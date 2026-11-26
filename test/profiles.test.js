// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/renderer/profiles.js');

const game = (mods, profiles, active) => ({ mods: mods.map(id => ({ id, name: id, root: '~mods' })), profiles, active });

test('a mod installed on SFW is on in SFW and explicitly off in NSFW', () => {
  const d = game([], { SFW: {}, NSFW: {} }, 'SFW');
  const ns = { ...d, mods: [{ id: 'X', name: 'X', root: '~mods' }] };
  P.applyInstall(d, ns, new Set(), 'SFW');
  assert.equal(P.isOn(d, 'SFW', 'X'), true);
  assert.equal(P.isOn(d, 'NSFW', 'X'), false);
  assert.equal(d.profiles.NSFW.X, false, 'off must be written down, not just missing');
});

test('your case: download on SFW, then turn it on and off in NSFW - SFW never changes', () => {
  const d = game([], { SFW: {}, NSFW: {} }, 'SFW');
  P.applyInstall(d, { mods: [{ id: 'X', name: 'X' }] }, new Set(), 'SFW');
  d.active = 'NSFW';
  P.toggle(d, 'NSFW', 'X'); // on
  assert.equal(P.isOn(d, 'SFW', 'X'), true);
  P.toggle(d, 'NSFW', 'X'); // off
  assert.equal(P.isOn(d, 'NSFW', 'X'), false);
  assert.equal(P.isOn(d, 'SFW', 'X'), true, 'disabling in NSFW must not touch SFW');
  P.toggle(d, 'SFW', 'X'); // and the other way round
  assert.equal(P.isOn(d, 'SFW', 'X'), false);
  assert.equal(P.isOn(d, 'NSFW', 'X'), false);
});

test('installing in one profile never switches on other mods that have no saved value there', () => {
  // old data: A is on in SFW, NSFW has no entry for A. The old install code wrote A=true into NSFW.
  const d = game(['A'], { SFW: { A: true }, NSFW: {} }, 'NSFW');
  const ns = { ...d, mods: [...d.mods, { id: 'B', name: 'B' }] };
  P.applyInstall(d, ns, new Set(['A']), 'NSFW');
  assert.equal(P.isOn(d, 'NSFW', 'A'), false, 'A stays off in NSFW');
  assert.equal(P.isOn(d, 'SFW', 'A'), true, 'A stays on in SFW');
  assert.equal(P.isOn(d, 'NSFW', 'B'), true);
  assert.equal(P.isOn(d, 'SFW', 'B'), false);
});

test('mods that were already installed keep their on/off state in every profile', () => {
  const d = game(['A', 'B'], { SFW: { A: true, B: false }, NSFW: { A: false, B: true }, Work: { A: true } }, 'SFW');
  const before = JSON.stringify(d.profiles);
  P.applyInstall(d, { mods: [...d.mods, { id: 'C', name: 'C' }] }, new Set(['A', 'B']), 'SFW');
  const after = JSON.parse(JSON.stringify(d.profiles));
  for (const p of ['SFW', 'NSFW', 'Work']) for (const id of ['A', 'B']) assert.equal(after[p][id], JSON.parse(before)[p][id]);
});

test('three profiles: a new mod is on only where it was installed', () => {
  const d = game([], { SFW: {}, NSFW: {}, Work: {} }, 'Work');
  P.applyInstall(d, { mods: [{ id: 'N', name: 'N' }] }, new Set(), 'Work');
  assert.deepEqual([P.isOn(d, 'SFW', 'N'), P.isOn(d, 'NSFW', 'N'), P.isOn(d, 'Work', 'N')], [false, false, true]);
});

