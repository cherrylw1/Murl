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
  | { type: 'status';   runId: string; status: 'running' | 'done' | 'error' | 'needs_human' }
  | { type: 'step';     runId: string; turn: number; reasoning?: string; action: import('@murl/engine').Action; screenshot?: string }
  | { type: 'done';     runId: string; extracted: unknown }
  | { type: 'error';    runId: string; message: string };

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
  };
}






