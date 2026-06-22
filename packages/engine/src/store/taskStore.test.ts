import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { TaskStore } from './taskStore.js';

describe('TaskStore', () => {
  it('handles repositories, tasks, and task logs persistence correctly', () => {
    const dbName = `murl-test-tasks-${crypto.randomUUID()}.db`;
    const dbPath = path.join(os.tmpdir(), dbName);

    const store = new TaskStore({ dbPath });

    try {
      // 1. Test Repositories CRUD
      const repoPath = path.join(os.tmpdir(), `test-repo-${crypto.randomUUID()}`);
      const repoResult = store.addRepository('test-project', repoPath);
      expect(repoResult.id).toBeDefined();

      const repos = store.listRepositories();
      expect(repos.length).toBe(1);
      expect(repos[0].name).toBe('test-project');
      expect(path.normalize(repos[0].path)).toBe(path.normalize(repoPath));

      // 2. Test Tasks CRUD
      const taskResult = store.createTask(
        repoResult.id,
        'Create test.txt containing Hello',
        'murl-task-test',
        path.join(os.tmpdir(), 'worktrees', 'test-task'),
      );
      expect(taskResult.id).toBeDefined();

      const task = store.getTask(taskResult.id);
      expect(task).toBeDefined();
      expect(task!.workspaceId).toBe(repoResult.id);
      expect(task!.status).toBe('queued');
      expect(task!.prompt).toBe('Create test.txt containing Hello');

      // Update task to running
      store.updateTaskStatus(taskResult.id, 'running');
      const runningTask = store.getTask(taskResult.id);
      expect(runningTask!.status).toBe('running');
      expect(runningTask!.finishedAt).toBeUndefined();

      // Update task to completed
      store.updateTaskStatus(taskResult.id, 'completed');
      const completedTask = store.getTask(taskResult.id);
      expect(completedTask!.status).toBe('completed');
      expect(completedTask!.finishedAt).toBeDefined();

      // List tasks
      const allTasks = store.listTasks();
      expect(allTasks.length).toBe(1);
      expect(allTasks[0].id).toBe(taskResult.id);

      // 3. Test Task Logs CRUD
      store.appendTaskLog(taskResult.id, 'stdout', 'Starting OpenCode agent...\n');
      store.appendTaskLog(taskResult.id, 'info', 'Worktree created successfully.\n');
      store.appendTaskLog(taskResult.id, 'stdout', 'Creating file...\n');
      store.appendTaskLog(taskResult.id, 'diff', 'diff --git a/test.txt b/test.txt\n+Hello');

      const logs = store.getTaskLogs(taskResult.id);
      expect(logs.length).toBe(4);
      expect(logs[0].type).toBe('stdout');
      expect(logs[0].content).toBe('Starting OpenCode agent...\n');
      expect(logs[1].type).toBe('info');
      expect(logs[2].type).toBe('stdout');
      expect(logs[3].type).toBe('diff');

      // Remove Repository
      store.removeRepository(repoResult.id);
      const remainingRepos = store.listRepositories();
      expect(remainingRepos.length).toBe(0);

    } finally {
      store.close();
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    }
  });
});
