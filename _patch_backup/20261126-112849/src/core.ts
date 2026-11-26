import { app, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extract } from './archive';
import { getGame, listGames, modCount, updateGame } from './db';
import type { GamePatch } from './db';
import { findImage, readImage, removeAllThumbs, removeThumb, saveThumb } from './thumbs';
import { backupRoot, listBackups, removeAllOverlay, removeOverlayMod, restoreBackup, syncOverlay } from './overlay';
import type { CommandArgs, GameData, GameDef, Mod, Requirement } from './types';

const LOOSE = /\.(pak|ucas|utoc|tkmod)$/i;
const KNOWN_ROOTS = new Set(['~mods', 'mods', 'logicmods']);
const DEFAULT_ROOT = '~mods';

// ---------- paths ----------
const userData = () => app.getPath('userData');
const libDir = (gid: string) => path.join(userData(), 'library', safe(gid));
export const downloadsDir = () => path.join(userData(), 'downloads');

/** Turn any string into a single safe path segment (no traversal, no separators). */
export function safe(name: string): string {
  const s = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').trim();
  return s || 'mod';
}

/** Resolve rel inside base; returns null if it would escape base. */
export function within(base: string, rel: string): string | null {
  const b = path.resolve(base);
  const t = path.resolve(b, rel);
  return t === b || t.startsWith(b + path.sep) ? t : null;
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`Missing ${what}`);
  return v;
}

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const rm = (p: string) => fs.rmSync(p, { recursive: true, force: true });
/** Same as rm, but the app stays responsive while a big folder is deleted. */
const rmAsync = (p: string) => fs.promises.rm(p, { recursive: true, force: true });

/** Size in bytes of everything inside a folder (0 when it is not there). Reads the disk without blocking the app. */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let es: fs.Dirent[];
  try { es = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (let i = 0; i < es.length; i += 64) {
    const sizes = await Promise.all(es.slice(i, i + 64).map(async e => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) return dirSize(f);
      try { return (await fs.promises.stat(f)).size; } catch { return 0; }
    }));
    for (const n of sizes) total += n;
  }
  return total;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

// ---------- game database ----------
// Three layers, highest priority first (an entry with the same id replaces the ones below it):
//   1. <userData>/games.user.json    your own entries and overrides (MODit never overwrites it)
//   2. <userData>/games.remote.json  downloaded from GitHub on every launch, kept for offline use
//   3. dist/data/games.json          bundled with the app (first run / no internet)
// The file may be a plain array of entries, or { "schema": 1, "version": 3, "games": [ ... ] }.
export const DB_URL = 'https://raw.githubusercontent.com/iam-aydin/MODit/main/src/data/games.json';
const DB_SCHEMA = 1; // newest file format this build understands; a newer file is ignored until the app is updated
const INSTALLS = new Set(['folder', 'overlay', 'folders']);

const validDef = (d: unknown): d is GameDef => {
  const x = d as Partial<GameDef> | null;
  return !!x && typeof x.id === 'string' && x.id !== '' && typeof x.name === 'string'
    && Array.isArray(x.detect) && x.detect.every(p => typeof p === 'string')
    && typeof x.modsPath === 'string'
    && (x.install === undefined || INSTALLS.has(x.install)); // unknown install types are skipped, not guessed
};

const cleanReqs = (r: unknown): Requirement[] | undefined => {
  if (!Array.isArray(r)) return undefined;
  const ok = r.filter((x): x is Requirement => !!x && typeof x.id === 'string' && typeof x.name === 'string'
    && Array.isArray(x.check) && x.check.length > 0 && x.check.every((p: unknown) => typeof p === 'string'));
  return ok.length ? ok : undefined;
};

function parseDefs(text: string): GameDef[] {
  try {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j
      : j && Array.isArray(j.games) && (j.schema === undefined || j.schema <= DB_SCHEMA) ? j.games : [];
    return list.filter(validDef).map((d: GameDef) => ({ ...d, requirements: cleanReqs(d.requirements) }));
  } catch { return []; }
}

const readDefs = (file: string): GameDef[] => {
  try { return parseDefs(fs.readFileSync(file, 'utf8')); } catch { return []; }
};

export const userDbFile = () => path.join(userData(), 'games.user.json');
const remoteDbFile = () => path.join(userData(), 'games.remote.json');
let remoteMem: GameDef[] | null = null;
let bundledMem: GameDef[] | null = null;

export function loadDb(): GameDef[] {
  bundledMem ??= readDefs(path.join(__dirname, 'data', 'games.json'));
  remoteMem ??= readDefs(remoteDbFile());
  const seen = new Set<string>();
  const out: GameDef[] = [];
  for (const layer of [readDefs(userDbFile()), remoteMem, bundledMem]) {
    for (const d of layer) if (!seen.has(d.id)) { seen.add(d.id); out.push(d); }
  }
  return out;
}

