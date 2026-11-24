import { BrowserWindow, clipboard, ipcMain, Menu, WebContents, WebContentsView } from 'electron';
import path from 'path';
import { browserSession, PARTITION } from './downloads';

// The MODit browser: one window with a tab strip + address bar (renderer/browser.html) on top
// and one WebContentsView per tab below it.

const CHROME_H = 84; // tab strip (40) + toolbar (44)

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
  const items: Electron.MenuItemConstructorOptions[] = [];
  const link = p.linkURL;
  if (link && isWeb(link)) {
    items.push(
      { label: 'Open link in new tab', click: () => openTab(link, { foreground: false, opener: tab.id }) },
      { label: 'Open link in new tab and switch to it', click: () => openTab(link, { opener: tab.id }) },
      { label: 'Copy link address', click: () => clipboard.writeText(link) },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'image' && isWeb(p.srcURL)) {
    items.push(
      { label: 'Open image in new tab', click: () => openTab(p.srcURL, { foreground: false, opener: tab.id }) },
      { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
      { type: 'separator' },
    );
  }
  if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
  else if (p.selectionText) items.push({ role: 'copy' }, { type: 'separator' });
  items.push(
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Reload', click: () => wc.reload() },
  );
  Menu.buildFromTemplate(items).popup({ window: win ?? undefined });
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
  const w = new BrowserWindow({ width: 1250, height: 850, minWidth: 640, minHeight: 420, title: 'MODit Browser', backgroundColor: '#0b0912' });
  win = w;
  w.removeMenu();
  const c = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'browser-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  chrome = c;
  w.contentView.addChildView(c);
  c.webContents.loadFile(path.join(__dirname, 'renderer', 'browser.html')).catch(() => undefined);
  c.webContents.on('will-navigate', e => e.preventDefault());
  c.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  hookKeys(c.webContents);
  w.on('resize', layout);
  w.on('maximize', layout);
  w.on('unmaximize', layout);
  w.on('restore', layout);
  w.on('enter-full-screen', layout);
  w.on('leave-full-screen', layout);
  w.on('closed', () => {
    for (const t of tabs) if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    if (!c.webContents.isDestroyed()) c.webContents.close();
    tabs = [];
    chrome = null;
    win = null;
    active = 0;
  });
  layout();
}

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
    case 'downloads': {
      const m = getMain();
      if (m && !m.isDestroyed()) {
        if (m.isMinimized()) m.restore();
        m.show();
        m.focus();
        m.webContents.send('goto', 'downloads');
      }
      break;
    }
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
