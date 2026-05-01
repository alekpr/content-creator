/**
 * Electron Main Process — Content Creator Desktop App
 *
 * Responsibilities:
 *   - Spawn the backend (Express + BullMQ) as a managed child process
 *   - Wait for the backend /health endpoint before showing the renderer
 *   - Create the BrowserWindow with hardened security defaults
 *   - Handle graceful shutdown and IPC helpers
 *
 * Dev mode:  spawns backend via tsx watch, loads Vite renderer (localhost:5173)
 * Prod mode: spawns backend via Node.js, backend also serves frontend static files
 */

import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

// ─── Constants ────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;
const DEFAULT_BACKEND_PORT = 3001;
const DEFAULT_VITE_PORT = 5173;

let backendPort = DEFAULT_BACKEND_PORT;
let vitePort = DEFAULT_VITE_PORT;

function getBackendUrl(): string {
  return `http://localhost:${backendPort}`;
}

function parsePort(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// ─── State ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let isQuitting = false;

// ─── Env helpers ──────────────────────────────────────────────────────────────

/**
 * Minimal .env file parser — no extra dependencies needed.
 * Handles basic KEY=VALUE, quoted values, and # comments.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
    result[key] = raw.replace(/^(["'])(.*)\1$/, '$2');
  }
  return result;
}

/**
 * Build the environment object for the backend child process.
 *
 * Priority order (highest → lowest):
 *   1. Electron-computed overrides (paths, FRONTEND_URL, ELECTRON_MODE)
 *   2. Values from the .env file  (user secrets: API keys, DB URLs, etc.)
 *   3. Inherited process.env     (PATH, system variables)
 */
function buildBackendEnv(): NodeJS.ProcessEnv {
  const userData = app.getPath('userData');

  // Dev: read secrets from backend/.env
  // Prod: read secrets from <userData>/.env (user-managed)
  const envFilePath = isDev
    ? path.join(__dirname, '../backend/.env')
    : path.join(userData, '.env');

  const fileEnv = parseEnvFile(envFilePath);

  backendPort = parsePort(process.env.BACKEND_PORT ?? process.env.PORT ?? fileEnv.BACKEND_PORT ?? fileEnv.PORT, DEFAULT_BACKEND_PORT);
  vitePort = parsePort(process.env.VITE_PORT ?? process.env.FRONTEND_PORT ?? fileEnv.VITE_PORT ?? fileEnv.FRONTEND_PORT, DEFAULT_VITE_PORT);

  const electronOverrides: Record<string, string> = {
    NODE_ENV: isDev ? 'development' : 'production',
    PORT: String(backendPort),

    // CORS origin — in dev: allow Vite dev server
    //               in prod: backend serves the frontend on the same origin
    FRONTEND_URL: isDev
      ? `http://localhost:${vitePort}`
      : `http://localhost:${backendPort}`,

    // File storage — use backend local dirs in dev, userData in production
    TEMP_DIR: isDev
      ? path.join(__dirname, '../backend/temp')
      : path.join(userData, 'temp'),
    OUTPUT_DIR: isDev
      ? path.join(__dirname, '../backend/output')
      : path.join(userData, 'output'),

    // Tell backend to serve the built frontend (production only)
    SERVE_FRONTEND: isDev ? 'false' : 'true',
    FRONTEND_DIST_DIR: isDev ? '' : path.join(__dirname, '../frontend/dist'),

    // Marker used by backend/middleware for desktop-specific behaviour
    ELECTRON_MODE: 'true',
  };

  return {
    ...process.env,   // inherit PATH, HOME, etc.
    ...fileEnv,       // user secrets
    ...electronOverrides, // computed Electron values always win
  };
}

// ─── Backend process management ───────────────────────────────────────────────

/**
 * Find the system Node.js binary for spawning the backend.
 * `process.execPath` in a packaged Electron app is the Electron binary itself,
 * not Node.js — so we must locate the real node executable separately.
 */
function findNodeBin(): string {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  // Common macOS install locations (NVM, Homebrew, system)
  const candidates = [
    '/opt/homebrew/bin/node',  // Apple Silicon Homebrew
    '/usr/local/bin/node',     // Intel Homebrew / nvm symlink
    '/usr/bin/node',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fall back to PATH resolution
  try {
    return execFileSync('which', ['node'], { encoding: 'utf8', env: process.env }).trim();
  } catch {
    return 'node';
  }
}

function spawnBackend(): void {
  const backendEnv = buildBackendEnv();
  const backendDir = path.join(__dirname, '../backend');

  if (isDev) {
    // Use the tsx binary from the workspace root node_modules
    const tsxBin = path.join(__dirname, '../node_modules/.bin/tsx');
    backendProcess = spawn(
      tsxBin,
      ['watch', 'src/server.ts'],
      { env: backendEnv, cwd: backendDir, stdio: 'inherit' },
    );
  } else {
    // Production: run the pre-compiled CommonJS bundle via system Node.js
    // (process.execPath is the Electron binary in packaged apps, not Node)
    const serverJs = path.join(__dirname, '../backend/dist/server.js');
    const nodeBin = findNodeBin();
    backendProcess = spawn(
      nodeBin,
      [serverJs],
      { env: backendEnv, cwd: path.dirname(serverJs), stdio: 'inherit' },
    );
  }

  backendProcess.on('error', (err) => {
    console.error('[Electron] Backend process error:', err.message);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Backend exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`);
    if (code !== 0 && code !== null && !isQuitting) {
      void dialog.showErrorBox(
        'Backend crashed',
        `The application backend exited unexpectedly (exit code ${code}).\n\n` +
          'Please restart the app. If the problem persists, check that MongoDB and Redis are running.',
      );
    }
  });
}

function stopBackend(): void {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

async function waitForBackend(maxMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${getBackendUrl()}/health`);
      if (res.ok) return true;
    } catch {
      // backend not ready yet — keep polling
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// ─── BrowserWindow ────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // renderer cannot access Node APIs
      nodeIntegration: false,   // no require() in renderer
      sandbox: true,            // renderer process sandboxing
    },
    titleBarStyle: 'hiddenInset', // native macOS look
    show: false, // show only after content loads (avoid flash)
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Prevent navigation to unexpected URLs; open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isInternal =
      url.startsWith(`http://localhost:${vitePort}`) ||
      url.startsWith(getBackendUrl());
    if (isInternal) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (evt, url) => {
    const isInternal =
      url.startsWith(`http://localhost:${vitePort}`) ||
      url.startsWith(getBackendUrl()) ||
      url.startsWith('file://');
    if (!isInternal) {
      evt.preventDefault();
      void shell.openExternal(url);
    }
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIPCHandlers(): void {
  // Expose userData path so the renderer can display where files are stored
  ipcMain.handle('app:get-data-path', () => app.getPath('userData'));

  // Expose app version from package.json
  ipcMain.handle('app:get-version', () => app.getVersion());

  // Reveal a local file in Finder
  ipcMain.handle('app:show-item-in-folder', (_evt, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  spawnBackend();

  const ready = await waitForBackend(25_000);
  if (!ready) {
    stopBackend();
    dialog.showErrorBox(
      'Backend startup failed',
      'The application backend did not respond within 25 seconds.\n\n' +
        'Please check:\n' +
        '  • MongoDB is running on mongodb://localhost:27017\n' +
        '  • Redis is running on redis://localhost:6379\n' +
        '  • GEMINI_API_KEY is set in your .env file\n\n' +
        `Config file location: ${app.getPath('userData')}/.env`,
    );
    app.quit();
    return;
  }

  createWindow();
  registerIPCHandlers();

  if (isDev) {
    // Development: load the Vite dev server for hot module replacement
    await mainWindow!.loadURL(`http://localhost:${vitePort}`);
    mainWindow!.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: backend serves the built frontend — same origin, no CORS
    await mainWindow!.loadURL(getBackendUrl());
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => void bootstrap());

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

app.on('window-all-closed', () => {
  // On macOS always quit when all windows are closed (no dock-only mode for this app)
  app.quit();
});

app.on('activate', () => {
  // macOS: re-create window when clicking the dock icon with no windows open
  if (BrowserWindow.getAllWindows().length === 0) {
    void bootstrap();
  }
});
