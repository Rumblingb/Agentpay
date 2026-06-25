const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('beeApproval', {
  onRequest: (cb) => ipcRenderer.on('gesture', (_event, request) => cb(request)),
  submit: (decision, token) => ipcRenderer.send('gesture-result', { decision, token }),
});
