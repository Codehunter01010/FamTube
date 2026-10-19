// Builds the web app into ./web: the same interface as the desktop app, with
// src/web/backend.js standing in for the Electron main process.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const out = path.join(root, 'web');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src', 'renderer'), out, { recursive: true });
for (const f of ['manifest.webmanifest', 'sw.js', 'register-sw.js', 'icon-192.png', 'icon-512.png']) {
  fs.copyFileSync(path.join(root, 'src', 'web', f), path.join(out, f));
}

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'web', 'backend.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outfile: path.join(out, 'backend.js'),
});

const indexFile = path.join(out, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
html = html
  .replace('<link rel="stylesheet" href="styles.css">', [
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta name="theme-color" content="#ffffff">',
    '  <link rel="manifest" href="manifest.webmanifest">',
    '  <link rel="icon" href="icon-192.png">',
    '  <link rel="apple-touch-icon" href="icon-192.png">',
    '  <link rel="stylesheet" href="styles.css">',
  ].join('\n'))
  .replace('<script src="app.js"></script>', '<script src="backend.js"></script>\n  <script src="app.js"></script>\n  <script src="register-sw.js"></script>');
fs.writeFileSync(indexFile, html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Built web app in', out);