test('an install that finishes after you switched profile or toggled something keeps your choices', () => {
  const d = game(['A'], { SFW: { A: true }, NSFW: { A: false } }, 'SFW');
  const before = new Set(['A']);
  const ns = structuredClone(d);                     // the copy the install worked on
  ns.mods.push({ id: 'X', name: 'X' });
  d.active = 'NSFW'; P.toggle(d, 'NSFW', 'A');        // meanwhile: you switch to NSFW and turn A on
  P.applyInstall(d, ns, before, 'SFW');
  assert.equal(d.active, 'NSFW', 'the active profile is not reset');
  assert.equal(P.isOn(d, 'NSFW', 'A'), true, 'your toggle is not undone');
  assert.equal(P.isOn(d, 'SFW', 'X'), true, 'X goes to the profile the install was started from');
  assert.equal(P.isOn(d, 'NSFW', 'X'), false);
});

test('a mod removed or renamed while an install runs stays removed / renamed', () => {
  const d = game(['A', 'B'], { SFW: { A: true, B: true } }, 'SFW');
  const ns = structuredClone(d);
  d.mods = d.mods.filter(m => m.id !== 'A');          // removed meanwhile
  d.mods.find(m => m.id === 'B').name = 'My B';       // renamed meanwhile
  P.applyInstall(d, ns, new Set(['A', 'B']), 'SFW');
  assert.deepEqual(d.mods.map(m => m.id), ['B']);
  assert.equal(d.mods[0].name, 'My B');
});

test('Enable on <profile> moves a mod: off here, on there, third profile untouched', () => {
  const d = game(['X'], { SFW: { X: true }, NSFW: { X: false }, Work: { X: false } }, 'SFW');
  assert.equal(P.moveMod(d, 'X', 'SFW', 'NSFW'), true);
  assert.deepEqual([P.isOn(d, 'SFW', 'X'), P.isOn(d, 'NSFW', 'X'), P.isOn(d, 'Work', 'X')], [false, true, false]);
  assert.equal(P.moveMod(d, 'X', 'NSFW', 'NSFW'), false);
  assert.equal(P.moveMod(d, 'X', 'NSFW', 'Nope'), false);
  assert.equal(P.moveMod(d, 'Nope', 'NSFW', 'SFW'), false);
});

test('a new profile starts with everything off; duplicates and empty names are refused', () => {
  const d = game(['A'], { SFW: { A: true } }, 'SFW');
  assert.equal(P.createProfile(d, '  NSFW '), true);
  assert.equal(d.profiles.NSFW.A, false);
  assert.equal(P.createProfile(d, 'NSFW'), false);
  assert.equal(P.createProfile(d, '   '), false);
  assert.equal(P.isOn(d, 'SFW', 'A'), true);
});

test('"turn off all" and the profile counts only look at their own profile', () => {
  const d = game(['A', 'B'], { SFW: { A: true, B: true, Gone: true }, NSFW: { A: true } }, 'SFW');
  assert.equal(P.countOn(d, 'SFW'), 2, 'entries of mods that no longer exist are not counted');
  P.clearProfile(d, 'SFW');
  assert.equal(P.countOn(d, 'SFW'), 0);
  assert.equal(P.countOn(d, 'NSFW'), 1);
});

test('a value that is not exactly true counts as off', () => {
  const d = game(['A'], { SFW: { A: 1 }, NSFW: {} }, 'SFW');
  assert.equal(P.isOn(d, 'SFW', 'A'), false);
  assert.equal(P.isOn(d, 'Missing', 'A'), false);
});

test('a queue of 3 installs finishing together keeps every mod, each on only in the starting profile', () => {
  const d = game([], { SFW: {}, NSFW: {} }, 'SFW');
  const done = [];
  for (const id of ['M1', 'M2', 'M3']) {            // run one after another, like the install queue
    const before = new Set(d.mods.map(m => m.id));
    const ns = structuredClone(d); ns.mods.push({ id, name: id });
    if (id === 'M2') { d.active = 'NSFW'; }            // user switches profile during the second install
    P.applyInstall(d, ns, before, 'SFW'); done.push(id);
  }
  assert.deepEqual(d.mods.map(m => m.id), ['M1', 'M2', 'M3']);
  for (const id of done) { assert.equal(P.isOn(d, 'SFW', id), true); assert.equal(P.isOn(d, 'NSFW', id), false); }
  assert.equal(d.active, 'NSFW');
});

