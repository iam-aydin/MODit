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
  item.on('updated', () => { dl.received = item.getReceivedBytes(); dl.total = item.getTotalBytes(); push(); });
  item.once('done', (_e, state) => {
    items.delete(id);
    dl.received = item.getReceivedBytes();
    dl.state = state === 'completed' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed';
    if (dl.state !== 'done') rm(dest);
    push(true);
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