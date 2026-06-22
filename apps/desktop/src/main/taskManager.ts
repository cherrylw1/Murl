import { WebContents } from 'electron';
import * as path from 'path';
import { TaskStore, Task } from '@murl/engine';
import { WorktreeManager } from '@murl/engine';

export interface TaskState {
  taskId: string;
  workspaceId: string;
  prompt: string;
  branchName: string;
  worktreePath: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error?: string;
}

interface QueuedTask {
  taskId: string;
  workspaceId: string;
  prompt: string;
  branchName: string;
  worktreePath: string;
  sender: WebContents;
}

export class TaskManager {
  private tasks = new Map<string, TaskState>();
  private queue: QueuedTask[] = [];
  private activeCount = 0;
  private maxConcurrent = 3;

  constructor(
    private taskStore: TaskStore,
    private worktreeManager: WorktreeManager,
  ) {}

  getStates(): TaskState[] {
    return Array.from(this.tasks.values()).reverse();
  }

  enqueue(
    taskId: string,
    prompt: string,
    workspaceId: string, // repository ID or path
    repoPath: string, // resolved absolute base repo path
    sender: WebContents,
  ): void {
    const branchName = `murl-task-${taskId}`;
    const worktreePath = path.join(this.worktreeManager.getWorktreeBaseDir(), `task-${taskId}`);

    const state: TaskState = {
      taskId,
      workspaceId,
      prompt,
      branchName,
      worktreePath,
      status: 'queued',
    };
    this.tasks.set(taskId, state);

    // Save to sqlite database
    try {
      this.taskStore.createTask(workspaceId, prompt, branchName, worktreePath);
    } catch (err) {
      console.error('[TaskManager] Failed to save task to SQLite:', err);
    }

    sender.send('task:event', {
      type: 'status',
      taskId,
      status: 'queued',
    });

    this.queue.push({
      taskId,
      workspaceId,
      prompt,
      branchName,
      worktreePath,
      sender,
    });

    this.processQueue(repoPath);
  }

  cancel(taskId: string, repoPath: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // 1. Check if it's in the queue
    const queueIndex = this.queue.findIndex((q) => q.taskId === taskId);
    if (queueIndex !== -1) {
      const qItem = this.queue[queueIndex];
      this.queue.splice(queueIndex, 1);

      task.status = 'failed';
      task.error = 'Cancelled';

      try {
        this.taskStore.updateTaskStatus(taskId, 'failed', 'Cancelled while queued');
      } catch (err) {
        console.error('[TaskManager] Failed to update task status in SQLite:', err);
      }

      qItem.sender.send('task:event', {
        type: 'status',
        taskId,
        status: 'failed',
      });
      qItem.sender.send('task:event', {
        type: 'error',
        taskId,
        message: 'Task cancelled while queued',
      });

      return true;
    }

    // 2. If it's active/running
    if (task.status === 'running') {
      task.status = 'failed';
      task.error = 'Cancelled';

      try {
        this.taskStore.updateTaskStatus(taskId, 'failed', 'Cancelled by user');
      } catch (err) {
        console.error('[TaskManager] Failed to update task status in SQLite:', err);
      }

      // Find sender associated with task in states
      // In this phase, we prune the worktree on cancellation
      this.worktreeManager
        .pruneWorktree(repoPath, task.worktreePath, task.branchName)
        .catch((err) => {
          console.error(`[TaskManager] Failed to prune worktree on cancel for task ${taskId}:`, err);
        });

      return true;
    }

    return false;
  }

  private async processQueue(repoPath: string) {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const next = this.queue.shift();
    if (!next) return;

    this.activeCount++;
    const state = this.tasks.get(next.taskId);
    if (state) {
      state.status = 'running';
    }

    // Stagger starts by 750ms
    await new Promise((resolve) => setTimeout(resolve, 750));

    this.executeTask(next, repoPath);
  }

  private async executeTask(item: QueuedTask, repoPath: string) {
    const { taskId, prompt, branchName, worktreePath, sender } = item;
    const state = this.tasks.get(taskId);

    try {
      if (state) {
        state.status = 'running';
      }
      this.taskStore.updateTaskStatus(taskId, 'running');

      sender.send('task:event', { type: 'started', taskId });
      sender.send('task:event', { type: 'status', taskId, status: 'running' });

      // Create the worktree
      sender.send('task:event', {
        type: 'info',
        taskId,
        message: `Creating Git worktree on branch ${branchName}...`,
      });
      this.taskStore.appendTaskLog(taskId, 'info', `Creating Git worktree on branch ${branchName}...`);

      const wtResult = await this.worktreeManager.createWorktree(repoPath, taskId);
      
      sender.send('task:event', {
        type: 'info',
        taskId,
        message: `Worktree initialized at ${wtResult.worktreePath}`,
      });
      this.taskStore.appendTaskLog(taskId, 'info', `Worktree initialized at ${wtResult.worktreePath}`);

      // Simulating task execution for CH-1 skeleton
      const logs = [
        'Initializing OpenCode CLI agent...',
        'Checking workspace environment details...',
        'Running headless code generation task...',
        'Analyzing modifications...',
        'Executing local test harness...',
        'Task completed successfully.',
      ];

      for (let i = 0; i < logs.length; i++) {
        // Wait 800ms between logs
        await new Promise((resolve) => setTimeout(resolve, 800));

        // Check if task was cancelled mid-run
        const currentTask = this.tasks.get(taskId);
        if (!currentTask || currentTask.status === 'failed') {
          throw new Error('Task was cancelled.');
        }

        const logType = i === logs.length - 1 ? 'info' : 'stdout';
        sender.send('task:event', {
          type: logType,
          taskId,
          message: logs[i],
        });
        this.taskStore.appendTaskLog(taskId, logType, logs[i]);
      }

      // Check one last time before marking complete
      const finalState = this.tasks.get(taskId);
      if (finalState && finalState.status !== 'failed') {
        finalState.status = 'completed';
        this.taskStore.updateTaskStatus(taskId, 'completed');
        sender.send('task:event', { type: 'status', taskId, status: 'completed' });
        sender.send('task:event', { type: 'done', taskId });
      }

    } catch (err: any) {
      console.error(`[TaskManager] Error executing task ${taskId}:`, err);
      
      const errMsg = err?.message || String(err);
      if (state) {
        state.status = 'failed';
        state.error = errMsg;
      }
      this.taskStore.updateTaskStatus(taskId, 'failed', errMsg);
      this.taskStore.appendTaskLog(taskId, 'error', errMsg);

      sender.send('task:event', { type: 'error', taskId, message: errMsg });
      sender.send('task:event', { type: 'status', taskId, status: 'failed' });

      // Only prune automatically on failures/errors
      sender.send('task:event', {
        type: 'info',
        taskId,
        message: 'Pruning git worktree and branch due to error...',
      });
      try {
        await this.worktreeManager.pruneWorktree(repoPath, worktreePath, branchName);
      } catch (pruneErr) {
        console.error(`[TaskManager] Failed to prune worktree for task ${taskId}:`, pruneErr);
      }
    } finally {
      this.activeCount--;
      this.processQueue(repoPath);
    }
  }
}
