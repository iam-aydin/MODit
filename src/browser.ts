import { BrowserWindow, clipboard, ipcMain, WebContents, WebContentsView } from 'electron';
import path from 'path';
import { onTheme, themed, themeBg } from './themes';
import { activeDownloads, browserSession, downloadApi, installDownload, onDownloadEvent, PARTITION, recentDownloads, refreshDownloads } from './downloads';

// The MODit browser: one window with a tab strip + address bar (renderer/browser.html) on top
// and one WebContentsView per tab below it.

const CHROME_H = 84; // tab strip (40) + toolbar (44)
const isNewTab = (url: string) => /[\\/]newtab\.html(?:[?#]|$)/.test(url); // only this page of a tab is themed, never a website

interface Tab {
  id: number;
  view: WebContentsView;
  title: string;
  loading: boolean;
  favicon: string;
  openedBy?: number; // the tab whose link opened this one
}

let win: BrowserWindow | null = null;
let chrome: WebContentsView | null = null;
let tabs: Tab[] = [];
let active = 0;
let nextId = 1;
let getMain: () => BrowserWindow | null = () => null;
// the downloads popup under the toolbar's Downloads button
let dlPanel: WebContentsView | null = null;
let dlOpen = false;
let dlHiddenAt = 0;
let dlHeight = 200;
let dlHideTimer: NodeJS.Timeout | null = null;
let dlAutoTimer: NodeJS.Timeout | null = null;
const DL_W = 360;
// the app-styled right-click menu (a small page in its own view, so it can look like the rest of MODit)
interface MenuItem { label?: string; enabled?: boolean; sep?: boolean; act?: () => void }
let menuView: WebContentsView | null = null;
let menuOpen = false;
let menuItems: MenuItem[] = [];
let menuHideTimer: NodeJS.Timeout | null = null;
const MENU_W = 270;
onTheme(() => {
  if (alive(win)) win.setBackgroundColor(themeBg());
  if (chrome && !chrome.webContents.isDestroyed()) chrome.setBackgroundColor(themeBg());
});

const isWeb = (u: string) => /^https?:\/\//i.test(u);
const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed();
const wcOf = (t: Tab | undefined): WebContents | null => (t && !t.view.webContents.isDestroyed() ? t.view.webContents : null);
const current = () => tabs.find(t => t.id === active);
const toast = (m: string) => getMain()?.webContents.send('toast', m);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const newTabPage = () => path.join(__dirname, 'renderer', 'newtab.html');

/** What was typed in the address bar -> a web address (or a Google search), or null if it is not allowed. */
function normalizeInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (isWeb(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(javascript|data|file|blob|about|chrome|view-source):/i.test(t)) return null;
  if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}([:/?#].*)?$/i.test(t)) return 'https://' + t;
  return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}

function layout(): void {
  if (!alive(win)) return;
  const [w, h] = win.getContentSize();
  chrome?.setBounds({ x: 0, y: 0, width: w, height: CHROME_H });
  current()?.view.setBounds({ x: 0, y: CHROME_H, width: w, height: Math.max(0, h - CHROME_H) });
  placeDl();
  placePick();
  hideMenu();
}

/** Send the tab list + navigation state to the toolbar. */
function push(): void {
  if (!alive(win) || !chrome || chrome.webContents.isDestroyed()) return;
  const t = current();
  const wc = wcOf(t);
  const url = wc ? wc.getURL() : '';
  chrome.webContents.send('br:state', {
    tabs: tabs.map(x => {
      const u = wcOf(x)?.getURL() ?? '';
      return { id: x.id, title: x.title || (isWeb(u) ? hostOf(u) : 'New tab'), loading: x.loading, favicon: x.favicon };
    }),
    active,
    url: isWeb(url) ? url : '',
    dls: activeDownloads(),
    canBack: !!wc && wc.navigationHistory.canGoBack(),
    canForward: !!wc && wc.navigationHistory.canGoForward(),
  });
  win.setTitle(t && t.title ? `${t.title} - MODit Browser` : 'MODit Browser');
}

function focusAddress(): void {
  if (!chrome || chrome.webContents.isDestroyed()) return;
  chrome.webContents.focus();
  chrome.webContents.send('br:focus');
}

function activate(id: number): void {
  const t = tabs.find(x => x.id === id);
  if (!t || !alive(win)) return;
  active = id;
  for (const x of tabs) { try { win.contentView.removeChildView(x.view); } catch { /* was not attached */ } }
  win.contentView.addChildView(t.view);
  hideMenu();
  if (dlOpen && dlPanel) win.contentView.addChildView(dlPanel); // the popup stays on top of the page
  layout();
  push();
  const wc = wcOf(t);
  if (wc && isWeb(wc.getURL())) wc.focus(); else focusAddress();
}

/** New tabs open right after the tab they came from (and after that tab's earlier children). */
function insertIndex(openerId?: number): number {
  if (openerId == null) return tabs.length;
  let i = tabs.findIndex(t => t.id === openerId);
  if (i < 0) return tabs.length;
  while (i + 1 < tabs.length && tabs[i + 1].openedBy === openerId) i++;
  return i + 1;
}

function openTab(url: string | null, o: { foreground?: boolean; opener?: number } = {}): Tab {
  const view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const tab: Tab = { id: nextId++, view, title: '', loading: false, favicon: '', openedBy: o.opener };
  tabs.splice(insertIndex(o.opener), 0, tab);
  themed(view.webContents, 'newtab', isNewTab);
  wire(tab);
  if (url) view.webContents.loadURL(url).catch(() => undefined); // failures are reported by did-fail-load
  else view.webContents.loadFile(newTabPage()).catch(() => undefined);
  if (o.foreground !== false || tabs.length === 1) activate(tab.id); else push();
  return tab;
}

function closeTab(id: number): void {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  if (alive(win)) { try { win.contentView.removeChildView(t.view); } catch { /* ignore */ } }
  if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
  if (!tabs.length) { if (alive(win)) win.close(); return; }
  if (id === active) activate((tabs[i] ?? tabs[i - 1]).id); else push();
}

function cycle(d: number): void {
  if (tabs.length < 2) return;
  const i = tabs.findIndex(t => t.id === active);
  activate(tabs[(i + d + tabs.length) % tabs.length].id);
}

/** Browser-style shortcuts, for the toolbar and for every tab. */
function hookKeys(wc: WebContents): void {
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const ctrl = i.control || i.meta;
    const k = i.key.toLowerCase();
    const t = current();
    const page = wcOf(t);
    let hit = true;
    if (ctrl && k === 't') openTab(null);
    else if (ctrl && k === 'w') { if (t) closeTab(t.id); }
    else if (ctrl && k === 'tab') cycle(i.shift ? -1 : 1);
    else if (ctrl && k === 'l') focusAddress();
    else if (k === 'f5' || (ctrl && k === 'r')) page?.reload();
    else if (i.alt && k === 'arrowleft') { if (page?.navigationHistory.canGoBack()) page.navigationHistory.goBack(); }
    else if (i.alt && k === 'arrowright') { if (page?.navigationHistory.canGoForward()) page.navigationHistory.goForward(); }
    else hit = false;
    if (hit) e.preventDefault();
  });
}

/** Right-click menu inside a page. */
function showMenu(tab: Tab, p: Electron.ContextMenuParams): void {
  const wc = tab.view.webContents;
  const items: MenuItem[] = [];
  const link = p.linkURL;
  const sep = () => { if (items.length && !items[items.length - 1].sep) items.push({ sep: true }); };
  if (link && isWeb(link)) {
    items.push(
      { label: 'Open link in new tab', act: () => openTab(link, { foreground: false, opener: tab.id }) },
      { label: 'Open link in new tab and switch to it', act: () => openTab(link, { opener: tab.id }) },
      { label: 'Copy link address', act: () => clipboard.writeText(link) },
    );
    sep();
  }
  if (p.mediaType === 'image' && isWeb(p.srcURL)) {
    items.push(
      { label: 'Open image in new tab', act: () => openTab(p.srcURL, { foreground: false, opener: tab.id }) },
      { label: 'Copy image address', act: () => clipboard.writeText(p.srcURL) },
    );
    sep();
  }
  if (p.isEditable) {
    items.push(
      { label: 'Cut', enabled: p.editFlags.canCut, act: () => { wc.focus(); wc.cut(); } },
      { label: 'Copy', enabled: p.editFlags.canCopy, act: () => { wc.focus(); wc.copy(); } },
      { label: 'Paste', enabled: p.editFlags.canPaste, act: () => { wc.focus(); wc.paste(); } },
    );
    sep();
  } else if (p.selectionText) {
    items.push({ label: 'Copy', act: () => { wc.focus(); wc.copy(); } });
    sep();
  }
  items.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), act: () => wc.navigationHistory.goBack() },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), act: () => wc.navigationHistory.goForward() },
    { label: 'Reload', act: () => wc.reload() },
  );
  popupMenu(items, p.x, p.y + CHROME_H); // the page view starts below the toolbar
}

