import { BrowserWindow, nativeImage, net, protocol } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { allowCoverRetry, coversDir, coversInUse, getGame, getSetting, gamesNeedingCover, updateGame } from './db';
import { steamAppId } from './launch';

// Cover art comes from SteamGridDB (https://www.steamgriddb.com). It needs a free API key, which goes into Settings.
// Covers are fetched in the background some seconds AFTER a game is added, and only while there is an internet
// connection, so adding a game is never slowed down. The files live in <userData>/covers and the UI shows them
// through the modit://cover/<file> address (see registerCoverProtocol).

const API = 'https://www.steamgriddb.com/api/v2';
const RETRY_MS = 12 * 3600 * 1000; // a game that could not be matched is tried again after this long
const MAX_W = 640;                 // stored width; the cards show them at about a third of that

type Outcome = 'ok' | 'nokey' | 'offline' | 'notfound' | 'error';

let getWin: () => BrowserWindow | null = () => null;
let running = false;
let timer: NodeJS.Timeout | null = null;

const notify = (id: string, cover: string | null) => getWin()?.webContents.send('cover', id, cover);

// ---------- modit:// protocol ----------
/** Must run before the app is ready. */
export const registerCoverScheme = () =>
  protocol.registerSchemesAsPrivileged([{ scheme: 'modit', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** Serves files of the covers folder only (modit://cover/<file name>). */
export function registerCoverProtocol(): void {
  protocol.handle('modit', req => {
    let name = '';
    try { name = path.basename(decodeURIComponent(new URL(req.url).pathname)); } catch { /* bad address */ }
    const file = path.join(coversDir(), name);
    if (!name || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------- images ----------
function sniffExt(buf: Buffer): string | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  if (buf.length > 4 && buf.toString('latin1', 0, 3) === 'GIF') return '.gif';
  if (buf.length > 2 && buf.toString('latin1', 0, 2) === 'BM') return '.bmp';
  return null;
}

/** Shrinks the picture to a JPEG of at most MAX_W wide (the card crops it with object-fit: cover, so nothing is stretched).
 *  Formats Electron cannot decode (WebP) are stored as they are - the UI can still show them. Returns the stored file name. */
function storeImage(id: string, buf: Buffer): string | null {
  const ext = sniffExt(buf);
  if (!ext) return null; // not a picture (e.g. an HTML error page)
  fs.mkdirSync(coversDir(), { recursive: true });
  const stamp = Date.now().toString(36); // new name each time = the UI never shows a stale cached picture
  let out = buf, outExt = ext;
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) {
      const { width } = img.getSize();
      out = (width > MAX_W ? img.resize({ width: MAX_W, quality: 'best' }) : img).toJPEG(88);
      outExt = '.jpg';
    }
  } catch { /* keep the original bytes */ }
  const name = `${id}-${stamp}${outExt}`;
  fs.writeFileSync(path.join(coversDir(), name), out);
  return name;
}

const dropFile = (name: string | null | undefined) => {
  if (!name) return;
  try { fs.rmSync(path.join(coversDir(), path.basename(name)), { force: true }); } catch { /* ignore */ }
};

// ---------- SteamGridDB ----------
class ApiError extends Error { constructor(public status: number) { super('SteamGridDB answered ' + status); } }

async function api<T>(key: string, pathname: string): Promise<T> {
  const r = await net.fetch(API + pathname, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new ApiError(r.status);
  const j = (await r.json()) as { success?: boolean; data: T };
  return j.data;
}

interface Grid { url: string; width: number; height: number; score?: number }
interface SgdbGame { id: number; name: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "Dead.or.Alive.6" -> "Dead or Alive 6" */
export const searchTerm = (name: string) => (/\s/.test(name.trim()) ? name.trim() : name.replace(/[._]+/g, ' ').trim());

/** The thumbnails show 4:3 .. 16:9 pictures, so prefer the grid whose shape is closest to that (3:2). Ties keep SteamGridDB's own order (best rated first). */
export function pickGrid(grids: Grid[]): Grid | null {
  const ok = grids.filter(g => g && g.url && g.width > 0 && g.height > 0);
  if (!ok.length) return null;
  const big = ok.filter(g => g.width >= 400);
  const pool = big.length ? big : ok;
  const dist = (g: Grid) => Math.abs(Math.log(g.width / g.height / 1.5));
  return pool.reduce((best, g) => (dist(g) < dist(best) - 1e-9 ? g : best), pool[0]);
}

async function findGrids(key: string, game: { name: string; path: string }): Promise<Grid[] | null> {
  const q = '?types=static&nsfw=false&humor=false';
  const appId = game.path ? steamAppId(game.path) : null;
  if (appId) {
    try { const g = await api<Grid[]>(key, `/grids/steam/${appId}${q}`); if (g && g.length) return g; }
    catch (e) { if (!(e instanceof ApiError) || e.status !== 404) throw e; }
  }
  const term = searchTerm(game.name);
  if (!term) return null;
  const found = await api<SgdbGame[]>(key, `/search/autocomplete/${encodeURIComponent(term)}`);
  if (!found || !found.length) return null;
  const hit = found.find(f => norm(f.name) === norm(term)) || found[0];
  return api<Grid[]>(key, `/grids/game/${hit.id}${q}`);
}

async function fetchCover(game: { id: string; name: string; path: string }): Promise<Outcome> {
  const key = getSetting('sgdbKey');
  if (!key) return 'nokey';
  try {
    const grids = await findGrids(key, game);
    const pick = grids && pickGrid(grids);
    if (!pick) return 'notfound';
    const r = await net.fetch(pick.url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return 'error';
    const name = storeImage(game.id, Buffer.from(await r.arrayBuffer()));
    if (!name) return 'error';
    const now = getGame(game.id);
    if (!now || now.coverCustom) { dropFile(name); return 'ok'; } // removed, or the user chose their own while we were downloading
    dropFile(now.cover);
    updateGame(game.id, { cover: name, coverTried: Date.now() });
    notify(game.id, name);
    return 'ok';
  } catch (e) {
    if (e instanceof ApiError) return e.status === 401 || e.status === 403 || e.status === 429 ? 'nokey' : 'error';
    return 'offline'; // network failure / timeout
  }
}

// ---------- background queue ----------
async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!getSetting('sgdbKey') || !net.isOnline()) return;
    for (const g of gamesNeedingCover(RETRY_MS)) {
      const cur = getGame(g.id); // may have been renamed / removed meanwhile
      if (!cur || cur.cover || cur.coverCustom) continue;
      const r = await fetchCover({ id: cur.id, name: cur.name, path: cur.path });
      if (r === 'nokey' || r === 'offline') break; // nothing else would work either; try again later
      if (r !== 'ok') updateGame(g.id, { coverTried: Date.now() });
      await new Promise(res => setTimeout(res, 350)); // be gentle with the API
    }
  } finally { running = false; }
}

/** Look for missing covers in `delayMs` (adding a game uses a few seconds so it never feels slow). */
export function scheduleCovers(delayMs = 4000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; run().catch(e => console.error('covers:', e)); }, delayMs);
}

export function initCovers(win: () => BrowserWindow | null): void {
  getWin = win;
  scheduleCovers(8000);
  setInterval(() => scheduleCovers(0), 3 * 60 * 1000); // picks up games after the connection comes back
  // covers of games that no longer exist
  try {
    const used = coversInUse();
    for (const f of fs.existsSync(coversDir()) ? fs.readdirSync(coversDir()) : []) if (!used.has(f)) dropFile(f);
  } catch { /* not important */ }
}

// ---------- commands used by the UI ----------
/** The user's own picture for a game. */
export function setCustomCover(id: string, file: string): string {
  const g = getGame(id);
  if (!g) throw new Error('Game not found');
  const name = storeImage(id, fs.readFileSync(file));
  if (!name) throw new Error('That file is not a picture (use PNG, JPG or WebP)');
  dropFile(g.cover);
  updateGame(id, { cover: name, coverCustom: true });
  return name;
}

/** Forget the cover (custom or downloaded) and look for a new one online. */
export function resetCover(id: string): void {
  const g = getGame(id);
  if (!g) return;
  dropFile(g.cover);
  updateGame(id, { cover: null, coverCustom: false, coverTried: 0 });
  notify(id, null);
  scheduleCovers(500);
}

export function removeCoverFile(name: string | null | undefined): void { dropFile(name); }

/** "Fetch now" in Settings: also retries games that could not be matched before. */
export function fetchNow(): { hasKey: boolean; online: boolean; missing: number } {
  const hasKey = !!getSetting('sgdbKey'), online = net.isOnline();
  allowCoverRetry();
  const missing = gamesNeedingCover(RETRY_MS).length;
  if (hasKey && online && missing) scheduleCovers(300);
  return { hasKey, online, missing };
}