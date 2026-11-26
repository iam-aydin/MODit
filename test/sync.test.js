// Checks the real sync code (dist/core.js, built by `npm run build`) against a temporary game folder.
// Electron, SQLite and the archive tools are replaced by stubs: sync_profile only needs the file system.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-test-ud-'));
const stubs = {
  electron: { app: { getPath: () => userData }, shell: {} },
  'better-sqlite3': class { pragma() {} exec() {} transaction(f) { return f; } close() {} prepare() { return { get: () => undefined, all: () => [], run: () => ({}) }; } },
  'adm-zip': class {}, 'node-7z': {}, '7zip-bin': {}, 'node-unrar-js': {},
};
const load = Module._load;
Module._load = function (request, ...rest) { return Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : load.call(this, request, ...rest); };

const dist = process.env.MODIT_DIST || path.join(__dirname, '..', 'dist');
const { handlers } = require(path.join(dist, 'core.js'));
const P = require('../src/renderer/profiles.js');

const GID = 'g1';
const modsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modit-test-game-'));
fs.mkdirSync(path.join(modsDir, '~mods'), { recursive: true });
const present = id => fs.existsSync(path.join(modsDir, '~mods', id, id + '.pak'));
const addToLibrary = id => {
  const dir = path.join(userData, 'library', GID, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.pak'), 'x');
};
const sync = d => handlers.sync_profile({ game: GID, modsDir, state: d });

test('switching profiles puts exactly the right mod files in the game folder', async () => {
  const d = { mods: [], profiles: { SFW: {}, NSFW: {} }, active: 'SFW' };
  for (const id of ['A', 'B']) { addToLibrary(id); d.mods.push({ id, name: id, root: '~mods' }); }
  P.addNew(d, ['A'], 'SFW');   // A downloaded on SFW
  P.addNew(d, ['B'], 'NSFW');  // B downloaded on NSFW
  await sync(d);
  assert.deepEqual([present('A'), present('B')], [true, false], 'SFW: only A');

  d.active = 'NSFW'; await sync(d);
  assert.deepEqual([present('A'), present('B')], [false, true], 'NSFW: only B');

  P.setOn(d, 'NSFW', 'A', true); await sync(d);   // turn A on in NSFW ...
  assert.deepEqual([present('A'), present('B')], [true, true]);
  P.setOn(d, 'NSFW', 'A', false); await sync(d);  // ... and disable it again in NSFW
  assert.deepEqual([present('A'), present('B')], [false, true]);

  d.active = 'SFW'; await sync(d);                // SFW still has A on, and B off
  assert.deepEqual([present('A'), present('B')], [true, false], 'disabling A in NSFW did not touch SFW');
  assert.equal(P.isOn(d, 'SFW', 'A'), true);
});

test('Enable on <profile> moves the files with the profile', async () => {
  const d = { mods: [{ id: 'C', name: 'C', root: '~mods' }], profiles: { SFW: { C: true }, NSFW: { C: false } }, active: 'SFW' };
  addToLibrary('C'); await sync(d);
  assert.equal(present('C'), true);
  P.moveMod(d, 'C', 'SFW', 'NSFW'); await sync(d);        // active is still SFW: C leaves the game folder
  assert.equal(present('C'), false);
  d.active = 'NSFW'; await sync(d);
  assert.equal(present('C'), true);
});

test('a big profile switch does not block the app: timers keep firing while files are copied', async () => {
  // the game on another drive than the library: no hard links possible, every byte has to be copied
  const realLink = fs.promises.link;
  fs.promises.link = async () => { const e = new Error('cross-device link not permitted'); e.code = 'EXDEV'; throw e; };
  try { await bigSwitch(); } finally { fs.promises.link = realLink; }
});

async function bigSwitch() {
  const id = 'Big';
  const dir = path.join(userData, 'library', GID, id);
  fs.mkdirSync(dir, { recursive: true });
  const chunk = Buffer.alloc(8 * 1024 * 1024, 1);
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, `part${i}.pak`), chunk); // 160 MB
  const d = { mods: [{ id, name: id, root: '~mods' }], profiles: { SFW: { Big: false }, NSFW: { Big: true } }, active: 'NSFW' };
  let last = Date.now(), worst = 0, ticks = 0;
  const timer = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; ticks++; }, 10);
  await sync(d);
  clearInterval(timer);
  assert.equal(fs.readdirSync(path.join(modsDir, '~mods', id)).length, 20, 'all files arrived');
  assert.ok(ticks > 3, 'the event loop kept running during the copy (' + ticks + ' ticks)');
  assert.ok(worst < 250, 'the app was never stuck for long (longest gap ' + worst + ' ms)');
  d.active = 'SFW'; await sync(d);
  assert.equal(fs.existsSync(path.join(modsDir, '~mods', id)), false, 'and removing it works too');
}

test('on one drive the game folder gets hard links: a big mod takes no extra disk space', async () => {
  const id = 'Linked';
  addToLibrary(id);
  const d = { mods: [{ id, name: id, root: '~mods' }], profiles: { SFW: { [id]: true } }, active: 'SFW' };
  await sync(d);
  const lib = path.join(userData, 'library', GID, id, id + '.pak'), game = path.join(modsDir, '~mods', id, id + '.pak');
  assert.equal(fs.statSync(lib).ino, fs.statSync(game).ino, 'the game file is the library file');
  d.profiles.SFW[id] = false; await sync(d);        // turning it off removes the game copy only
  assert.equal(fs.existsSync(game), false);
  assert.equal(fs.readFileSync(lib, 'utf8'), 'x', 'the library copy is untouched');
  d.profiles.SFW[id] = true; await sync(d);         // and it comes back
  assert.equal(fs.readFileSync(game, 'utf8'), 'x');
});

test('mod_sizes reports how much a profile switch has to copy', async () => {
  const sizes = await handlers.mod_sizes({ game: GID, ids: ['A', 'Nope'] });
  assert.equal(sizes.A, 1);
  assert.equal(sizes.Nope, 0);
});
