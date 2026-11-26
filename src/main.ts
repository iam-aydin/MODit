import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { handlers, reapplyDb, refreshRemoteDb } from './core';
import { initCovers, registerCoverProtocol, registerCoverScheme } from './covers';
import { closeDb, getDb, getSetting } from './db';
import { onTheme, setGlass, setThemeId, themeBg, themed } from './themes';
import { libraryApi } from './library';
import { closeBrowser, openBrowser, pickTarget, reloadBrowserChrome } from './browser';
import { downloadApi, init as initDownloads } from './downloads';
import { getIcon } from './icons';
import { playGame } from './launch';
import type { CommandArgs } from './types';

let win: BrowserWindow | null = null;

const toast = (m: string) => win?.webContents.send('toast', m);

onTheme(() => { if (win && !win.isDestroyed()) win.setBackgroundColor(themeBg()); });

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: themeBg(),
    show: false, // shown once the page is drawn in the chosen theme, so there is no flash of the wrong colours
    title: 'MODit',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const w = win;
  let shown = false;
  const reveal = () => { if (!shown && !w.isDestroyed()) { shown = true; w.show(); } };
  Promise.all([new Promise<void>(r => w.once('ready-to-show', () => r())), themed(w.webContents, 'main')]).then(reveal);
  setTimeout(reveal, 3000); // never leave the window hidden, whatever happens
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // `npm run dev`: refresh the UI whenever dist/renderer changes
  if (process.env.MODIT_DEV) {
    let t: NodeJS.Timeout | undefined;
    fs.watch(path.join(__dirname, 'renderer'), () => {
      clearTimeout(t);
      t = setTimeout(() => { win?.webContents.reloadIgnoringCache(); reloadBrowserChrome(); }, 150);
    });
  }

  // the app UI never navigates away or opens windows; links go to the OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('closed', () => { win = null; closeBrowser(); });
}

// ---------- IPC ----------
type Fn = (a: CommandArgs) => unknown | Promise<unknown>;
const extra: Record<string, Fn> = {
  ...libraryApi,
  open_browser: a => { openBrowser(String(a.url), () => win); return null; },
  play_game: a => playGame(a),
  pick_target: a => pickTarget({ title: String(a.title || ''), items: Array.isArray(a.items) ? a.items : [], selected: a.selected, multi: !!a.multi, okLabel: a.okLabel, allowEmpty: !!a.allowEmpty, profile: a.profile ? String(a.profile) : undefined, profiles: Array.isArray(a.profiles) ? a.profiles.map(String) : undefined }),
  get_icon: a => getIcon(String(a.url)),
  ...(downloadApi as unknown as Record<string, Fn>),
};

ipcMain.handle('cmd', async (_e, name: string, args: CommandArgs) => {
  const has = (o: object) => Object.prototype.hasOwnProperty.call(o, name);
  const h = has(extra) ? extra[name] : has(handlers) ? handlers[name] : null;
  if (!h) throw new Error(`Unknown command: ${name}`);
  return h(args || {});
});

ipcMain.handle('dialog:open', async (_e, opts: { directory?: boolean; multiple?: boolean; title?: string; defaultPath?: string; filters?: Electron.FileFilter[] }) => {
  const props: Array<'openFile' | 'openDirectory' | 'multiSelections'> = [opts?.directory ? 'openDirectory' : 'openFile'];
  if (opts?.multiple) props.push('multiSelections');
  const r = await dialog.showOpenDialog(win!, { title: opts?.title, defaultPath: opts?.defaultPath, filters: opts?.filters, properties: props });
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
registerCoverScheme(); // modit://cover/<file> shows the cover pictures; must be declared before the app is ready

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    try { getDb(); } // opens (and creates / upgrades) modit.db
    catch (e) {
      dialog.showErrorBox('MODit cannot open its database',
        'The SQLite module could not be loaded. Run "npm install" in the MODit folder (it rebuilds the module for Electron) and start MODit again.\n\n' + String((e as Error)?.message || e));
      app.quit();
      return;
    }
    registerCoverProtocol();
    try { reapplyDb(); } catch (e) { console.error('Game database:', e); } // saved copy + bundled file, instant
    try { setThemeId(getSetting('theme')); } catch (e) { console.error('Theme:', e); }
    try { setGlass(getSetting('glass') === '1'); } catch (e) { console.error('Glass:', e); }
    createWindow();
    initDownloads(() => win);
    initCovers(() => win);
    // newest game database from GitHub, in the background; offline just keeps the saved copy
    refreshRemoteDb().then(ok => {
      if (!ok) return;
      try { if (reapplyDb() > 0) toast('Game database updated. Restart MODit to apply it to your games.'); } catch (e) { console.error('Game database:', e); }
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', closeDb);
}
