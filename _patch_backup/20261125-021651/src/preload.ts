import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('api', {
  invoke: (cmd: string, args?: Record<string, unknown>) => ipcRenderer.invoke('cmd', cmd, args || {}),
  openDialog: (opts: Record<string, unknown>) => ipcRenderer.invoke('dialog:open', opts),
  ask: (message: string) => ipcRenderer.invoke('dialog:ask', message),
  // a download finished (full path of the saved file)
  onDownloaded: (cb: (path: string) => void) => {
    ipcRenderer.on('downloaded', (_e, p: string) => cb(p));
  },
  // live list of downloads (progress updates)
  onDownloads: (cb: (list: unknown[]) => void) => {
    ipcRenderer.on('downloads', (_e, l: unknown[]) => cb(l));
  },
  onToast: (cb: (msg: string) => void) => {
    ipcRenderer.on('toast', (_e, m: string) => cb(m));
  },
  // real file paths for drag & drop
  pathFor: (file: File) => webUtils.getPathForFile(file),
});
