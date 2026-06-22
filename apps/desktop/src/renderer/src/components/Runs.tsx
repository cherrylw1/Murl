import React, { useEffect, useState, useRef } from 'react';
import { SettingsView } from './Settings';

export interface RunInput {
  goal: string;
  url: string;
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'needs_human';

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

export interface RunState {
  runId: string;
  goal: string;
  url: string;
  status: RunStatus;
  currentTurn?: number;
  lastScreenshot?: string;
  error?: string;
}

export interface RunStep {
  turn: number;
  reasoning?: string;
  action: Action;
  screenshot?: string;
}

export interface RunDetail {
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

interface MurlRunsAPI {
  start(input: RunInput): Promise<{ runId: string }>;
  cancel(runId: string): Promise<{ ok: boolean }>;
  getState(): Promise<RunState[]>;
  onEvent(cb: (e: RunEvent) => void): () => void;
}

const getMurlSettings = () => (window as any).murl.settings;
const getMurlRuns = (): MurlRunsAPI => (window as any).murl.runs;

interface RunsProps {
  onNavigateToSettings: () => void;
}

const styles = `
@keyframes breath {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
.breath {
  animation: breath 3s ease-in-out infinite;
}
@keyframes breath-slow {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
.breath-slow {
  animation: breath-slow 2.5s ease-in-out infinite;
}
@keyframes breath-slow-error {
  0%, 100% {
    opacity: 0.6;
    box-shadow: 0 0 8px rgba(215, 25, 33, 0.15);
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 20px rgba(215, 25, 33, 0.45);
  }
}
.breath-slow-error {
  animation: breath-slow-error 2.5s ease-in-out infinite;
}
@keyframes pulse-glow {
  0%, 100% {
    opacity: 0.6;
    box-shadow: 0 0 4px rgba(250, 250, 250, 0.2);
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 12px rgba(250, 250, 250, 0.6);
  }
}
.pulse-glow {
  animation: pulse-glow 2s infinite ease-in-out;
}
@media (prefers-reduced-motion: reduce) {
  .breath {
    animation: none;
    opacity: 1;
  }
  .breath-slow {
    animation: none;
    opacity: 1;
  }
  .breath-slow-error {
    animation: none;
    opacity: 1;
    box-shadow: 0 0 20px rgba(215, 25, 33, 0.30);
  }
  .pulse-glow {
    animation: none;
    opacity: 1;
  }
}
`;

function getHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch (err) {
    return urlStr || 'unknown';
  }
}

function formatRelativeTime(startedAt: number): string {
  const diffMs = Date.now() - startedAt;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return 'just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return `${diffHrs}h ago`;
  }
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

interface GlyphWallProps {
  runs: RunState[];
  onCardClick: (runId: string) => void;
}

function GlyphWall({ runs, onCardClick }: GlyphWallProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 justify-items-center">
      {runs.map((run, index) => {
        const indexStr = String(index + 1).padStart(2, '0');
        const turnStr = run.status === 'queued' ? 'T--' : `T${run.currentTurn ?? 0}`;
        
        const isError = run.status === 'error';
        const isNeedsHuman = run.status === 'needs_human';
        const isDone = run.status === 'done';
        const isRunning = run.status === 'running';
        const isQueued = run.status === 'queued';

        let cardClasses = '';
        let dotsContainerClasses = '';
        let litDotClass = '';
        let litCount = 0;

        if (isQueued) {
          cardClasses = 'border-aluminium/10 opacity-60 hover:opacity-90 hover:border-aluminium/25';
          litCount = 0;
        } else if (isRunning) {
          cardClasses = 'border-aluminium/20 hover:border-chalk/40 hover:shadow-active';
          dotsContainerClasses = 'breath-slow';
          litDotClass = 'bg-chalk';
          const currentTurn = run.currentTurn ?? 0;
          litCount = Math.min(25, Math.max(1, (currentTurn + 1) * 5));
        } else if (isDone) {
          cardClasses = 'border-aluminium/30 shadow-active';
          litDotClass = 'bg-chalk';
          litCount = 25;
        } else if (isError || isNeedsHuman) {
          cardClasses = 'border-signal/30 shadow-signal breath-slow-error';
          litDotClass = 'bg-signal';
          litCount = 25;
        }

        return (
          <div
            key={run.runId}
            onClick={() => onCardClick(run.runId)}
            title={`${run.goal} · ${run.status} · ${turnStr}`}
            className={`w-20 h-20 bg-carbon border rounded flex flex-col items-center justify-center relative cursor-pointer select-none group transition-all duration-150 ${cardClasses}`}
          >
            {/* Index label top-left */}
            <div className="absolute top-1.5 left-2 font-dot text-[9px] text-aluminium select-none">
              {indexStr}
            </div>

            {/* 5x5 dot grid in the center */}
            <div className={`grid grid-cols-5 gap-[4px] justify-center items-center ${dotsContainerClasses}`}>
              {Array.from({ length: 25 }).map((_, i) => {
                const isLit = i < litCount;
                return (
                  <span
                    key={i}
                    className={`w-[3px] h-[3px] rounded-full transition-colors duration-200 ${
                      isLit ? litDotClass : 'bg-aluminium/10'
                    }`}
                  />
                );
              })}
            </div>

            {/* Turn label bottom-right */}
            <div className="absolute bottom-1.5 right-2 font-dot text-[9px] text-aluminium select-none">
              {turnStr}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Runs({ onNavigateToSettings }: RunsProps): JSX.Element {
  // Input fields
  const [goal, setGoal] = useState('');
  const [url, setUrl] = useState('');

  // Active configurations
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // Active runs (Dashboard state)
  const [activeRuns, setActiveRuns] = useState<RunState[]>([]);

  // Selected run for Detail View
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detailRun, setDetailRun] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedStepTurn, setSelectedStepTurn] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Auto-scroll ref & state
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // History states
  const [historyList, setHistoryList] = useState<any[]>([]);

  const fetchHistory = async () => {
    try {
      const list = await (window as any).murl.history.list();
      setHistoryList(list || []);
    } catch (err) {
      console.error('Failed to fetch history list:', err);
    }
  };

  const refreshActiveRuns = async () => {
    try {
      const runs = await getMurlRuns().getState();
      setActiveRuns(runs || []);
    } catch (err) {
      console.error('Failed to get active runs:', err);
    }
  };

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
    fetchHistory();
    refreshActiveRuns();
  }, []);

  // Auto scroll effect in Detail View
  useEffect(() => {
    if (!isHovered && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [detailRun?.steps, isHovered]);

  // Global event listener subscription
  useEffect(() => {
    const unsub = getMurlRuns().onEvent((event: RunEvent) => {
      // Update activeRuns state
      setActiveRuns((prev) => {
        const exists = prev.some((r) => r.runId === event.runId);
        if (!exists) {
          refreshActiveRuns();
          return prev;
        }
        return prev.map((r) => {
          if (r.runId !== event.runId) return r;
          const updated = { ...r };
          if (event.type === 'status') {
            updated.status = event.status;
          } else if (event.type === 'step') {
            updated.currentTurn = event.turn;
            if (event.screenshot) {
              updated.lastScreenshot = event.screenshot;
            }
          } else if (event.type === 'done') {
            updated.status = 'done';
          } else if (event.type === 'error') {
            updated.status = 'error';
            updated.error = event.message;
          }
          return updated;
        });
      });

      // Update history if complete
      if (event.type === 'done' || event.type === 'error') {
        fetchHistory();
      }

      // If we are looking at this specific run in detail view, update detailRun
      if (selectedRunId && event.runId === selectedRunId) {
        setDetailRun((prev) => {
          if (!prev) return null;
          const updated = { ...prev };
          if (event.type === 'status') {
            updated.status = event.status;
          } else if (event.type === 'step') {
            const stepExists = updated.steps.some((s) => s.turn === event.turn);
            const newStep: RunStep = {
              turn: event.turn,
              reasoning: event.reasoning,
              action: event.action,
              screenshot: event.screenshot,
            };
            if (!stepExists) {
              updated.steps = [...updated.steps, newStep];
            } else {
              updated.steps = updated.steps.map((s) => (s.turn === event.turn ? newStep : s));
            }
          } else if (event.type === 'done') {
            updated.status = 'done';
            updated.extracted = event.extracted;
          } else if (event.type === 'error') {
            updated.status = 'error';
            updated.error = event.message;
          }
          return updated;
        });
      }
    });

    return () => {
      unsub();
    };
  }, [selectedRunId]);

  const handleRunStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfigured || isLoadingSettings) return;

    const currentGoal = goal;
    const currentUrl = url;

    // Reset goal input immediately so user can submit another task
    setGoal('');

    try {
      await getMurlRuns().start({ goal: currentGoal, url: currentUrl });
      await refreshActiveRuns();
    } catch (err: any) {
      console.error('Failed to start agent run', err);
    }
  };

  const handleCancelRun = async (id: string) => {
    setIsCancelling(true);
    try {
      await getMurlRuns().cancel(id);
    } catch (err: any) {
      console.error('Failed to cancel agent run', err);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCardClick = async (runIdStr: string) => {
    setSelectedRunId(runIdStr);
    setDetailLoading(true);
    setDetailRun(null);
    setSelectedStepTurn(null);
    try {
      const data = await (window as any).murl.history.get(runIdStr);
      if (data) {
        setDetailRun(data);
      } else {
        // Fallback for queued runs that don't have records in history DB yet
        const active = activeRuns.find((r) => r.runId === runIdStr);
        if (active) {
          setDetailRun({
            id: runIdStr,
            goal: active.goal,
            url: active.url,
            status: active.status,
            startedAt: Date.now(),
            steps: [],
          });
        }
      }
    } catch (err) {
      console.error('Failed to get run details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  function renderStatusDot(status: string) {
    let colorClass = '';
    let shadowStyle = {};
    let pulseClass = '';

    if (status === 'queued') {
      colorClass = 'bg-[#8A8A8A]';
    } else if (status === 'running' || status === 'needs_human') {
      colorClass = 'bg-[#FAFAFA]';
      shadowStyle = { boxShadow: '0 0 12px rgba(250, 250, 250, 0.5)' };
      pulseClass = 'pulse-glow';
    } else if (status === 'done' || status === 'complete') {
      colorClass = 'bg-[#FAFAFA]';
    } else if (status === 'error') {
      colorClass = 'bg-[#D71921]';
      shadowStyle = { boxShadow: '0 0 12px rgba(215, 25, 33, 0.5)' };
    }

    return (
      <span
        className={`w-2 h-2 rounded-full ${colorClass} ${pulseClass}`}
        style={shadowStyle}
      />
    );
  }

  // --- DETAIL VIEW ---
  if (selectedRunId) {
    if (detailLoading) {
      return (
        <div className="flex-1 panel p-8 flex flex-col items-center justify-center bg-dotgrid bg-repeat min-h-0">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="font-dot text-xl text-aluminium tracking-widest animate-pulse">LOADING</span>
            <span className="text-[10px] font-sans text-aluminium/60 uppercase tracking-label">Retrieving run details...</span>
          </div>
        </div>
      );
    }

    if (!detailRun) {
      return (
        <div className="flex-1 panel p-8 flex flex-col items-center justify-center bg-dotgrid bg-repeat min-h-0">
          <div className="max-w-md w-full panel p-8 flex flex-col gap-6 text-left relative bg-carbon border-signal/30">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-signal shadow-signal"></span>
              <span className="font-dot text-lg tracking-widest text-signal uppercase mt-0.5">Run Not Found</span>
            </div>
            <p className="text-xs font-sans text-aluminium leading-relaxed uppercase">
              The requested run details could not be found or failed to load.
            </p>
            <div className="flex justify-end mt-2">
              <button
                onClick={() => {
                  setSelectedRunId(null);
                  setDetailRun(null);
                }}
                className="px-5 py-2.5 text-xs font-sans uppercase tracking-label bg-carbon text-chalk border border-aluminium/40 hover:border-chalk hover:shadow-active rounded transition-all duration-150 cursor-pointer"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Get the screenshot of the active/selected step
    let activeScreenshot: string | undefined = undefined;
    if (selectedStepTurn !== null) {
      const activeStep = detailRun.steps.find((s: any) => s.turn === selectedStepTurn);
      activeScreenshot = activeStep?.screenshot;
    } else {
      // Find the last step with a screenshot
      const stepsWithScreenshots = detailRun.steps.filter((s: any) => s.screenshot);
      if (stepsWithScreenshots.length > 0) {
        activeScreenshot = stepsWithScreenshots[stepsWithScreenshots.length - 1].screenshot;
      }
    }

    return (
      <div className="flex-1 panel p-8 flex flex-col overflow-y-auto select-text bg-dotgrid bg-repeat gap-6 min-h-0">
        <style>{styles}</style>

        {/* Header bar */}
        <div className="flex items-center justify-between pb-4 border-b border-aluminium/20">
          <div className="flex items-center gap-3">
            {renderStatusDot(detailRun.status)}
            <span className="font-dot text-lg tracking-widest text-chalk uppercase mt-0.5">
              {detailRun.status === 'queued' && 'QUEUED: '}
              {detailRun.status === 'running' && 'RUNNING: '}
              {detailRun.status === 'needs_human' && 'ATTENTION REQUIRED: '}
              {detailRun.status === 'done' && 'DONE: '}
              {detailRun.status === 'error' && 'FAILED: '}
              {getHostname(detailRun.url)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(detailRun.status === 'running' || detailRun.status === 'queued' || detailRun.status === 'needs_human') && (
              <button
                onClick={() => handleCancelRun(detailRun.id)}
                disabled={isCancelling}
                className="px-3 py-1.5 text-xs font-sans text-signal bg-transparent border border-signal/20 hover:border-signal/50 hover:shadow-signal rounded transition-all duration-150 cursor-pointer uppercase tracking-label"
              >
                {isCancelling ? 'CANCELLING...' : 'Cancel run'}
              </button>
            )}
            <button
              onClick={() => {
                setSelectedRunId(null);
                setDetailRun(null);
                setSelectedStepTurn(null);
              }}
              className="px-3 py-1.5 text-xs font-sans text-chalk bg-transparent border border-aluminium/40 hover:border-chalk hover:shadow-active rounded transition-all duration-150 cursor-pointer uppercase tracking-label"
            >
              Back to dashboard
            </button>
          </div>
        </div>

        {/* Run Metadata display */}
        <div className="p-4 bg-carbon border border-aluminium/20 rounded flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-label font-sans text-aluminium">Research Goal</span>
            <span className="text-xs font-sans text-chalk">{detailRun.goal}</span>
          </div>
          <div className="flex items-center gap-6 mt-1 text-[10px] font-mono text-aluminium uppercase tracking-wider">
            <div>
              <span className="text-aluminium/60 mr-1.5">START URL:</span>
              <span className="text-chalk font-semibold truncate max-w-md inline-block align-bottom">{detailRun.url}</span>
            </div>
            {detailRun.startedAt && (
              <div>
                <span className="text-aluminium/60 mr-1.5">STARTED:</span>
                <span className="text-chalk">{new Date(detailRun.startedAt).toLocaleString()}</span>
              </div>
            )}
            {detailRun.finishedAt && (
              <div>
                <span className="text-aluminium/60 mr-1.5">FINISHED:</span>
                <span className="text-chalk">{new Date(detailRun.finishedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Workspace grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 flex-1">
          {/* Screenshot Column */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-label font-sans text-aluminium">
                {selectedStepTurn !== null ? `Step ${selectedStepTurn} Screenshot` : 'Latest Screenshot'}
              </span>
              {selectedStepTurn !== null && (
                <button
                  onClick={() => setSelectedStepTurn(null)}
                  className="text-[10px] uppercase tracking-label font-sans text-aluminium hover:text-chalk transition-colors bg-transparent border-0 cursor-pointer"
                >
                  Show latest
                </button>
              )}
            </div>
            <div className="flex-1 bg-well border border-aluminium/20 rounded overflow-hidden relative flex items-center justify-center p-2 min-h-[300px]">
              {activeScreenshot ? (
                <img
                  src={activeScreenshot}
                  alt="Browser Frame"
                  className="max-w-full max-h-full object-contain rounded"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="font-dot text-xl text-aluminium/40 tracking-widest animate-pulse">...</span>
                  <span className="text-xs font-sans text-aluminium/60 uppercase tracking-label">
                    {detailRun.status === 'queued' ? 'Waiting for execution to start' : 'No screenshot recorded'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Log / Results Column */}
          <div className="flex flex-col gap-6 min-h-0">
            {/* Action Log */}
            <div className="flex flex-col gap-2 min-h-0 flex-1">
              <span className="text-xs uppercase tracking-label font-sans text-aluminium font-semibold">
                Action Stream (Click step to view screenshot)
              </span>
              <div
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className="flex-1 bg-well/50 backdrop-blur-sm border border-aluminium/20 rounded p-4 font-mono text-xs overflow-y-auto flex flex-col gap-3 min-h-[250px]"
              >
                {detailRun.steps.length === 0 ? (
                  <div className="text-aluminium/40 italic font-mono text-xs uppercase tracking-wider p-2">
                    {detailRun.status === 'queued' ? 'Run is queued. Waiting to start...' : 'No actions recorded.'}
                  </div>
                ) : (
                  detailRun.steps.map((step: any) => {
                    const turnStr = String(step.turn).padStart(2, '0');
                    const actionType = step.action?.action || 'unknown';
                    const actionDetails = Object.entries(step.action || {})
                      .filter(([k]) => k !== 'action' && k !== 'thought')
                      .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
                      .join(' ');
                    
                    const isSelected = selectedStepTurn === step.turn;

                    return (
                      <div
                        key={step.turn}
                        onClick={() => setSelectedStepTurn(step.turn)}
                        className={`flex flex-col gap-1.5 border-b border-aluminium/5 pb-2.5 last:border-0 last:pb-0 cursor-pointer p-1.5 rounded transition-all duration-150 ${
                          isSelected
                            ? 'bg-carbon border border-aluminium/20 shadow-active'
                            : 'hover:bg-carbon/40'
                        }`}
                      >
                        {/* Thought line */}
                        <div className="text-aluminium font-sans text-xs flex justify-between">
                          <div>
                            <span className="font-mono text-xs text-aluminium/60 bg-carbon px-1.5 py-0.5 rounded mr-2">
                              T{turnStr}
                            </span>
                            {step.reasoning || '(no thought)'}
                          </div>
                          {step.screenshot && (
                            <span className="text-[9px] text-aluminium/50 uppercase tracking-wider self-center">
                              📸
                            </span>
                          )}
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

            {/* Extracted Data / Error Message Section */}
            {(detailRun.status === 'done' || detailRun.status === 'complete' || detailRun.extracted || detailRun.error) && (
              <div className="flex flex-col gap-2 flex-shrink-0">
                {detailRun.status === 'error' || detailRun.error ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-label font-sans text-aluminium">Error Message</span>
                    <div className="text-xs font-mono text-signal bg-signal/5 border border-signal/20 p-4 rounded overflow-auto max-h-[150px] whitespace-pre-wrap">
                      {detailRun.error || 'An unknown error occurred during execution.'}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-label font-sans text-aluminium">Extracted Data</span>
                    <pre className="text-xs font-mono text-chalk bg-well/80 p-4 border border-aluminium/20 rounded overflow-auto max-h-[180px] whitespace-pre-wrap break-all">
                      {JSON.stringify(detailRun.extracted, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- DASHBOARD VIEW ---
  return (
    <div className="flex-1 panel p-8 flex flex-col overflow-y-auto select-text relative bg-dotgrid bg-repeat">
      <style>{styles}</style>
      
      <div className="mb-8">
        <h2 className="font-dot text-2xl tracking-widest text-chalk uppercase mb-1">Research Harness</h2>
        <span className="text-xs uppercase tracking-label font-sans text-aluminium">Define and execute parallel web research tasks</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
        {/* Launcher Form (Left Column, span 1) */}
        <div className="xl:col-span-1 bg-[#161616]/40 border border-aluminium/15 rounded p-6 flex flex-col gap-6">
          <h3 className="font-dot text-lg tracking-widest text-chalk uppercase border-b border-aluminium/10 pb-2">Launcher</h3>
          
          <form onSubmit={handleRunStart} className="flex flex-col gap-5">
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
            <div className="p-3 bg-carbon border border-aluminium/10 rounded flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-label font-sans text-aluminium">Active LLM Configuration</span>
                {isLoadingSettings ? (
                  <span className="font-mono text-[11px] text-aluminium/60">Loading settings...</span>
                ) : settings ? (
                  <div className="flex items-center gap-1.5 font-mono text-[11px]">
                    <span className="text-chalk font-semibold uppercase">{settings.activeProvider}</span>
                    <span className="text-aluminium/40">/</span>
                    <span className="text-chalk truncate max-w-[150px]">{settings.activeModel}</span>
                  </div>
                ) : (
                  <span className="font-mono text-[11px] text-signal">Failed to load settings</span>
                )}
              </div>
              <button
                type="button"
                onClick={onNavigateToSettings}
                className="text-[10px] font-sans text-aluminium hover:text-chalk transition-colors border border-aluminium/20 hover:border-aluminium/40 rounded py-1 bg-transparent cursor-pointer uppercase tracking-wider"
              >
                Configure settings
              </button>
            </div>

            {/* Action Row */}
            <div className="flex flex-col gap-2 mt-2">
              <button
                type="submit"
                disabled={!isConfigured || isLoadingSettings}
                className={`w-full py-2.5 text-xs font-sans uppercase tracking-label rounded border transition-all duration-150 cursor-pointer ${
                  isConfigured && !isLoadingSettings
                    ? 'bg-carbon text-chalk border-aluminium/40 hover:border-chalk hover:shadow-active'
                    : 'bg-carbon/50 text-aluminium/40 border-aluminium/10 cursor-not-allowed'
                }`}
              >
                Add run
              </button>
              
              {!isConfigured && !isLoadingSettings && (
                <span className="text-[10px] text-signal font-sans font-medium uppercase tracking-[0.02em] text-center mt-1">
                  Configure a provider in Settings
                </span>
              )}
            </div>
          </form>
        </div>

        {/* Active Runs Grid & History (Right Columns, span 2) */}
        <div className="xl:col-span-2 flex flex-col gap-8">
          {/* Active Runs Section */}
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between border-b border-aluminium/10 pb-2">
              <h3 className="font-dot text-lg tracking-widest text-chalk uppercase">Active runs</h3>
              {/* Header Statistics */}
              <span className="text-xs font-mono text-aluminium uppercase tracking-wider">
                {activeRuns.filter((r) => r.status === 'running' || r.status === 'needs_human').length} running &middot;{' '}
                {activeRuns.filter((r) => r.status === 'queued').length} queued &middot;{' '}
                {activeRuns.filter((r) => r.status === 'done' || r.status === 'error').length} done
              </span>
            </div>

            {activeRuns.length === 0 ? (
              <div className="p-12 bg-carbon/20 border border-aluminium/10 border-dashed rounded text-center text-xs font-sans text-aluminium uppercase tracking-wider">
                No active runs. Use the launcher to add one.
              </div>
            ) : (
              <GlyphWall runs={activeRuns} onCardClick={handleCardClick} />
            )}
          </div>

          {/* Recent Runs List */}
          <div className="flex flex-col gap-4 mt-4">
            <h3 className="font-dot text-lg tracking-widest text-chalk uppercase border-b border-aluminium/10 pb-2">
              Recent runs
            </h3>

            {historyList.length === 0 ? (
              <div className="p-6 bg-carbon/20 border border-aluminium/10 rounded text-center text-xs font-sans text-aluminium uppercase tracking-wider">
                No past runs recorded.
              </div>
            ) : (
              <div className="flex flex-col border border-aluminium/15 rounded overflow-hidden divide-y divide-aluminium/10 bg-carbon/20">
                {historyList.map((runItem) => {
                  const hostname = getHostname(runItem.url);
                  const relativeTime = formatRelativeTime(runItem.startedAt);
                  
                  return (
                    <div
                      key={runItem.id}
                      onClick={() => handleCardClick(runItem.id)}
                      className="flex items-center justify-between p-4 hover:bg-carbon/50 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1 mr-4">
                        {renderStatusDot(runItem.status)}
                        <div className="flex flex-col min-w-0 gap-1">
                          <span className="text-xs font-sans text-chalk font-medium truncate max-w-2xl group-hover:text-chalk transition-colors">
                            {runItem.goal}
                          </span>
                          <span className="text-[10px] font-mono text-aluminium uppercase tracking-wider">
                            {hostname}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <span className="text-[10px] font-mono text-aluminium uppercase tracking-wider">
                          {relativeTime}
                        </span>
                        <span className="text-aluminium group-hover:text-chalk transition-colors font-mono text-xs select-none">
                          &rarr;
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