/** Right-click menu in the address bar. */
function showAddressMenu(p: Electron.ContextMenuParams): void {
  const c = chrome?.webContents;
  if (!c || !p.isEditable) return;
  popupMenu([
    { label: 'Cut', enabled: p.editFlags.canCut, act: () => { c.focus(); c.cut(); } },
    { label: 'Copy', enabled: p.editFlags.canCopy, act: () => { c.focus(); c.copy(); } },
    { label: 'Paste', enabled: p.editFlags.canPaste, act: () => { c.focus(); c.paste(); } },
    { sep: true },
    { label: 'Select all', act: () => { c.focus(); c.selectAll(); } },
  ], p.x, p.y);
}

function wire(tab: Tab): void {
  const wc = tab.view.webContents;
  // middle-click / ctrl+click on a link => background tab; target=_blank and popups => foreground tab
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (isWeb(url)) openTab(url, { foreground: disposition !== 'background-tab', opener: tab.id });
    return { action: 'deny' };
  });
  wc.on('page-title-updated', (_e, title) => { tab.title = title; push(); });
  wc.on('page-favicon-updated', (_e, icons) => { tab.favicon = icons[0] || ''; push(); });
  wc.on('did-start-loading', () => { tab.loading = true; push(); });
  wc.on('did-stop-loading', () => { tab.loading = false; push(); });
  wc.on('did-navigate', () => push());
  wc.on('did-navigate-in-page', () => push());
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (redirects, downloads)
    toast(`Could not open ${url} (${desc})`);
  });
  wc.on('context-menu', (_e, p) => showMenu(tab, p));
  hookKeys(wc);
}

