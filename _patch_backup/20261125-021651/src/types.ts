export interface Mod {
  id: string;
  name: string;
  root: string; // subfolder of the game's mods dir this mod goes in ("" = directly in it)
  emoji?: string;
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
}

export interface AppState {
  v: 2;
  game: string | null;
  games: Game[];
  data: Record<string, GameData>;
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
}
