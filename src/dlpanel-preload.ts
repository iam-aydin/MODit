import { contextBridge, ipcRenderer } from 'electron';

// Bridge for the downloads popup of the browser window (renderer/dlpanel.html).
contextBridge.exposeInMainWorld('dlp', {
  cmd: (name: string, id?: string) => ipcRenderer.invoke('br:dl', name, id),
  size: (h: number) => ipcRenderer.send('br:dl-size', h),
  blur: () => ipcRenderer.send('br:dl-blur'),
  keep: () => ipcRenderer.send('br:dl-keep'),
  ready: () => ipcRenderer.send('br:dl-ready'),
  onOpen: (cb: () => void) => { ipcRenderer.on('dl:open', () => cb()); },
  onClose: (cb: () => void) => { ipcRenderer.on('dl:close', () => cb()); },
});