// Electron main process (ESM). Serves the web build over app://prophet/ with cross-origin isolation.
//   electron .                 serves dist/web (run `npm run build` first)
//   electron . --px-root=.     serves the repo root (development, no bundling)
//   --px-query=driver=ping     appended to the start URL (tests, diagnostics)
//   PX_GPU_SWITCHES=none|unsafe|amd|swiftshader   overrides the per-OS switch set
import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppProtocol } from './protocol.js';
import { GpuSwitches } from './gpu-switches.js';

const here = dirname(fileURLToPath(import.meta.url));

/** @param {string} name */
function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const root = resolve(app.getAppPath(), arg('px-root') ?? 'dist/web');
const query = arg('px-query');
const isRetry = process.argv.includes('--px-gpu-retry');
const switchSet = GpuSwitches.apply(app, { override: process.env.PX_GPU_SWITCHES, alternate: isRetry });

protocol.registerSchemesAsPrivileged([AppProtocol.PRIVILEGES]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'SCRAPWAKE',
    backgroundColor: '#070B16',
    webPreferences: {
      preload: resolve(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${AppProtocol.ORIGIN}/`)) event.preventDefault();
  });
  win.loadURL(`${AppProtocol.ORIGIN}/index.html${query ? `?${query}` : ''}`);
  return win;
}

// The renderer reports "no WebGPU adapter": relaunch once with the alternate switch set.
ipcMain.once('px:gpu-unavailable', () => {
  if (isRetry) return;
  console.warn(`[prophet] no WebGPU adapter with switch set "${switchSet}", relaunching with the alternate set`);
  app.relaunch({ args: process.argv.slice(1).concat('--px-gpu-retry') });
  app.exit(0);
});

app.whenReady().then(() => {
  AppProtocol.install(protocol, root);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
