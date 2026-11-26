import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Mod thumbnails live in MODit's own folder, <userData>/thumbs/<game>/<mod>.jpg, never in the game or in the mod.
// The picture is found in the archive here, shrunk to JPEG by the window (it can decode PNG, JPEG, WebP, BMP and GIF)
// and written back here.

export const THUMB_LIMIT = 30 * 1024;           // a saved thumbnail is at most this big
const SRC_LIMIT = 12 * 1024 * 1024;             // pictures bigger than this in an archive are ignored
const PICK_LIMIT = 30 * 1024 * 1024;            // same for a picture the user chooses
const IMG = /\.(png|jpe?g|webp|bmp|gif)$/i;

export const seg = (s: string) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').trim() || 'x';
export const thumbsRoot = () => path.join(app.getPath('userData'), 'thumbs');
export const thumbFile = (gid: string, id: string) => path.join(thumbsRoot(), seg(gid), seg(id) + '.jpg');

export interface FoundImage { ext: string; data: Buffer }

/** The first picture in an extracted archive: top-level ones before deeper ones, then by name. Null when there is none. */
export async function findImage(dir: string): Promise<FoundImage | null> {
  const hits: Array<{ file: string; depth: number; rel: string }> = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    let es: fs.Dirent[];
    try { es = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^__macosx$/i.test(e.name) && depth < 8) await walk(f, depth + 1); }
      else if (IMG.test(e.name) && !e.name.startsWith('._')) hits.push({ file: f, depth, rel: path.relative(dir, f).toLowerCase() });
    }
  };
  await walk(dir, 0);
  hits.sort((a, b) => a.depth - b.depth || a.rel.localeCompare(b.rel));
  for (const h of hits) {
    try {
      const st = await fs.promises.stat(h.file);
      if (st.size < 1 || st.size > SRC_LIMIT) continue;
      return { ext: path.extname(h.file).toLowerCase().slice(1), data: await fs.promises.readFile(h.file) };
    } catch { /* unreadable: try the next one */ }
  }
  return null;
}

/** A picture the user chose (any format the window can show). */
export async function readImage(file: string): Promise<Buffer> {
  if (!IMG.test(file)) throw new Error('That is not a picture MODit can use (PNG, JPG, WebP, BMP or GIF)');
  const st = await fs.promises.stat(file);
  if (st.size > PICK_LIMIT) throw new Error('That picture is too big (over 30 MB)');
  return fs.promises.readFile(file);
}

export async function saveThumb(gid: string, id: string, bytes: Uint8Array): Promise<void> {
  const b = Buffer.from(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) throw new Error('The thumbnail is not a JPEG');
  if (b.length > 4 * THUMB_LIMIT) throw new Error('The thumbnail is too big');
  const f = thumbFile(gid, id);
  await fs.promises.mkdir(path.dirname(f), { recursive: true });
  await fs.promises.writeFile(f + '.tmp', b);
  await fs.promises.rename(f + '.tmp', f);
}

export const removeThumb = (gid: string, id: string) => fs.promises.rm(thumbFile(gid, id), { force: true });
export const removeAllThumbs = (gid: string) => fs.promises.rm(path.join(thumbsRoot(), seg(gid)), { recursive: true, force: true });
