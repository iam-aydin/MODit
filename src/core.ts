import { app, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extract } from './archive';
import { getGame, updateGame } from './db';
import { backupRoot, listBackups, removeAllOverlay, removeOverlayMod, restoreBackup, syncOverlay } from './overlay';
import type { CommandArgs, GameData, GameDef, Mod } from './types';

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

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

// ---------- game database ----------
// Bundled: dist/data/games.json. Your own entries go in <userData>/games.json
// (a copy is created on first run); an entry with the same id replaces the bundled one.
const readDefs = (file: string): GameDef[] => {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j) ? j.filter(d => d && d.id && Array.isArray(d.detect) && typeof d.modsPath === 'string') : [];
  } catch { return []; }
};

export const userDbFile = () => path.join(userData(), 'games.json');

export function loadDb(): GameDef[] {
  const bundledFile = path.join(__dirname, 'data', 'games.json');
  const bundled = readDefs(bundledFile);
  try {
    if (!fs.existsSync(userDbFile())) {
      fs.mkdirSync(userData(), { recursive: true });
      fs.copyFileSync(bundledFile, userDbFile());
    }
  } catch { /* read-only is fine */ }
  const user = readDefs(userDbFile());
  const ids = new Set(user.map(d => d.id));
  return [...user, ...bundled.filter(d => !ids.has(d.id))];
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

/** Moves the useful part of an extracted archive into the library, laid out exactly as it goes into the game folder. */
function finalizeOverlay(src: string, gid: string, id: string, ov: Ov): Mod {
  const dest = path.join(libDir(gid), safe(id));
  rm(dest);
  fs.mkdirSync(dest, { recursive: true });
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

  open_db: async () => {
    loadDb(); // makes sure the file exists
    shell.showItemInFolder(userDbFile());
    return null;
  },

  scan_archive: a => withTmp(async tmp => {
    await extract(need(a.path, 'path'), tmp);
    const zips = walk(tmp).filter(f => /\.zip$/i.test(f)).map(f => path.basename(f));
    return zips.length >= 2 ? { kind: 'picker', zips: [...new Set(zips)].sort() } : { kind: 'single' };
  }),

  install_archive: a => withTmp(async tmp => {
    const gid = need(a.game, 'game'), archive = need(a.path, 'path');
    const ns = structuredClone(a.state as GameData);
    const dr = rootOf(a);
    const ov = overlayOf(gid);
    // one mod: into the library (overlay games: only the part that goes into the game folder)
    const put = (src: string, id: string) => {
      if (ov) { removeOverlayMod(gid, ov.root, id); addMod(ns, finalizeOverlay(src, gid, id, ov), ''); } // a reinstall first puts the old files back
      else addMod(ns, finalize(src, gid, id, dr), a.modsDir || '');
    };
    await extract(archive, tmp);
    const picks = a.picks || [];
    if (picks.length) {
      const zips = walk(tmp).filter(f => /\.zip$/i.test(f));
      for (const pick of picks) {
        const z = zips.find(f => path.basename(f) === pick);
        if (!z) continue;
        const sub = path.join(tmp, '__' + safe(stem(z)));
        await extract(z, sub);
        put(sub, safe(stem(z)));
      }
    } else {
      put(tmp, safe(stem(archive)));
    }
    return ns;
  }),

  install_files: async a => {
    const gid = need(a.game, 'game');
    if (overlayOf(gid)) throw new Error('Loose files cannot be placed for this game. Add the mod as a .zip, .7z or .rar archive instead.');
    const ns = structuredClone(a.state as GameData);
    // a .pak/.ucas/.utoc trio with the same name is one mod
    const groups = new Map<string, string[]>();
    for (const p of a.paths || []) {
      if (!LOOSE.test(p)) continue;
      const k = safe(stem(p));
      groups.set(k, [...(groups.get(k) || []), p]);
    }
    for (const [id, files] of groups) {
      const dest = path.join(libDir(gid), id);
      rm(dest);
      fs.mkdirSync(dest, { recursive: true });
      for (const f of files) fs.copyFileSync(f, path.join(dest, path.basename(f)));
      addMod(ns, { id, name: id, root: rootOf(a) }, a.modsDir || '');
    }
    return ns;
  },

  /** Make the game's folders match the active profile: enabled = copied in, disabled = removed. */
  sync_profile: a => {
    const gid = need(a.game, 'game');
    const st = a.state as GameData;
    const on = st.profiles[st.active] || {};
    const ov = overlayOf(gid);
    let result: { backedUp: string[] } | null = null;

    if (ov) {
      if (!isDir(ov.root)) throw new Error(`Game folder not found: ${ov.root}`);
      if (a.modsDir && !sameDir(a.modsDir, ov.root)) updateGame(gid, { modsDir: ov.root, modFolder: '' }); // games added before MODit knew them
      const mods = st.mods.filter(m => m.kind === 'overlay').map(m => ({ id: m.id, on: !!on[m.id], order: m.order }));
      result = syncOverlay(gid, ov.root, id => path.join(libDir(gid), safe(id)), mods);
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
          fs.mkdirSync(path.dirname(t), { recursive: true });
          fs.cpSync(src, t, { recursive: true });
        }
      } else rm(t);
    }
    return result;
  },

  remove_mod: a => {
    const gid = need(a.game, 'game'), id = need(a.id, 'id');
    const ov = overlayOf(gid);
    if (ov) removeOverlayMod(gid, ov.root, id); // its files go out of the game, the originals come back
    const oldStyle = a.kind !== 'overlay' && !(ov && a.modsDir && sameDir(a.modsDir, ov.root));
    if (a.modsDir && oldStyle) rm(target(a.modsDir, { id, root: a.root ?? '' }));
    rm(path.join(libDir(gid), safe(id)));
    return null;
  },

  remove_game: a => {
    const gid = need(a.game, 'game');
    const st = a.state as GameData | undefined;
    const ov = overlayOf(gid);
    if (ov) removeAllOverlay(gid, ov.root);
    if (a.modsDir && st && !(ov && sameDir(a.modsDir, ov.root))) for (const m of st.mods) if (!m.kind) rm(target(a.modsDir, m));
    rm(libDir(gid));
    return null;
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
