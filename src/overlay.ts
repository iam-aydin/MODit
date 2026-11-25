import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Mods that are copied INTO the game's own folders (007 First Light: Runtime, Alan Wake 2: data,
// Kingdom Come: Deliverance 2: Mods/<mod>).  Rules:
//  - every file a mod would replace is first copied to <userData>/backups/<game>/files (same relative path)
//  - everything a mod wrote is remembered in <userData>/backups/<game>/state.json
//  - turning a mod off / removing it deletes what it added and puts the originals back
//  - the game's own folders are never deleted: only folders MODit created, and only when empty

interface Orig { existed: boolean; mod: string; size: number; time: number }
interface State {
  applied: Record<string, string[]>; // mod id -> files it wrote (relative to the game folder, "/" separators)
  orig: Record<string, Orig>;        // relative file -> what was there before the first mod touched it
  dirs: string[];                    // folders MODit created
  orders: Record<string, string[]>;  // mod id -> folder names to list in mod_order.txt
}

export interface OverlayMod { id: string; on: boolean; order?: string[] }
export interface BackupInfo { rel: string; mod: string; size: number; time: number; present: boolean }

const seg = (s: string) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').trim() || 'game';
export const backupRoot = (gid: string) => path.join(app.getPath('userData'), 'backups', seg(gid));
const filesDir = (gid: string) => path.join(backupRoot(gid), 'files');
const stateFile = (gid: string) => path.join(backupRoot(gid), 'state.json');

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (p: string) => { try { fs.statSync(p); return true; } catch { return false; } };
const rmrf = (p: string) => fs.rmSync(p, { recursive: true, force: true });

function within(base: string, rel: string): string | null {
  const b = path.resolve(base);
  const t = path.resolve(b, rel);
  return t === b || t.startsWith(b + path.sep) ? t : null;
}

/** All files under dir, as paths relative to dir with "/" separators. */
function walkRel(dir: string, sub = '', out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
    const r = sub ? `${sub}/${e.name}` : e.name;
    e.isDirectory() ? walkRel(dir, r, out) : out.push(r);
  }
  return out;
}

// ---------- state ----------
function load(gid: string): State {
  const blank: State = { applied: {}, orig: {}, dirs: [], orders: {} };
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(gid), 'utf8'));
    return {
      applied: j.applied && typeof j.applied === 'object' ? j.applied : {},
      orig: j.orig && typeof j.orig === 'object' ? j.orig : {},
      dirs: Array.isArray(j.dirs) ? j.dirs : [],
      orders: j.orders && typeof j.orders === 'object' ? j.orders : {},
    };
  } catch { return blank; }
}

function save(gid: string, st: State): void {
  fs.mkdirSync(backupRoot(gid), { recursive: true });
  const tmp = stateFile(gid) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, stateFile(gid));
}

// ---------- helpers ----------
function mkdirTracked(st: State, root: string, dir: string): void {
  const missing: string[] = [];
  let d = dir;
  while (!exists(d)) { missing.push(d); const up = path.dirname(d); if (up === d) break; d = up; }
  fs.mkdirSync(dir, { recursive: true });
  for (const m of missing.reverse()) {
    const rel = path.relative(root, m).split(path.sep).join('/');
    if (rel && !rel.startsWith('..') && !st.dirs.includes(rel)) st.dirs.push(rel);
  }
}

function prune(st: State, root: string): void {
  const list = [...st.dirs].sort((a, b) => b.length - a.length);
  for (const rel of list) {
    const p = within(root, rel);
    if (!p) { st.dirs = st.dirs.filter(d => d !== rel); continue; }
    try { fs.rmdirSync(p); st.dirs = st.dirs.filter(d => d !== rel); }          // only works when empty
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') st.dirs = st.dirs.filter(d => d !== rel); }
  }
}

/** Takes one mod's files out of the game and puts the original files back. */
function undo(st: State, gid: string, root: string, id: string): void {
  const list = st.applied[id] || [];
  delete st.applied[id];
  const still = new Set<string>();
  for (const l of Object.values(st.applied)) for (const f of l) still.add(f);
  for (const rel of list) {
    if (still.has(rel)) continue;                  // another enabled mod still provides this file
    const dest = within(root, rel);
    if (!dest) continue;
    const o = st.orig[rel];
    const bak = path.join(filesDir(gid), rel);
    if (o && o.existed) {
      if (exists(bak)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(bak, dest);
        rmrf(bak);
      } // backup gone: leave the file alone rather than delete the game's own
    } else rmrf(dest);
    delete st.orig[rel];
  }
}

// ---------- mod_order.txt (Kingdom Come: Deliverance 2) ----------
// Only touched when the game's Mods folder already has one: mods that are not listed are not loaded.
function orderFile(root: string): string | null {
  try {
    const hit = fs.readdirSync(root).find(n => /^mod_order\.txt$/i.test(n));
    return hit ? path.join(root, hit) : null;
  } catch { return null; }
}