test('installing a mod again from a profile where it was off switches it on there (the Default case)', () => {
  // X was installed from SFW earlier. Installing the same archive on Default must give you X on Default.
  const d = game(['X'], { Default: {}, SFW: { X: true } }, 'Default');
  const ns = structuredClone(d); ns.installed = ['X'];
  P.applyInstall(d, ns, new Set(['X']), 'Default');
  assert.equal(P.isOn(d, 'Default', 'X'), true);
  assert.equal(P.isOn(d, 'SFW', 'X'), true, 'SFW keeps what it had');
  const off = game(['Y'], { Default: {}, SFW: { Y: false } }, 'Default');
  const n2 = structuredClone(off); n2.installed = ['Y'];
  P.applyInstall(off, n2, new Set(['Y']), 'Default');
  assert.equal(P.isOn(off, 'SFW', 'Y'), false, 'a profile where it was off stays off');
});

test('rename keeps the on/off settings, the order and the active profile; duplicates are refused', () => {
  const d = game(['A', 'B'], { Default: { A: true }, SFW: { B: true }, Work: {} }, 'SFW');
  assert.deepEqual(P.renameProfile(d, 'SFW', 'Safe'), { ok: true });
  assert.deepEqual(Object.keys(d.profiles), ['Default', 'Safe', 'Work']);
  assert.equal(d.active, 'Safe');
  assert.equal(P.isOn(d, 'Safe', 'B'), true);
  assert.equal(d.profiles.SFW, undefined);
  assert.equal(P.renameProfile(d, 'Safe', 'default').ok, false, 'same name in another case counts as a duplicate');
  assert.equal(P.renameProfile(d, 'Safe', 'Work').ok, false);
  assert.equal(P.renameProfile(d, 'Safe', '   ').ok, false);
  assert.equal(P.renameProfile(d, 'Nope', 'X').ok, false);
  assert.deepEqual(P.renameProfile(d, 'Safe', 'safe'), { ok: true }, 'changing only the case of its own name is fine');
  assert.equal(d.active, 'safe');
});

test('deleting a profile: mods stay, other profiles untouched, the active one falls back to Default', () => {
  const d = game(['A', 'B'], { Default: { A: false }, SFW: { A: true }, NSFW: { B: true } }, 'NSFW');
  const r = P.deleteProfile(d, 'NSFW');
  assert.deepEqual(r, { ok: true, switchedTo: 'Default' });
  assert.equal(d.active, 'Default');
  assert.deepEqual(Object.keys(d.profiles), ['Default', 'SFW']);
  assert.deepEqual(d.mods.map(m => m.id), ['A', 'B'], 'the mods themselves are not deleted');
  assert.equal(P.isOn(d, 'SFW', 'A'), true);
  const r2 = P.deleteProfile(d, 'SFW');                 // not the active one: nothing switches
  assert.deepEqual(r2, { ok: true });
  assert.equal(d.active, 'Default');
});

test('the last profile and "Default" cannot be deleted; without a Default the first one left takes over', () => {
  const d = game([], { Default: {}, SFW: {} }, 'SFW');
  assert.equal(P.deleteProfile(d, 'Default').ok, false);
  assert.equal(P.deleteProfile(d, 'Nope').ok, false);
  const e = game([], { Safe: {}, Work: {}, Fun: {} }, 'Work');   // Default was renamed away
  assert.deepEqual(P.deleteProfile(e, 'Work'), { ok: true, switchedTo: 'Safe' });
  const one = game([], { Only: {} }, 'Only');
  assert.equal(P.deleteProfile(one, 'Only').ok, false);
});
