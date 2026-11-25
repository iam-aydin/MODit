import { contextBridge, ipcRenderer } from 'electron';

// Bridge for the right-click menu of the browser window (renderer/menu.html).
contextBridge.exposeInMainWorld('mnu', {
  pick: (i: number) => ipcRenderer.send('br:menu-pick', i),
  blur: () => ipcRenderer.send('br:menu-blur'),
  ready: () => ipcRenderer.send('br:menu-ready'),
  onShow: (cb: (items: Array<{ label?: string; enabled: boolean; sep: boolean }>) => void) => { ipcRenderer.on('menu:show', (_e, items) => cb(items)); },
  onClose: (cb: () => void) => { ipcRenderer.on('menu:close', () => cb()); },
});