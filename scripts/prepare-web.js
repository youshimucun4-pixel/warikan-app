const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'www');

const files = [
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
  'sw.js',
  'icon.svg',
  'icon-180.png',
  'ogp.png',
  'privacy.html',
  'terms.html'
];

const dirs = ['icons'];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const src = path.join(projectRoot, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outDir, file));
  }
}

for (const dir of dirs) {
  const src = path.join(projectRoot, dir);
  const dest = path.join(outDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true, force: true });
  }
}

console.log('Prepared web assets in ./www');
