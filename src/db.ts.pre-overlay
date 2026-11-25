import { app } from 'electron';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { AppState, Game, GameData, Settings } from './types';

// All games, their mods/profiles and the app settings live in one SQLite file: <userData>/modit.db
// SQLite reads and writes only the rows it needs, so 500+ games stay as fast as 5.
//
//   games      one row per game (name is indexed)
//   game_data  the mods + profiles of one game, as JSON (written only when that game changes)
//   settings   key/value pairs (API key, saved sites, ...)

const userData = () => app.getPath('userData');
export const dbFile = () => path.join(userData(), 'modit.db');
export const coversDir = () => path.join(userData(), 'covers');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games(
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL DEFAULT '',
  mods_dir     TEXT NOT NULL DEFAULT '',
  mod_folder   TEXT,
  exe          TEXT NOT NULL DEFAULT '',
  cover        TEXT,
  cover_custom INTEGER NOT NULL DEFAULT 0,
  cover_tried  INTEGER NOT NULL DEFAULT 0,
  added_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_name ON games(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS game_data(
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  data    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(userData(), { recursive: true });
  const d = new Database(dbFile());
  d.pragma('journal_mode = WAL');
  d.pragma('synchronous = NORMAL');
  d.pragma('foreign_keys = ON');
  d.exec(SCHEMA);
  db = d;
  importLegacyState();
  return d;
}

export function closeDb(): void {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
}

// ---------- settings ----------
export const getSetting = (key: string): string | null => {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r ? r.value : null;
};

export const setSetting = (key: string, value: string): void => {
  getDb().prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
};

export function getSettings(): Settings {
  return { sgdbKey: getSetting('sgdbKey') || '', skipBrowserWarn: getSetting('skipBrowserWarn') === '1' };
}

// ---------- games ----------
interface Row {
  id: string; name: string; path: string; mods_dir: string; mod_folder: string | null; exe: string;
  cover: string | null; cover_custom: number;
}

const toGame = (r: Row): Game => {
  const g: Game = { id: r.id, name: r.name, path: r.path, modsDir: r.mods_dir, exe: r.exe, cover: r.cover, coverCustom: !!r.cover_custom };
  if (r.mod_folder !== null) g.modFolder = r.mod_folder; // null = "use the default"
  return g;
};

const blankData = (): GameData => ({ mods: [], profiles: { Default: {} }, active: 'Default' });

/** Everything the UI needs when it starts. */
export function loadAll(): AppState {
  const d = getDb();
  const games = (d.prepare('SELECT * FROM games ORDER BY added_at, rowid').all() as Row[]).map(toGame);
  const data: Record<string, GameData> = {};
  for (const r of d.prepare('SELECT game_id, data FROM game_data').all() as Array<{ game_id: string; data: string }>) {
    try { data[r.game_id] = JSON.parse(r.data); } catch { /* damaged row: replaced below */ }
  }
  for (const g of games) if (!data[g.id]) data[g.id] = blankData();
  let sites: AppState['sites'] = null;
  try { const s = JSON.parse(getSetting('sites') || 'null'); if (Array.isArray(s)) sites = s; } catch { /* use the defaults */ }
  const active = getSetting('activeGame');
  return { v: 2, game: active && games.some(g => g.id === active) ? active : null, games, data, sites, settings: getSettings() };
}

export function addGame(g: Game, data: GameData): void {
  const d = getDb();
  d.transaction(() => {
    d.prepare(`INSERT INTO games(id, name, path, mods_dir, mod_folder, exe, cover, cover_custom, cover_tried, added_at)
               VALUES(@id, @name, @path, @mods_dir, @mod_folder, @exe, NULL, 0, 0, @added_at)
               ON CONFLICT(id) DO NOTHING`).run({
      id: g.id, name: g.name, path: g.path || '', mods_dir: g.modsDir || '',
      mod_folder: g.modFolder ?? null, exe: g.exe || '', added_at: Date.now(),
    });
    d.prepare('INSERT OR REPLACE INTO game_data(game_id, data) VALUES(?, ?)').run(g.id, JSON.stringify(data));
  })();
}

export function saveData(id: string, data: GameData): void {
  // the games row must exist (foreign key); ignore saves for a game that was just removed
  getDb().prepare('INSERT INTO game_data(game_id, data) SELECT ?, ? WHERE EXISTS(SELECT 1 FROM games WHERE id = ?) ON CONFLICT(game_id) DO UPDATE SET data = excluded.data')
    .run(id, JSON.stringify(data), id);
}

export const getGame = (id: string): (Game & { coverTried: number }) | null => {
  const r = getDb().prepare('SELECT *, cover_tried AS tried FROM games WHERE id = ?').get(id) as (Row & { tried: number }) | undefined;
  return r ? { ...toGame(r), coverTried: r.tried } : null;
};

export interface GamePatch { name?: string; exe?: string; cover?: string | null; coverCustom?: boolean; coverTried?: number }

export function updateGame(id: string, p: GamePatch): void {
  const sets: string[] = [];
  const v: Record<string, unknown> = { id };
  if (p.name !== undefined) { sets.push('name = @name'); v.name = p.name; }
  if (p.exe !== undefined) { sets.push('exe = @exe'); v.exe = p.exe; }
  if (p.cover !== undefined) { sets.push('cover = @cover'); v.cover = p.cover; }
  if (p.coverCustom !== undefined) { sets.push('cover_custom = @cc'); v.cc = p.coverCustom ? 1 : 0; }
  if (p.coverTried !== undefined) { sets.push('cover_tried = @ct'); v.ct = p.coverTried; }
  if (sets.length) getDb().prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = @id`).run(v);
}

export function deleteGame(id: string): void {
  getDb().prepare('DELETE FROM games WHERE id = ?').run(id); // game_data goes with it (ON DELETE CASCADE)
}

/** Games that still have no cover and are due for another look (the user's own covers are never touched). */
export function gamesNeedingCover(retryAfterMs: number): Array<{ id: string; name: string; path: string }> {
  return getDb().prepare('SELECT id, name, path FROM games WHERE cover IS NULL AND cover_custom = 0 AND cover_tried < ? ORDER BY added_at, rowid')
    .all(Date.now() - retryAfterMs) as Array<{ id: string; name: string; path: string }>;
}

/** Makes every game without a cover eligible for another attempt right away. */
export function allowCoverRetry(): void {
  getDb().prepare('UPDATE games SET cover_tried = 0 WHERE cover IS NULL AND cover_custom = 0').run();
}

export function coversInUse(): Set<string> {
  const rows = getDb().prepare('SELECT cover FROM games WHERE cover IS NOT NULL').all() as Array<{ cover: string }>;
  return new Set(rows.map(r => r.cover));
}

// ---------- one-time import of the old state.json ----------
function importLegacyState(): void {
  if (getSetting('legacyImported')) return;
  const file = path.join(userData(), 'state.json');
  try {
    if (fs.existsSync(file)) {
      const st = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppState> & { sites?: AppState['sites'] };
      const d = getDb();
      d.transaction(() => {
        let t = Date.now();
        for (const g of Array.isArray(st.games) ? st.games : []) {
          if (!g || !g.id || !g.name) continue;
          addGame({ ...g, path: g.path || '', modsDir: g.modsDir || '' }, (st.data && st.data[g.id]) || blankData());
          d.prepare('UPDATE games SET added_at = ? WHERE id = ?').run(t++, g.id); // keep the old order
        }
        if (st.game) setSetting('activeGame', st.game);
        if (Array.isArray(st.sites)) setSetting('sites', JSON.stringify(st.sites));
      })();
      try { fs.renameSync(file, file + '.imported'); } catch { /* keeping it is harmless */ }
    }
  } catch (e) {
    console.error('Could not import the old state.json:', e); // the file stays where it is
  }
  setSetting('legacyImported', '1');
}
