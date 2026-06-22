import { app, BrowserWindow, ipcMain, Menu, Tray, WebContents } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { health, createProvider, ProviderId, BrowserSession, runAgent, Recorder } from '@murl/engine';
import { SettingsStore } from './settingsStore.js';
import crypto from 'crypto';

// Helper to resolve __dirname in ES Modules (electron-vite compiles main to ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Intercept fetch for mock testing Together API
if (process.env.MOCK_TOGETHER_API === 'true') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    if (urlStr.includes('api.together.xyz/v1/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"thought": "Mocking together connection test", "action": "done"}',
              },
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 5,
          },
        }),
      } as Response;
    }
    return originalFetch(input, init);
  };
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

export interface RunState {
  runId: string;
  goal: string;
  url: string;
  status: 'queued' | 'running' | 'done' | 'error';
  currentTurn?: number;
  lastScreenshot?: string;
  error?: string;
}

interface QueuedRun {
  runId: string;
  goal: string;
  url: string;
  sender: WebContents;
}

class RunManager {
  private runs = new Map<string, RunState>();
  private queue: QueuedRun[] = [];
  private activeSessions = new Map<string, BrowserSession>();
  private activeCount = 0;
  private maxConcurrent = 3;

  constructor(
    private store: SettingsStore,
    private recorder: Recorder
  ) {}

  public getStates(): RunState[] {
    return Array.from(this.runs.values()).reverse();
  }

  public enqueue(runId: string, goal: string, url: string, sender: WebContents) {
    const runState: RunState = {
      runId,
      goal,
      url,
      status: 'queued',
    };
    this.runs.set(runId, runState);

    sender.send('run:event', {
      type: 'status',
      runId,
      status: 'queued',
    });

    this.queue.push({ runId, goal, url, sender });
    this.processQueue();
  }

  public cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;

    const queueIndex = this.queue.findIndex((q) => q.runId === runId);
    if (queueIndex !== -1) {
      const qItem = this.queue[queueIndex];
      this.queue.splice(queueIndex, 1);
      
      run.status = 'error';
      run.error = 'Cancelled';
      
      qItem.sender.send('run:event', {
        type: 'status',
        runId,
        status: 'error',
      });
      qItem.sender.send('run:event', {
        type: 'error',
        runId,
        message: 'Run cancelled while queued',
      });
      
      try {
        this.recorder.finishRun(runId, { status: 'error', error: 'Run cancelled while queued' });
      } catch (err) {
        console.error('Failed to finish run in recorder:', err);
      }
      return true;
    }

    const session = this.activeSessions.get(runId);
    if (session) {
      session.close().catch(() => {});
      this.activeSessions.delete(runId);
      return true;
    }