function create(): void {
  const w = new BrowserWindow({ width: 1250, height: 850, minWidth: 640, minHeight: 420, title: 'MODit Browser', backgroundColor: themeBg() });
  win = w;
  w.removeMenu();
  const c = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'browser-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  chrome = c;
  c.setBackgroundColor(themeBg());
  themed(c.webContents, 'browser');
  w.contentView.addChildView(c);
  c.webContents.loadFile(path.join(__dirname, 'renderer', 'browser.html')).catch(() => undefined);
  c.webContents.on('will-navigate', e => e.preventDefault());
  c.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  c.webContents.on('context-menu', (_e, p) => showAddressMenu(p));
  hookKeys(c.webContents);
  w.on('resize', layout);
  w.on('maximize', layout);
  w.on('unmaximize', layout);
  w.on('restore', layout);
  w.on('enter-full-screen', layout);
  w.on('leave-full-screen', layout);
  w.on('closed', () => {
    closePick(null);
    for (const t of tabs) if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    if (!c.webContents.isDestroyed()) c.webContents.close();
    tabs = [];
    if (dlPanel && !dlPanel.webContents.isDestroyed()) dlPanel.webContents.close();
    if (menuView && !menuView.webContents.isDestroyed()) menuView.webContents.close();
    dlPanel = null;
    menuView = null;
    dlOpen = false;
    menuOpen = false;
    chrome = null;
    win = null;
    active = 0;
  });
  layout();
}

// ---------- downloads popup ----------
function placeDl(): void {
  if (!alive(win) || !dlPanel || !dlOpen) return;
  const [w, h] = win.getContentSize();
  const ph = Math.min(dlHeight, Math.max(120, h - CHROME_H - 12));
  dlPanel.setBounds({ x: Math.max(0, w - DL_W - 10), y: CHROME_H, width: DL_W, height: ph });
}

function hideDl(): void {
  if (!dlOpen) return;
  dlOpen = false;
  dlHiddenAt = Date.now();
  if (dlAutoTimer) { clearTimeout(dlAutoTimer); dlAutoTimer = null; }
  const v = dlPanel;
  if (!v || v.webContents.isDestroyed()) return;
  v.webContents.send('dl:close'); // the page plays its closing animation, then the view is taken away
  dlHideTimer = setTimeout(() => {
    dlHideTimer = null;
    if (!dlOpen && alive(win)) { try { win.contentView.removeChildView(v); } catch { /* not attached */ } }
  }, 230);
}

function showDl(focus = true): void {
  if (!alive(win)) return;
  if (dlHideTimer) { clearTimeout(dlHideTimer); dlHideTimer = null; }
  if (!dlPanel || dlPanel.webContents.isDestroyed()) {
    dlPanel = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'dlpanel-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    dlPanel.setBackgroundColor('#00000000');
    themed(dlPanel.webContents, 'dlpanel');
    dlPanel.webContents.loadFile(path.join(__dirname, 'renderer', 'dlpanel.html')).catch(() => undefined);
    dlPanel.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'Escape') { e.preventDefault(); hideDl(); } });
  }
  refreshDownloads();
  dlOpen = true;
  win.contentView.addChildView(dlPanel);
  placeDl();
  if (focus) { if (dlAutoTimer) { clearTimeout(dlAutoTimer); dlAutoTimer = null; } dlPanel.webContents.focus(); }
  dlPanel.webContents.send('dl:open');
}

