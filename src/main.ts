import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { handlers } from './core';
import { initCovers, registerCoverProtocol, registerCoverScheme } from './covers';
import { closeDb, getDb } from './db';
import { libraryApi } from './library';
import { closeBrowser, openBrowser, reloadBrowserChrome } from './browser';
import { downloadApi, init as initDownloads } from './downloads';
import { getIcon } from './icons';
import { playGame } from './launch';
import type { CommandArgs } from './types';

let win: BrowserWindow | null = null;

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
    createWindow();
    initDownloads(() => win);
    initCovers(() => win);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', closeDb);
}
