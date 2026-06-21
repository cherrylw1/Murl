import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { health, createProvider, ProviderId, BrowserSession, runAgent, Recorder } from '@murl/engine';
import { SettingsStore } from './settingsStore.js';
import crypto from 'crypto';

// Helper to resolve __dirname in ES Modules (electron-vite compiles main to ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const activeRuns = new Map<string, BrowserSession>();

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
      if (id === 'openrouter' || id === 'gemini') {
        const apiKey = store.getDecryptedKey(id);
        if (!apiKey) {
          return { ok: false, error: 'API key is not configured.' };
        }
        const activeModel = store.getActiveModel(id);
        const defaultModel = id === 'openrouter' ? 'google/gemini-2.5-flash' : 'gemini-2.5-flash';
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

    const settings = store.getSettingsView();
    const providerId = settings.activeProvider;
    const model = settings.activeModel;
    const ollamaBaseUrl = store.getOllamaBaseUrl();
    const decryptedKey = (providerId === 'openrouter' || providerId === 'gemini')
      ? store.getDecryptedKey(providerId)
      : undefined;

    if ((providerId === 'openrouter' || providerId === 'gemini') && !decryptedKey) {
      console.error(`Error: Provider key not configured`);
      setTimeout(() => {
        event.sender.send('run:event', {
          type: 'error',
          runId,
          message: 'No provider configured — set one in Settings',
        });
      }, 50);
      return { runId };
    }

    try {
      recorder.startRun({
        id: runId,
        goal: input.goal,
        startUrl: input.url,
        providerId,
        model,
      });
    } catch (err) {
      console.error('Failed to start run in database recorder:', err);
    }

    // Run the agent run asynchronously in the background
    (async () => {
      // Give the renderer a tiny bit of time to subscribe to events
      await new Promise(resolve => setTimeout(resolve, 50));

      event.sender.send('run:event', { type: 'started', runId });
      event.sender.send('run:event', { type: 'status', runId, status: 'running' });

      let session: BrowserSession | null = null;
      try {
        const provider = createProvider(providerId, {
          apiKey: decryptedKey,
          baseUrl: providerId === 'ollama' ? ollamaBaseUrl : undefined
        });

        session = await BrowserSession.launch({ headless: true });
        activeRuns.set(runId, session);

        await session.goto(input.url);

        const initialShot = await session.screenshot().catch(() => undefined);
        let initialDataUrl: string | undefined = undefined;
        if (initialShot) {
          initialDataUrl = `data:image/png;base64,${initialShot.toString('base64')}`;
        }
        event.sender.send('run:event', {
          type: 'step',
          runId,
          turn: 0,
          action: { action: 'navigate', url: input.url },
          screenshot: initialDataUrl,
        });
        recorder.recordStep({
          runId,
          turn: 0,
          action: { action: 'navigate', url: input.url },
          screenshot: initialShot,
        });

        const runResult = await runAgent({
          goal: input.goal,
          url: input.url,
          provider,
          model,
          session,
          onStep: async ({ turn, reasoning, action, screenshot }) => {
            let dataUrl: string | undefined = undefined;
            if (screenshot) {
              dataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;
            }
            event.sender.send('run:event', {
              type: 'step',
              runId,
              turn,
              reasoning,
              action,
              screenshot: dataUrl,
            });
            recorder.recordStep({
              runId,
              turn,
              thought: reasoning,
              action,
              screenshot,
            });
          },
        });

        if (runResult.status === 'complete') {
          event.sender.send('run:event', { type: 'done', runId, extracted: runResult.extracted });
          event.sender.send('run:event', { type: 'status', runId, status: 'done' });
          recorder.finishRun(runId, { status: 'complete', result: runResult.extracted });
        } else if (runResult.status === 'error') {
          event.sender.send('run:event', { type: 'error', runId, message: runResult.error || 'Unknown error occurred' });
          event.sender.send('run:event', { type: 'status', runId, status: 'error' });
          recorder.finishRun(runId, { status: 'error', error: runResult.error || 'Unknown error occurred' });
        } else {
          event.sender.send('run:event', { type: 'status', runId, status: 'done' });
          event.sender.send('run:event', { type: 'done', runId, extracted: runResult.extracted });
          recorder.finishRun(runId, { status: runResult.status, result: runResult.extracted });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Exception occurred during run:`, message);
        event.sender.send('run:event', { type: 'error', runId, message });
        event.sender.send('run:event', { type: 'status', runId, status: 'error' });
        recorder.finishRun(runId, { status: 'error', error: message });
      } finally {
        if (session) {
          await session.close().catch(() => {});
        }
        activeRuns.delete(runId);
      }
    })().catch(err => {
      console.error('Background agent run failed:', err);
    });

    return { runId };
  });

  ipcMain.handle('run:cancel', async (_event, runId: string) => {
    const session = activeRuns.get(runId);
    if (session) {
      await session.close().catch(() => {});
      activeRuns.delete(runId);
      return { ok: true };
    }
    return { ok: false };
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
