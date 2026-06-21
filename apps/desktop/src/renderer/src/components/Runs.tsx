import React, { useEffect, useState, useRef } from 'react';
import { SettingsView } from './Settings';


export interface RunInput {
  goal: string;
  url: string;
}

export type RunStatus = 'running' | 'done' | 'error' | 'needs_human';

export interface Action {
  action: string;
  [key: string]: any;
}

export type RunEvent =
  | { type: 'started'; runId: string }
  | { type: 'status'; runId: string; status: RunStatus }
  | { type: 'step'; runId: string; turn: number; reasoning?: string; action: Action; screenshot?: string }
  | { type: 'done'; runId: string; extracted: unknown }
  | { type: 'error'; runId: string; message: string };

interface MurlRunsAPI {
  start(input: RunInput): Promise<{ runId: string }>;
  cancel(runId: string): Promise<{ ok: boolean }>;
  onEvent(cb: (e: RunEvent) => void): () => void;
}

const getMurlSettings = () => (window as any).murl.settings;
const getMurlRuns = (): MurlRunsAPI => (window as any).murl.runs;

interface RunsProps {
  onNavigateToSettings: () => void;
}

interface ActionStep {
  turn: number;
  reasoning?: string;
  action: Action;
}

const styles = `
@keyframes breath {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
.breath {
  animation: breath 3s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .breath {
    animation: none;
    opacity: 1;
  }
}
`;

