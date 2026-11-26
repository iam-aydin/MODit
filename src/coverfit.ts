// Game covers are stored as JPEG files of at most COVER_LIMIT bytes. This is the size loop only: it works on anything shaped
// like Electron's NativeImage, so it can be tested without Electron.

export const COVER_LIMIT = 100 * 1024; // a stored cover is at most this big
export const COVER_MAX_W = 640;        // widest stored cover; the cards show them at about a third of that

export interface Pic {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(o: { width: number; quality?: 'good' | 'better' | 'best' }): Pic;
  toJPEG(quality: number): Buffer;
}

const QUALITIES = [88, 80, 72, 64, 56, 48, 40, 32];

/**
 * A JPEG of at most `limit` bytes: the picture is first made at most `maxW` wide (quality 88, like a normal cover),
 * then the quality goes down step by step, and when even that is too big the picture is made smaller and tried again.
 * Returns null when the picture could not be decoded; when the limit cannot be reached, the smallest result found.
 */
export function fitJpeg(img: Pic, limit: number = COVER_LIMIT, maxW: number = COVER_MAX_W): Buffer | null {
  if (!img || img.isEmpty()) return null;
  const full = img.getSize().width;
  if (!(full > 0)) return null;
  let w = Math.min(maxW, full);
  let best: Buffer | null = null;
  for (;;) {
    const pic = w < full ? img.resize({ width: w, quality: 'best' }) : img;
    for (const q of QUALITIES) {
      const b = pic.toJPEG(q);
      if (!best || b.length < best.length) best = b;
      if (b.length <= limit) return b;
    }
    if (w <= 64) return best;
    w = Math.max(64, Math.round(w * 0.8));
  }
}

/** True when the bytes start like a JPEG file. */
export const isJpeg = (b: Uint8Array): boolean => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
