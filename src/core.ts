import { app, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extract } from './archive';
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

export interface ResolvedGame { name: string; paks: string; modFolder: string; engine?: string; matched?: string }

/** Identify the game in the picked install folder and find where its mods go. */
export function resolveGame(p: string): ResolvedGame | null {
  if (!isDir(p)) return null;
  const folderName = path.basename(path.resolve(p)) || 'Game';

  // 1) the database
  for (const def of loadDb()) {
    const ok = def.detect.every(d => { const f = within(p, d); return !!f && fs.existsSync(f); });
    const mods = within(p, def.modsPath);
    if (!ok || !mods) continue;
    fs.mkdirSync(mods, { recursive: true });
    return { name: def.generic ? folderName : def.name, paks: mods, modFolder: def.modFolder ?? '', engine: def.engine, matched: def.id };
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
    await extract(archive, tmp);
    const picks = a.picks || [];
    if (picks.length) {
      const zips = walk(tmp).filter(f => /\.zip$/i.test(f));
      for (const pick of picks) {
        const z = zips.find(f => path.basename(f) === pick);
        if (!z) continue;
        const sub = path.join(tmp, '__' + safe(stem(z)));
        await extract(z, sub);
        addMod(ns, finalize(sub, gid, safe(stem(z)), dr), a.modsDir || '');
      }
    } else {
      addMod(ns, finalize(tmp, gid, safe(stem(archive)), dr), a.modsDir || '');
    }
    return ns;
  }),

  install_files: async a => {
    const gid = need(a.game, 'game');
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
    const gid = need(a.game, 'game'), modsDir = need(a.modsDir, 'modsDir');
    const st = a.state as GameData;
    if (!isDir(modsDir)) throw new Error(`Game folder not found: ${modsDir}`);
    const on = st.profiles[st.active] || {};
    for (const m of st.mods) {
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
    return null;
  },

  remove_mod: a => {
    const gid = need(a.game, 'game'), id = need(a.id, 'id');
    if (a.modsDir) rm(target(a.modsDir, { id, root: a.root ?? '' }));
    rm(path.join(libDir(gid), safe(id)));
    return null;
  },

  remove_game: a => {
    const gid = need(a.game, 'game');
    const st = a.state as GameData | undefined;
    if (a.modsDir && st) for (const m of st.mods) rm(target(a.modsDir, m));
    rm(libDir(gid));
    return null;
  },
};
