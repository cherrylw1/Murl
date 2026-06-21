import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { health } from '@murl/engine';

// Helper to resolve __dirname in ES Modules (electron-vite compiles main to ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Set up IPC handle calling the headless engine health()
  ipcMain.handle('engine:health', () => {
    return health();
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
