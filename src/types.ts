export interface Mod {
  id: string;
  name: string;
  root: string; // subfolder of the game's mods dir this mod goes in ("" = directly in it)
  emoji?: string;
  kind?: 'overlay'; // copied into the game's own folders (backups + restore), see overlay.ts
  order?: string[]; // overlay mods: folder names that must be listed in the game's mod_order.txt
}

export interface GameData {
  mods: Mod[];
  profiles: Record<string, Record<string, boolean>>;
  active: string;
}

export interface Game {
  id: string;
  name: string;
  path: string;      // install folder the user picked
  modsDir: string;   // folder mods are installed under
  modFolder?: string; // subfolder inside modsDir, e.g. "~mods" ("" = none)
  exe?: string;      // program the user picked to start the game ("" = detect it)
  cover?: string | null; // file name inside <userData>/covers, shown through modit://cover/<file>
  coverCustom?: boolean; // true = the user chose it, so it is never replaced by a downloaded one
}

/** What the UI gets at start-up (assembled from the SQLite database). */
export interface AppState {
  v: 2;
  game: string | null;
  games: Game[];
  data: Record<string, GameData>;
  sites: Array<{ n: string; u: string }> | null;
  settings: Settings;
}

export interface Settings {
  sgdbKey: string;          // SteamGridDB API key (covers are only downloaded when there is one)
  skipBrowserWarn: boolean; // "Don't show again" on the Before you browse warning
}

/** One entry of the game database (games.json). */
export interface GameDef {
  id: string;
  name: string;
  engine?: string;
  generic?: boolean;   // true = use the install folder's name instead of `name`
  detect: string[];    // paths (relative to the install folder) that must all exist
  modsPath: string;    // folder mods live under, relative to the install folder
  modFolder: string;   // subfolder inside modsPath ("~mods", "Mods", or "" for none)
  folderNames?: string[]; // the game also matches when its install folder has one of these names
  install?: 'folder' | 'overlay' | 'folders'; // folder (default): one subfolder per mod inside modsPath
                                              // overlay: mod files are copied into the game folder (modsPath)
                                              // folders: mod folders (with a mod.manifest) go into modsPath
  overlayRoots?: string[]; // overlay: top-level folders a mod archive contains ("Runtime", "data")
  manifest?: string;       // folders: file that marks a mod folder (default mod.manifest)
}

export interface CommandArgs {
  game?: string;
  modsDir?: string;
  modFolder?: string;
  state?: GameData;
  path?: string;
  sub?: string;
  paths?: string[];
  picks?: string[];
  id?: string;
  dlId?: string;
  root?: string;
  profile?: string;
  url?: string;
  exe?: string;
  name?: string;
  rec?: Game;
  data?: GameData;
  key?: string;
  value?: string;
  sites?: unknown;
  file?: string;
  kind?: string;
}
