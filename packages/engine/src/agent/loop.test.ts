import { describe, it, expect, afterEach } from 'vitest';
import { BrowserSession } from '../browser/session.js';
import { LLMProvider, CompletionResponse } from '../providers/types.js';
import { runAgent } from './loop.js';
import { parseAction } from './actions.js';

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
    return { text: next };
  }

  async *stream(): AsyncIterable<string> {
    throw new Error('unused');
  }
}

describe('runAgent Loop', () => {
  let session: BrowserSession | null = null;

  afterEach(async () => {
    if (session) {
      await session.close();
      session = null;
    }
  });

  it('T1 happy path: runs type, click, extract, and complete actions', async () => {
    session = await BrowserSession.launch({ headless: true });
    await session.setContent('<button>Submit</button><input type="text" />');

    const provider = new FakeProvider([
      '{"action": "type", "ref": 1, "text": "hello", "thought": "Typing hello"}',
      '{"action": "click", "ref": 0, "thought": "Clicking submit"}',
      '{"action": "extract", "data": {"found": true}, "thought": "Extracting findings"}',
      '{"action": "complete", "result": {"done": true}, "thought": "Finished successfully"}',
    ]);

    const result = await runAgent({
      goal: 'Type hello, submit, extract and complete',
      url: 'about:blank',
      provider,
      model: 'test-model',
      session,
      maxTurns: 5,
    });

    expect(result.status).toBe('complete');
    expect(result.steps).toHaveLength(4);
    expect(result.extracted).toEqual([{ found: true }]);
    expect(result.result).toEqual({ done: true });

    // Verify correct fields on a step
    expect(result.steps[0].action).toEqual({
      action: 'type',
      ref: 1,
      text: 'hello',
      thought: 'Typing hello',
    });
  });

  it('T2 max turns: fails safely under max turns cap', async () => {
    session = await BrowserSession.launch({ headless: true });
    await session.setContent('<button>Submit</button><input type="text" />');

    // Always returns scroll action
    const provider = new FakeProvider([
      '{"action": "scroll", "direction": "down", "thought": "Scroll turn 1"}',
      '{"action": "scroll", "direction": "down", "thought": "Scroll turn 2"}',
      '{"action": "scroll", "direction": "down", "thought": "Scroll turn 3"}',
      '{"action": "scroll", "direction": "down", "thought": "Scroll turn 4"}',
    ]);

    const result = await runAgent({
      goal: 'Try to achieve goal',
      url: 'about:blank',
      provider,
      model: 'test-model',
      session,
      maxTurns: 3,
    });

    expect(result.status).toBe('max_turns');
    expect(result.steps).toHaveLength(3);
  });

  it('T3 bad output: handles parsing failures by returning error status', async () => {
    session = await BrowserSession.launch({ headless: true });
    await session.setContent('<button>Submit</button><input type="text" />');

    const provider = new FakeProvider(['not json']);

    const result = await runAgent({
      goal: 'Achieve goal with bad output provider',
      url: 'about:blank',
      provider,
      model: 'test-model',
      session,
      maxTurns: 3,
    });

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].note).toContain('Unexpected token');
  });

  describe('parseAction Unit Tests', () => {
    it('successfully parses a valid action', () => {
      const valid = { action: 'click', ref: 5, thought: 'Let us click ref 5' };
      const parsed = parseAction(valid);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.action).toEqual(valid);
      }
    });

    it('fails on an invalid action', () => {
      const invalid = { action: 'click', ref: 'five' }; // ref should be number
      const parsed = parseAction(invalid);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toContain('ref');
      }
    });
  });
});
