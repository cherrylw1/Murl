import { BrowserSession } from '../browser/session.js';
import { LLMProvider } from '../providers/types.js';
import { Action, parseAction } from './actions.js';
import { buildMessages } from './prompt.js';

export interface AgentStep {
  turn: number;
  thought?: string;
  action: Action;
  pageUrl: string;
  note?: string;
}

export interface RunResult {
  status: 'complete' | 'max_turns' | 'error';
  steps: AgentStep[];
  extracted: unknown[];
  result?: unknown;
  error?: string;
}

export interface RunOptions {
  goal: string;
  url: string;
  provider: LLMProvider;
  model: string;
  maxTurns?: number; // default 5
  session?: BrowserSession;
}

function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  let cleaned = trimmed;
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    if (lines[0].startsWith('```')) {
      lines.shift();
    }
    if (lines[lines.length - 1].startsWith('```')) {
      lines.pop();
    }
    cleaned = lines.join('\n').trim();
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

async function applyAction(
  session: BrowserSession,
  action: Action,
  extracted: unknown[],
): Promise<{ note?: string; result?: unknown; done?: boolean }> {
  try {
    switch (action.action) {
      case 'click':
        await session.page.click(`[data-murl-ref="${action.ref}"]`, {
          timeout: 5000,
        });
        break;
      case 'type':
        await session.page.fill(
          `[data-murl-ref="${action.ref}"]`,
          action.text,
          { timeout: 5000 },
        );
        break;
      case 'scroll':
        await session.page.mouse.wheel(
          0,
          action.direction === 'down' ? 800 : -800,
        );
        // Wait briefly for scroll to render
        await session.page.waitForTimeout(500).catch(() => {});
        break;
      case 'extract':
        extracted.push(action.data);
        break;
      case 'complete':
        return { result: action.result, done: true };
      default:
        break;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { note: errorMsg };
  }
  return {};
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const maxTurns = opts.maxTurns ?? 5;
  const steps: AgentStep[] = [];
  const extracted: unknown[] = [];
  let result: unknown = undefined;

  let session: BrowserSession;
  let ownSession = false;

  if (opts.session) {
    session = opts.session;
  } else {
    session = await BrowserSession.launch({ headless: true });
    ownSession = true;
  }

  try {
    await session.goto(opts.url);

    for (let turn = 1; turn <= maxTurns; turn++) {
      const page = await session.getPageState();
      const messages = buildMessages(opts.goal, page);

      let resText = '';
      try {
        const res = await opts.provider.complete({
          model: opts.model,
          messages,
          responseFormat: 'json',
        });
        resText = res.text;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        steps.push({
          turn,
          thought: 'LLM completion failed',
          action: { action: 'complete', result: null, thought: 'API failure' },
          pageUrl: page.url,
          note: errorMsg,
        });
        return { status: 'error', steps, extracted, error: errorMsg };
      }

      let action: Action;
      let thought: string | undefined = undefined;
      try {
        const cleaned = cleanJsonText(resText);
        const parsed = JSON.parse(cleaned) as unknown;
        const parseRes = parseAction(parsed);
        if (!parseRes.ok) {
          throw new Error(parseRes.error);
        }
        action = parseRes.action;
        thought = action.thought;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        steps.push({
          turn,
          thought: 'Failed to parse action JSON',
          action: {
            action: 'complete',
            result: null,
            thought: 'JSON parse error',
          },
          pageUrl: page.url,
          note: errorMsg,
        });
        return { status: 'error', steps, extracted, error: errorMsg };
      }

      const applyRes = await applyAction(session, action, extracted);

      steps.push({
        turn,
        thought,
        action,
        pageUrl: page.url,
        note: applyRes.note,
      });

      if (applyRes.done) {
        result = applyRes.result;
        return { status: 'complete', steps, extracted, result };
      }
    }

    return { status: 'max_turns', steps, extracted };
  } finally {
    if (ownSession) {
      await session.close().catch(() => {});
    }
  }
}
