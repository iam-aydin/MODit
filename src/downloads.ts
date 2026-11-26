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
  gameId?: string;   // the game that was selected when the download started
  gameName?: string;
}

const list = new Map<string, Dl>();
const items = new Map<string, DownloadItem>();
let getWin: () => BrowserWindow | null = () => null;
let hooked = false;
let timer: NodeJS.Timeout | null = null;

// Which game a file was downloaded for: kept in memory and in <userData>/download-games.json
interface Stamp { id: string; name: string }
let activeGame: Stamp | null = null;
let stamps: Record<string, Stamp> = {};
const stampFile = () => path.join(app.getPath('userData'), 'download-games.json');
const loadStamps = () => { try { stamps = JSON.parse(fs.readFileSync(stampFile(), 'utf8')) || {}; } catch { stamps = {}; } };
const saveStamps = () => { try { fs.writeFileSync(stampFile(), JSON.stringify(stamps)); } catch { /* not critical */ } };

// the browser window listens to these to show "a download started"
type DlEvent = (kind: 'start' | 'end', name: string) => void;
const listeners: DlEvent[] = [];
export const onDownloadEvent = (cb: DlEvent) => { listeners.push(cb); };
const emit: DlEvent = (k, n) => { for (const f of listeners) { try { f(k, n); } catch { /* ignore */ } } };
export const activeDownloads = () => [...list.values()].filter(d => d.state === 'downloading').length;

const snapshot = () => [...list.values()].sort((a, b) => b.time - a.time);

/** Files MODit can install (the same list the app's Downloads section shows an Install button for). */
export const INSTALLABLE = /\.(zip|7z|rar|pak|ucas|utoc|tkmod)$/i;

function flush(): void {
  timer = null;
  getWin()?.webContents.send('downloads', snapshot());
}
function push(now = false): void {
  if (now) { if (timer) clearTimeout(timer); flush(); }
  else if (!timer) timer = setTimeout(flush, 250); // progress ticks are throttled
}

/** The browser session keeps Electron's own user agent on purpose: a Chrome user agent without matching Chrome client hints
 *  looks like a fake to Cloudflare and makes its "verify you are human" check fail (error 600010). */
export function browserSession() {
  const ses = session.fromPartition(PARTITION);
  if (!hooked) {
    hooked = true;
    // pages never get camera, microphone, notifications... without a prompt, which this browser does not have
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (_e, item) => track(item));
  }
  return ses;
}

/** Every game gets its own folder: <userData>/downloads/<gameId>/ (files with no game stay in downloads/). */
const gameDir = (gameId?: string) => gameId ? path.join(downloadsDir(), safe(gameId)) : downloadsDir();

function uniquePath(name: string, gameId?: string): string {
  const dir = gameDir(gameId);
  fs.mkdirSync(dir, { recursive: true });
  const { name: n, ext } = path.parse(safe(name));
  let dest = path.join(dir, n + ext);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(dir, `${n} (${i})${ext}`);
  return dest;
}

function track(item: DownloadItem): void {
  const id = randomUUID();
  const dest = uniquePath(item.getFilename() || 'download', activeGame?.id);
  item.setSavePath(dest);
  const dl: Dl = { id, name: path.basename(dest), path: dest, received: 0, total: item.getTotalBytes(), state: 'downloading', time: Date.now(), gameId: activeGame?.id, gameName: activeGame?.name };
  list.set(id, dl);
  items.set(id, item);
  push(true);
  emit('start', dl.name);
  item.on('updated', () => { dl.received = item.getReceivedBytes(); dl.total = item.getTotalBytes(); push(); });
  item.once('done', (_e, state) => {
    items.delete(id);
    dl.received = item.getReceivedBytes();
    dl.state = state === 'completed' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed';
    if (dl.state !== 'done') rm(dest);
    push(true);
    emit('end', dl.name);
    if (dl.state === 'done') getWin()?.webContents.send('downloaded', dest, dl.gameId);
  });
}

/** Pick up files from earlier sessions so the list survives a restart.
 *  A file's game is the folder it sits in; loose files in downloads/ (older versions) use download-games.json. */
function scan(): void {
  const add = (p: string, name: string, gameId?: string, gameName?: string) => {
    if ([...list.values()].some(d => d.path === p)) return;
    const st = fs.statSync(p);
    const id = 'f' + Buffer.from(path.relative(downloadsDir(), p)).toString('base64url');
    list.set(id, { id, name, path: p, received: st.size, total: st.size, state: 'done', time: st.mtimeMs, gameId, gameName });
  };
  try {
    for (const f of fs.readdirSync(downloadsDir(), { withFileTypes: true })) {
      const p = path.join(downloadsDir(), f.name);
      if (f.isFile()) { add(p, f.name, stamps[f.name]?.id, stamps[f.name]?.name); continue; }
      if (!f.isDirectory()) continue;
      for (const g of fs.readdirSync(p, { withFileTypes: true })) {
        if (g.isFile()) add(path.join(p, g.name), g.name, f.name, stamps[f.name]?.name);
      }
    }
  } catch { /* no downloads yet */ }
}

function prune(): void {
  for (const d of [...list.values()]) if (d.state === 'done' && !fs.existsSync(d.path)) list.delete(d.id);
}

export function init(win: () => BrowserWindow | null): void {
  getWin = win;
  browserSession();
  loadStamps();
  scan();
}

const inDownloads = (p: string) => {
  const b = path.resolve(downloadsDir());
  const t = path.resolve(p);
  return t.startsWith(b + path.sep);
};

/** For the browser's downloads popup: the newest few downloads of the selected game, and a rescan of the folders. */
export const recentDownloads = () => snapshot().filter(d => !activeGame || d.gameId === activeGame.id).slice(0, 8)
  .map(d => ({ id: d.id, name: d.name, received: d.received, total: d.total, state: d.state, installable: d.state === 'done' && INSTALLABLE.test(d.name) }));

/** The browser's Install button: asks the app to install a finished download (the app asks its questions on top of the browser window). */
export function installDownload(id: string): boolean {
  const d = list.get(id);
  if (!d || d.state !== 'done' || !INSTALLABLE.test(d.name) || !fs.existsSync(d.path)) return false;
  getWin()?.webContents.send('install-download', d.path, d.gameId);
  return true;
}
export const refreshDownloads = () => { prune(); scan(); };

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

  // the UI reports which game is selected, so new downloads get labelled with it
  set_active_game: (a: { game?: string; gameName?: string }) => {
    activeGame = a.game ? { id: String(a.game), name: String(a.gameName || a.game) } : null;
    if (activeGame) { stamps[activeGame.id] = activeGame; saveStamps(); } // remembers the game's name for its folder
    return null;
  },

  show_download: (a: { dlId?: string }) => {
    const d = list.get(String(a.dlId));
    if (d && inDownloads(d.path)) shell.showItemInFolder(d.path);
    return null;
  },

  // opens the folder of one game (a.game), or the whole downloads folder
  open_downloads_dir: async (a: { game?: string } = {}) => {
    const dir = a.game ? gameDir(String(a.game)) : downloadsDir();
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return null;
  },
};