// npm run dev
//  - TypeScript recompiles whenever you save
//  - edits to src/renderer/*.html are copied over and the open windows refresh by themselves
//  - edits to main-process code (main.ts, core.ts, ...) restart the app
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const tscJs = require.resolve('typescript/lib/tsc.js', { paths: [root] });
const electronExe = require('electron'); // path to the electron executable

const copyStatic = () => spawnSync(process.execPath, [path.join(__dirname, 'copy-static.js')], { stdio: 'inherit' });

let app = null;
let restarting = false;
let quitting = false;
let started = false;

function startApp() {
  const env = { ...process.env, MODIT_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE; // some terminals set this and it would stop Electron from opening a window
  app = spawn(electronExe, ['.'], { cwd: root, stdio: 'inherit', env });
  app.on('exit', () => {
    app = null;
    if (restarting) { restarting = false; startApp(); }
    else shutdown();
  });
}

function restartApp() {
  if (!app || restarting) return;
  restarting = true;
  console.log('[dev] main process changed - restarting the app...');
  app.kill();
}

function shutdown() {
  if (quitting) return;
  quitting = true;
  restarting = false;
  try { if (app) app.kill(); } catch { /* already gone */ }
  try { tsc.kill(); } catch { /* already gone */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

fs.mkdirSync(dist, { recursive: true });

// UI files: copy to dist whenever they change (the app refreshes its windows when dist/renderer changes)
let copyTimer;
const onStatic = () => {
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copyStatic(); console.log('[dev] UI files updated'); }, 120);
};
fs.watch(path.join(root, 'src', 'renderer'), onStatic);
fs.watch(path.join(root, 'src', 'data'), onStatic);

// Compiled main-process code: restart the app when it changes (the renderer folder is handled by the app itself)
function watchCompiled() {
  let t;
  fs.watch(dist, { recursive: true }, (_ev, name) => {
    if (!name || !/\.js$/i.test(String(name)) || /^renderer[\\/]/.test(String(name))) return;
    clearTimeout(t);
    t = setTimeout(restartApp, 400);
  });
}

const tsc = spawn(process.execPath, [tscJs, '--watch', '--preserveWatchOutput'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
readline.createInterface({ input: tsc.stdout }).on('line', line => {
  console.log(line);
  if (started || !/Watching for file changes/i.test(line)) return;
  started = true; // first compile finished
  copyStatic();
  startApp();
  setTimeout(watchCompiled, 1500);
  console.log('[dev] live mode on - save a file and the app updates. Press Ctrl+C to stop.');
});
tsc.on('exit', shutdown);
