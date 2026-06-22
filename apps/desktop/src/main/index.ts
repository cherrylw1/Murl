import { app, BrowserWindow, ipcMain, Menu, Tray, WebContents } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { health, createProvider, ProviderId, TaskStore, WorktreeManager } from '@murl/engine';
import { SettingsStore } from './settingsStore.js';
import crypto from 'crypto';
import { TaskManager } from './taskManager.js';

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
  const taskStore = new TaskStore({
    dbPath: path.join(app.getPath('userData'), 'murl.db'),
  });
  const worktreeManager = new WorktreeManager();
  const taskManager = new TaskManager(taskStore, worktreeManager);

  // Set up runs compatibility IPC Handler
  ipcMain.handle('runs:getState', () => {
    return taskManager.getStates().map((t) => ({
      runId: t.taskId,
      goal: t.prompt,
      url: t.workspaceId,
      status: t.status === 'completed' ? 'done' : t.status === 'failed' ? 'error' : t.status,
      error: t.error,
    }));
  });

  // Set up IPC handle calling the headless engine health()
  ipcMain.handle('engine:health', () => {
    return health();
  });

  // History IPC Handlers
  ipcMain.handle('history:list', () => {
    try {
      const tasks = taskStore.listTasks();
      return tasks.map((t) => ({
        id: t.id,
        goal: t.prompt,
        url: '',
        status: t.status,
        startedAt: t.createdAt,
        finishedAt: t.finishedAt ?? undefined,
      }));
    } catch (err) {
      console.error('Failed to list history:', err);
      return [];
    }
  });

  ipcMain.handle('history:get', async (_event, id: string) => {
    try {
      const task = taskStore.getTask(id);
      if (!task) {
        return null;
      }
      const logs = taskStore.getTaskLogs(id);
      return {
        id: task.id,
        goal: task.prompt,
        url: '',
        status: task.status,
        startedAt: task.createdAt,
        finishedAt: task.finishedAt,
        steps: logs.map((l) => ({
          turn: 0,
          reasoning: l.type === 'info' ? l.content : undefined,
          action:
            l.type === 'stdout' || l.type === 'stderr' || l.type === 'diff'
              ? { action: 'output', type: l.type, content: l.content }
              : undefined,
        })),
        extracted: undefined,
        error: task.errorMessage,
      };
    } catch (err) {
      console.error('Failed to get history:', err);
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
        const defaultModel =
          id === 'openrouter'
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

  // compatibility Run Handlers
  ipcMain.handle('run:start', async (event, input: { goal: string; url: string }) => {
    const runId = crypto.randomUUID();
    taskManager.enqueue(runId, input.goal, 'default-workspace', input.url, event.sender);
    return { runId };
  });

  ipcMain.handle('run:cancel', async (_event, runId: string) => {
    const taskState = taskManager.getStates().find((t) => t.taskId === runId);
    const repoPath = taskState ? taskState.workspaceId : '';
    const ok = taskManager.cancel(runId, repoPath);
    return { ok };
  });

  // Repository IPC Handlers
  ipcMain.handle('repo:add', (_event, name: string, repoPath: string) => {
    return taskStore.addRepository(name, repoPath);
  });

  ipcMain.handle('repo:list', () => {
    return taskStore.listRepositories();
  });

  ipcMain.handle('repo:remove', (_event, id: string) => {
    taskStore.removeRepository(id);
    return { ok: true };
  });

  // Task IPC Handlers
  ipcMain.handle(
    'task:start',
    async (event, input: { prompt: string; workspaceId: string; repoPath: string }) => {
      const taskId = crypto.randomUUID();
      taskManager.enqueue(taskId, input.prompt, input.workspaceId, input.repoPath, event.sender);
      return { taskId };
    },
  );

  ipcMain.handle(
    'task:cancel',
    async (_event, input: { taskId: string; repoPath: string }) => {
      const ok = taskManager.cancel(input.taskId, input.repoPath);
      return { ok };
    },
  );

  ipcMain.handle('tasks:getState', () => {
    return taskManager.getStates();
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
