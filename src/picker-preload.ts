import { contextBridge, ipcRenderer } from 'electron';

// Bridge for the "who is this mod for?" overlay of the browser window (renderer/picker.html).
interface PickShow { title: string; items: Array<{ v: string; l: string; c?: number }>; selected?: string | string[]; multi?: boolean; okLabel?: string; allowEmpty?: boolean; profile?: string; profiles?: string[] }
contextBridge.exposeInMainWorld('pk', {
  ready: () => ipcRenderer.send('br:pick-ready'),
  done: (v: string | string[] | null, profile?: string) => ipcRenderer.send('br:pick-done', v, profile),
  onShow: (cb: (o: PickShow) => void) => { ipcRenderer.on('pick:show', (_e, o) => cb(o)); },
});
