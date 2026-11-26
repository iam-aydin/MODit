import type { WebContents } from 'electron';
import { LAYERS, type Page } from './theme-css';

// Colour themes for MODit.
//
//  - "glass" is the original look (dark, red + blue). It is the page's own CSS, so nothing is injected for it.
//  - "mint-gum" and "forest" are the same two themes as in the Game Asset Manager. Their colours below are copied
//    from that app's mint-gum.ts / forest.ts (the constant names are kept, so the two files are easy to compare).
//
// A theme is just a Palette. themeCss() turns it into CSS custom properties (--t-*) and main.ts / browser.ts
// inject that, plus the page layer from theme-css.ts, into every MODit window (insertCSS), so switching
// themes is instant and needs no reload. This file does not depend on MODit's markup: for the future launcher,
// copy this file and write a theme-css.ts for its own pages.

export type ThemeId = 'glass' | 'mint-gum' | 'forest';

export interface Palette {
  scheme: 'dark' | 'light';
  bg: string;        // window / page background          (Mantine dark-8 / body)
  strip: string;     // browser tab strip                  (dark-6)
  panel: string;     // sidebar, header, toolbars          (dark-7)
  card: string;      // cards, dialogs, list rows
  input: string;     // text fields
  hover: string;     // hovered rows and buttons           (dark-5)
  line: string;      // dividers, card borders             (dark-4)
  line2: string;     // input / button borders             (default-border)
  tx: string;        // text
  mut: string;       // dimmed text
  a: string;         // primary accent (indigo-6)
  aHover: string;
  aDeep: string;     // darker end of the accent (game icon)
  aSoft: string;     // translucent accent fill (active nav item, selected rows)
  aText: string;     // accent used as text on aSoft
  onA: string;       // text on a filled accent button
  b: string;         // secondary accent (blue scale: links, info chips)
  bSoft: string;
  bLine: string;
  bText: string;
  link: string;
  menu: string;      // dropdowns, right-click menu, toasts
  scrim: string;     // dim layer behind dialogs
  thumb: string;     // placeholder behind mod / game pictures
  pill: string;      // toggle, off
  knob: string;      // toggle knob, off
  spot: string;      // the light that follows the mouse on game cards
  glow: string;      // hover shadow of game cards
  shadow: string;    // shadow of dropdowns
  tab: string;       // inactive browser tab
  danger: string;
  dangerTx: string;
  dangerSoft: string;
  ok: string;
  bad: string;
}

// ---- Mint Gum (from mint-gum.ts) ----
const MG_BODY = '#f3fcf6';
const MG_LINE = '#a8dfbd';
const MG_LINE_STRONG = '#7fcfa0';
const MG_ROW = '#d6f3e0';

const mintGum: Palette = {
  scheme: 'light',
  bg: MG_BODY,
  strip: '#e6f8ec',
  panel: '#eefaf2',
  card: '#ffffff',
  input: '#ffffff',
  hover: MG_ROW,
  line: MG_LINE,
  line2: MG_LINE_STRONG,
  tx: '#12301f',
  mut: '#5b7a68',
  a: '#0f9d58',            // indigo-6
  aHover: '#0c8449',       // indigo-7
  aDeep: '#096b3b',        // indigo-8
  aSoft: 'rgba(15,157,88,0.14)',
  aText: '#0b6b3e',        // indigo-2
  onA: '#ffffff',
  b: '#e64980',            // blue-6 (bubble-gum pink)
  bSoft: 'rgba(230,73,128,0.12)',
  bLine: 'rgba(230,73,128,0.35)',
  bText: '#b02a5b',        // blue-8
  link: '#d6336c',         // blue-7
  menu: '#ffffff',
  scrim: 'rgba(18,48,31,0.28)',
  thumb: 'linear-gradient(135deg,#d6f3e0,#eaf6ec 50%,#ffe3ee)',
  pill: '#c3e9d1',
  knob: '#ffffff',
  spot: 'rgba(15,157,88,0.16)',
  glow: '0 12px 28px rgba(18,48,31,0.16),0 0 18px rgba(15,157,88,0.2)',
  shadow: '0 18px 40px rgba(18,48,31,0.18)',
  tab: 'rgba(15,157,88,0.08)',
  danger: '#e03131',
  dangerTx: '#c92a2a',
  dangerSoft: 'rgba(224,49,49,0.14)',
  ok: '#2f9e44',
  bad: '#e03131',
};

// ---- Forest (from forest.ts) ----
const FO_MAIN = '#2dbe69';
const FO_D8 = '#020804';
const FO_D7 = '#030b06';
const FO_D6 = '#040f08';
const FO_D5 = '#06190e';
const FO_D4 = '#092615';

const forest: Palette = {
  scheme: 'dark',
  bg: FO_D8,
  strip: FO_D8,
  panel: FO_D7,
  card: FO_D7,
  input: FO_D6,
  hover: FO_D5,
  line: FO_D4,
  line2: '#0c3019',        // one step above dark-4 so buttons and fields stay visible
  tx: '#cbe2d4',
  mut: '#8db09b',
  a: FO_MAIN,
  aHover: '#3dd17b',       // indigo-5
  aDeep: '#26a159',        // indigo-7
  aSoft: 'rgba(45,190,105,0.16)',
  aText: '#83e2ab',        // indigo-3
  onA: '#03170b',
  b: '#83e2ab',            // blue scale = lighter greens
  bSoft: 'rgba(131,226,171,0.12)',
  bLine: 'rgba(131,226,171,0.3)',
  bText: '#b0e8c7',
  link: '#83e2ab',         // --mantine-color-anchor
  menu: FO_D6,
  scrim: 'rgba(1,6,3,0.72)',
  thumb: 'linear-gradient(135deg,rgba(45,190,105,0.2),rgba(45,190,105,0.04))',
  pill: '#0b2a18',
  knob: '#5e826d',
  spot: 'rgba(131,226,171,0.16)',
  glow: '0 14px 30px rgba(0,0,0,0.55),0 0 22px rgba(45,190,105,0.22)',
  shadow: '0 20px 50px rgba(0,0,0,0.6)',
  tab: 'rgba(45,190,105,0.06)',
  danger: '#c0434b',
  dangerTx: '#f0626b',
  dangerSoft: 'rgba(240,98,107,0.22)',
  ok: '#4ade80',
  bad: '#f0626b',
};

