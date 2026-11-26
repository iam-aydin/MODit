// The library copy runs on a worker thread (src/fastfs.ts -> dist/fastfs.js), so a big copy cannot freeze the window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { threadId } = require('worker_threads');

const { copyTree } = require(path.join(process.env.MODIT_DIST || path.join(__dirname, '..', 'dist'), 'fastfs.js'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'modit-copy-'));
const put = (dir, rel, data) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

test('copies a whole folder, nested files included, and creates missing parent folders', async () => {
  const src = tmp(), out = path.join(tmp(), 'deep', 'er', 'mod');
  put(src, 'a.pak', 'AAA'); put(src, 'sub/b.ucas', 'BBBB'); put(src, 'sub/more/c.utoc', 'C');
  await copyTree(src, out);
  assert.equal(fs.readFileSync(path.join(out, 'a.pak'), 'utf8'), 'AAA');
  assert.equal(fs.readFileSync(path.join(out, 'sub', 'b.ucas'), 'utf8'), 'BBBB');
  assert.equal(fs.readFileSync(path.join(out, 'sub', 'more', 'c.utoc'), 'utf8'), 'C');
});

test('copying onto an existing folder merges and overwrites, like fs.cpSync', async () => {
  const src = tmp(), out = tmp();
  put(src, 'x.pak', 'new'); put(out, 'x.pak', 'old'); put(out, 'keep.txt', 'kept');
  await copyTree(src, out);
  assert.equal(fs.readFileSync(path.join(out, 'x.pak'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(out, 'keep.txt'), 'utf8'), 'kept');
});

test('a missing source rejects with the reason instead of crashing the app', async () => {
  await assert.rejects(copyTree(path.join(tmp(), 'nope'), path.join(tmp(), 'out')), /ENOENT|no such file/i);
});

test('the main thread keeps running while a big copy is going on', async () => {
  const src = tmp(), out = path.join(tmp(), 'out');
  const chunk = Buffer.alloc(8 * 1024 * 1024, 7);
  for (let i = 0; i < 16; i++) put(src, `part${i}.pak`, chunk); // 128 MB
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  const t0 = Date.now();
  await copyTree(src, out);
  clearInterval(timer);
  const ms = Date.now() - t0;
  assert.equal(fs.readdirSync(out).length, 16);
  assert.equal(threadId, 0, 'the test itself runs on the main thread');
  // a blocking copy would give ~0-1 ticks; a free main thread ticks about once per millisecond
  assert.ok(ticks >= Math.min(20, ms / 10), `only ${ticks} timer ticks during a ${ms} ms copy: the main thread was blocked`);
});

// ---- game folder: hard links instead of a second copy ----
const { placeFile, placeTree } = require(path.join(process.env.MODIT_DIST || path.join(__dirname, '..', 'dist'), 'fastfs.js'));
const ino = f => fs.statSync(f).ino;

test('placeTree hard-links every file: no second copy of the data on disk', async () => {
  const lib = tmp(), game = path.join(tmp(), '~mods', 'M');
  put(lib, 'a.pak', 'AAA'); put(lib, 'sub/b.ucas', 'BBBB');
  await placeTree(lib, game);
  assert.equal(fs.readFileSync(path.join(game, 'sub', 'b.ucas'), 'utf8'), 'BBBB');
  assert.equal(ino(path.join(game, 'a.pak')), ino(path.join(lib, 'a.pak')), 'same data on disk');
  assert.equal(fs.statSync(path.join(lib, 'a.pak')).nlink, 2);
});

test('removing the game copy leaves the library copy untouched', async () => {
  const lib = tmp(), game = tmp();
  put(lib, 'a.pak', 'AAA');
  await placeTree(lib, game);
  fs.rmSync(game, { recursive: true, force: true });
  assert.equal(fs.readFileSync(path.join(lib, 'a.pak'), 'utf8'), 'AAA');
  assert.equal(fs.statSync(path.join(lib, 'a.pak')).nlink, 1);
});

test('placing over a linked file never writes through the link into the library', async () => {
  const lib = tmp(), other = tmp(), game = tmp();
  put(lib, 'a.pak', 'LIBRARY'); put(other, 'a.pak', 'OTHER MOD');
  await placeTree(lib, game);                                   // game/a.pak is a link to lib/a.pak
  await placeFile(path.join(other, 'a.pak'), path.join(game, 'a.pak'), false); // a copy goes there now
  assert.equal(fs.readFileSync(path.join(game, 'a.pak'), 'utf8'), 'OTHER MOD');
  assert.equal(fs.readFileSync(path.join(lib, 'a.pak'), 'utf8'), 'LIBRARY', 'the library copy must not change');
  await placeTree(other, game);                                 // and again with links
  assert.equal(fs.readFileSync(path.join(lib, 'a.pak'), 'utf8'), 'LIBRARY');
});

test('when links are not possible (another drive) the file is copied instead', async () => {
  const lib = tmp(), game = tmp();
  put(lib, 'a.pak', 'AAA');
  const real = fs.promises.link;
  fs.promises.link = async () => { const e = new Error('cross-device link not permitted'); e.code = 'EXDEV'; throw e; };
  try { await placeTree(lib, game); } finally { fs.promises.link = real; }
  assert.equal(fs.readFileSync(path.join(game, 'a.pak'), 'utf8'), 'AAA');
  assert.notEqual(ino(path.join(game, 'a.pak')), ino(path.join(lib, 'a.pak')), 'a real copy');
});

test('an unexpected link error is reported, not hidden', async () => {
  const lib = tmp(), game = tmp();
  put(lib, 'a.pak', 'AAA');
  const real = fs.promises.link;
  fs.promises.link = async () => { const e = new Error('disk on fire'); e.code = 'EIO'; throw e; };
  try { await assert.rejects(placeTree(lib, game), /disk on fire/); } finally { fs.promises.link = real; }
});
