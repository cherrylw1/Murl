import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Recorder } from './recorder.js';
import { BrowserSession } from '../browser/session.js';
import { LLMProvider, CompletionResponse } from '../providers/types.js';
import { runAgent } from '../agent/loop.js';

class FakeProvider implements LLMProvider {
  readonly id = 'ollama';
  private queue: string[];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async complete(): Promise<CompletionResponse> {
    const next = this.queue.shift();
    if (!next) {
      return {
        text: '{"action": "complete", "result": null, "thought": "Queue exhausted"}',
      };
    }
    return { text: next, usage: { promptTokens: 10, completionTokens: 20 } };
  }

  async *stream(): AsyncIterable<string> {
    throw new Error('unused');
  }
}

describe('Recorder', () => {
  it('correctly persists and reconstructs runs and steps from the database', () => {
    const dbName = `murl-test-${crypto.randomUUID()}.db`;
    const tempDir = path.join(
      os.tmpdir(),
      `murl-screenshots-${crypto.randomUUID()}`,
    );
    const dbPath = path.join(os.tmpdir(), dbName);

    const recorder = new Recorder({ dbPath, screenshotDir: tempDir });

    const runId = recorder.startRun({
      goal: 'Test persisting run data',
      startUrl: 'https://example.com',
      providerId: 'ollama',
      model: 'llama3',
    });

    const fakePng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);

    const step1 = {
      runId,
      turn: 1,
      thought: 'First step thought',
      action: { action: 'click', ref: 0, thought: 'First step thought' },
      pageState: {
        url: 'https://example.com',
        title: 'Example Domain',
        text: 'Visible page text...',
        elements: [],
      },
      note: 'Note for turn 1',
      screenshot: fakePng,
      usage: { promptTokens: 10, completionTokens: 15 },
    };

    const step2 = {
      runId,
      turn: 2,
      thought: 'Second step thought',
      action: {
        action: 'complete',
        result: { success: true },
        thought: 'Second step thought',
      },
      pageState: {
        url: 'https://example.com/next',
        title: 'Next Page',
        text: 'Visible next page text...',
        elements: [],
      },
      note: 'Note for turn 2',
      screenshot: undefined,
      usage: { promptTokens: 20, completionTokens: 25 },
    };

    recorder.recordStep(step1);
    recorder.recordStep(step2);

    recorder.finishRun(runId, {
      status: 'complete',
      result: { finalOutput: 'success' },
    });

    recorder.close();

    // Reopen NEW Recorder on the same db
    const newRecorder = new Recorder({ dbPath, screenshotDir: tempDir });
    const data = newRecorder.getRun(runId);

    expect(data).toBeDefined();
    if (!data) return;

    const { run, steps } = data;

    // Verify run metadata
    expect(run.id).toBe(runId);
    expect(run.goal).toBe('Test persisting run data');
    expect(run.start_url).toBe('https://example.com');
    expect(run.provider_id).toBe('ollama');
    expect(run.model).toBe('llama3');
    expect(run.status).toBe('complete');
    expect(run.result).toEqual({ finalOutput: 'success' });
    expect(run.created_at).toBeTypeOf('number');
    expect(run.finished_at).toBeTypeOf('number');

    // Verify steps
    expect(steps).toHaveLength(2);

    // Step 1 assertions
    expect(steps[0].turn).toBe(1);
    expect(steps[0].thought).toBe('First step thought');
    expect(steps[0].action).toEqual(step1.action);
    expect(steps[0].page_url).toBe('https://example.com');
    expect(steps[0].page_title).toBe('Example Domain');
    expect(steps[0].pageState).toEqual(step1.pageState);
    expect(steps[0].note).toBe('Note for turn 1');
    expect(steps[0].prompt_tokens).toBe(10);
    expect(steps[0].completion_tokens).toBe(15);
    expect(steps[0].screenshot_path).toBeDefined();
    expect(typeof steps[0].screenshot_path).toBe('string');
    expect(fs.existsSync(steps[0].screenshot_path as string)).toBe(true);

    // Step 2 assertions
    expect(steps[1].turn).toBe(2);
    expect(steps[1].thought).toBe('Second step thought');
    expect(steps[1].action).toEqual(step2.action);
    expect(steps[1].page_url).toBe('https://example.com/next');
    expect(steps[1].page_title).toBe('Next Page');
    expect(steps[1].pageState).toEqual(step2.pageState);
    expect(steps[1].note).toBe('Note for turn 2');
    expect(steps[1].prompt_tokens).toBe(20);
    expect(steps[1].completion_tokens).toBe(25);
    expect(steps[1].screenshot_path).toBeNull();

    newRecorder.close();

    try {
      fs.unlinkSync(dbPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('correctly integrates with runAgent loop to record real session steps', async () => {
    const dbName = `murl-loop-test-${crypto.randomUUID()}.db`;
    const tempDir = path.join(
      os.tmpdir(),
      `murl-screenshots-${crypto.randomUUID()}`,
    );
    const dbPath = path.join(os.tmpdir(), dbName);

    const recorder = new Recorder({ dbPath, screenshotDir: tempDir });
    const session = await BrowserSession.launch({ headless: true });
    await session.setContent('<button>Submit</button><input type="text" />');

    const provider = new FakeProvider([
      '{"action": "type", "ref": 1, "text": "hello", "thought": "Typing hello"}',
      '{"action": "complete", "result": {"success": true}, "thought": "Goal reached"}',
    ]);

    const runResult = await runAgent({
      goal: 'Loop integration test goal',
      url: 'about:blank',
      provider,
      model: 'test-model',
      session,
      recorder,
      maxTurns: 3,
    });

    expect(runResult.status).toBe('complete');

    // Query DB to inspect results
    const runStmt = recorder.db.prepare(
      'SELECT id FROM runs ORDER BY created_at DESC LIMIT 1',
    );
    const rows = runStmt.all() as { id: string }[];
    expect(rows).toHaveLength(1);
    const runId = rows[0].id;

    const data = recorder.getRun(runId);
    expect(data).toBeDefined();
    if (!data) return;

    expect(data.run.goal).toBe('Loop integration test goal');
    expect(data.run.status).toBe('complete');
    expect(data.run.result).toEqual({ success: true });

    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].turn).toBe(1);
    expect(data.steps[0].action).toEqual({
      action: 'type',
      ref: 1,
      text: 'hello',
      thought: 'Typing hello',
    });
    expect(data.steps[0].prompt_tokens).toBe(10);
    expect(data.steps[0].completion_tokens).toBe(20);

    expect(data.steps[0].screenshot_path).toBeDefined();
    expect(typeof data.steps[0].screenshot_path).toBe('string');
    expect(fs.existsSync(data.steps[0].screenshot_path as string)).toBe(true);

    await session.close();
    recorder.close();

    try {
      fs.unlinkSync(dbPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('correctly lists runs newest first', () => {
    const dbName = `murl-list-test-${crypto.randomUUID()}.db`;
    const tempDir = path.join(
      os.tmpdir(),
      `murl-screenshots-${crypto.randomUUID()}`,
    );
    const dbPath = path.join(os.tmpdir(), dbName);

    const recorder = new Recorder({ dbPath, screenshotDir: tempDir });

    const runId1 = recorder.startRun({
      goal: 'First run',
      startUrl: 'https://example.com/1',
      providerId: 'ollama',
      model: 'llama3',
    });
    recorder.finishRun(runId1, { status: 'complete' });

    // Wait a tiny bit to guarantee different timestamps
    const start = Date.now();
    while (Date.now() - start < 5) {}

    const runId2 = recorder.startRun({
      goal: 'Second run',
      startUrl: 'https://example.com/2',
      providerId: 'ollama',
      model: 'llama3',
    });
    recorder.finishRun(runId2, { status: 'error', error: 'some error' });

    const summaries = recorder.listRuns();
    expect(summaries).toHaveLength(2);
    expect(summaries[0].id).toBe(runId2);
    expect(summaries[0].goal).toBe('Second run');
    expect(summaries[0].status).toBe('error');
    expect(summaries[1].id).toBe(runId1);
    expect(summaries[1].goal).toBe('First run');
    expect(summaries[1].status).toBe('complete');

    recorder.close();

    try {
      fs.unlinkSync(dbPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });
});