/** Download the newest game database. Any problem (offline, bad file) keeps what we already have. */
export async function refreshRemoteDb(): Promise<boolean> {
  try {
    const res = await fetch(DB_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (text.length > 2_000_000) return false;
    const defs = parseDefs(text);
    if (!defs.length) return false; // empty or unreadable: never replace a good copy with it
    fs.mkdirSync(userData(), { recursive: true });
    const tmp = remoteDbFile() + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, remoteDbFile());
    remoteMem = defs;
    return true;
  } catch { return false; }
}

/**
 * Re-derive the mods folder of games that were matched to a database entry, so database fixes reach
 * existing users. Never touches a game whose folder the user chose, a game that was never matched,
 * or a game that already has mods installed (those would have to be moved). Returns how many changed.
 */
export function reapplyDb(): number {
  let changed = 0;
  for (const g of listGames()) {
    if (g.customPath || !g.matchedId || !g.path) continue;
    const def = matchDef(g.path);
    const mods = def && within(g.path, def.modsPath);
    if (!def || !mods) continue;
    const patch: GamePatch = {};
    if (g.matchedId !== def.id) patch.matchedId = def.id;
    const pathChanged = !g.modsDir || !sameDir(g.modsDir, mods);
    const folderChanged = (g.modFolder ?? '') !== (def.modFolder ?? '');
    if ((pathChanged || folderChanged) && modCount(g.id) === 0) {
      patch.modsDir = mods;
      patch.modFolder = def.modFolder ?? '';
    }
    if (Object.keys(patch).length) { updateGame(g.id, patch); changed++; }
  }
  return changed;
}

export interface ResolvedGame { name: string; paks: string; modFolder: string; engine?: string; matched?: string; install?: string }

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const sameDir = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** The database entry for an install folder: its files are there, or its folder has a known name. */
export function matchDef(p: string): GameDef | null {
  if (!isDir(p)) return null;
  const folder = normName(path.basename(path.resolve(p)));
  for (const def of loadDb()) {
    const byFiles = def.detect.length > 0 && def.detect.every(d => { const f = within(p, d); return !!f && fs.existsSync(f); });
    const byName = (def.folderNames || []).some(n => normName(n) === folder);
    if ((byFiles || byName) && within(p, def.modsPath)) return def;
  }
  return null;
}

/** Identify the game in the picked install folder and find where its mods go. */
export function resolveGame(p: string): ResolvedGame | null {
  if (!isDir(p)) return null;
  const folderName = path.basename(path.resolve(p)) || 'Game';

  // 1) the database
  const def = matchDef(p);
  if (def) {
    const mods = within(p, def.modsPath)!;
    fs.mkdirSync(mods, { recursive: true });
    return { name: def.generic ? folderName : def.name, paks: mods, modFolder: def.modFolder ?? '', engine: def.engine, matched: def.id, install: def.install };
  }

  // 2) any other Unreal game: <something>/Content/Paks
  const queue: Array<[string, number]> = [[p, 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === 'Paks' && path.basename(dir).toLowerCase() === 'content') {
        return { name: folderName, paks: full, modFolder: DEFAULT_ROOT, engine: 'Unreal Engine' };
      }
      if (depth < 5 && e.name !== 'node_modules') queue.push([full, depth + 1]);
    }
  }
  return null;
}

// ---------- installing ----------
function target(modsDir: string, mod: Pick<Mod, 'id' | 'root'>): string {
  const r = mod.root ? safe(mod.root) : '';
  return r ? path.join(modsDir, r, safe(mod.id)) : path.join(modsDir, safe(mod.id));
}

