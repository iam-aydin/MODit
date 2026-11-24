// Copies the renderer pages (plain HTML) and the game database next to the compiled TypeScript output.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'renderer'), { recursive: true });
fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src', 'renderer'))) {
  if (/\.html$/i.test(f)) fs.copyFileSync(path.join(root, 'src', 'renderer', f), path.join(dist, 'renderer', f));
}
fs.copyFileSync(path.join(root, 'src', 'data', 'games.json'), path.join(dist, 'data', 'games.json'));
