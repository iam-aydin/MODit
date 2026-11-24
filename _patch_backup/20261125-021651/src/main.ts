import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'path';
import { handlers } from './core';
import { browserSession, downloadApi, init as initDownloads, PARTITION } from './downloads';
import { getIcon } from './icons';
import type { CommandArgs } from './types';

let win: BrowserWindow | null = null;
let browserWin: BrowserWindow | null = null;

const toast = (m: string) => win?.webContents.send('toast', m);

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07060c',
    title: 'MODit',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // the app UI never navigates away or opens windows; links go to the OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('closed', () => { win = null; browserWin?.close(); });
}

// ---------- browser window (Nexus Mods etc.) ----------
function createBrowser(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1150,
    height: 800,
    title: 'MODit Browser',
    backgroundColor: '#ffffff',
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = w.webContents;
  // no address bar, so the menu bar carries back / forward / reload
  w.setMenu(Menu.buildFromTemplate([
    { label: '◀ Back', click: () => { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); } },
    { label: 'Forward ▶', click: () => { if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); } },
    { label: '⟳ Reload', accelerator: 'F5', click: () => wc.reload() },
    { label: 'Downloads', click: () => { win?.show(); win?.focus(); } },
  ]));
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) wc.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (redirects, downloads)
    toast(`Could not open ${url} (${desc})`);
  });
  w.on('closed', () => { browserWin = null; });
  return w;
}

function openBrowser(url: string): void {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) addresses can be opened');
  browserSession(); // makes sure the user agent / download hook are set up
  if (!browserWin || browserWin.isDestroyed()) browserWin = createBrowser();
  browserWin.webContents.loadURL(url).catch(() => undefined); // failures are reported by did-fail-load
  browserWin.show();
  browserWin.focus();
}

// ---------- IPC ----------
type Fn = (a: CommandArgs) => unknown | Promise<unknown>;
const extra: Record<string, Fn> = {
  open_browser: a => { openBrowser(String(a.url)); return null; },
  get_icon: a => getIcon(String(a.url)),
  ...(downloadApi as unknown as Record<string, Fn>),
};

ipcMain.handle('cmd', async (_e, name: string, args: CommandArgs) => {
  const has = (o: object) => Object.prototype.hasOwnProperty.call(o, name);
  const h = has(extra) ? extra[name] : has(handlers) ? handlers[name] : null;
  if (!h) throw new Error(`Unknown command: ${name}`);
  return h(args || {});
});

ipcMain.handle('dialog:open', async (_e, opts: { directory?: boolean; multiple?: boolean; title?: string; filters?: Electron.FileFilter[] }) => {
  const props: Array<'openFile' | 'openDirectory' | 'multiSelections'> = [opts?.directory ? 'openDirectory' : 'openFile'];
  if (opts?.multiple) props.push('multiSelections');
  const r = await dialog.showOpenDialog(win!, { title: opts?.title, filters: opts?.filters, properties: props });
  if (r.canceled || !r.filePaths.length) return null;
  return opts?.multiple ? r.filePaths : r.filePaths[0];
});

ipcMain.handle('dialog:ask', async (_e, message: string) => {
  const r = await dialog.showMessageBox(win!, {
    type: 'warning', title: 'MODit', message: String(message),
    buttons: ['Yes', 'Cancel'], defaultId: 1, cancelId: 1,
  });
  return r.response === 0;
});

// ---------- lifecycle ----------
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { createWindow(); initDownloads(() => win); });
  app.on('window-all-closed', () => app.quit());
}
