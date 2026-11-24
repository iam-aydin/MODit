import { contextBridge, ipcRenderer } from 'electron';

// Bridge for the browser window's own toolbar (renderer/browser.html).
contextBridge.exposeInMainWorld('br', {
  cmd: (name: string, arg?: unknown) => ipcRenderer.send('br', name, arg),
  onState: (cb: (s: unknown) => void) => { ipcRenderer.on('br:state', (_e, s) => cb(s)); },
  onFocus: (cb: () => void) => { ipcRenderer.on('br:focus', () => cb()); },
});