export interface Theme {
  id: ThemeId;
  label: string;
  note: string;
  bg: string;                       // window colour while a page loads
  swatch: { bg: string; card: string; a: string; b: string }; // the preview in Settings
  palette: Palette | null;          // null = the page's own CSS (nothing is injected)
}

const THEMES: Theme[] = [
  { id: 'glass', label: 'Glass', note: 'The original: dark, red and blue.', bg: '#07060c',
    swatch: { bg: '#07060c', card: '#1b1a26', a: '#7f1d1d', b: '#1e3a8a' }, palette: null },
  { id: 'mint-gum', label: 'Mint Gum', note: 'Light: fresh mint and bubble-gum pink.', bg: mintGum.bg,
    swatch: { bg: mintGum.bg, card: mintGum.card, a: mintGum.a, b: mintGum.b }, palette: mintGum },
  { id: 'forest', label: 'Forest', note: 'Dark: near-black with a green cast.', bg: forest.bg,
    swatch: { bg: forest.bg, card: forest.card, a: forest.a, b: forest.b }, palette: forest },
];

export const DEFAULT_THEME: ThemeId = 'glass';
export const isThemeId = (v: unknown): v is ThemeId => THEMES.some(t => t.id === v);
const byId = (id: string): Theme => THEMES.find(t => t.id === id) || THEMES[0];

export const listThemes = () => THEMES.map(({ id, label, note, swatch }) => ({ id, label, note, swatch }));

// ---------- CSS ----------
const kebab = (k: string) => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

/**
 * The :root block: the --t-* tokens plus the page's old variables (--bg, --card, --tx, ...) pointed at the palette.
 * `scheme` = also set color-scheme (leave it out for the transparent pop-up pages: a dark colour-scheme would give
 * them an opaque dark backdrop instead of letting the window behind show through).
 */
export function paletteVars(p: Palette, scheme = true): string {
  const t = Object.entries(p).filter(([k]) => k !== 'scheme').map(([k, v]) => `--t-${kebab(k)}:${v}`);
  const legacy = [
    `--bg:${p.bg}`, `--panel:${p.panel}`, `--card:${p.card}`, `--line:${p.line}`,
    `--tx:${p.tx}`, `--mut:${p.mut}`, `--pu:${p.a}`, `--pu2:${p.aText}`,
    `--ok:${p.ok}`, `--bad:${p.bad}`,
  ];
  if (scheme) legacy.push(`color-scheme:${p.scheme}`);
  return `:root{${t.concat(legacy).join(';')}}`;
}

const TRANSPARENT: Page[] = ['menu', 'dlpanel', 'picker']; // pop-ups drawn over the browser window

/** Everything to inject into one kind of page. Empty for "glass". */
export function themeCss(page: Page, id: string): string {
  const th = byId(id);
  return th.palette ? paletteVars(th.palette, !TRANSPARENT.includes(page)) + '\n' + LAYERS[page] : '';
}

export const themeBg = (id: string = current): string => byId(id).bg;

// ---------- the current theme + the windows that follow it ----------
let current: ThemeId = DEFAULT_THEME;
const listeners = new Set<() => void>();
interface Entry { page: Page; only?: (url: string) => boolean; key: string | null; chain: Promise<void> }
const entries = new Map<WebContents, Entry>();

export const themeId = (): ThemeId => current;

/** Switch theme (unknown ids fall back to the default). Every registered window follows at once. Returns the id in use. */
export function setThemeId(id: unknown): ThemeId {
  const next = isThemeId(id) ? id : DEFAULT_THEME;
  if (next === current) return current;
  current = next;
  for (const [wc, e] of entries) queue(wc, e);
  for (const cb of listeners) { try { cb(); } catch { /* a window that is gone */ } }
  return current;
}

/** Called after the theme changed (to repaint window background colours). */
export const onTheme = (cb: () => void): void => { listeners.add(cb); };

function queue(wc: WebContents, e: Entry): Promise<void> {
  e.chain = e.chain.then(() => apply(wc, e)).catch(() => undefined);
  return e.chain;
}

async function apply(wc: WebContents, e: Entry): Promise<void> {
  if (wc.isDestroyed()) return;
  const old = e.key;
  e.key = null;
  if (old) { try { await wc.removeInsertedCSS(old); } catch { /* the page was reloaded */ } }
  if (wc.isDestroyed() || (e.only && !e.only(wc.getURL()))) return;
  const css = themeCss(e.page, current);
  if (css) e.key = await wc.insertCSS(css);
}

/**
 * Make a window follow the theme. `only` limits it to some addresses (browser tabs show any website, and only
 * the new-tab page may be themed). The returned promise resolves once the first page has been styled.
 */
export function themed(wc: WebContents, page: Page, only?: (url: string) => boolean): Promise<void> {
  const e: Entry = { page, only, key: null, chain: Promise.resolve() };
  entries.set(wc, e);
  wc.once('destroyed', () => { entries.delete(wc); });
  return new Promise<void>(resolve => {
    wc.on('dom-ready', () => { e.key = null; queue(wc, e).then(resolve); }); // a (re)loaded page has lost the injected CSS
  });
}
