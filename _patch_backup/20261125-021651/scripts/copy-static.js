// Copies the renderer (plain HTML) and the game database next to the compiled TypeScript output.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'renderer'), { recursive: true });
fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
fs.copyFileSync(path.join(root, 'src', 'renderer', 'index.html'), path.join(dist, 'renderer', 'index.html'));
fs.copyFileSync(path.join(root, 'src', 'data', 'games.json'), path.join(dist, 'data', 'games.json'));
