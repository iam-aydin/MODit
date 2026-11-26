import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

// Copying a mod into the library can be several GB. fs.cpSync would block the main process (and with it the window)
// for the whole copy, so the copy runs in a worker thread: the main process only waits for its answer.

const CODE = `
const { parentPort, workerData: w } = require('worker_threads');
const fs = require('fs');
try { fs.cpSync(w.src, w.dest, { recursive: true }); parentPort.postMessage(null); }
catch (e) { parentPort.postMessage(String((e && e.message) || e)); }
`;

/** Copies a file or a whole folder (recursively) on a worker thread. Rejects when the copy fails. */
export function copyTree(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const end = (err?: Error): void => { if (settled) return; settled = true; if (err) reject(err); else resolve(); };
    const w = new Worker(CODE, { eval: true, workerData: { src, dest } });
    w.once('message', (m: string | null) => end(m ? new Error(m) : undefined));
    w.once('error', e => end(e instanceof Error ? e : new Error(String(e))));
    w.once('exit', code => end(new Error(code ? `The copy stopped (code ${code})` : 'The copy ended without a result')));
  });
}

// ---------- putting a mod into the game folder ----------
// The library keeps one copy of every mod. A copy in the game folder would double the disk space (a 10 GB mod = 20 GB more),
// so a file is HARD-LINKED into the game instead: both names point at the same data on disk, nothing is copied and it is instant.
// This is what Vortex (Nexus Mods) does. A hard link only works inside one drive; on another drive, or on a file system without
// links, the file is copied as before.
// The one danger of a link: writing INTO it changes the library copy too. So a file that is already there is deleted first,
// never overwritten in place.

const NO_LINK = new Set(['EXDEV', 'EPERM', 'EACCES', 'EMLINK', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'UNKNOWN']);

/** Puts one file at dest: a hard link when `link` is set and possible, else a copy. Returns true when it was linked. */
export async function placeFile(from: string, dest: string, link: boolean): Promise<boolean> {
  let old: fs.Stats | null = null;
  try { old = await fs.promises.lstat(dest); } catch { /* nothing there yet */ }
  // dest may itself be a link to a library file: copying over it would rewrite that library file
  if (old && (link || old.nlink > 1 || old.isSymbolicLink())) await fs.promises.unlink(dest);
  if (link) {
    try { await fs.promises.link(from, dest); return true; }
    catch (e) { if (!NO_LINK.has((e as NodeJS.ErrnoException).code || '')) throw e; }
  }
  await fs.promises.copyFile(from, dest);
  return false;
}

/** Puts a whole folder at dest (merging into what is there): hard links where possible, copies elsewhere. */
export async function placeTree(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  for (const e of await fs.promises.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dest, e.name);
    if (e.isDirectory()) await placeTree(from, to);
    else await placeFile(from, to, true);
  }
}
