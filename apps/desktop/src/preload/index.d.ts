type ProviderId = 'openrouter' | 'gemini' | 'ollama' | 'together';

interface SettingsView {
  activeProvider: ProviderId;
  activeModel: string;
  providers: {
    openrouter: { configured: boolean };
    gemini:     { configured: boolean };
    together:   { configured: boolean };
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
    repo: {
      add(name: string, path: string): Promise<{ id: string }>;
      list(): Promise<Repository[]>;
      remove(id: string): Promise<{ ok: boolean }>;
    };
    tasks: {
      start(input: { prompt: string; workspaceId: string; repoPath: string }): Promise<{ taskId: string }>;
      cancel(input: { taskId: string; repoPath: string }): Promise<{ ok: boolean }>;
      getState(): Promise<TaskState[]>;
      onEvent(cb: (e: TaskEvent) => void): () => void;
    };
  };
}

interface Repository {
  id: string;
  path: string;
  name: string;
  createdAt: number;
}

interface TaskState {
  taskId: string;
  workspaceId: string;
  prompt: string;
  branchName: string;
  worktreePath: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error?: string;
}

interface Task {
  id: string;
  workspaceId: string;
  prompt: string;
  branchName: string;
  worktreePath: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt: number;
  finishedAt?: number;
}

type TaskEvent =
  | { type: 'started'; taskId: string }
  | { type: 'status'; taskId: string; status: 'queued' | 'running' | 'completed' | 'failed' }
  | { type: 'info'; taskId: string; message: string }
  | { type: 'stdout'; taskId: string; message: string }
  | { type: 'stderr'; taskId: string; message: string }
  | { type: 'error'; taskId: string; message: string }
  | { type: 'done'; taskId: string };



