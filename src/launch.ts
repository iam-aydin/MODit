import { shell } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CommandArgs } from './types';

export interface PlayResult { ok: boolean; how?: 'exe' | 'steam'; exe?: string; need?: 'exe' }

/** Steam games live in <library>/steamapps/common/<folder>; the matching appmanifest_<id>.acf holds the app id. */
export function steamAppId(gamePath: string): string | null {
  const parts = path.resolve(gamePath).split(path.sep);
  const i = parts.findIndex(p => p.toLowerCase() === 'steamapps');
  if (i < 1 || parts[i + 1]?.toLowerCase() !== 'common' || !parts[i + 2]) return null;
  const apps = parts.slice(0, i + 1).join(path.sep);
  const folder = parts[i + 2].toLowerCase();
  try {
    for (const f of fs.readdirSync(apps)) {
      const m = /^appmanifest_(\d+)\.acf$/i.exec(f);
      if (!m) continue;
      const d = /"installdir"\s+"([^"]+)"/i.exec(fs.readFileSync(path.join(apps, f), 'utf8'));
      if (d && d[1].toLowerCase() === folder) return m[1];
    }
  } catch { /* not a readable Steam library */ }
  return null;
}

// ---------- finding the program that starts a game ----------
// Unreal Engine games normally have their runnable .exe right in the game's root folder (e.g. Tekken 8\Tekken8.exe).
// Installers, crash reporters, anti-cheat and redistributables sit there too and must never be started by Play.
const NOT_THE_GAME = /unins|setup|install|redist|dxsetup|dotnet|vcredist|prereq|crash|report|easyanticheat|^eac|battleye|beservice|updater|helper|diagnostic|benchmark|gamingrepair/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function exesIn(dir: string): Array<{ file: string; size: number }> {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.exe$/i.test(e.name))
      .map(e => ({ file: path.join(dir, e.name), size: fs.statSync(path.join(dir, e.name)).size }));
  } catch { return []; }
}

/** How well an .exe name matches the game's folder / title: 2 = same, 1 = one contains the other, 0 = no relation. */
function nameScore(exeFile: string, names: string[]): number {
  const e = norm(path.basename(exeFile).replace(/\.exe$/i, '').replace(/-win(64|32)-shipping$/i, ''));
  let best = 0;
  for (const n of names.map(norm)) {
    if (!n || !e) continue;
    if (n === e) return 2;
    if (e.length >= 3 && n.length >= 3 && (n.includes(e) || e.includes(n))) best = 1;
  }
  return best;
}

/** Picks the game's program from the root of its folder. Returns null when it cannot tell (several unrelated .exe files). */
export function findGameExe(gameDir: string, title = ''): string | null {
  const names = [path.basename(path.resolve(gameDir)), title].filter(Boolean);
  const best = (list: Array<{ file: string; size: number }>): string | null => {
    const ok = list.filter(x => !NOT_THE_GAME.test(path.basename(x.file)));
    if (!ok.length) return null;
    const scored = ok.map(x => ({ ...x, score: nameScore(x.file, names) })).sort((a, b) => b.score - a.score || b.size - a.size);
    if (scored[0].score > 0) return scored[0].file;      // named like the game
    return ok.length === 1 ? ok[0].file : null;          // the only candidate
  };

  const root = best(exesIn(gameDir));
  if (root) return root;

  // no usable .exe in the root: Unreal's own <Project>\Binaries\Win64\<Project>-Win64-Shipping.exe
  const shipping: Array<{ file: string; size: number }> = [];
  try {
    for (const e of fs.readdirSync(gameDir, { withFileTypes: true })) {
      if (e.isDirectory()) shipping.push(...exesIn(path.join(gameDir, e.name, 'Binaries', 'Win64')).filter(x => /shipping\.exe$/i.test(x.file)));
    }
  } catch { /* unreadable folder */ }
  return best(shipping) || (shipping.length === 1 ? shipping[0].file : null);
}

function runExe(exe: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    c.once('error', reject);
    c.once('spawn', () => { c.unref(); resolve(); });
  });
}

/** Start the game. Order: the program the user picked, a Steam install (through Steam), the game's own .exe found in its folder. */
export async function playGame(a: CommandArgs): Promise<PlayResult> {
  const start = async (exe: string): Promise<PlayResult> => {
    try { await runExe(exe); }
    catch { // e.g. the program asks for admin rights: let Windows start it
      const err = await shell.openPath(exe);
      if (err) throw new Error(err);
    }
    return { ok: true, how: 'exe', exe };
  };

  const picked = a.exe ? path.resolve(a.exe) : '';
  if (picked && /\.exe$/i.test(picked) && fs.existsSync(picked) && fs.statSync(picked).isFile()) return start(picked);

  const id = a.path ? steamAppId(a.path) : null;
  if (id) {
    await shell.openExternal(`steam://rungameid/${id}`);
    return { ok: true, how: 'steam' };
  }

  const found = a.path && fs.existsSync(a.path) ? findGameExe(a.path, a.name) : null;
  if (found) return start(found);

  return { ok: false, need: 'exe' };
}
