// Overlay games (mod files go INTO the game's folders): added files are hard-linked, replaced game files are copied + backed up.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-ov-ud-'));
const stubs = { electron: { app: { getPath: () => userData }, shell: {} } };
const load = Module._load;
Module._load = function (request, ...rest) { return Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : load.call(this, request, ...rest); };
const { syncOverlay, removeOverlayMod } = require(path.join(process.env.MODIT_DIST || path.join(__dirname, '..', 'dist'), 'overlay.js'));

const mk = (dir, rel, data) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const nlink = f => fs.statSync(f).nlink;

test('a new file is linked, a replaced game file is copied; turning the mod off restores the original and keeps the library intact', async () => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-ov-game-'));
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-ov-lib-'));
  mk(game, 'data/own.bin', 'GAME ORIGINAL');
  mk(lib, 'data/own.bin', 'MOD VERSION'); mk(lib, 'data/new.bin', 'NEW FILE');
  const libOf = () => lib;

  await syncOverlay('g', game, libOf, [{ id: 'm', on: true }]);
  assert.equal(fs.readFileSync(path.join(game, 'data/own.bin'), 'utf8'), 'MOD VERSION');
  assert.equal(fs.readFileSync(path.join(game, 'data/new.bin'), 'utf8'), 'NEW FILE');
  assert.equal(nlink(path.join(lib, 'data/new.bin')), 2, 'a file the mod adds is a link: no second copy');
  assert.equal(nlink(path.join(lib, 'data/own.bin')), 1, 'a replaced game file is a real copy');

  await syncOverlay('g', game, libOf, [{ id: 'm', on: false }]);
  assert.equal(fs.readFileSync(path.join(game, 'data/own.bin'), 'utf8'), 'GAME ORIGINAL', 'the original is back');
  assert.equal(fs.existsSync(path.join(game, 'data/new.bin')), false);
  assert.equal(fs.readFileSync(path.join(lib, 'data/new.bin'), 'utf8'), 'NEW FILE', 'the library copy survives');
  assert.equal(fs.readFileSync(path.join(lib, 'data/own.bin'), 'utf8'), 'MOD VERSION');
});

test('two mods with the same new file: switching never rewrites the other mod\'s library file', async () => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-ov-game-'));
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-ov-a-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-ov-b-'));
  mk(a, 'x/shared.bin', 'FROM A'); mk(b, 'x/shared.bin', 'FROM B');
  const libOf = id => (id === 'a' ? a : b);
  await syncOverlay('g2', game, libOf, [{ id: 'a', on: true }, { id: 'b', on: false }]);
  await syncOverlay('g2', game, libOf, [{ id: 'a', on: false }, { id: 'b', on: true }]);
  assert.equal(fs.readFileSync(path.join(game, 'x/shared.bin'), 'utf8'), 'FROM B');
  assert.equal(fs.readFileSync(path.join(a, 'x/shared.bin'), 'utf8'), 'FROM A');
  await removeOverlayMod('g2', game, 'b');
  assert.equal(fs.readFileSync(path.join(b, 'x/shared.bin'), 'utf8'), 'FROM B');
});

// ---- packs: the whole pack is kept, the game gets the chosen characters ----
test('a pack is rebuilt from its whole copy: chosen characters linked, the others left out, nothing else lost', async () => {
  Module._load = function (request, ...rest) {
    const st = { electron: { app: { getPath: () => userData }, shell: {} }, 'better-sqlite3': class { pragma() {} exec() {} transaction(f) { return f; } close() {} prepare() { return { get: () => undefined, all: () => [], run: () => ({}) }; } }, 'adm-zip': class {}, 'node-7z': {}, '7zip-bin': {}, 'node-unrar-js': {} };
    return Object.prototype.hasOwnProperty.call(st, request) ? st[request] : load.call(this, request, ...rest);
  };
  const { buildPackLibrary } = require(path.join(process.env.MODIT_DIST || path.join(__dirname, '..', 'dist'), 'core.js'));
  const full = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-pack-full-')), dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'modit-pack-lib-')), 'P');
  mk(full, 'AutoLink/AKIRA/a.dds', 'akira'); mk(full, 'AutoLink/AYANE/b.dds', 'ayane'); mk(full, 'AutoLink/HAYATE/c.dds', 'hayate');
  mk(full, 'AutoLink/_Stages/s.bin', 'stage'); mk(full, 'shortcut.lnk', 'lnk');
  const all = ['AKIRA', 'AYANE', 'HAYATE'];

  await buildPackLibrary(full, dest, all, ['ayane']);          // case-insensitive
  assert.equal(fs.existsSync(path.join(dest, 'AutoLink/AYANE/b.dds')), true);
  assert.equal(fs.existsSync(path.join(dest, 'AutoLink/AKIRA')), false);
  assert.equal(fs.existsSync(path.join(dest, 'AutoLink/HAYATE')), false);
  assert.equal(fs.readFileSync(path.join(dest, 'AutoLink/_Stages/s.bin'), 'utf8'), 'stage', 'stages stay');
  assert.equal(fs.readFileSync(path.join(dest, 'shortcut.lnk'), 'utf8'), 'lnk', 'root files stay');
  assert.equal(nlink(path.join(full, 'AutoLink/AYANE/b.dds')), 2, 'linked: no second copy');

  await buildPackLibrary(full, dest, all, ['AKIRA', 'HAYATE']); // change the choice later, no archive needed
  assert.deepEqual(fs.readdirSync(path.join(dest, 'AutoLink')).sort(), ['AKIRA', 'HAYATE', '_Stages']);
  assert.equal(fs.readFileSync(path.join(full, 'AutoLink/AYANE/b.dds'), 'utf8'), 'ayane', 'the whole copy is untouched');
});
