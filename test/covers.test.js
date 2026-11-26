// Game covers: every stored cover is a JPEG of at most 100 KB (src/coverfit.ts -> dist/coverfit.js).
// Electron's image decoder is replaced by a stand-in whose JPEG size follows width x height x quality, so this checks the
// size logic (how far quality and size go down) on its own. The real encoder is covered by the browser test in thumbs.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const F = require(path.join(process.env.MODIT_DIST || path.join(__dirname, '..', 'dist'), 'coverfit.js'));
const KB = 1024;

/** A fake picture. `density` = JPEG bytes per pixel at quality 100 (noise ~2.7, a flat picture ~0.05). `seen` records every encode. */
function pic(w, h, density, seen = []) {
  return {
    isEmpty: () => w === 0,
    getSize: () => ({ width: w, height: h }),
    resize: o => pic(o.width, Math.max(1, Math.round(h * o.width / w)), density, seen),
    toJPEG: q => { seen.push({ w, h, q }); return Buffer.alloc(Math.ceil(w * h * density * q / 100)); },
  };
}

test('the limit is 100 KB and covers are at most 640 px wide', () => {
  assert.equal(F.COVER_LIMIT, 100 * KB);
  assert.equal(F.COVER_MAX_W, 640);
});

test('a big noisy picture (the worst case) ends up under 100 KB and never wider than 640 px', () => {
  const seen = [];
  const out = F.fitJpeg(pic(2400, 1600, 2.7, seen));
  assert.ok(out.length <= 100 * KB, 'cover is ' + out.length + ' bytes');
  assert.ok(seen.every(s => s.w <= 640), 'something was encoded wider than 640 px');
  assert.ok(seen[0].w === 640 && seen[0].q === 88, 'the first try is the normal cover: 640 px at quality 88');
});

test('pictures of every shape end up under 100 KB', () => {
  for (const [w, h, d] of [[600, 900, 2.7], [1920, 620, 2.7], [4000, 3000, 2.7], [640, 960, 1.2], [300, 200, 2.7], [1200, 1200, 0.4], [8000, 600, 3]]) {
    const out = F.fitJpeg(pic(w, h, d));
    assert.ok(out.length <= 100 * KB, `${w}x${h} density ${d}: ${out.length} bytes`);
  }
});

test('a picture that already fits is encoded once at quality 88 (nothing is squeezed for no reason)', () => {
  const seen = [];
  const out = F.fitJpeg(pic(640, 427, 0.05, seen));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { w: 640, h: 427, q: 88 });
  assert.ok(out.length < 100 * KB);
});

test('small pictures are never made bigger', () => {
  const seen = [];
  F.fitJpeg(pic(300, 200, 2.7, seen));
  assert.ok(seen.every(s => s.w <= 300), 'a 300 px picture was scaled up');
});

test('quality goes down before the picture is made smaller', () => {
  const seen = [];
  // 640x427 at density 0.5 is 120 KB at q88... too big at 88 (120 KB), fits at a lower quality without shrinking
  const out = F.fitJpeg(pic(640, 427, 0.5, seen));
  assert.ok(out.length <= 100 * KB);
  assert.ok(seen.every(s => s.w === 640), 'the picture was shrunk although a lower quality was enough');
  assert.ok(seen.length > 1 && seen[seen.length - 1].q < 88);
});

test('when the limit cannot be reached the smallest result comes back (no endless loop)', () => {
  const out = F.fitJpeg(pic(2000, 2000, 3), 1);
  assert.ok(out && out.length > 1);
});

test('a picture Electron could not decode gives null; isJpeg checks the file header', () => {
  assert.equal(F.fitJpeg(pic(0, 0, 1)), null);
  assert.equal(F.fitJpeg(null), null);
  assert.equal(F.isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), true);
  assert.equal(F.isJpeg(Buffer.from('RIFFxxxxWEBP')), false);
  assert.equal(F.isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false);
});
