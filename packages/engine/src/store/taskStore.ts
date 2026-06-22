import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncClass } = require('node:sqlite');
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  CREATE_REPOSITORIES_TABLE,
  CREATE_TASKS_TABLE,
  CREATE_TASK_LOGS_TABLE,
} from './schema.js';

export interface Repository {
  id: string;
  path: string;
  name: string;
  createdAt: number;
}

export interface Task {
  id: string;
  workspaceId: string; // matches the schema's workspace_id
  prompt: string;
  branchName: string;
  worktreePath: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt: number;
  finishedAt?: number;
}

export interface TaskLog {
  id: string;
  taskId: string;
  type: 'stdout' | 'stderr' | 'info' | 'error' | 'diff';
  content: string;
  createdAt: number;
}

export class TaskStore {
  readonly db: DatabaseSync;

  constructor(opts?: { dbPath?: string }) {
    const dbPath = opts?.dbPath ?? './murl-data/murl.db';
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new DatabaseSyncClass(dbPath) as DatabaseSync;
    this.db.exec(CREATE_REPOSITORIES_TABLE);
    this.db.exec(CREATE_TASKS_TABLE);
    this.db.exec(CREATE_TASK_LOGS_TABLE);
  }

  // Repositories CRUD
  addRepository(name: string, repoPath: string): { id: string } {
    const id = crypto.randomUUID();
    const normalizedPath = path.normalize(repoPath);
    const stmt = this.db.prepare(`
      INSERT INTO repositories (id, path, name, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, normalizedPath, name, Date.now());
    return { id };
  }

  listRepositories(): Repository[] {
    const stmt = this.db.prepare(`
      SELECT id, path, name, created_at as createdAt
      FROM repositories
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as { id: string; path: string; name: string; createdAt: number }[];
    return rows;
  }

  removeRepository(id: string): void {
    const stmt = this.db.prepare('DELETE FROM repositories WHERE id = ?');
    stmt.run(id);
  }

  // Tasks CRUD
  createTask(
    workspaceId: string,
    prompt: string,
    branchName: string,
    worktreePath: string,
  ): { id: string } {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, workspace_id, prompt, branch_name, worktree_path, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, workspaceId, prompt, branchName, worktreePath, 'queued', Date.now());
    return { id };
  }

  updateTaskStatus(id: string, status: Task['status'], errorMessage?: string | null): void {
    const isFinished = status === 'completed' || status === 'failed';
    const finishedAt = isFinished ? Date.now() : null;

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, error_message = ?, finished_at = ?
      WHERE id = ?
    `);
    stmt.run(status, errorMessage ?? null, finishedAt, id);
  }

  getTask(id: string): Task | undefined {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const rows = stmt.all(id) as Record<string, unknown>[];
    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      prompt: row.prompt as string,
      branchName: row.branch_name as string,
      worktreePath: row.worktree_path as string,
      status: row.status as Task['status'],
      errorMessage: (row.error_message as string | null) ?? undefined,
      createdAt: row.created_at as number,
      finishedAt: (row.finished_at as number | null) ?? undefined,
    };
  }

  listTasks(): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      prompt: row.prompt as string,
      branchName: row.branch_name as string,
      worktreePath: row.worktree_path as string,
      status: row.status as Task['status'],
      errorMessage: (row.error_message as string | null) ?? undefined,
      createdAt: row.created_at as number,
      finishedAt: (row.finished_at as number | null) ?? undefined,
    }));
  }

  // Logs CRUD
  appendTaskLog(taskId: string, type: TaskLog['type'], content: string): void {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO task_logs (id, task_id, type, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, taskId, type, content, Date.now());
  }

  getTaskLogs(taskId: string): TaskLog[] {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, type, content, created_at as createdAt
      FROM task_logs
      WHERE task_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      taskId: r.taskId as string,
      type: r.type as TaskLog['type'],
      content: r.content as string,
      createdAt: r.createdAt as number,
    }));
  }

  close(): void {
    this.db.close();
  }
}
