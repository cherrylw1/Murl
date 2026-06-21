import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncClass } = require('node:sqlite');
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PageState } from '../browser/types.js';
import { CREATE_RUNS_TABLE, CREATE_STEPS_TABLE } from './schema.js';

export interface RunMetadata {
  id?: string;
  goal: string;
  startUrl: string;
  providerId: string;
  model: string;
}

export interface StepInput {
  runId: string;
  turn: number;
  thought?: string;
  action: unknown;
  pageState?: PageState;
  note?: string;
  screenshot?: Buffer;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface FinishOptions {
  status: 'complete' | 'max_turns' | 'error';
  result?: unknown;
  error?: string;
}

export class Recorder {
  readonly db: DatabaseSync;
  private readonly screenshotDir: string;

  constructor(opts?: { dbPath?: string; screenshotDir?: string }) {
    const dbPath = opts?.dbPath ?? './murl-data/murl.db';
    this.screenshotDir = opts?.screenshotDir ?? './murl-data/screenshots';

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    this.db = new DatabaseSyncClass(dbPath) as DatabaseSync;
    this.db.exec(CREATE_RUNS_TABLE);
    this.db.exec(CREATE_STEPS_TABLE);
  }

  startRun(meta: RunMetadata): string {
    const id = meta.id || crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, goal, start_url, provider_id, model, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      meta.goal,
      meta.startUrl,
      meta.providerId,
      meta.model,
      'running',
      Date.now(),
    );
    return id;
  }

  recordStep(input: StepInput): void {
    const actionJson = JSON.stringify(input.action);
    const pageStateJson = input.pageState
      ? JSON.stringify(input.pageState)
      : null;

    let screenshotPath: string | null = null;
    if (input.screenshot) {
      const dir = path.join(this.screenshotDir, input.runId);
      fs.mkdirSync(dir, { recursive: true });
      const filename = `turn-${input.turn}.png`;
      const fullPath = path.resolve(path.join(dir, filename));
      fs.writeFileSync(fullPath, input.screenshot);
      screenshotPath = fullPath;
    }

    const stmt = this.db.prepare(`
      INSERT INTO steps (
        run_id, turn, thought, action_json, page_url, page_title, page_state_json,
        note, screenshot_path, prompt_tokens, completion_tokens, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      input.runId,
      input.turn,
      input.thought ?? null,
      actionJson,
      input.pageState?.url ?? null,
      input.pageState?.title ?? null,
      pageStateJson,
      input.note ?? null,
      screenshotPath,
      input.usage?.promptTokens ?? null,
      input.usage?.completionTokens ?? null,
      Date.now(),
    );
  }

  finishRun(runId: string, opts: FinishOptions): void {
    const resultJson =
      opts.result !== undefined ? JSON.stringify(opts.result) : null;
    const stmt = this.db.prepare(`
      UPDATE runs
      SET status = ?, result_json = ?, error = ?, finished_at = ?
      WHERE id = ?
    `);
    stmt.run(opts.status, resultJson, opts.error ?? null, Date.now(), runId);
  }

  getRun(
    runId: string,
  ):
    | { run: Record<string, unknown>; steps: Record<string, unknown>[] }
    | undefined {
    const runStmt = this.db.prepare('SELECT * FROM runs WHERE id = ?');
    const runRows = runStmt.all(runId) as Record<string, unknown>[];
    if (runRows.length === 0) {
      return undefined;
    }

    const runRow = runRows[0];
    const stepsStmt = this.db.prepare(
      'SELECT * FROM steps WHERE run_id = ? ORDER BY turn ASC',
    );
    const stepRows = stepsStmt.all(runId) as Record<string, unknown>[];

    const run = {
      ...runRow,
      result:
        typeof runRow.result_json === 'string'
          ? JSON.parse(runRow.result_json)
          : undefined,
    };

    const steps = stepRows.map((step) => ({
      ...step,
      action:
        typeof step.action_json === 'string'
          ? JSON.parse(step.action_json)
          : undefined,
      pageState:
        typeof step.page_state_json === 'string'
          ? JSON.parse(step.page_state_json)
          : undefined,
    }));

    return { run, steps };
  }

  close(): void {
    this.db.close();
  }
}
