import { handlers } from './core';
import { fetchNow, removeCoverFile, resetCover, scheduleCovers, setCustomCover } from './covers';
import { addGame, deleteGame, getGame, loadAll, saveData, setSetting, updateGame } from './db';
import type { CommandArgs } from './types';
import { listThemes, setGlass, setThemeId } from './themes';
import { app } from 'electron';
import fs from 'fs';
import { databaseExe, findGameExe } from './launch';

const gameIconCache = new Map<string, string>(); // exe path -> data: URL

// Commands that read and write the game library (SQLite). main.ts adds them to the UI's command table.
type Fn = (a: CommandArgs) => unknown | Promise<unknown>;

const need = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null || v === '') throw new Error(`Missing ${what}`);
  return v;
};

export const libraryApi: Record<string, Fn> = {
  load_state: () => loadAll(),

  /** The colour themes for the picker in Settings. */
  list_themes: () => listThemes(),

  /** Icon of the game's program (the one the user picked, else the .exe found in its folder) as a data: URL. */
  get_game_icon: async a => {
    const g = getGame(need(a.id, 'id'));
    if (!g) return null;
    let exe: string | null = g.exe && /\.exe$/i.test(g.exe) && fs.existsSync(g.exe) ? g.exe : null;
    if (!exe && g.path && fs.existsSync(g.path)) exe = databaseExe(g.path) || findGameExe(g.path, g.name);
    if (!exe) return null;
    const hit = gameIconCache.get(exe);
    if (hit) return hit;
    try {
      const img = await app.getFileIcon(exe, { size: 'large' });
      if (img.isEmpty()) return null;
      const url = img.toDataURL();
      gameIconCache.set(exe, url);
      return url;
    } catch { return null; }
  },

  /** The active game and the saved sites (small, so they are written together). */
  save_meta: a => {
    setSetting('activeGame', a.game || '');
    if (Array.isArray(a.sites)) setSetting('sites', JSON.stringify(a.sites));
    return null;
  },

  add_game: a => {
    const g = need(a.rec, 'game');
    addGame(g, need(a.data, 'data'));
    scheduleCovers(4000); // the cover is looked up a moment later, never while the game is being added
    return null;
  },

  save_data: a => { saveData(need(a.id, 'id'), need(a.data, 'data')); return null; },

  rename_game: a => {
    const id = need(a.id, 'id'), name = need(String(a.name || '').trim(), 'name');
    const g = getGame(id);
    if (!g) throw new Error('Game not found');
    updateGame(id, { name, ...(g.cover ? {} : { coverTried: 0 }) });
    if (!g.cover) scheduleCovers(1500); // a corrected title may find a cover now
    return null;
  },

  set_game_exe: a => { updateGame(need(a.id, 'id'), { exe: a.exe || '' }); return null; },

  set_cover: a => setCustomCover(need(a.id, 'id'), a.bytes ? { bytes: a.bytes } : { file: need(a.path, 'path') }),
  reset_cover: a => { resetCover(need(a.id, 'id')); return null; },
  fetch_covers: () => fetchNow(),

  set_setting: a => {
    const key = need(a.key, 'key');
    if (key !== 'sgdbKey' && key !== 'skipBrowserWarn' && key !== 'theme' && key !== 'glass') throw new Error('Unknown setting');
    if (key === 'theme') { setSetting(key, setThemeId(a.value)); return null; } // every MODit window repaints at once
    if (key === 'glass') { const on = String(a.value) === '1' || String(a.value) === 'true'; setSetting(key, on ? '1' : '0'); setGlass(on); return null; } // every MODit window repaints at once
    setSetting(key, String(a.value ?? ''));
    if (key === 'sgdbKey') { fetchNow(); }
    return null;
  },

  /** Takes the game's mods out of its folder (core), then its row, mods and cover out of the database. */
  remove_game: async a => {
    const id = need(a.game, 'game');
    const g = getGame(id);
    await handlers.remove_game(a);
    deleteGame(id);
    removeCoverFile(g?.cover);
    return null;
  },
};