    return false;
  }

  private async processQueue() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const next = this.queue.shift();
    if (!next) return;

    this.activeCount++;
    const runState = this.runs.get(next.runId);
    if (runState) {
      runState.status = 'running';
    }

    // Stagger starts ~750ms to soften rate limits
    await new Promise((resolve) => setTimeout(resolve, 750));

    this.executeRun(next);
  }

  private async executeRun(item: QueuedRun) {
    const { runId, goal, url, sender } = item;
    const runState = this.runs.get(runId);

    const settings = this.store.getSettingsView();
    const providerId = settings.activeProvider;
    const model = settings.activeModel;
    const ollamaBaseUrl = this.store.getOllamaBaseUrl();
    const decryptedKey = (providerId === 'openrouter' || providerId === 'gemini' || providerId === 'together')
      ? this.store.getDecryptedKey(providerId)
      : undefined;

    if ((providerId === 'openrouter' || providerId === 'gemini' || providerId === 'together') && !decryptedKey) {
      console.error(`Error: Provider key not configured`);
      if (runState) {
        runState.status = 'error';
        runState.error = 'No provider configured — set one in Settings';
      }
      sender.send('run:event', {
        type: 'error',
        runId,
        message: 'No provider configured — set one in Settings',
      });
      sender.send('run:event', {
        type: 'status',
        runId,
        status: 'error',
      });
      
      try {
        this.recorder.finishRun(runId, { status: 'error', error: 'No provider configured — set one in Settings' });
      } catch (err) {}
      
      this.activeCount--;
      this.processQueue();
      return;
    }

    try {
      sender.send('run:event', { type: 'started', runId });
      sender.send('run:event', { type: 'status', runId, status: 'running' });

      let session: BrowserSession | null = null;
      try {
        const provider = createProvider(providerId, {
          apiKey: decryptedKey,
          baseUrl: providerId === 'ollama' ? ollamaBaseUrl : undefined
        });

        session = await BrowserSession.launch({ headless: true });
        this.activeSessions.set(runId, session);

        await session.goto(url);

        const initialShot = await session.screenshot().catch(() => undefined);
        let initialDataUrl: string | undefined = undefined;
        if (initialShot) {
          initialDataUrl = `data:image/png;base64,${initialShot.toString('base64')}`;
        }
        
        if (runState) {
          runState.lastScreenshot = initialDataUrl;
          runState.currentTurn = 0;
        }

        sender.send('run:event', {
          type: 'step',
          runId,
          turn: 0,
          action: { action: 'navigate', url },
          screenshot: initialDataUrl,
        });

        try {
          this.recorder.recordStep({
            runId,
            turn: 0,
            action: { action: 'navigate', url },
            screenshot: initialShot,
          });
        } catch (err) {
          console.error('Failed to record initial step:', err);
        }

        const runResult = await runAgent({
          goal,
          url,
          provider,
          model,
          session,
          onStep: async ({ turn, reasoning, action, screenshot }) => {
            let dataUrl: string | undefined = undefined;
            if (screenshot) {
              dataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;
            }

            if (runState) {
              runState.lastScreenshot = dataUrl;
              runState.currentTurn = turn;
            }

            sender.send('run:event', {
              type: 'step',
              runId,
              turn,
              reasoning,
              action,
              screenshot: dataUrl,
            });

            try {
              this.recorder.recordStep({
                runId,
                turn,
                thought: reasoning,
                action,
                screenshot,
              });
            } catch (err) {
              console.error('Failed to record step in database:', err);
            }
          },
        });

        if (runResult.status === 'complete') {
          if (runState) {
            runState.status = 'done';
          }
          sender.send('run:event', { type: 'done', runId, extracted: runResult.extracted });
          sender.send('run:event', { type: 'status', runId, status: 'done' });
          try {
            this.recorder.finishRun(runId, { status: 'complete', result: runResult.extracted });
          } catch (err) {}
        } else if (runResult.status === 'error') {
          const errMsg = runResult.error || 'Unknown error occurred';
          if (runState) {
            runState.status = 'error';
            runState.error = errMsg;
          }
          sender.send('run:event', { type: 'error', runId, message: errMsg });
          sender.send('run:event', { type: 'status', runId, status: 'error' });
          try {
            this.recorder.finishRun(runId, { status: 'error', error: errMsg });
          } catch (err) {}
        } else {
          if (runState) {
            runState.status = 'done';
          }
          sender.send('run:event', { type: 'status', runId, status: 'done' });
          sender.send('run:event', { type: 'done', runId, extracted: runResult.extracted });
          try {
            this.recorder.finishRun(runId, { status: runResult.status, result: runResult.extracted });
          } catch (err) {}
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Exception occurred during run:`, message);
        if (runState) {
          runState.status = 'error';
          runState.error = message;
        }
        sender.send('run:event', { type: 'error', runId, message });
        sender.send('run:event', { type: 'status', runId, status: 'error' });
        try {
          this.recorder.finishRun(runId, { status: 'error', error: message });
        } catch (recErr) {}
      } finally {
        if (session) {
          await session.close().catch(() => {});
        }
        this.activeSessions.delete(runId);
      }
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }
}

function createWindow(): void {
  let preloadPath = path.join(__dirname, '../preload/index.js');
  if (!fs.existsSync(preloadPath)) {
    preloadPath = path.join(__dirname, '../preload/index.mjs');
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#0A0A0A',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM (.mjs) preloads don't run in a sandboxed renderer
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Intercept close event for close-to-tray behavior
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  } else {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (rendererUrl) {
      mainWindow.loadURL(rendererUrl);
    } else {
      mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
  }
}

app.whenReady().then(() => {
  // Remove default File/Edit/View menu bar
  Menu.setApplicationMenu(null);

  const store = new SettingsStore();
  const recorder = new Recorder({
    dbPath: path.join(app.getPath('userData'), 'murl.db'),
    screenshotDir: path.join(app.getPath('userData'), 'screenshots'),
  });

  const runManager = new RunManager(store, recorder);

  // Set up runs:getState IPC Handler
  ipcMain.handle('runs:getState', () => {
    return runManager.getStates();
  });

  // Set up IPC handle calling the headless engine health()
  ipcMain.handle('engine:health', () => {
    return health();
  });

  // History IPC Handlers
  ipcMain.handle('history:list', () => {
    try {
      return recorder.listRuns();
    } catch (err) {
      console.error('Failed to list runs:', err);
      return [];
    }
  });

  ipcMain.handle('history:get', async (_event, id: string) => {
    try {
      const result = recorder.getRun(id);
      if (!result) {
        return null;
      }

      const { run, steps } = result;

      const mappedSteps = steps.map((step) => {
        let screenshot: string | undefined = undefined;
        const screenshotPath = step.screenshot_path as string | null;
        if (screenshotPath && fs.existsSync(screenshotPath)) {
          try {
            const buffer = fs.readFileSync(screenshotPath);
            screenshot = `data:image/png;base64,${buffer.toString('base64')}`;
          } catch (e) {
            console.error(`Failed to read screenshot at ${screenshotPath}:`, e);
          }
        }

        return {
          turn: step.turn as number,
          reasoning: (step.thought as string | null) ?? undefined,
          action: step.action,
          screenshot,
        };
      });

      return {
        id: run.id as string,
        goal: run.goal as string,
        url: run.start_url as string,
        status: run.status as string,
        startedAt: run.created_at as number,
        finishedAt: (run.finished_at as number | null) ?? undefined,
        steps: mappedSteps,
        extracted: run.result,
        error: (run.error as string | null) ?? undefined,
      };
    } catch (err) {
      console.error('Failed to get run:', err);
      return null;
    }
  });

  // Settings IPC Handlers
  ipcMain.handle('settings:get', () => {
    return store.getSettingsView();
  });

  ipcMain.handle('settings:setKey', (_event, id: ProviderId, key: string) => {
    return store.setKey(id, key);
  });

  ipcMain.handle('settings:clearKey', (_event, id: ProviderId) => {
    return store.clearKey(id);
  });

  ipcMain.handle('settings:setActive', (_event, id: ProviderId, model: string) => {
    return store.setActive(id, model);
  });

  ipcMain.handle('settings:setOllamaBaseUrl', (_event, url: string) => {
    return store.setOllamaBaseUrl(url);
  });

  ipcMain.handle('settings:test', async (_event, id: ProviderId) => {
    try {
      if (id === 'openrouter' || id === 'gemini' || id === 'together') {
        const apiKey = store.getDecryptedKey(id);
        if (!apiKey) {
          return { ok: false, error: 'API key is not configured.' };
        }
        const activeModel = store.getActiveModel(id);
        const defaultModel = id === 'openrouter'
          ? 'google/gemini-2.5-flash'
          : id === 'gemini'
          ? 'gemini-2.5-flash'
          : 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
        const model = activeModel || defaultModel;

        const provider = createProvider(id, { apiKey });
        await provider.complete({
          model,
          messages: [{ role: 'user', content: 'say ok' }],
          maxTokens: 1,
        });
        return { ok: true };
      } else if (id === 'ollama') {
        const ollamaBaseUrl = store.getOllamaBaseUrl();
        const cleanUrl = ollamaBaseUrl.trim().replace(/\/+$/, '');
        const testUrl = cleanUrl.endsWith('/v1') ? `${cleanUrl}/models` : `${cleanUrl}/v1/models`;
        const res = await fetch(testUrl);
        if (!res.ok) {
          return { ok: false, error: `Ollama returned HTTP error status ${res.status}` };
        }
        return { ok: true };
      } else {
        return { ok: false, error: `Unknown provider ID: ${id}` };
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { ok: false, error: errorMessage };
    }
  });

  // Run/Agent IPC Handlers
  ipcMain.handle('run:start', async (event, input: { goal: string; url: string }) => {
    const runId = crypto.randomUUID();
    runManager.enqueue(runId, input.goal, input.url, event.sender);
    return { runId };
  });

  ipcMain.handle('run:cancel', async (_event, runId: string) => {
    const ok = runManager.cancel(runId);
    return { ok };
  });

  createWindow();

  // Create Tray Icon
  const iconPath = path.join(app.getPath('userData'), 'tray_icon.png');
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );
  try {
    fs.writeFileSync(iconPath, dummyPng);
  } catch (err) {
    console.error('Failed to write tray icon:', err);
  }

  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Murl',
      click: (): void => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Quit',
      click: (): void => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('Murl Research Harness');
  tray.setContextMenu(contextMenu);

  // Restore on single click
  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // darwin app-lifecycle standard is handled by activate above
  }
});
