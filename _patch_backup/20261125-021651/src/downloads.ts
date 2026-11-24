import { app, BrowserWindow, DownloadItem, session, shell } from 'electron';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { downloadsDir, rm, safe } from './core';

export const PARTITION = 'persist:modit-browser'; // shared by the browser window and direct downloads

export interface Dl {
  id: string;
  name: string;
  path: string;
  received: number;
  total: number;
  state: 'downloading' | 'done' | 'failed' | 'cancelled';
  time: number;
}

const list = new Map<string, Dl>();
const items = new Map<string, DownloadItem>();
let getWin: () => BrowserWindow | null = () => null;
let hooked = false;
let timer: NodeJS.Timeout | null = null;

const snapshot = () => [...list.values()].sort((a, b) => b.time - a.time);

function flush(): void {
  timer = null;
  getWin()?.webContents.send('downloads', snapshot());
}
function push(now = false): void {
  if (now) { if (timer) clearTimeout(timer); flush(); }
  else if (!timer) timer = setTimeout(flush, 250); // progress ticks are throttled
}

/** The browser session should look like a normal Chrome, or sites like Nexus Mods show endless "verify you are human" pages. */
export function browserSession() {
  const ses = session.fromPartition(PARTITION);
  if (!hooked) {
    hooked = true;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ua = ses.getUserAgent()
      .replace(/\s?Electron\/\S+/, '')
      .replace(new RegExp('\\s?' + esc(app.getName()) + '\\/\\S+'), '');
    ses.setUserAgent(ua);
    ses.on('will-download', (_e, item) => track(item));
  }
  return ses;
}

function uniquePath(name: string): string {
  fs.mkdirSync(downloadsDir(), { recursive: true });
  const { name: n, ext } = path.parse(safe(name));
  let dest = path.join(downloadsDir(), n + ext);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(downloadsDir(), `${n} (${i})${ext}`);
  return dest;
}

function track(item: DownloadItem): void {
  const id = randomUUID();
  const dest = uniquePath(item.getFilename() || 'download');
  item.setSavePath(dest);
  const dl: Dl = { id, name: path.basename(dest), path: dest, received: 0, total: item.getTotalBytes(), state: 'downloading', time: Date.now() };
  list.set(id, dl);
  items.set(id, item);
  push(true);
  item.on('updated', () => { dl.received = item.getReceivedBytes(); dl.total = item.getTotalBytes(); push(); });
  item.once('done', (_e, state) => {
    items.delete(id);
    dl.received = item.getReceivedBytes();
    dl.state = state === 'completed' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed';
    if (dl.state !== 'done') rm(dest);
    push(true);
    if (dl.state === 'done') getWin()?.webContents.send('downloaded', dest);
  });
}

/** Pick up files from earlier sessions so the list survives a restart. */
function scan(): void {
  try {
    for (const f of fs.readdirSync(downloadsDir(), { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const p = path.join(downloadsDir(), f.name);
      if ([...list.values()].some(d => d.path === p)) continue;
      const st = fs.statSync(p);
      const id = 'f' + Buffer.from(f.name).toString('base64url');
      list.set(id, { id, name: f.name, path: p, received: st.size, total: st.size, state: 'done', time: st.mtimeMs });
    }
  } catch { /* no downloads yet */ }
}

function prune(): void {
  for (const d of [...list.values()]) if (d.state === 'done' && !fs.existsSync(d.path)) list.delete(d.id);
}

export function init(win: () => BrowserWindow | null): void {
  getWin = win;
  browserSession();
  scan();
}

const inDownloads = (p: string) => {
  const b = path.resolve(downloadsDir());
  const t = path.resolve(p);
  return t.startsWith(b + path.sep);
};

export const downloadApi = {
  // the list mirrors the downloads folder: new files appear, deleted files disappear
  list_downloads: () => { prune(); scan(); return snapshot(); },

  cancel_download: (a: { dlId?: string }) => { items.get(String(a.dlId))?.cancel(); return null; },

  remove_download: (a: { dlId?: string }) => {
    const d = list.get(String(a.dlId));
    if (!d) return null;
    items.get(d.id)?.cancel();
    if (inDownloads(d.path)) rm(d.path);
    list.delete(d.id);
    push(true);
    return null;
  },

  clear_downloads: () => {
    for (const d of [...list.values()]) {
      if (d.state === 'downloading') continue;
      if (inDownloads(d.path)) rm(d.path);
      list.delete(d.id);
    }
    push(true);
    return null;
  },

  show_download: (a: { dlId?: string }) => {
    const d = list.get(String(a.dlId));
    if (d && inDownloads(d.path)) shell.showItemInFolder(d.path);
    return null;
  },

  open_downloads_dir: async () => {
    fs.mkdirSync(downloadsDir(), { recursive: true });
    await shell.openPath(downloadsDir());
    return null;
  },
};
