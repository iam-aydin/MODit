import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('api', {
  invoke: (cmd: string, args?: Record<string, unknown>) => ipcRenderer.invoke('cmd', cmd, args || {}),
  openDialog: (opts: Record<string, unknown>) => ipcRenderer.invoke('dialog:open', opts),
  ask: (message: string) => ipcRenderer.invoke('dialog:ask', message),
  // a download finished (full path of the saved file)
  onDownloaded: (cb: (path: string, gameId?: string) => void) => {
    ipcRenderer.on('downloaded', (_e, p: string, gameId?: string) => cb(p, gameId));
  },
  // live list of downloads (progress updates)
  onDownloads: (cb: (list: unknown[]) => void) => {
    ipcRenderer.on('downloads', (_e, l: unknown[]) => cb(l));
  },
  // the browser window asks the app to show one of its sections (e.g. "downloads")
  onGoto: (cb: (view: string) => void) => {
    ipcRenderer.on('goto', (_e, v: string) => cb(v));
  },
  // a cover picture was downloaded (file name inside the covers folder) or removed (null)
  onCover: (cb: (id: string, file: string | null) => void) => {
    ipcRenderer.on('cover', (_e, id: string, f: string | null) => cb(id, f));
  },
  onToast: (cb: (msg: string) => void) => {
    ipcRenderer.on('toast', (_e, m: string) => cb(m));
  },
  // real file paths for drag & drop
  pathFor: (file: File) => webUtils.getPathForFile(file),
});
