const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bridge', {
  info: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (payload) => ipcRenderer.invoke('update:download', payload),
  installUpdate: (filePath) => ipcRenderer.invoke('update:install', filePath),
  onProgress: (handler) => {
    const listener = (_event, progress) => handler(progress)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  open: (url) => ipcRenderer.invoke('shell:open', url),
})
