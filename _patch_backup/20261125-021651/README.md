# MODit

Electron + TypeScript mod manager.

    npm install
    npm start        # compiles TypeScript, copies the UI, launches Electron
    npm run dist     # build an installer with electron-builder

Layout: `src/main.ts` (windows, IPC, browser window), `src/core.ts` (game/mod/profile logic),
`src/archive.ts` (zip/7z/rar), `src/preload.ts` (safe bridge), `src/renderer/index.html` (UI).

## Game database
`src/data/games.json` maps a game to its mods folder. A copy is created at
`%APPDATA%\modit\games.json` on first run - edit that one to add games or change a
`modFolder` (`"~mods"`, `"Mods"`, or `""` for none). Entries with the same `id` win over the bundled ones.
Unknown Unreal games are detected automatically (`Content/Paks`, folder `~mods`).