/** A download just started: pop the list open for a few seconds (without taking focus from the page). */
onDownloadEvent((kind) => {
  push();
  if (kind !== 'start' || !alive(win)) return;
  showDl(false);
  if (dlAutoTimer) clearTimeout(dlAutoTimer);
  dlAutoTimer = setTimeout(() => { dlAutoTimer = null; hideDl(); }, 5000);
});

/** Bring the main MODit window forward and open its Downloads section. */
function openAppDownloads(): void {
  const m = getMain();
  if (m && !m.isDestroyed()) {
    if (m.isMinimized()) m.restore();
    m.show();
    m.focus();
    m.webContents.send('goto', 'downloads');
  }
}

const fromDl = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!dlPanel && !dlPanel.webContents.isDestroyed() && e.sender === dlPanel.webContents;
ipcMain.handle('br:dl', (e, name: string, id?: string) => {
  if (!fromDl(e)) return null;
  switch (name) {
    case 'list': return recentDownloads();
    case 'show': downloadApi.show_download({ dlId: String(id) }); return null;
    case 'cancel': downloadApi.cancel_download({ dlId: String(id) }); return null;
    case 'install': hideDl(); installDownload(String(id)); return null; // the question appears on top of this window, the app stays where it is
    case 'all': hideDl(); openAppDownloads(); return null;
  }
  return null;
});
ipcMain.on('br:dl-size', (e, h: number) => { if (fromDl(e) && Number.isFinite(h)) { dlHeight = Math.min(480, Math.max(100, Math.ceil(h))); placeDl(); } });
ipcMain.on('br:dl-blur', e => { if (fromDl(e) && !dlAutoTimer) hideDl(); }); // clicked somewhere else
ipcMain.on('br:dl-keep', e => { // the mouse is over the popup: keep it open and let it take focus
  if (!fromDl(e)) return;
  if (dlAutoTimer) { clearTimeout(dlAutoTimer); dlAutoTimer = null; }
  if (dlOpen) dlPanel?.webContents.focus();
});
ipcMain.on('br:dl-ready', e => { if (fromDl(e) && dlOpen) e.sender.send('dl:open'); });

// ---------- "who is this mod for?" (Dead or Alive 5 and other games that need a choice) ----------
interface PickOpts { title: string; items: Array<{ v: string; l: string; c?: number }>; selected?: string | string[]; multi?: boolean; okLabel?: string; allowEmpty?: boolean; profile?: string; profiles?: string[] }
type PickValue = string | string[] | null;
let pickView: WebContentsView | null = null;
let pickResolve: ((v: PickValue, profile?: string) => void) | null = null;
let pickOpts: PickOpts | null = null;

