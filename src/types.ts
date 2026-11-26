export interface Mod {
  id: string;
  name: string;
  root: string; // subfolder of the game's mods dir this mod goes in ("" = directly in it)
  emoji?: string;
  thumb?: number; // set (to the time it was made) when the mod has a thumbnail in MODit's thumbs folder
  kind?: 'overlay'; // copied into the game's own folders (backups + restore), see overlay.ts
  order?: string[]; // overlay mods: folder names that must be listed in the game's mod_order.txt
  target?: string;  // AutoLink games: the character (folder in AutoLink) this mod is for, "*auto" or "*root"
  pack?: { archive: string; all: string[]; selected: string[]; stored?: boolean }; // a pack: many characters in one archive, only `selected` are installed; stored = every character is kept whole in <userData>/packs, so the archive is not needed any more
}

export interface GameData {
  mods: Mod[];
  profiles: Record<string, Record<string, boolean>>;
  active: string;
  installed?: string[]; // only in the answer of an install: the mods it just wrote (never saved)
  thumbs?: Record<string, { ext: string; data: Uint8Array }>; // only in the answer of an install: a picture found in each mod's archive (never saved)
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
  matchedId?: string | null; // id of the game-database entry this game was matched to when it was added
  customPath?: boolean;      // true = the user chose the mods folder, so database updates never change it
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
  theme: string;            // colour theme id (themes.ts): glass, mint-gum, forest
  glass?: boolean;          // liquid-glass look for all buttons (Settings > Appearance)
}

/** Something a game needs before mods can be installed (e.g. the AutoLink tool for Dead or Alive 5). */
export interface Requirement {
  id: string;
  name: string;
  check: string[];  // paths (relative to the install folder) that must all exist when it is installed
  url?: string;     // where to get it (opened in MODit's browser)
  file?: string;    // the name of the file to download on that page
  note?: string;
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
                           // any other install type: an archive holding one of them (Tekken 8: "Polaris") is copied into the game folder, the rest uses modsPath
  manifest?: string;       // folders: file that marks a mod folder (default mod.manifest)
  layout?: 'autolink';     // overlay: Dead or Alive 5 style, mods go flat into AutoLink/<CHARACTER>/
  launch?: string;         // program that starts the game, relative to the install folder (Play needs no questions)
  modsOpen?: string;       // folder the "Mods folder" button opens, relative to the install folder
  rootFiles?: string[];    // file types (e.g. .lnk) that always go to the game's root folder
  folders?: string[];      // folders to create once the game's tool is installed (empty folders are not copied with a mod's files)
  requirements?: Requirement[]; // must be installed first; mods cannot be installed before that
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
  profiles?: string[]; // pick_target: the profiles to choose from
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
  target?: string;   // AutoLink: who the mod is for
  bytes?: Uint8Array; // save_thumb: the JPEG
  ids?: string[];    // mod_sizes: the mods to measure
  title?: string;    // pick_target: question shown to the user
  items?: Array<{ v: string; l: string; c?: number }>; // pick_target: the choices (c = a character name)
  selected?: string | string[]; // pick_target: preselected choice(s)
  multi?: boolean;       // pick_target: tick several (a pack)
  okLabel?: string;      // pick_target: text of the confirm button
  allowEmpty?: boolean;  // pick_target: confirm even with nothing ticked
  on?: boolean;          // show_mod: the mod is switched on
  chars?: string[];      // install_archive / edit_pack: the characters of a pack to install
  archive?: string;      // edit_pack: the archive to read again when the saved one is gone
}