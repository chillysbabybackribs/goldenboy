const fs = require('fs');
const path = require('path');

const srcBase = path.join(__dirname, '..', 'src', 'renderer');
const distBase = path.join(__dirname, '..', 'dist', 'renderer');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.css')) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(srcBase, distBase);

// Copy xterm.js assets into dist/renderer/vendor/
const vendorDir = path.join(distBase, 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

const nodeModules = path.join(__dirname, '..', 'node_modules');

const xtermFiles = [
  { src: path.join(nodeModules, '@xterm', 'xterm', 'lib', 'xterm.js'), dest: path.join(vendorDir, 'xterm.js') },
  { src: path.join(nodeModules, '@xterm', 'xterm', 'css', 'xterm.css'), dest: path.join(vendorDir, 'xterm.css') },
  { src: path.join(nodeModules, '@xterm', 'addon-fit', 'lib', 'addon-fit.js'), dest: path.join(vendorDir, 'addon-fit.js') },
];

for (const file of xtermFiles) {
  if (fs.existsSync(file.src)) {
    fs.copyFileSync(file.src, file.dest);
  } else {
    console.warn(`Warning: ${file.src} not found`);
  }
}

console.log('Renderer assets copied.');