function editOrder(root: string, add: string[], remove: string[]): void {
  const file = orderFile(root);
  if (!file || (!add.length && !remove.length)) return;
  const txt = fs.readFileSync(file, 'utf8');
  const eol = txt.includes('\r\n') ? '\r\n' : '\n';
  let lines = txt.split(/\r?\n/);
  const finalNl = lines.length > 0 && lines[lines.length - 1] === '';
  if (finalNl) lines.pop();
  const key = (s: string) => s.trim().toLowerCase();
  const before = lines.length + '|' + lines.join('\n');
  const drop = new Set(remove.map(key));
  if (drop.size) lines = lines.filter(l => !drop.has(key(l)));
  for (const n of add) if (!lines.some(l => key(l) === key(n))) lines.push(n);
  if (lines.length + '|' + lines.join('\n') === before) return;
  fs.writeFileSync(file, lines.join(eol) + (finalNl ? eol : ''));
}

// ---------- public API ----------
/**
 * Makes the game folder match the enabled mods. `lib(id)` is the folder holding a mod's files.
 * Returns the files whose originals were backed up during this call.
 */
export function syncOverlay(gid: string, root: string, lib: (id: string) => string, mods: OverlayMod[]): { backedUp: string[] } {
  const st = load(gid);
  const backedUp: string[] = [];
  const had = new Set(Object.keys(st.orig).filter(k => st.orig[k].existed)); // already saved earlier: not news for the user
  const known = new Set(mods.map(m => m.id));
  const desired = mods.filter(m => m.on && isDir(lib(m.id)));
  const desiredIds = desired.map(m => m.id);
  const cache = new Map<string, string[]>();
  const files = (id: string) => { let f = cache.get(id); if (!f) { f = walkRel(lib(id)); cache.set(id, f); } return f; };

  let revert = Object.keys(st.applied).filter(id => !desiredIds.includes(id));
  let apply = desiredIds.filter(id => !st.applied[id]);
  const staying = desiredIds.filter(id => st.applied[id]);

  if (revert.length || apply.length) {
    // two mods sharing a file cannot be switched one by one without losing the other one's version: redo everything then
    const stay = new Set<string>();
    for (const id of staying) for (const f of st.applied[id]) stay.add(f);
    const incoming = new Set<string>();
    let clash = false;
    for (const id of apply) for (const f of files(id)) { if (stay.has(f) || incoming.has(f)) clash = true; incoming.add(f); }
    for (const id of revert) for (const f of st.applied[id]) if (stay.has(f)) clash = true;
    if (clash) { revert = Object.keys(st.applied); apply = desiredIds; }
  }

  const removedOrder: string[] = [];
  for (const id of revert) {
    undo(st, gid, root, id);
    if (!known.has(id)) removedOrder.push(...(st.orders[id] || []));
  }
  prune(st, root);

  for (const id of apply) {
    const src = lib(id);
    const list: string[] = [];
    for (const rel of files(id)) {
      const dest = within(root, rel);
      if (!dest) continue;
      if (!st.orig[rel]) {
        if (exists(dest)) {
          const bak = path.join(filesDir(gid), rel);
          fs.mkdirSync(path.dirname(bak), { recursive: true });
          fs.copyFileSync(dest, bak);
          st.orig[rel] = { existed: true, mod: id, size: fs.statSync(dest).size, time: Date.now() };
          if (!had.has(rel)) backedUp.push(rel);
        } else st.orig[rel] = { existed: false, mod: id, size: 0, time: Date.now() };
      }
      mkdirTracked(st, root, path.dirname(dest));
      fs.copyFileSync(path.join(src, rel), dest);
      list.push(rel);
    }
    st.applied[id] = list;
    save(gid, st); // after every mod, so an interrupted copy can still be undone
  }

  const add: string[] = [], remove = [...removedOrder];
  for (const m of mods) {
    if (!m.order) continue;
    st.orders[m.id] = m.order;
    (m.on ? add : remove).push(...m.order);
  }
  editOrder(root, add, remove);

  save(gid, st);
  return { backedUp };
}

/** A mod is being deleted: take its files out and restore what it replaced. */
export function removeOverlayMod(gid: string, root: string, id: string): void {
  const st = load(gid);
  undo(st, gid, root, id);
  prune(st, root);
  editOrder(root, [], st.orders[id] || []);
  delete st.orders[id];
  save(gid, st);
}

/** The game is being removed from MODit: put every original back and delete the backups. */
export function removeAllOverlay(gid: string, root: string): void {
  const st = load(gid);
  const orders: string[] = [];
  for (const id of Object.keys(st.applied)) undo(st, gid, root, id);
  for (const o of Object.values(st.orders)) orders.push(...o);
  prune(st, root);
  editOrder(root, [], orders);
  rmrf(backupRoot(gid));
}

export function listBackups(gid: string): BackupInfo[] {
  const st = load(gid);
  return Object.entries(st.orig)
    .filter(([, o]) => o.existed)
    .map(([rel, o]) => ({ rel, mod: o.mod, size: o.size, time: o.time, present: exists(path.join(filesDir(gid), rel)) }))
    .sort((a, b) => b.time - a.time);
}

/** Put one original file back right now (the mod that replaced it no longer owns that file). */
export function restoreBackup(gid: string, root: string, rel: string): void {
  const st = load(gid);
  const o = st.orig[rel];
  if (!o || !o.existed) throw new Error('No backup of that file');
  const bak = path.join(filesDir(gid), rel);
  const dest = within(root, rel);
  if (!dest || !exists(bak)) throw new Error('The backup file is missing');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(bak, dest);
  rmrf(bak);
  delete st.orig[rel];
  for (const id of Object.keys(st.applied)) st.applied[id] = st.applied[id].filter(f => f !== rel);
  save(gid, st);
}
