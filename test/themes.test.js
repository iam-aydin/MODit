// Themes: the palettes are complete, the CSS layers only use tokens that exist, the default theme injects nothing,
// and unknown theme names fall back to the default.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dist = process.env.MODIT_DIST || path.join(__dirname, '..', 'dist');
const T = require(path.join(dist, 'themes.js'));
const { LAYERS } = require(path.join(dist, 'theme-css.js'));
const PAGES = Object.keys(LAYERS);
const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

test('the list has the original look first, then Mint Gum and Forest', () => {
  assert.deepEqual(T.listThemes().map(t => t.id), ['glass', 'mint-gum', 'forest']);
  for (const t of T.listThemes()) for (const k of ['bg', 'card', 'a', 'b']) assert.match(t.swatch[k], /^#[0-9a-f]{6}$/i, `${t.id} swatch.${k}`);
});

test('glass (the page\'s own CSS) injects nothing for any window', () => {
  for (const p of PAGES) assert.equal(T.themeCss(p, 'glass'), '');
});

test('every --t-* token a layer uses is defined by every palette', () => {
  for (const id of ['mint-gum', 'forest']) {
    for (const p of PAGES) {
      const css = T.themeCss(p, id);
      const defined = new Set([...css.split('\n')[0].matchAll(/--t-([a-z0-9-]+):/g)].map(m => m[1]));
      const used = new Set([...LAYERS[p].matchAll(/var\(--t-([a-z0-9-]+)/g)].map(m => m[1]));
      for (const u of used) assert.ok(defined.has(u), `${id}/${p}: --t-${u} is used but not defined`);
    }
  }
});

test('the legacy page variables follow the palette, and the colour scheme matches', () => {
  const light = T.themeCss('main', 'mint-gum'), dark = T.themeCss('main', 'forest');
  assert.match(light, /color-scheme:light/);
  assert.match(dark, /color-scheme:dark/);
  assert.match(light, /--bg:#f3fcf6/);
  assert.match(dark, /--bg:#020804/);
  assert.match(dark, /--pu:#2dbe69/);
  assert.match(light, /--pu:#0f9d58/);
});

test('the pop-up pages (transparent windows) never set a colour-scheme, so they stay see-through', () => {
  for (const p of ['menu', 'dlpanel', 'picker']) for (const id of ['mint-gum', 'forest']) assert.doesNotMatch(T.themeCss(p, id), /color-scheme/, `${id}/${p}`);
  for (const p of ['main', 'browser', 'newtab']) assert.match(T.themeCss(p, 'forest'), /color-scheme:dark/, p);
});

test('palette colours are the ones from the Game Asset Manager themes', () => {
  const m = T.themeCss('main', 'mint-gum'), f = T.themeCss('main', 'forest');
  for (const c of ['#f3fcf6', '#a8dfbd', '#7fcfa0', '#d6f3e0', '#0f9d58', '#e64980', '#12301f']) assert.ok(m.includes(c), 'mint-gum ' + c);
  for (const c of ['#020804', '#030b06', '#040f08', '#06190e', '#092615', '#2dbe69', '#cbe2d4']) assert.ok(f.includes(c), 'forest ' + c);
});

test('injected CSS cannot close its own <style> or contain script-ish text', () => {
  for (const id of ['mint-gum', 'forest']) for (const p of PAGES) assert.doesNotMatch(T.themeCss(p, id), /<\/?style|<script|expression\(/i);
});

test('an unknown theme falls back to the default, a known one sticks, and listeners hear about changes', () => {
  assert.equal(T.themeId(), 'glass');
  let calls = 0; T.onTheme(() => { calls++; });
  assert.equal(T.setThemeId('nope'), 'glass');
  assert.equal(calls, 0, 'no change, no call');
  assert.equal(T.setThemeId('forest'), 'forest');
  assert.equal(T.themeBg(), '#020804');
  assert.equal(T.setThemeId(undefined), 'glass');
  assert.equal(calls, 2);
  assert.equal(T.themeBg(), '#07060c');
});

test('windows follow the theme: CSS is inserted on dom-ready and swapped on a change; other sites are left alone', async () => {
  const { EventEmitter } = require('events');
  const mk = url => { const w = new EventEmitter(); let n = 0; w.live = new Map(); w.url = url;
    w.isDestroyed = () => false; w.getURL = () => w.url;
    w.insertCSS = async css => { const k = 'k' + (++n); w.live.set(k, css); return k; };
    w.removeInsertedCSS = async k => { w.live.delete(k); }; return w; };
  T.setThemeId('glass');
  const win = mk('file:///x/index.html'), tab = mk('https://example.com/'), nt = mk('file:///x/newtab.html');
  const only = u => /newtab\.html/.test(u);
  const ready = T.themed(win, 'main'); T.themed(tab, 'newtab', only); T.themed(nt, 'newtab', only);
  T.setThemeId('mint-gum');
  win.emit('dom-ready'); tab.emit('dom-ready'); nt.emit('dom-ready');
  await ready; await new Promise(r => setTimeout(r, 20));
  assert.equal(win.live.size, 1); assert.match([...win.live.values()][0], /--bg:#f3fcf6/);
  assert.equal(tab.live.size, 0, 'a website must never get MODit CSS');
  assert.equal(nt.live.size, 1);
  T.setThemeId('forest'); await new Promise(r => setTimeout(r, 20));
  assert.equal(win.live.size, 1, 'the old CSS is removed, not stacked'); assert.match([...win.live.values()][0], /--bg:#020804/);
  assert.equal(tab.live.size, 0);
  T.setThemeId('glass'); await new Promise(r => setTimeout(r, 20));
  assert.equal(win.live.size, 0, 'back to the original look: nothing injected');
});
