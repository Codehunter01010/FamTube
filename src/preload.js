const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('safetube', {
  state: () => ipcRenderer.invoke('state'),
  setPin: (pin) => ipcRenderer.invoke('set-pin', pin),
  checkPin: (pin) => ipcRenderer.invoke('check-pin', pin),
  lockParent: () => ipcRenderer.invoke('lock-parent'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  finishSetup: () => ipcRenderer.invoke('finish-setup'),
  openGuideLink: (url) => ipcRenderer.invoke('open-guide-link', url),
});
