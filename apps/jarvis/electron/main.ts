import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';

const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 30_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000;

let bridgeProcess: ChildProcess | undefined;
let mainWindow: BrowserWindow | undefined;
let appOrigin: string | undefined;
let quitting = false;

interface BridgeSecrets {
  apiToken: string;
  masterKey: string;
}

function resourcePath(...parts: string[]): string {
  return path.join(app.getAppPath(), ...parts);
}

function bridgeResourcePath(...parts: string[]): string {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath();
  return path.join(root, ...parts);
}

function keychainSecret(service: string): string | undefined {
  try {
    return execFileSync('security', [
      'find-generic-password', '-s', service, '-a', userInfo().username, '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function bridgeSecrets(): BridgeSecrets {
  const keychainApiToken = keychainSecret('jericho-core-api');
  const keychainMasterKey = keychainSecret('jericho-core');
  if (keychainApiToken && keychainMasterKey) {
    return { apiToken: keychainApiToken, masterKey: keychainMasterKey };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('macOS secure storage is unavailable. Unlock your login Keychain and try again.');
  }
  const secretsPath = path.join(app.getPath('userData'), 'bridge-secrets.bin');
  try {
    const existing = JSON.parse(safeStorage.decryptString(readFileSync(secretsPath))) as BridgeSecrets;
    if (existing.apiToken && existing.masterKey) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Jericho could not decrypt its local credentials.', { cause: error });
    }
  }
  const created = {
    apiToken: keychainApiToken ?? randomBytes(32).toString('base64url'),
    masterKey: keychainMasterKey ?? randomBytes(32).toString('base64'),
  };
  writeFileSync(secretsPath, safeStorage.encryptString(JSON.stringify(created)), { mode: 0o600 });
  chmodSync(secretsPath, 0o600);
  return created;
}

function startBridge(): Promise<string> {
  return new Promise((resolve, reject) => {
    const secrets = bridgeSecrets();
    const bridgeScript = bridgeResourcePath('bridge', 'src', 'server.ts');
    const tsxLoader = bridgeResourcePath('node_modules', 'tsx', 'dist', 'loader.mjs');
    const child = spawn(process.execPath, ['--import', tsxLoader, bridgeScript, '--port', '0'], {
      cwd: path.dirname(bridgeScript),
      env: {
        ...process.env,
        CONDUCTOR_PORT: '0',
        ELECTRON_RUN_AS_NODE: '1',
        JERICHO_HOST: HOST,
        JERICHO_API_TOKEN: secrets.apiToken,
        JERICHO_MASTER_KEY: secrets.masterKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    bridgeProcess = child;

    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(url!);
    };
    const consumeLines = (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        console.log(`[bridge] ${line}`);
        const match = line.match(/one-time browser bootstrap (http:\/\/127\.0\.0\.1:\d+\/\S+)/);
        if (match?.[1]) finish(undefined, match[1]);
      }
    };

    child.stdout?.on('data', consumeLines);
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr = (stderr + text).slice(-4_000);
      console.error(`[bridge] ${text.trimEnd()}`);
    });
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      bridgeProcess = undefined;
      if (!quitting) {
        finish(new Error(`Jericho bridge exited (${signal ?? code ?? 'unknown'}).${stderr ? `\n${stderr}` : ''}`));
        if (settled) void showFatalError('The Jericho bridge stopped unexpectedly.');
      }
    });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`Jericho bridge did not start within ${STARTUP_TIMEOUT_MS / 1_000} seconds.${stderr ? `\n${stderr}` : ''}`));
    }, STARTUP_TIMEOUT_MS);
  });
}

function createWindow(url: string): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Jericho',
    backgroundColor: '#05090c',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resourcePath('electron', 'dist', 'preload.cjs'),
      sandbox: true,
    },
  });
  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });
  void window.loadURL(url).catch((error) => showFatalError(`Jericho could not load its interface.\n\n${String(error)}`));
}

async function showFatalError(message: string): Promise<void> {
  await dialog.showMessageBox({ type: 'error', title: 'Jericho', message });
  app.quit();
}

function githubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('security', [
      'find-generic-password', '-s', 'jericho-github-updater', '-a', userInfo().username, '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function configureUpdates(): void {
  if (!app.isPackaged) return;
  const token = githubToken();
  if (!token) {
    console.log('[updater] No jericho-github-updater token; automatic updates are disabled.');
    return;
  }
  autoUpdater.requestHeaders = { Authorization: `token ${token}` };
  autoUpdater.autoDownload = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('update-available', (info) => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Jericho ${info.version} is available.`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => response === 0 && void autoUpdater.downloadUpdate());
  });
  autoUpdater.on('update-downloaded', () => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'The update is ready to install.',
      buttons: ['Install & Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => response === 0 && autoUpdater.quitAndInstall());
  });
  autoUpdater.on('error', (error) => console.error('[updater]', error));
  const check = () => void autoUpdater.checkForUpdates().catch((error) => console.error('[updater]', error));
  check();
  setInterval(check, UPDATE_INTERVAL_MS).unref();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const bootstrapUrl = await startBridge();
      appOrigin = new URL(bootstrapUrl).origin;
      createWindow(bootstrapUrl);
      configureUpdates();
    } catch (error) {
      await showFatalError(`Jericho could not start.\n\n${String(error)}`);
    }
  });
}

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else if (appOrigin) createWindow(appOrigin);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  bridgeProcess?.kill('SIGTERM');
});
