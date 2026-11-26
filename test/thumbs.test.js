// Thumbnails: picking the picture from an extracted archive (dist/thumbs.js) and shrinking it (src/renderer/shrink.js, in a real browser).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-thumb-ud-'));
const load = Module._load;
Module._load = function (r, ...rest) { return r === 'electron' ? { app: { getPath: () => userData } } : load.call(this, r, ...rest); };
const T = require(path.join(process.env.MODIT_DIST || path.join(__dirname, '..', 'dist'), 'thumbs.js'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'modit-arch-'));
const put = (dir, rel, data = 'x') => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

test('takes the first picture of any type; top-level pictures come before deeper ones', async () => {
  const d = tmp();
  put(d, 'Mod/textures/deep.png', 'deep'); put(d, 'zeta.jpg', 'zeta'); put(d, 'alpha.webp', 'alpha'); put(d, 'Mod/skin.pak', 'pak');
  const img = await T.findImage(d);
  assert.equal(img.ext, 'webp');
  assert.equal(img.data.toString(), 'alpha');
});

test('no picture in the archive means no thumbnail', async () => {
  const d = tmp(); put(d, 'mod.pak'); put(d, 'readme.txt'); put(d, '__MACOSX/pic.png'); put(d, '._pic.png');
  assert.equal(await T.findImage(d), null);
});

test('finds png, jpg, jpeg, webp, bmp and gif; skips empty and oversized files', async () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'PNG']) {
    const d = tmp(); put(d, 'a/b/pic.' + ext, 'data');
    assert.equal((await T.findImage(d)).ext, ext.toLowerCase());
  }
  const d = tmp(); put(d, 'empty.png', ''); put(d, 'big.png', Buffer.alloc(13 * 1024 * 1024)); put(d, 'z.gif', 'ok');
  assert.equal((await T.findImage(d)).ext, 'gif');
});

test('saved thumbnails must be JPEG and stay in the thumbs folder', async () => {
  await assert.rejects(T.saveThumb('g1', 'M', Buffer.from('not a jpeg')), /not a JPEG/);
  await T.saveThumb('g1', '../evil', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  assert.ok(T.thumbFile('g1', '../evil').startsWith(T.thumbsRoot()), 'a hostile name cannot leave the thumbs folder');
  assert.ok(fs.existsSync(T.thumbFile('g1', '../evil')));
  await T.removeThumb('g1', '../evil');
  assert.equal(fs.existsSync(T.thumbFile('g1', '../evil')), false);
});

// ---- shrinking: needs a browser engine, so it is skipped where Playwright is not installed ----
let pw = null;
try { pw = require('playwright'); } catch { /* skipped below */ }

test('pictures of every format shrink to 30 KB (thumbnail) and 100 KB (cover) or less', { skip: !pw && 'playwright is not installed' }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + path.join(__dirname, '..', 'src', 'renderer', 'shrink.js').replace(/[^/]+$/, '') + 'picker.html').catch(() => {});
    await page.addScriptTag({ path: path.join(__dirname, '..', 'src', 'renderer', 'shrink.js') });
    const out = await page.evaluate(async () => {
      // a big noisy picture is the worst case: noise does not compress
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1600;
      const x = c.getContext('2d'), im = x.createImageData(c.width, c.height);
      for (let i = 0; i < im.data.length; i += 4) { im.data[i] = Math.random() * 255; im.data[i + 1] = Math.random() * 255; im.data[i + 2] = Math.random() * 255; im.data[i + 3] = 255; }
      x.putImageData(im, 0, 0);
      const bytes = async b => new Uint8Array(await b.arrayBuffer());
      const blob = t => new Promise(r => c.toBlob(r, t, 1));
      const bmp = (w, h) => { const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h, b = new Uint8Array(size), v = new DataView(b.buffer);
        b[0] = 66; b[1] = 77; v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
        for (let i = 54; i < size; i++) b[i] = (i * 7919) & 255; return b; };
      const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='), ch => ch.charCodeAt(0));
      const inputs = { png: await bytes(await blob('image/png')), jpeg: await bytes(await blob('image/jpeg')), webp: await bytes(await blob('image/webp')), bmp: bmp(600, 400), gif };
      const res = {};
      for (const [k, b] of Object.entries(inputs)) {
        const t = await Shrink.toJpeg(b, 30 * 1024, 512), v = await Shrink.toJpeg(b, 100 * 1024, 1024);
        res[k] = { in: b.length, thumb: t.length, cover: v.length, magic: [t[0], t[1], v[0], v[1]] };
      }
      return res;
    });
    for (const [k, r] of Object.entries(out)) {
      assert.ok(r.thumb <= 30 * 1024, `${k}: thumbnail is ${r.thumb} bytes`);
      assert.ok(r.cover <= 100 * 1024, `${k}: cover is ${r.cover} bytes`);
      assert.deepEqual(r.magic, [0xff, 0xd8, 0xff, 0xd8], `${k}: result is a JPEG`);
    }
    assert.ok(out.png.in > 1_000_000, 'the test picture really was big (' + out.png.in + ' bytes)');
  } finally { await browser.close(); }
});