/** Move an extracted folder into the library. defaultRoot = the game's mod folder. */
function finalize(src: string, gid: string, id: string, defaultRoot: string): Mod {
  // unwrap single wrapper folders, e.g. ModName/ModName/file.pak
  for (;;) {
    const es = fs.readdirSync(src, { withFileTypes: true });
    if (es.length === 1 && es[0].isDirectory() && !KNOWN_ROOTS.has(es[0].name.toLowerCase())) src = path.join(src, es[0].name);
    else break;
  }
  let root = defaultRoot;
  const es = fs.readdirSync(src, { withFileTypes: true });
  const hit = es.find(e => e.isDirectory() && KNOWN_ROOTS.has(e.name.toLowerCase()));
  if (defaultRoot && hit && es.length === 1) {
    // the archive's own ~mods/Mods folder is replaced by this game's folder; LogicMods keeps its meaning
    if (hit.name.toLowerCase() === 'logicmods') root = 'LogicMods';
    src = path.join(src, hit.name);
  }
  if (!walk(src).length) throw new Error(`No files found in "${id}"`);
  const dest = path.join(libDir(gid), safe(id));
  rm(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return { id, name: id, root };
}

// ---------- overlay games (mod files go INTO the game's own folders) ----------
interface Ov { def: GameDef; root: string }

/** Set when the game is one whose mods are copied into its own folders (install: overlay / folders). */
function overlayOf(gid: string): Ov | null {
  const g = getGame(gid);
  if (!g || !g.path) return null;
  const def = matchDef(g.path);
  if (!def || (def.install !== 'overlay' && def.install !== 'folders')) return null;
  const root = within(g.path, def.modsPath);
  return root ? { def, root } : null;
}

// ---------- requirements (things a game needs before mods can be installed) ----------
function requirementState(gid: string): { items: Array<Requirement & { installed: boolean }> } | null {
  const g = getGame(gid);
  if (!g || !g.path) return null;
  const def = matchDef(g.path);
  if (!def) return null;
  return { items: (def.requirements || []).map(r => ({ ...r, installed: r.check.every(c => { const f = within(g.path, c); return !!f && fs.existsSync(f); }) })) };
}
const missingRequirements = (gid: string) => (requirementState(gid)?.items || []).filter(r => !r.installed);
const needMsg = (miss: Requirement[]) => `You cannot install mods until ${miss.map(m => m.name).join(' and ')} ${miss.length > 1 ? 'are' : 'is'} installed. See the Requirements section.`;

const lc = (s: string) => s.toLowerCase();
const subDirs = (dir: string) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()); } catch { return []; } };

/** Shallowest folder of an extracted archive that directly contains a folder named in `names`. */
function findHolder(top: string, names: Set<string>): string | null {
  const queue: Array<[string, number]> = [[top, 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift()!;
    const ds = subDirs(dir).filter(e => !/^__macosx$/i.test(e.name));
    if (ds.some(e => names.has(lc(e.name)))) return dir;
    if (depth < 4) for (const e of ds) queue.push([path.join(dir, e.name), depth + 1]);
  }
  return null;
}

/** Folders that contain a mod.manifest (a mod folder never contains another one). */
function findManifestDirs(top: string, manifest: string): string[] {
  const out: string[] = [];
  const scan = (dir: string, depth: number) => {
    let es: fs.Dirent[];
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (es.some(e => e.isFile() && lc(e.name) === manifest)) { out.push(dir); return; }
    if (depth < 5) for (const e of es) if (e.isDirectory() && !/^__macosx$/i.test(e.name)) scan(path.join(dir, e.name), depth + 1);
  };
  scan(top, 0);
  return out;
}

// ---------- AutoLink games (Dead or Alive 5 Last Round) ----------
// AutoLink reads costume files from <game>/AutoLink/<CHARACTER>/ and every file must sit directly in that
// folder (no subfolders), so a mod needs to be told which character it is for.
export const AUTO_TARGET = '*auto'; // every file goes to the character named at the start of its file name
export const ROOT_TARGET = '*root'; // the archive is copied into the game folder as it is (ReShade, fixes ...)
const JUNK = /\.(txt|md|jpe?g|png|gif|bmp|webp|url|nfo|html?|pdf|docx?)$|^(thumbs\.db|desktop\.ini)$/i;

const isAutolink = (ov: Ov) => ov.def.layout === 'autolink';
const autolinkDir = (ov: Ov) => path.join(ov.root, 'AutoLink');
const rel = (base: string, f: string) => path.relative(base, f).split(path.sep).join('/');

/** Reads a text file in any common encoding: UTF-16 (Notepad's "Unicode"), UTF-8 with or without a BOM. */
function readTextFile(file: string): string {
  const b = fs.readFileSync(file);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2, 2 + ((b.length - 2) & ~1))).swap16().toString('utf16le');
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  const sample = b.subarray(0, 200);
  let zeros = 0;
  for (const x of sample) if (x === 0) zeros++;
  return zeros > sample.length / 4 ? b.toString('utf16le') : b.toString('utf8'); // UTF-16 without a BOM is mostly 0 bytes
}