function placePick(): void {
  if (!alive(win) || !pickView || pickView.webContents.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  pickView.setBounds({ x: 0, y: 0, width: w, height: h });
}

function closePick(value: PickValue, profile?: string): void {
  const v = pickView, r = pickResolve;
  pickView = null; pickResolve = null; pickOpts = null;
  if (v) {
    try { if (alive(win)) win.contentView.removeChildView(v); } catch { /* not attached */ }
    if (!v.webContents.isDestroyed()) v.webContents.close();
  }
  r?.(value, profile);
}

/**
 * Asks the question on top of the browser window (so the user does not have to leave the page they downloaded from).
 * available:false = the browser is not open or the main window is the one in front: the app shows its own dialog then.
 */
export function pickTarget(opts: PickOpts): Promise<{ available: boolean; value: PickValue; profile?: string }> {
  const main = getMain();
  if (!alive(win) || (alive(main) && main.isFocused())) return Promise.resolve({ available: false, value: null });
  closePick(null);
  return new Promise(resolve => {
    const w = win!;
    pickResolve = (value, profile) => resolve({ available: true, value, profile });
    pickOpts = opts;
    const v = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    v.setBackgroundColor('#00000000');
    themed(v.webContents, 'picker');
    pickView = v;
    v.webContents.loadFile(path.join(__dirname, 'renderer', 'picker.html')).catch(() => undefined);
    w.contentView.addChildView(v);
    placePick();
    v.webContents.focus();
  });
}

const fromPick = (e: Electron.IpcMainEvent) => !!pickView && !pickView.webContents.isDestroyed() && e.sender === pickView.webContents;
ipcMain.on('br:pick-ready', e => { if (fromPick(e) && pickOpts) e.sender.send('pick:show', pickOpts); });
ipcMain.on('br:pick-done', (e, v: unknown, profile: unknown) => {
  if (!fromPick(e)) return;
  closePick(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? v : null, typeof profile === 'string' ? profile : undefined);
});

// ---------- right-click menu ----------
const menuHeight = (items: MenuItem[]) => 18 + items.reduce((n, i) => n + (i.sep ? 11 : 34), 0);

function sendMenu(): void {
  if (!menuView || menuView.webContents.isDestroyed() || !menuOpen) return;
  menuView.webContents.send('menu:show', menuItems.map(i => ({ label: i.label, enabled: i.enabled !== false, sep: !!i.sep })));
}

function hideMenu(): void {
  if (!menuOpen) return;
  menuOpen = false;
  const v = menuView;
  if (!v || v.webContents.isDestroyed()) return;
  v.webContents.send('menu:close');
  menuHideTimer = setTimeout(() => {
    menuHideTimer = null;
    if (!menuOpen && alive(win)) { try { win.contentView.removeChildView(v); } catch { /* not attached */ } }
  }, 230);
}

/** Show a menu with its top-left corner at (x, y) in window coordinates. */
function popupMenu(items: MenuItem[], x: number, y: number): void {
  if (!alive(win) || !items.length) return;
  if (menuHideTimer) { clearTimeout(menuHideTimer); menuHideTimer = null; }
  if (!menuView || menuView.webContents.isDestroyed()) {
    menuView = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'menu-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    menuView.setBackgroundColor('#00000000');
    themed(menuView.webContents, 'menu');
    menuView.webContents.loadFile(path.join(__dirname, 'renderer', 'menu.html')).catch(() => undefined);
  }
  menuItems = items;
  const [w, h] = win.getContentSize();
  const mh = menuHeight(items);
  menuOpen = true;
  win.contentView.addChildView(menuView);
  menuView.setBounds({ x: Math.max(4, Math.min(x, w - MENU_W - 4)), y: Math.max(4, Math.min(y, h - mh - 4)), width: MENU_W, height: mh });
  menuView.webContents.focus();
  sendMenu();
}

const fromMenu = (e: Electron.IpcMainEvent) => !!menuView && !menuView.webContents.isDestroyed() && e.sender === menuView.webContents;
ipcMain.on('br:menu-ready', e => { if (fromMenu(e)) sendMenu(); });
ipcMain.on('br:menu-blur', e => { if (fromMenu(e)) hideMenu(); });
ipcMain.on('br:menu-pick', (e, i: number) => {
  if (!fromMenu(e)) return;
  const it = menuItems[Number(i)];
  hideMenu();
  if (it && !it.sep && it.enabled !== false) { try { it.act?.(); } catch { /* ignore */ } }
});

// ---------- commands from the toolbar ----------
ipcMain.on('br', (e, name: string, arg: unknown) => {
  if (!chrome || chrome.webContents.isDestroyed() || e.sender !== chrome.webContents) return;
  const t = current();
  const wc = wcOf(t);
  switch (name) {
    case 'ready': push(); break;
    case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': if (t?.loading) wc?.stop(); else wc?.reload(); break;
    case 'go': {
      const u = normalizeInput(String(arg ?? ''));
      if (!u) { toast('Only web addresses (http/https) can be opened'); break; }
      if (wc) { wc.loadURL(u).catch(() => undefined); wc.focus(); }
      break;
    }
    case 'new': openTab(null); break;
    case 'close': closeTab(Number(arg)); break;
    case 'activate': activate(Number(arg)); break;
    case 'downloads':
      // toggles the popup; a click that just closed it (by moving focus) must not reopen it
      if (dlOpen) hideDl(); else if (Date.now() - dlHiddenAt > 300) showDl();
      break;
  }
});

// ---------- API for main.ts ----------
/** Open an address in the browser window (as a new tab; an empty tab is reused). */
export function openBrowser(url: string, main: () => BrowserWindow | null): void {
  if (!isWeb(url)) throw new Error('Only http(s) addresses can be opened');
  getMain = main;
  browserSession(); // makes sure the user agent / download hook are set up
  if (!alive(win)) {
    create();
    openTab(url);
  } else {
    const t = current();
    const wc = wcOf(t);
    if (t && wc && !t.loading && !isWeb(wc.getURL())) wc.loadURL(url).catch(() => undefined);
    else openTab(url);
  }
  const w = win!;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

export function closeBrowser(): void { if (alive(win)) win.close(); }

/** Dev mode: pick up edits to browser.html. */
export function reloadBrowserChrome(): void {
  if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.reloadIgnoringCache();
}