import React, { useEffect, useState } from 'react';

export type ProviderId = 'openrouter' | 'gemini' | 'ollama';

export interface SettingsView {
  activeProvider: ProviderId;
  activeModel: string;
  providers: {
    openrouter: { configured: boolean };
    gemini:     { configured: boolean };
    ollama:     { baseUrl: string };
  };
}

declare global {
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
}

const PROVIDER_MODELS: Record<ProviderId, string[]> = {
  openrouter: [
    'google/gemini-2.5-flash',
    'meta-llama/llama-3-8b-instruct:free',
    'deepseek/deepseek-chat'
  ],
  gemini: [
    'gemini-1.5-flash',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ],
  ollama: [
    'llama3',
    'mistral',
    'phi3'
  ]
};

export default function Settings(): JSX.Element {
  const [view, setView] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);

  // Input states
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('');
  const [modelInput, setModelInput] = useState('');

  // Status and error states
  const [testStatuses, setTestStatuses] = useState<Record<ProviderId, 'idle' | 'testing' | 'success' | 'failed'>>({
    openrouter: 'idle',
    gemini: 'idle',
    ollama: 'idle',
  });

  const [testErrors, setTestErrors] = useState<Record<ProviderId, string | null>>({
    openrouter: null,
    gemini: null,
    ollama: null,
  });

  const loadSettings = async () => {
    try {
      const settingsView = await window.murl.settings.get();
      setView(settingsView);
      setOllamaBaseUrl(settingsView.providers.ollama.baseUrl || '');
      setModelInput(settingsView.activeModel || '');
    } catch (err) {
      console.error('Failed to load settings', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const isConfigured = (id: ProviderId): boolean => {
    if (!view) return false;
    if (id === 'ollama') {
      return !!view.providers.ollama?.baseUrl;
    }
    return !!view.providers[id]?.configured;
  };

  const getStatusLabel = (id: ProviderId): string => {
    if (testStatuses[id] === 'failed') return 'ERROR';
    if (testStatuses[id] === 'testing') return 'TESTING';
    if (testStatuses[id] === 'success') return 'PASSED';
    if (isConfigured(id)) return 'READY';
    return 'UNCONFIGURED';
  };

  const handleProviderChange = async (provider: ProviderId) => {
    if (!view) return;
    const models = PROVIDER_MODELS[provider];
    const model = models.includes(view.activeModel) ? view.activeModel : models[0];
    try {
      const res = await window.murl.settings.setActive(provider, model);
      if (res.ok) {
        await loadSettings();
      }
    } catch (err) {
      console.error('Failed to change provider', err);
    }
  };

  const handleInputChange = (val: string) => {
    setModelInput(val);
    if (view && PROVIDER_MODELS[view.activeProvider]?.includes(val)) {
      handleModelChange(val);
    }
  };

  const handleModelChange = async (model: string) => {
    if (!view) return;
    try {
      const res = await window.murl.settings.setActive(view.activeProvider, model);
      if (res.ok) {
        await loadSettings();
      }
    } catch (err) {
      console.error('Failed to change model', err);
    }
  };

  const handleSaveKey = async (provider: 'openrouter' | 'gemini') => {
    const key = provider === 'openrouter' ? openRouterKey : geminiKey;
    if (!key) return;
    try {
      const res = await window.murl.settings.setKey(provider, key);
      if (res.ok) {
        // Clear key state immediately to prevent keys from persisting in renderer memory
        if (provider === 'openrouter') setOpenRouterKey('');
        else setGeminiKey('');
        
        await loadSettings();
        setTestStatuses((prev) => ({ ...prev, [provider]: 'idle' }));
        setTestErrors((prev) => ({ ...prev, [provider]: null }));
      }
    } catch (err) {
      console.error(`Failed to save key for ${provider}`, err);
    }
  };

  const handleClearKey = async (provider: 'openrouter' | 'gemini') => {
    try {
      const res = await window.murl.settings.clearKey(provider);
      if (res.ok) {
        if (provider === 'openrouter') setOpenRouterKey('');
        else setGeminiKey('');

        await loadSettings();
        setTestStatuses((prev) => ({ ...prev, [provider]: 'idle' }));
        setTestErrors((prev) => ({ ...prev, [provider]: null }));
      }
    } catch (err) {
      console.error(`Failed to clear key for ${provider}`, err);
    }
  };

  const handleSaveOllamaBaseUrl = async () => {
    try {
      const res = await window.murl.settings.setOllamaBaseUrl(ollamaBaseUrl);
      if (res.ok) {
        await loadSettings();
        setTestStatuses((prev) => ({ ...prev, ollama: 'idle' }));
        setTestErrors((prev) => ({ ...prev, ollama: null }));
      }
    } catch (err) {
      console.error('Failed to save Ollama Base URL', err);
    }
  };

  const handleTestConnection = async (provider: ProviderId) => {
    setTestStatuses((prev) => ({ ...prev, [provider]: 'testing' }));
    setTestErrors((prev) => ({ ...prev, [provider]: null }));
    try {
      const res = await window.murl.settings.test(provider);
      if (res.ok) {
        setTestStatuses((prev) => ({ ...prev, [provider]: 'success' }));
      } else {
        setTestStatuses((prev) => ({ ...prev, [provider]: 'failed' }));
        setTestErrors((prev) => ({ ...prev, [provider]: res.error || 'Connection test failed.' }));
      }
    } catch (err: unknown) {
      setTestStatuses((prev) => ({ ...prev, [provider]: 'failed' }));
      const errorMessage = err instanceof Error ? err.message : String(err);
      setTestErrors((prev) => ({ ...prev, [provider]: errorMessage || 'Connection test threw an error.' }));
    }
  };

  const getModelsForProvider = (provider: ProviderId): string[] => {
    const defaults = PROVIDER_MODELS[provider] || [];
    if (view && view.activeProvider === provider && view.activeModel) {
      if (!defaults.includes(view.activeModel)) {
        return [...defaults, view.activeModel];
      }
    }
    return defaults;
  };

  if (loading) {
    return (
      <div className="flex-1 panel p-8 flex flex-col items-center justify-center text-center relative overflow-hidden">
        <span className="font-dot text-2xl text-aluminium tracking-wider animate-pulse">LOADING</span>
      </div>
    );
  }

  return (
    <div className="flex-1 panel p-8 flex flex-col overflow-y-auto min-h-0 select-text">
      {/* Title Header */}
      <div className="mb-8">
        <h2 className="font-dot text-2xl tracking-widest text-chalk uppercase mb-1">Settings</h2>
        <span className="text-xs uppercase tracking-label font-sans text-aluminium">Configure your LLM model and API key providers</span>
      </div>

      <div className="flex flex-col gap-6 max-w-4xl">
        {/* Section 1: Active Configuration */}
        <div className="flex flex-col gap-4 pb-8 border-b border-aluminium/10">
          <h3 className="text-xs uppercase tracking-label font-sans text-aluminium">Active Configuration</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Active Provider Selector */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-sans text-aluminium uppercase tracking-label">Provider</span>
              <div className="flex gap-2">
                {(['openrouter', 'gemini', 'ollama'] as ProviderId[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => handleProviderChange(p)}
                    className={`px-3 py-1.5 text-xs font-mono tracking-wider rounded border transition-all duration-150 cursor-pointer ${
                      view?.activeProvider === p
                        ? 'bg-chalk text-ink border-chalk shadow-active'
                        : 'bg-carbon text-aluminium border-aluminium/20 hover:text-chalk hover:border-aluminium/40'
                    }`}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Model Selector */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-sans text-aluminium uppercase tracking-label">Model</span>
              <input
                type="text"
                list="model-suggestions"
                value={modelInput}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={() => handleModelChange(modelInput)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleModelChange(modelInput);
                  }
                }}
                className="w-full max-w-sm bg-carbon text-chalk border border-aluminium/20 rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-chalk/60 focus:border-chalk/60 transition-all"
                placeholder="Select or type model ID"
              />
              <datalist id="model-suggestions">
                {getModelsForProvider(view?.activeProvider || 'openrouter').map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <span className="text-[10px] font-mono tracking-wider text-aluminium/70 mt-1">
                type any model id — e.g. google/gemini-2.5-flash (OpenRouter), gemini-2.5-flash (Gemini), llama3.3 (Ollama)
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: OpenRouter */}
        <div className="flex flex-col gap-6 py-6 border-b border-aluminium/10">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-label font-sans text-aluminium">OpenRouter</h3>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full transition-all duration-500 ${
                testStatuses.openrouter === 'failed'
                  ? 'bg-signal shadow-signal animate-pulse'
                  : testStatuses.openrouter === 'testing'
                  ? 'bg-aluminium/70 animate-pulse'
                  : isConfigured('openrouter')
                  ? 'bg-chalk shadow-active'
                  : 'bg-aluminium/40'
              }`}></span>
              <span className={`font-dot text-xs tracking-widest ${
                testStatuses.openrouter === 'failed'
                  ? 'text-signal'
                  : testStatuses.openrouter === 'testing'
                  ? 'text-aluminium/80'
                  : isConfigured('openrouter')
                  ? 'text-chalk'
                  : 'text-aluminium/40'
              }`}>
                {getStatusLabel('openrouter')}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs uppercase tracking-label font-sans text-aluminium/70">API KEY</label>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="password"
                value={openRouterKey}
                onChange={(e) => setOpenRouterKey(e.target.value)}
                placeholder={isConfigured('openrouter') ? "••••••••••••••••" : "Not configured"}
                className="flex-1 min-w-[200px] max-w-sm bg-well border border-aluminium/20 rounded px-3 py-1.5 text-xs font-mono text-chalk placeholder-aluminium/40 focus:outline-none focus:border-chalk/60 focus:ring-1 focus:ring-chalk/60 transition-all"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleSaveKey('openrouter')}
                  disabled={!openRouterKey}
                  className={`px-3 py-1.5 text-xs font-sans transition-all duration-150 border rounded cursor-pointer ${
                    openRouterKey
                      ? 'bg-carbon text-chalk border-aluminium/40 hover:border-chalk hover:shadow-active'
                      : 'bg-carbon/50 text-aluminium/40 border-aluminium/10 cursor-not-allowed'
                  }`}
                >
                  Save
                </button>
                {isConfigured('openrouter') && (
                  <button
                    onClick={() => handleClearKey('openrouter')}
                    className="px-3 py-1.5 text-xs font-sans text-signal bg-transparent border border-signal/20 hover:border-signal/50 hover:shadow-signal rounded transition-all duration-150 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => handleTestConnection('openrouter')}
                  className="px-3 py-1.5 text-xs font-sans text-aluminium hover:text-chalk bg-transparent border border-aluminium/20 hover:border-aluminium/40 rounded transition-all duration-150 cursor-pointer"
                >
                  Test Connection
                </button>
              </div>
            </div>
            {testErrors.openrouter && (
              <div className="text-xs font-mono text-signal mt-1 max-w-2xl bg-signal/5 border border-signal/20 p-2 rounded">
                {testErrors.openrouter}
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Gemini */}
        <div className="flex flex-col gap-6 py-6 border-b border-aluminium/10">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-label font-sans text-aluminium">Gemini</h3>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full transition-all duration-500 ${
                testStatuses.gemini === 'failed'
                  ? 'bg-signal shadow-signal animate-pulse'
                  : testStatuses.gemini === 'testing'
                  ? 'bg-aluminium/70 animate-pulse'
                  : isConfigured('gemini')
                  ? 'bg-chalk shadow-active'
                  : 'bg-aluminium/40'
              }`}></span>
              <span className={`font-dot text-xs tracking-widest ${
                testStatuses.gemini === 'failed'
                  ? 'text-signal'
                  : testStatuses.gemini === 'testing'
                  ? 'text-aluminium/80'
                  : isConfigured('gemini')
                  ? 'text-chalk'
                  : 'text-aluminium/40'
              }`}>
                {getStatusLabel('gemini')}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs uppercase tracking-label font-sans text-aluminium/70">API KEY</label>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={isConfigured('gemini') ? "••••••••••••••••" : "Not configured"}
                className="flex-1 min-w-[200px] max-w-sm bg-well border border-aluminium/20 rounded px-3 py-1.5 text-xs font-mono text-chalk placeholder-aluminium/40 focus:outline-none focus:border-chalk/60 focus:ring-1 focus:ring-chalk/60 transition-all"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleSaveKey('gemini')}
                  disabled={!geminiKey}
                  className={`px-3 py-1.5 text-xs font-sans transition-all duration-150 border rounded cursor-pointer ${
                    geminiKey
                      ? 'bg-carbon text-chalk border-aluminium/40 hover:border-chalk hover:shadow-active'
                      : 'bg-carbon/50 text-aluminium/40 border-aluminium/10 cursor-not-allowed'
                  }`}
                >
                  Save
                </button>
                {isConfigured('gemini') && (
                  <button
                    onClick={() => handleClearKey('gemini')}
                    className="px-3 py-1.5 text-xs font-sans text-signal bg-transparent border border-signal/20 hover:border-signal/50 hover:shadow-signal rounded transition-all duration-150 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => handleTestConnection('gemini')}
                  className="px-3 py-1.5 text-xs font-sans text-aluminium hover:text-chalk bg-transparent border border-aluminium/20 hover:border-aluminium/40 rounded transition-all duration-150 cursor-pointer"
                >
                  Test Connection
                </button>
              </div>
            </div>
            {testErrors.gemini && (
              <div className="text-xs font-mono text-signal mt-1 max-w-2xl bg-signal/5 border border-signal/20 p-2 rounded">
                {testErrors.gemini}
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Ollama */}
        <div className="flex flex-col gap-6 py-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-label font-sans text-aluminium">Ollama</h3>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full transition-all duration-500 ${
                testStatuses.ollama === 'failed'
                  ? 'bg-signal shadow-signal animate-pulse'
                  : testStatuses.ollama === 'testing'
                  ? 'bg-aluminium/70 animate-pulse'
                  : isConfigured('ollama')
                  ? 'bg-chalk shadow-active'
                  : 'bg-aluminium/40'
              }`}></span>
              <span className={`font-dot text-xs tracking-widest ${
                testStatuses.ollama === 'failed'
                  ? 'text-signal'
                  : testStatuses.ollama === 'testing'
                  ? 'text-aluminium/80'
                  : isConfigured('ollama')
                  ? 'text-chalk'
                  : 'text-aluminium/40'
              }`}>
                {getStatusLabel('ollama')}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs uppercase tracking-label font-sans text-aluminium/70">BASE URL</label>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="text"
                value={ollamaBaseUrl}
                onChange={(e) => setOllamaBaseUrl(e.target.value)}
                placeholder="http://localhost:11434"
                className="flex-1 min-w-[200px] max-w-sm bg-well border border-aluminium/20 rounded px-3 py-1.5 text-xs font-mono text-chalk placeholder-aluminium/40 focus:outline-none focus:border-chalk/60 focus:ring-1 focus:ring-chalk/60 transition-all"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveOllamaBaseUrl}
                  className="px-3 py-1.5 text-xs font-sans bg-carbon text-chalk border border-aluminium/40 hover:border-chalk hover:shadow-active rounded transition-all duration-150 cursor-pointer"
                >
                  Save Base URL
                </button>
                <button
                  onClick={() => handleTestConnection('ollama')}
                  className="px-3 py-1.5 text-xs font-sans text-aluminium hover:text-chalk bg-transparent border border-aluminium/20 hover:border-aluminium/40 rounded transition-all duration-150 cursor-pointer"
                >
                  Test Connection
                </button>
              </div>
            </div>
            {testErrors.ollama && (
              <div className="text-xs font-mono text-signal mt-1 max-w-2xl bg-signal/5 border border-signal/20 p-2 rounded">
                {testErrors.ollama}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
