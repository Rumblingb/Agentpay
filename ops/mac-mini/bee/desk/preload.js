const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bee', {
  onState: (cb) => ipcRenderer.on('state', (_e, d) => cb(d)),
  onPointer: (cb) => ipcRenderer.on('pointer', (_e, p) => cb(p)),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  speak: (t) => ipcRenderer.send('speak', t),
  resizePanel: (open, h) => ipcRenderer.send('panel-resize', { open: !!open, h: h || 0 }),
  onDashData: (cb) => ipcRenderer.on('dash-data', (_e, d) => cb(d)),
  onDashFeed: (cb) => ipcRenderer.on('dash-feed', (_e, d) => cb(d)),
  dashAction: (kind, arg) => ipcRenderer.send('dash-action', { kind, arg }),
  dashClose: () => ipcRenderer.send('dash-close'),
});
