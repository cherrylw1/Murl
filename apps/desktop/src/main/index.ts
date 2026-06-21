import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { health, createProvider, ProviderId, BrowserSession, runAgent } from '@murl/engine';
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

  // Set up IPC handle calling the headless engine health()
  ipcMain.handle('engine:health', () => {
    return health();
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
        const defaultModel = id === 'openrouter' ? 'google/gemini-2.5-flash' : 'gemini-1.5-flash';
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
    console.log(`[MAIN] run:start invoked: id=${runId}, goal="${input.goal}", url="${input.url}"`);

    const settings = store.getSettingsView();
    const providerId = settings.activeProvider;
    const model = settings.activeModel;
    const ollamaBaseUrl = store.getOllamaBaseUrl();
    const decryptedKey = (providerId === 'openrouter' || providerId === 'gemini')
      ? store.getDecryptedKey(providerId)
      : undefined;

    console.log(`[MAIN] Config: provider=${providerId}, model=${model}, hasKey=${!!decryptedKey}`);
    if (decryptedKey) {
      console.log(`[MAIN] Decrypted key length=${decryptedKey.length}, prefix="${decryptedKey.substring(0, 6)}"`);
      try {
        console.log('[MAIN] Testing Gemini models list...');
        const testRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${decryptedKey}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        console.log(`[MAIN] Gemini response status: ${testRes.status}`);
        const testText = await testRes.text();
        console.log(`[MAIN] Gemini response body: ${testText}`);
      } catch (testErr: any) {
        console.error('[MAIN] Gemini fetch threw error:', testErr.stack || testErr.message || testErr);
      }

      // Also test OpenRouter if key is present
      const orKey = store.getDecryptedKey('openrouter');
      if (orKey) {
        console.log(`[MAIN] Decrypted OpenRouter key length=${orKey.length}, prefix="${orKey.substring(0, 6)}"`);
        try {
          console.log('[MAIN] Testing OpenRouter fetch...');
          const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${orKey}`,
              'HTTP-Referer': 'https://github.com/murl',
              'X-Title': 'Murl Desktop'
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [{ role: 'user', content: 'Hello' }]
            })
          });
          console.log(`[MAIN] OpenRouter response status: ${orRes.status}`);
          const orText = await orRes.text();
          console.log(`[MAIN] OpenRouter response body: ${orText}`);
        } catch (orErr: any) {
          console.error('[MAIN] OpenRouter fetch threw error:', orErr.stack || orErr.message || orErr);
        }
      }
    }

    if ((providerId === 'openrouter' || providerId === 'gemini') && !decryptedKey) {
      console.error(`[MAIN] Error: Provider key not configured`);
      setTimeout(() => {
        event.sender.send('run:event', {
          type: 'error',
          runId,
          message: 'No provider configured — set one in Settings',
        });
      }, 50);
      return { runId };
    }

    // Run the agent run asynchronously in the background
    (async () => {
      // Give the renderer a tiny bit of time to subscribe to events
      await new Promise(resolve => setTimeout(resolve, 50));

      event.sender.send('run:event', { type: 'started', runId });
      event.sender.send('run:event', { type: 'status', runId, status: 'running' });

      let session: BrowserSession | null = null;
      try {
        console.log(`[MAIN] Building provider...`);
        const provider = createProvider(providerId, {
          apiKey: decryptedKey,
          baseUrl: providerId === 'ollama' ? ollamaBaseUrl : undefined
        });

        console.log(`[MAIN] Launching browser session...`);
        session = await BrowserSession.launch({ headless: true });
        activeRuns.set(runId, session);

        console.log(`[MAIN] Navigating to: ${input.url}`);
        await session.goto(input.url);
        console.log(`[MAIN] Navigation complete.`);

        console.log(`[MAIN] Executing runAgent...`);
        const runResult = await runAgent({
          goal: input.goal,
          url: input.url,
          provider,
          model,
          session,
          onStep: async ({ turn, reasoning, action, screenshot }) => {
            console.log(`[MAIN] onStep: turn=${turn}, action=${action.action}, reasoning="${reasoning || ''}"`);
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
          },
        });

        console.log(`[MAIN] runAgent finished: status=${runResult.status}`);

        if (runResult.status === 'complete') {
          event.sender.send('run:event', { type: 'done', runId, extracted: runResult.extracted });
          event.sender.send('run:event', { type: 'status', runId, status: 'done' });
        } else if (runResult.status === 'error') {
          event.sender.send('run:event', { type: 'error', runId, message: runResult.error || 'Unknown error occurred' });
          event.sender.send('run:event', { type: 'status', runId, status: 'error' });
        } else {
          event.sender.send('run:event', { type: 'status', runId, status: 'done' });
          event.sender.send('run:event', { type: 'done', runId, extracted: runResult.extracted });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[MAIN] Exception occurred during run:`, message);
        event.sender.send('run:event', { type: 'error', runId, message });
        event.sender.send('run:event', { type: 'status', runId, status: 'error' });
      } finally {
        if (session) {
          console.log(`[MAIN] Closing browser session...`);
          await session.close().catch(() => {});
        }
        activeRuns.delete(runId);
        console.log(`[MAIN] Run cleaned up.`);
      }
    })().catch(err => {
      console.error('[MAIN] Background agent run failed:', err);
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
