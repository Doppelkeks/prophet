// Sandboxed preload (must be CommonJS). Exposes a minimal, typed host API to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prophetHost', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  gpuUnavailable: () => ipcRenderer.send('px:gpu-unavailable'),
});
