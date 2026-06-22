type ProviderId = 'openrouter' | 'gemini' | 'ollama';

interface SettingsView {
  activeProvider: ProviderId;
  activeModel: string;
  providers: {
    openrouter: { configured: boolean };
    gemini:     { configured: boolean };
    ollama:     { baseUrl: string };
  };
}

interface RunInput {
  goal: string;
  url: string;
}

type RunEvent =
  | { type: 'started';  runId: string }
  | { type: 'status';   runId: string; status: 'queued' | 'running' | 'done' | 'error' | 'needs_human' }
  | { type: 'step';     runId: string; turn: number; reasoning?: string; action: import('@murl/engine').Action; screenshot?: string }
  | { type: 'done';     runId: string; extracted: unknown }
  | { type: 'error';    runId: string; message: string };

interface RunState {
  runId: string;
  goal: string;
  url: string;
  status: 'queued' | 'running' | 'done' | 'error';
  currentTurn?: number;
  lastScreenshot?: string;
  error?: string;
}

interface RunSummary {
  id: string;
  goal: string;
  url: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
}

interface RunStep {
  turn: number;
  reasoning?: string;
  action: any;
  screenshot?: string;
}

interface RunDetail {
  id: string;
  goal: string;
  url: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  steps: RunStep[];
  extracted?: any;
  error?: string;
}

interface Window {
  murl: {
    engineHealth(): Promise<string>;
    settings: {
      get(): Promise<SettingsView>;
      setKey(id: ProviderId, key: string): Promise<{ ok: boolean }>;
      clearKey(id: ProviderId): Promise<{ ok: boolean }>;
      setActive(id: ProviderId, model: string): Promise<{ ok: boolean }>;
      setOllamaBaseUrl(url: string): Promise<{ ok: boolean }>;
      test(id: ProviderId): Promise<{ ok: boolean; error?: string }>;
    };
    runs: {
      start(input: RunInput): Promise<{ runId: string }>;
      cancel(runId: string): Promise<{ ok: boolean }>;
      getState(): Promise<RunState[]>;
      onEvent(cb: (e: RunEvent) => void): () => void;
    };
    history: {
      list(): Promise<RunSummary[]>;
      get(id: string): Promise<RunDetail | null>;
    };
  };
}






