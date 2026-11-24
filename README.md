# MODit

Electron + TypeScript mod manager.

    npm install
    npm start        # compiles TypeScript, copies the UI, launches Electron
    npm run dev      # same, but live: UI edits refresh the window, main-process edits restart the app
    npm run dist     # build an installer with electron-builder

The first `npm install` also rebuilds the SQLite module (`better-sqlite3`) for Electron (postinstall step).

Layout: `src/main.ts` (windows, IPC, browser window), `src/core.ts` (game/mod/profile logic),
`src/archive.ts` (zip/7z/rar), `src/preload.ts` (safe bridge), `src/renderer/index.html` (UI).

## Game database
`src/data/games.json` maps a game to its mods folder. A copy is created at
`%APPDATA%\modit\games.json` on first run - edit that one to add games or change a
`modFolder` (`"~mods"`, `"Mods"`, or `""` for none). Entries with the same `id` win over the bundled ones.
Unknown Unreal games are detected automatically (`Content/Paks`, folder `~mods`).

## Library database
Games, their mods/profiles and the settings are stored in SQLite: `%APPDATA%\modit\modit.db`
(an old `state.json` is imported once and renamed to `state.json.imported`). Cover pictures are cached in
`%APPDATA%\modit\covers`. Covers come from SteamGridDB a few seconds after a game is added (needs a free API key,
Settings > Game covers, and an internet connection; missing covers are retried automatically).
Code: `src/db.ts` (database), `src/covers.ts` (SteamGridDB + `modit://` pictures), `src/library.ts` (commands the UI calls),
`src/launch.ts` (Play: picked .exe, Steam, or the game's own .exe in its folder).