/** Character names: folders already in AutoLink plus the lines of AutoLink/NAME.txt (one name per line). */
function autolinkCharacters(ov: Ov): string[] {
  const names = new Map<string, string>(); // lower case -> name (an existing folder's spelling wins)
  const add = (raw: string) => {
    const t = raw.replace(/^\uFEFF/, '').trim();
    if (!t || /^(#|\/\/)/.test(t)) return;
    const n = t.replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/^\.+/, '').trim(); // letters, digits, space, _ . - only
    if (n && n.length <= 30 && !n.startsWith('_') && !names.has(lc(n))) names.set(lc(n), n);
  };
  for (const e of subDirs(autolinkDir(ov))) add(e.name);
  try { for (const l of readTextFile(path.join(autolinkDir(ov), 'NAME.txt')).split(/\r?\n/)) add(l); } catch { /* AutoLink not installed */ }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** One folder per character inside AutoLink (only once the AutoLink tool is in the game). */
function ensureCharacterFolders(ov: Ov): void {
  const dir = autolinkDir(ov);
  if (!isDir(dir)) return;
  for (const e of subDirs(dir)) { // a garbled folder from an older MODit that misread NAME.txt: removed when it is empty
    if (e.name.includes('\uFFFD')) { try { fs.rmdirSync(path.join(dir, e.name)); } catch { /* not empty: left alone */ } }
  }
  for (const n of autolinkCharacters(ov)) { try { fs.mkdirSync(path.join(dir, safe(n)), { recursive: true }); } catch { /* ignore */ } }
  // the tool's own folders that ship empty (_Stages, _Sound ...) are lost when files are copied, so they are made here
  for (const f of ov.def.folders ?? ['AutoLink/_Texture', 'AutoLink/_Movie', 'AutoLink/_Stages', 'AutoLink/_Sound']) {
    const d = within(ov.root, f);
    if (d) { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } }
  }
}

/** The character a file belongs to: its name starts with "<CHARACTER>_" (TINA_VESPER.TMC -> TINA). */
function guessCharacter(file: string, chars: string[]): string | null {
  const f = path.basename(file).toUpperCase();
  let best: string | null = null;
  for (const c of chars) if (f.startsWith(c.toUpperCase() + '_') && (!best || c.length > best.length)) best = c;
  return best;
}

/** The AutoLink tool itself: an archive holding AutoLink/NAME.txt. Returns the folder that contains AutoLink/. */
function autolinkToolHolder(top: string): string | null {
  const hit = walk(top).find(f => /(^|\/)autolink\/name\.txt$/i.test(rel(top, f)));
  return hit ? path.dirname(path.dirname(hit)) : null;
}

// Readme and preview files (any format: .txt .md .jpg ...) are never installed, anywhere.
const IGNORED = /^(read[ _-]?me|preview)|^(thumbs\.db|desktop\.ini)$/i;
const rootExts = (ov: Ov) => (ov.def.rootFiles ?? ['.lnk']).map(lc);

interface Move { from: string; to: string } // `to` is relative to the game folder
interface AlPlan { specials: Move[]; chars: Map<string, Move[]>; root: Move[]; loose: string[] }

/** Sorts what is inside an archive: _Stages/_Movie/_Sound files, character folders (a pack), root files (.lnk) and loose files. */
function planAutolink(top: string, ov: Ov): AlPlan {
  const known = new Map(autolinkCharacters(ov).map(n => [lc(n), n] as const));
  const plan: AlPlan = { specials: [], chars: new Map(), root: [], loose: [] };
  for (const f of walk(top)) {
    const r = rel(top, f), parts = r.split('/'), base = parts[parts.length - 1];
    if (IGNORED.test(base) || /(^|\/)__macosx\//i.test(r)) continue;
    const i = parts.findIndex(p => lc(p) === 'autolink');
    if (i >= 0 && i < parts.length - 1) {
      const rest = parts.slice(i + 1);
      if (rest.length === 1) continue; // a file directly inside AutoLink belongs to the tool
      if (rest[0].startsWith('_')) plan.specials.push({ from: f, to: `AutoLink/${rest.map(safe).join('/')}` });
      else {
        const name = known.get(lc(rest[0])) ?? safe(rest[0]).toUpperCase();
        if (!plan.chars.has(name)) plan.chars.set(name, []);
        plan.chars.get(name)!.push({ from: f, to: `AutoLink/${name}/${safe(base)}` });
      }
    } else if (rootExts(ov).includes(lc(path.extname(base)))) plan.root.push({ from: f, to: safe(base) });
    else if (!JUNK.test(base)) plan.loose.push(f);
  }
  return plan;
}
const hasStructure = (p: AlPlan) => p.specials.length + p.chars.size + p.root.length > 0;
const sortedNames = (p: AlPlan) => [...p.chars.keys()].sort((x, y) => x.localeCompare(y));

interface FinalizeOpts { target?: string; chars?: string[]; archive?: string }

function finalizeAutolink(src: string, dest: string, id: string, ov: Ov, o: FinalizeOpts): Mod {
  const holder = autolinkToolHolder(src);
  if (holder) { // the tool: everything next to the AutoLink folder (its d3d9.dll and so on) goes into the game
    fs.cpSync(holder, dest, { recursive: true });
    return { id, name: id, root: '', kind: 'overlay' };
  }
  const put = (from: string, to: string) => { const t = path.join(dest, ...to.split('/')); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(from, t); };
  let pack: Mod['pack'];
  if (o.target === ROOT_TARGET) { // "Game folder": the archive is copied into the game folder as it is
    let top = src; // ModName/ModName/files -> files (only when the wrapper is named like the mod)
    for (;;) {
      const es = fs.readdirSync(top, { withFileTypes: true }).filter(e => !/^__macosx$/i.test(e.name));
      if (es.length === 1 && es[0].isDirectory() && normName(es[0].name) === normName(id)) top = path.join(top, es[0].name); else break;
    }
    for (const f of walk(top)) if (!IGNORED.test(path.basename(f))) put(f, rel(top, f));
  } else {
    const plan = planAutolink(src, ov);
    if (hasStructure(plan)) { // AutoLink folders and/or .lnk files: nothing to ask, except which characters of a pack
      for (const m of [...plan.specials, ...plan.root]) put(m.from, m.to);
      const want = o.chars ? new Set(o.chars.map(lc)) : null;
      const all = sortedNames(plan);
      const selected = all.filter(n => !want || want.has(lc(n)));
      for (const n of selected) for (const m of plan.chars.get(n)!) put(m.from, m.to);
      if (all.length >= 2) pack = { archive: o.archive || '', all, selected };
    } else { // loose costume files: they need to be told which character they are for
      if (!o.target) throw new Error(`Choose who "${id}" is for first`);
      const chars = autolinkCharacters(ov);
      for (const f of plan.loose) {
        const who = o.target === AUTO_TARGET ? guessCharacter(f, chars) : safe(o.target);
        if (who) put(f, `AutoLink/${who}/${path.basename(f)}`);
      }
    }
  }
  if (!walk(dest).length) throw new Error(`No mod files found in "${id}"`);
  return { id, name: id, root: '', kind: 'overlay', ...(o.target ? { target: o.target } : {}), ...(pack ? { pack } : {}) };
}

/** Keeps a copy of an installed archive in the game's Downloads folder (browser downloads are already there). */
async function stashInDownloads(gid: string, archive: string): Promise<string> {
  const root = path.resolve(downloadsDir());
  if (path.resolve(archive).startsWith(root + path.sep)) return archive;
  const dir = path.join(root, safe(gid));
  fs.mkdirSync(dir, { recursive: true });
  const { name, ext } = path.parse(safe(path.basename(archive)));
  const size = fs.statSync(archive).size;
  let dest = path.join(dir, name + ext);
  for (let i = 1; fs.existsSync(dest); i++) {
    if (fs.statSync(dest).size === size) return dest; // the same file is already there
    dest = path.join(dir, `${name} (${i})${ext}`);
  }
  await fs.promises.copyFile(archive, dest);
  return dest;
}

/** Moves the useful part of an extracted archive into the library, laid out exactly as it goes into the game folder. */
function finalizeOverlay(src: string, gid: string, id: string, ov: Ov, o: FinalizeOpts = {}): Mod {
  const dest = path.join(libDir(gid), safe(id));
  rm(dest);
  fs.mkdirSync(dest, { recursive: true });
  if (isAutolink(ov)) return finalizeAutolink(src, dest, id, ov, o);
  let order: string[] | undefined;

  if (ov.def.install === 'folders') {
    // Kingdom Come: every folder with a mod.manifest is one mod and keeps its own name inside Mods
    let dirs = findManifestDirs(src, lc(ov.def.manifest || 'mod.manifest'));
    if (!dirs.length) { // no manifest found: a single top-level folder is taken as the mod
      const top = subDirs(src).filter(e => !/^__macosx$/i.test(e.name));
      if (top.length === 1) dirs = [path.join(src, top[0].name)];
    }
    if (!dirs.length) throw new Error(`\"${id}\" has no mod.manifest, so MODit cannot tell which folder goes into Mods`);
    order = [];
    for (const d of dirs) {
      const name = d === src ? safe(id) : safe(path.basename(d));
      fs.cpSync(d, path.join(dest, name), { recursive: true });
      order.push(name);
    }
  } else {
    // Alan Wake 2 / 007: the archive holds the game's own top-level folder(s) (data, Runtime ...)
    let names = new Set((ov.def.overlayRoots || []).map(lc));
    let holder = names.size ? findHolder(src, names) : null;
    if (!holder) { // not the usual name: use any folder the game itself has in its root
      names = new Set(subDirs(ov.root).map(e => lc(e.name)));
      holder = findHolder(src, names);
    }
    if (!holder) throw new Error(`\"${id}\" has no ${(ov.def.overlayRoots || ['game']).join(' / ')} folder, so MODit cannot tell where in ${ov.def.name} it goes`);
    for (const e of subDirs(holder)) if (names.has(lc(e.name))) fs.cpSync(path.join(holder, e.name), path.join(dest, e.name), { recursive: true });
  }

  if (!walk(dest).length) throw new Error(`No files found in \"${id}\"`);
  return { id, name: id, root: '', kind: 'overlay', ...(order ? { order } : {}) };
}

function addMod(state: GameData, mod: Mod, modsDir: string): void {
  const old = state.mods.find(m => m.id === mod.id);
  if (old && modsDir) rm(target(modsDir, old)); // so a reinstall replaces files in the game folder
  state.mods = state.mods.filter(m => m.id !== mod.id);
  state.mods.push(mod);
}

const withTmp = async <T>(f: (tmp: string) => Promise<T>): Promise<T> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-'));
  try { return await f(tmp); } finally { rm(tmp); }
};

const stem = (p: string) => path.basename(p).replace(/\.[^.]+$/, '');
const rootOf = (a: CommandArgs) => (a.modFolder ?? DEFAULT_ROOT);

// ---------- command handlers (names match what the UI calls) ----------
type Handler = (a: CommandArgs) => unknown | Promise<unknown>;

export const handlers: Record<string, Handler> = {
  resolve_game: a => resolveGame(need(a.path, 'path')),

  /** Open a folder in Explorer: path, plus an optional subfolder. Directories only. */
  open_folder: async a => {
    const base = need(a.path, 'path');
    const dir = a.sub ? within(base, a.sub) : path.resolve(base);
    if (!dir) throw new Error('Invalid folder');
    if (!isDir(dir)) {
      if (isDir(base)) fs.mkdirSync(dir, { recursive: true }); // e.g. ~mods before the first mod
      else throw new Error(`Folder not found: ${base}`);
    }
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
    return null;
  },

  /** Opens your own overrides file (created empty on first use). */
  open_db: async () => {
    const f = userDbFile();
    if (!fs.existsSync(f)) { fs.mkdirSync(userData(), { recursive: true }); fs.writeFileSync(f, '[]\n'); }
    shell.showItemInFolder(f);
    return null;
  },

  /** Download the newest game database now. */
  refresh_db: async () => {
    const ok = await refreshRemoteDb();
    return { ok, changed: ok ? reapplyDb() : 0 };
  },

  scan_archive: a => withTmp(async tmp => {
    await extract(need(a.path, 'path'), tmp);
    const zips = walk(tmp).filter(f => /\.zip$/i.test(f)).map(f => path.basename(f));
    const miss = a.game ? missingRequirements(a.game) : [];
    const tool = !!autolinkToolHolder(tmp);
    if (miss.length && !tool) return { kind: 'blocked', missing: miss.map(m => ({ id: m.id, name: m.name, url: m.url, file: m.file })) };
    if (zips.length >= 2) return { kind: 'picker', zips: [...new Set(zips)].sort() };
    const ov = a.game ? overlayOf(a.game) : null;
    if (ov && isAutolink(ov)) { // Dead or Alive 5: the UI has to ask who the mod is for
      if (tool) return { kind: 'autolink-tool' };
      const chars = autolinkCharacters(ov);
      const plan = planAutolink(tmp, ov);
      const hits = new Set<string>();
      for (const f of plan.loose) { const c = guessCharacter(f, chars); if (c) hits.add(c); }
      return {
        kind: 'autolink', installed: isDir(autolinkDir(ov)), characters: chars,
        suggested: hits.size === 1 ? [...hits][0] : null, multi: hits.size > 1,
        structured: hasStructure(plan),               // AutoLink folders / .lnk files: nothing to ask about the target
        pack: plan.chars.size ? sortedNames(plan) : null, // character folders inside the archive (2 or more = a pack)
      };
    }
    return { kind: 'single' };
  }),

  install_archive: a => withTmp(async tmp => {
    const gid = need(a.game, 'game'), archive = need(a.path, 'path');
    const ns = structuredClone(a.state as GameData);
    const dr = rootOf(a);
    const ov = overlayOf(gid);
    // one mod: into the library (overlay games: only the part that goes into the game folder)
    const added: string[] = [];
    const thumbs: NonNullable<GameData['thumbs']> = {};
    const put = async (src: string, id: string) => {
      const img = await findImage(src).catch(() => null); // the first picture in the archive becomes the thumbnail
      if (img) thumbs[id] = img;
      if (ov) {
        await removeOverlayMod(gid, ov.root, id); // a reinstall first puts the old files back
        addMod(ns, finalizeOverlay(src, gid, id, ov, { target: a.target, chars: a.chars, archive }), '');
      } else addMod(ns, finalize(src, gid, id, dr), a.modsDir || '');
      added.push(id);
    };
    await extract(archive, tmp);
    const miss = missingRequirements(gid);
    if (miss.length && !autolinkToolHolder(tmp)) throw new Error(needMsg(miss)); // the requirement itself can always be installed
    const picks = a.picks || [];
    if (picks.length) {
      const zips = walk(tmp).filter(f => /\.zip$/i.test(f));
      for (const pick of picks) {
        const z = zips.find(f => path.basename(f) === pick);
        if (!z) continue;
        const sub = path.join(tmp, '__' + safe(stem(z)));
        await extract(z, sub);
        await put(sub, safe(stem(z)));
      }
    } else {
      await put(tmp, safe(stem(archive)));
    }
    // every installed archive is kept in the game's Downloads (packs read it again when their characters change)
    const kept = await stashInDownloads(gid, archive).catch(() => archive);
    for (const m of ns.mods) if (added.includes(m.id) && m.pack) m.pack.archive = kept;
    ns.installed = added;
    if (Object.keys(thumbs).length) ns.thumbs = thumbs;
    return ns;
  }),

  /** Changes which characters of a pack are installed, reading the pack's archive again. */
  edit_pack: a => withTmp(async tmp => {
    const gid = need(a.game, 'game'), id = need(a.id, 'id');
    const ov = overlayOf(gid);
    if (!ov) throw new Error('This game has no packs');
    const ns = structuredClone(a.state as GameData);
    const mod = ns.mods.find(m => m.id === id);
    if (!mod || !mod.pack) throw new Error('This mod is not a pack');
    const archive = a.archive || mod.pack.archive;
    if (!archive || !fs.existsSync(archive)) return { missing: true }; // deleted from Downloads: the UI asks for the file again
    await extract(archive, tmp);
    const plan = planAutolink(tmp, ov);
    const want = new Set((a.chars || []).map(lc));
    const count = plan.specials.length + plan.root.length + [...plan.chars].filter(([n]) => want.has(lc(n))).reduce((t, [, v]) => t + v.length, 0);
    if (!count) return { empty: true };
    await removeOverlayMod(gid, ov.root, id); // its files leave the game first, the originals come back
    const nm = finalizeOverlay(tmp, gid, id, ov, { chars: a.chars || [], archive });
    if (!nm.pack) throw new Error('This archive is no longer a pack');
    mod.pack = { ...nm.pack, archive: await stashInDownloads(gid, archive).catch(() => archive) };
    return { state: ns };
  }),

  /** Opens the folder a mod's files are in: inside the game while it is on, else its saved copy. */
  show_mod: async a => {
    const gid = need(a.game, 'game'), id = need(a.id, 'id');
    const lib = path.join(libDir(gid), safe(id));
    const ov = overlayOf(gid);
    let dir = lib;
    if (ov) {
      const dirs = isDir(lib) ? walk(lib).map(f => rel(lib, f).split('/').slice(0, -1)) : [];
      let common = dirs[0] || [];
      for (const d of dirs) { let k = 0; while (k < common.length && k < d.length && lc(common[k]) === lc(d[k])) k++; common = common.slice(0, k); }
      const inGame = within(ov.root, common.join('/'));
      if (a.on && inGame && isDir(inGame)) dir = inGame;
    } else {
      const t = target(a.modsDir || '', { id, root: a.modFolder ?? '' }); // the UI passes the mod's own folder as modFolder
      if (a.on && isDir(t)) dir = t;
    }
    if (!isDir(dir)) throw new Error('Nothing to show yet');
    await shell.openPath(dir);
    return null;
  },

  install_files: async a => {
    const gid = need(a.game, 'game');
    const miss = missingRequirements(gid);
    if (miss.length) throw new Error(needMsg(miss));
    if (overlayOf(gid)) throw new Error('Loose files cannot be placed for this game. Add the mod as a .zip, .7z or .rar archive instead.');
    const ns = structuredClone(a.state as GameData);
    // a .pak/.ucas/.utoc trio with the same name is one mod
    const groups = new Map<string, string[]>();
    for (const p of a.paths || []) {
      if (!LOOSE.test(p)) continue;
      const k = safe(stem(p));
      groups.set(k, [...(groups.get(k) || []), p]);
    }
    const installed: string[] = [];
    for (const [id, files] of groups) {
      const dest = path.join(libDir(gid), id);
      rm(dest);
      fs.mkdirSync(dest, { recursive: true });
      for (const f of files) fs.copyFileSync(f, path.join(dest, path.basename(f)));
      addMod(ns, { id, name: id, root: rootOf(a) }, a.modsDir || '');
      installed.push(id);
    }
    ns.installed = installed;
    return ns;
  },

  /** Make the game's folders match the active profile: enabled = copied in, disabled = removed. */
  sync_profile: async a => {
    const gid = need(a.game, 'game');
    const st = a.state as GameData;
    const on = st.profiles[st.active] || {};
    const ov = overlayOf(gid);
    let result: { backedUp: string[] } | null = null;

    if (ov) {
      if (!isDir(ov.root)) throw new Error(`Game folder not found: ${ov.root}`);
      if (a.modsDir && !sameDir(a.modsDir, ov.root)) updateGame(gid, { modsDir: ov.root, modFolder: '' }); // games added before MODit knew them
      const mods = st.mods.filter(m => m.kind === 'overlay').map(m => ({ id: m.id, on: !!on[m.id], order: m.order }));
      result = await syncOverlay(gid, ov.root, id => path.join(libDir(gid), safe(id)), mods);
      if (isAutolink(ov)) ensureCharacterFolders(ov); // right after the AutoLink tool arrives: one folder per name in NAME.txt
      if (!a.modsDir || sameDir(a.modsDir, ov.root) || !st.mods.some(m => !m.kind)) return result; // old-style mods have nowhere safe to go
    }

    const modsDir = need(a.modsDir, 'modsDir');
    if (!isDir(modsDir)) throw new Error(`Game folder not found: ${modsDir}`);
    for (const m of st.mods) {
      if (m.kind) continue;
      const t = target(modsDir, m);
      if (on[m.id]) {
        if (!fs.existsSync(t)) {
          const src = path.join(libDir(gid), safe(m.id));
          if (!isDir(src)) continue;
          await fs.promises.mkdir(path.dirname(t), { recursive: true });
          await fs.promises.cp(src, t, { recursive: true }); // does not freeze the app, even for many GB
        }
      } else await rmAsync(t);
    }
    return result;
  },

  remove_mod: async a => {
    const gid = need(a.game, 'game'), id = need(a.id, 'id');
    const ov = overlayOf(gid);
    if (ov) await removeOverlayMod(gid, ov.root, id); // its files go out of the game, the originals come back
    const oldStyle = a.kind !== 'overlay' && !(ov && a.modsDir && sameDir(a.modsDir, ov.root));
    if (a.modsDir && oldStyle) await rmAsync(target(a.modsDir, { id, root: a.root ?? '' }));
    await rmAsync(path.join(libDir(gid), safe(id)));
    await removeThumb(gid, id);
    return null;
  },

  remove_game: async a => {
    const gid = need(a.game, 'game');
    const st = a.state as GameData | undefined;
    const ov = overlayOf(gid);
    if (ov) await removeAllOverlay(gid, ov.root);
    if (a.modsDir && st && !(ov && sameDir(a.modsDir, ov.root))) for (const m of st.mods) if (!m.kind) await rmAsync(target(a.modsDir, m));
    await rmAsync(libDir(gid));
    await removeAllThumbs(gid);
    return null;
  },

  // ----- thumbnails (the window shrinks the picture to JPEG, this saves it) -----
  read_image: async a => ({ data: await readImage(need(a.path, 'path')) }),
  save_thumb: async a => { if (!a.bytes) throw new Error('Missing bytes'); await saveThumb(need(a.game, 'game'), need(a.id, 'id'), a.bytes); return null; },
  remove_thumb: async a => { await removeThumb(need(a.game, 'game'), need(a.id, 'id')); return null; },

  /** How big each mod is (bytes), so the UI can warn before a profile switch that has to copy a lot. */
  mod_sizes: async a => {
    const gid = need(a.game, 'game');
    const out: Record<string, number> = {};
    for (const id of a.ids || []) out[id] = await dirSize(path.join(libDir(gid), safe(id)));
    return out;
  },

  /** What the game needs before mods can be installed, and whether each is there. */
  check_requirements: a => {
    const gid = need(a.game, 'game');
    const st = requirementState(gid);
    const ov = overlayOf(gid);
    if (ov && isAutolink(ov) && st && st.items.length && st.items.every(i => i.installed)) ensureCharacterFolders(ov); // repairs missing character folders
    return { items: (st?.items || []).map(i => ({ id: i.id, name: i.name, installed: i.installed, url: i.url, file: i.file, note: i.note })) };
  },

  /** The "Mods folder" button: the folder the game's database entry names (AutoLink for Dead or Alive 5), else the mods folder. */
  open_mods_folder: async a => {
    const g = a.game ? getGame(a.game) : null;
    const def = g && g.path ? matchDef(g.path) : null;
    let base = a.path || '', sub = a.sub;
    if (g && g.path && def?.modsOpen) {
      const d = within(g.path, def.modsOpen);
      base = d && isDir(d) ? d : g.path; // not there yet (tool missing): show the game folder
      sub = '';
    }
    if (!base) throw new Error('Mods folder unknown');
    return handlers.open_folder({ path: base, sub });
  },

  /** AutoLink games: is the tool installed, and which characters can a mod be installed for. */
  autolink_status: a => {
    const ov = overlayOf(need(a.game, 'game'));
    if (!ov || !isAutolink(ov)) return { supported: false };
    return { supported: true, installed: isDir(autolinkDir(ov)), characters: autolinkCharacters(ov) };
  },

  // ----- backups of the game's own files that mods replaced -----
  list_backups: a => {
    const gid = need(a.game, 'game');
    return { dir: backupRoot(gid), files: listBackups(gid), supported: !!overlayOf(gid) };
  },

  restore_backup: a => {
    const gid = need(a.game, 'game');
    const ov = overlayOf(gid);
    if (!ov) throw new Error('This game has no backups');
    restoreBackup(gid, ov.root, need(a.file, 'file'));
    return listBackups(gid);
  },

  open_backups: async a => {
    const dir = backupRoot(need(a.game, 'game'));
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
    return null;
  },
};