export default function Runs({ onNavigateToSettings }: RunsProps): JSX.Element {
  // Input fields
  const [goal, setGoal] = useState('');
  const [url, setUrl] = useState('');

  // Active configurations
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // Run states
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error' | 'needs_human'>('idle');
  const [actionLog, setActionLog] = useState<ActionStep[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Auto-scroll ref & state
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // IPC Subscription Ref
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Check if provider is configured
  const checkSettings = async () => {
    try {
      const s = await getMurlSettings().get();
      setSettings(s);
      if (s && s.activeProvider) {
        const active = s.activeProvider;
        if (active === 'ollama') {
          setIsConfigured(!!s.providers.ollama?.baseUrl);
        } else {
          setIsConfigured(!!s.providers[active]?.configured);
        }
      } else {
        setIsConfigured(false);
      }
    } catch (err) {
      console.error('Failed to retrieve settings', err);
      setIsConfigured(false);
    } finally {
      setIsLoadingSettings(false);
    }
  };

  useEffect(() => {
    checkSettings();
  }, []);

  // Auto scroll effect
  useEffect(() => {
    if (!isHovered && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [actionLog, isHovered]);

  const cleanupSubscription = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

  // Clean up subscription on unmount
  useEffect(() => {
    return () => {
      cleanupSubscription();
    };
  }, []);

  const handleRunStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfigured || isLoadingSettings) return;

    // Reset states
    setActionLog([]);
    setLatestScreenshot(null);
    setExtractedData(null);
    setErrorMessage(null);
    setIsCancelling(false);
    setStatus('running');

    try {
      const res = await getMurlRuns().start({ goal, url });
      const currentRunId = res.runId;
      setRunId(currentRunId);

      cleanupSubscription();

      // Subscribe to events
      const unsub = getMurlRuns().onEvent((event: RunEvent) => {
        if (event.runId !== currentRunId) return;

        if (event.type === 'started') {
          setStatus('running');
        } else if (event.type === 'status') {
          setStatus(event.status);
        } else if (event.type === 'step') {
          setActionLog((prev) => {
            if (prev.some((s) => s.turn === event.turn)) return prev;
            return [...prev, {
              turn: event.turn,
              reasoning: event.reasoning,
              action: event.action
            }];
          });
          if (event.screenshot) {
            setLatestScreenshot(event.screenshot);
          }
        } else if (event.type === 'done') {
          setStatus('done');
          setExtractedData(event.extracted);
          cleanupSubscription();
        } else if (event.type === 'error') {
          setStatus('error');
          setErrorMessage(event.message);
          cleanupSubscription();
        }
      });

      unsubscribeRef.current = unsub;
    } catch (err: any) {
      console.error('Failed to start agent run', err);
      setStatus('error');
      setErrorMessage(err.message || String(err));
    }
  };

  const handleCancel = async () => {
    if (!runId) return;
    setIsCancelling(true);
    try {
      await getMurlRuns().cancel(runId);
    } catch (err: any) {
      console.error('Failed to cancel agent run', err);
      setStatus('error');
      setErrorMessage(`Cancellation failed: ${err.message || String(err)}`);
      cleanupSubscription();
    }
  };

  const handleBackToIdle = () => {
    setRunId(null);
    setStatus('idle');
    setActionLog([]);
    setLatestScreenshot(null);
    setExtractedData(null);
    setErrorMessage(null);
    setIsCancelling(false);
    checkSettings();
  };

  // Render States
  if (status === 'idle') {
    return (
      <div className="flex-1 panel p-8 flex flex-col overflow-y-auto select-text relative bg-dotgrid bg-repeat">
        <style>{styles}</style>
        
        <div className="mb-8">
          <h2 className="font-dot text-2xl tracking-widest text-chalk uppercase mb-1">New Run</h2>
          <span className="text-xs uppercase tracking-label font-sans text-aluminium">Define research goal and starting URL</span>
        </div>

        <form onSubmit={handleRunStart} className="flex flex-col gap-6 max-w-4xl">
          {/* Goal Textarea */}
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-label font-sans text-aluminium">Research Goal</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Find the pricing page of OpenAI and extract the GPT-4o API price."
              className="w-full h-32 bg-well border border-aluminium/20 rounded p-3 text-sm font-sans text-chalk placeholder-aluminium/40 focus:outline-none focus:ring-1 focus:ring-chalk/60 focus:border-chalk/60 transition-all resize-none"
              required
            />
          </div>

          {/* Starting URL Input */}
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-label font-sans text-aluminium">Starting URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g. https://openai.com"
              className="w-full bg-well border border-aluminium/20 rounded px-3 py-2 text-xs font-mono text-chalk placeholder-aluminium/40 focus:outline-none focus:ring-1 focus:ring-chalk/60 focus:border-chalk/60 transition-all"
              required
            />
          </div>

          {/* Active Configuration Info */}
          <div className="p-4 bg-carbon border border-aluminium/20 rounded flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-label font-sans text-aluminium">Active LLM Configuration</span>
              {isLoadingSettings ? (
                <span className="font-mono text-xs text-aluminium/60">Loading settings...</span>
              ) : settings ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-chalk font-semibold uppercase">{settings.activeProvider}</span>
                  <span className="text-aluminium/40 font-mono text-xs">/</span>
                  <span className="font-mono text-xs text-chalk">{settings.activeModel}</span>
                </div>
              ) : (
                <span className="font-mono text-xs text-signal">Failed to load settings</span>
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={onNavigateToSettings}
                className="text-xs font-sans text-aluminium hover:text-chalk transition-colors border border-aluminium/20 hover:border-aluminium/40 rounded px-2.5 py-1 bg-transparent cursor-pointer"
              >
                Configure Settings
              </button>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-4 mt-2">
            <button
              type="submit"
              disabled={!isConfigured || isLoadingSettings}
              className={`px-5 py-2.5 text-xs font-sans uppercase tracking-label rounded border transition-all duration-150 cursor-pointer ${
                isConfigured && !isLoadingSettings
                  ? 'bg-carbon text-chalk border-aluminium/40 hover:border-chalk hover:shadow-active'
                  : 'bg-carbon/50 text-aluminium/40 border-aluminium/10 cursor-not-allowed'
              }`}
            >
              Run Agent
            </button>
            
            {!isConfigured && !isLoadingSettings && (
              <span className="text-xs text-signal font-sans font-medium uppercase tracking-[0.02em]">
                Configure a provider in Settings
              </span>
            )}
          </div>
        </form>
      </div>
    );
  }

  if (status === 'running' || status === 'needs_human') {
    return (
      <div className="flex-1 panel p-8 flex flex-col overflow-y-auto select-none bg-dotgrid bg-repeat gap-6 min-h-0">
        <style>{styles}</style>
        
        {/* Header bar */}
        <div className="flex items-center justify-between pb-4 border-b border-aluminium/20">
          <div className="flex items-center gap-3">
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                status === 'needs_human'
                  ? 'bg-signal shadow-signal animate-pulse'
                  : 'bg-chalk shadow-active breath'
              }`}
            ></span>
            <span className="font-dot text-lg tracking-widest text-chalk uppercase mt-0.5">
              {status === 'needs_human' ? 'NEEDS HUMAN ATTENTION' : 'RUNNING RESEARCH'}
            </span>
          </div>
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="px-3 py-1.5 text-xs font-sans text-signal bg-transparent border border-signal/20 hover:border-signal/50 hover:shadow-signal rounded transition-all duration-150 cursor-pointer"
          >
            {isCancelling ? 'CANCELLING...' : 'Cancel Run'}
          </button>
        </div>

        {/* Workspace grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 flex-1">
          {/* Screenshot Column */}
          <div className="flex flex-col gap-2 min-h-0">
            <span className="text-xs uppercase tracking-label font-sans text-aluminium">Live Screenshot</span>
            <div className="flex-1 bg-well border border-aluminium/20 rounded-well overflow-hidden relative flex items-center justify-center p-2 min-h-[300px]">
              {latestScreenshot ? (
                <img
                  src={latestScreenshot}
                  alt="Browser Frame"
                  className="max-w-full max-h-full object-contain rounded"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="font-dot text-xl text-aluminium/40 tracking-widest animate-pulse">...</span>
                  <span className="text-xs font-sans text-aluminium/60 uppercase tracking-label">Waiting for screenshot</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Log Column */}
          <div className="flex flex-col gap-2 min-h-0">
            <span className="text-xs uppercase tracking-label font-sans text-aluminium">Action Stream</span>
            <div
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              className="flex-1 bg-well/50 backdrop-blur-sm border border-aluminium/20 rounded p-4 font-mono text-xs overflow-y-auto flex flex-col gap-3 min-h-[300px]"
            >
              {actionLog.length === 0 ? (
                <div className="text-aluminium/40 italic font-mono text-xs uppercase tracking-wider p-2">
                  No actions recorded yet...
                </div>
              ) : (
                actionLog.map((step) => {
                  const turnStr = String(step.turn).padStart(2, '0');
                  const actionType = step.action?.action || 'unknown';
                  const actionDetails = Object.entries(step.action || {})
                    .filter(([k]) => k !== 'action')
                    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
                    .join(' ');
                    
                  return (
                    <div key={step.turn} className="flex flex-col gap-1.5 border-b border-aluminium/5 pb-2.5 last:border-0 last:pb-0">
                      {/* Thought line */}
                      <div className="text-aluminium font-sans text-xs">
                        <span className="font-mono text-xs text-aluminium/60 bg-carbon px-1.5 py-0.5 rounded mr-2">
                          T{turnStr}
                        </span>
                        {step.reasoning || '(no thought)'}
                      </div>
                      {/* Action line */}
                      <div className="flex items-baseline gap-2 pl-8">
                        <span className="font-dot text-chalk text-xs uppercase tracking-wider">
                          ▸ {actionType}
                        </span>
                        <span className="text-chalk/80 text-xs font-mono truncate">
                          {actionDetails}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="flex-1 panel p-8 flex flex-col overflow-y-auto select-none bg-dotgrid bg-repeat items-center justify-center relative">
        <style>{styles}</style>
        
        <div className="max-w-2xl w-full panel p-8 flex flex-col gap-6 text-left relative bg-carbon/90">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-chalk shadow-active"></span>
            <span className="font-dot text-lg tracking-widest text-chalk uppercase mt-0.5">
              Research Done
            </span>
          </div>
          
          <div className="flex flex-col gap-2 select-text">
            <span className="text-xs uppercase tracking-label font-sans text-aluminium">Extracted Data</span>
            <pre className="text-xs font-mono text-chalk bg-well/80 p-4 border border-aluminium/20 rounded-well overflow-auto max-h-[350px] whitespace-pre-wrap break-all">
              {JSON.stringify(extractedData, null, 2)}
            </pre>
          </div>

          <div className="flex justify-end mt-2">
            <button
              onClick={handleBackToIdle}
              className="px-5 py-2.5 text-xs font-sans uppercase tracking-label bg-carbon text-chalk border border-aluminium/40 hover:border-chalk hover:shadow-active rounded transition-all duration-150 cursor-pointer"
            >
              New run
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="flex-1 panel p-8 flex flex-col overflow-y-auto select-none bg-dotgrid bg-repeat items-center justify-center relative">
      <style>{styles}</style>
      
      <div className="max-w-2xl w-full panel p-8 flex flex-col gap-6 text-left relative border-signal/30 bg-carbon/90">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-signal shadow-signal animate-pulse"></span>
          <span className="font-dot text-lg tracking-widest text-signal uppercase mt-0.5">
            Run Failed
          </span>
        </div>

        <div className="flex flex-col gap-2 select-text">
          <span className="text-xs uppercase tracking-label font-sans text-aluminium">Error Message</span>
          <div className="text-xs font-mono text-signal bg-signal/5 border border-signal/20 p-4 rounded-well overflow-auto max-h-[300px] whitespace-pre-wrap">
            {errorMessage || 'An unknown error occurred during the agent execution.'}
          </div>
        </div>

        <div className="flex justify-end mt-2">
          <button
            onClick={handleBackToIdle}
            className="px-5 py-2.5 text-xs font-sans uppercase tracking-label bg-carbon text-chalk border border-aluminium/40 hover:border-chalk hover:shadow-active rounded transition-all duration-150 cursor-pointer"
          >
            New run
          </button>
        </div>
      </div>
    </div>
  );
}
