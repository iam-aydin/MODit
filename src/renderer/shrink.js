// Shrinks a picture to a JPEG that fits a size limit. Runs in the window, which can decode
// PNG, JPEG, WebP, BMP and GIF (Electron's main process can only read PNG and JPEG).
// Quality is lowered step by step; when even the lowest quality is still too big, the picture is made smaller.
(function (root) {
  const toBlob = (canvas, q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));

  /**
   * @param bytes     the picture file (Uint8Array / ArrayBuffer)
   * @param limit     largest size of the result in bytes
   * @param maxSide   longest side to start from, in pixels
   * @returns Uint8Array holding a JPEG of at most `limit` bytes (or the smallest one reached)
   */
  async function toJpeg(bytes, limit, maxSide) {
    const bmp = await createImageBitmap(new Blob([bytes]));
    try {
      let side = Math.min(maxSide || 512, Math.max(bmp.width, bmp.height));
      let best = null;
      for (;;) {
        const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d');
        x.fillStyle = '#14101f'; x.fillRect(0, 0, w, h);          // transparent pictures get a dark background, JPEG has no alpha
        x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h);
        for (let q = 0.9; q >= 0.25; q -= 0.1) {
          const b = await toBlob(c, q);
          if (!b) throw new Error('This picture could not be converted');
          if (!best || b.size < best.size) best = b;
          if (b.size <= limit) return new Uint8Array(await b.arrayBuffer());
        }
        if (side <= 32) return new Uint8Array(await best.arrayBuffer());
        side = Math.max(32, Math.round(side * 0.8));
      }
    } finally { if (bmp.close) bmp.close(); }
  }
  root.Shrink = { toJpeg };
})(this);
