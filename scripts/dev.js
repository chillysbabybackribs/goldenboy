const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const buildCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
);

const watchRoots = [
  path.join(projectRoot, 'src'),
  path.join(projectRoot, 'scripts'),
];

const watchFiles = [
  path.join(projectRoot, 'package.json'),
  path.join(projectRoot, 'tsconfig.json'),
  path.join(projectRoot, 'tsconfig.main.json'),
  path.join(projectRoot, 'tsconfig.preload.json'),
  path.join(projectRoot, 'tsconfig.renderer.json'),
];

const directoryWatchers = new Map();
const fileWatchers = new Map();

let electronProcess = null;
let buildProcess = null;
let pendingBuild = false;
let rebuildTimer = null;
let shuttingDown = false;

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  process.stdout.write(`[dev ${stamp}] ${message}\n`);
}

function startElectron() {
  if (shuttingDown) return;
  electronProcess = spawn(electronCommand, ['.'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
    },
  });

  electronProcess.on('exit', (code, signal) => {
    electronProcess = null;
    if (shuttingDown) return;
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    log(`Electron exited (${signal || code || 0}). Waiting for next rebuild.`);
  });
}

function stopElectron() {
  if (!electronProcess) return;
  const proc = electronProcess;
  electronProcess = null;
  proc.kill('SIGTERM');
}

function restartElectron() {
  stopElectron();
  startElectron();
}

function runBuild() {
  if (buildProcess) {
    pendingBuild = true;
    return;
  }

  buildProcess = spawn(buildCommand, ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  log('Building application...');

  buildProcess.on('exit', (code) => {
    buildProcess = null;

    if (code === 0) {
      log('Build complete. Reloading Electron.');
      if (electronProcess) {
        restartElectron();
      } else {
        startElectron();
      }
    } else {
      log(`Build failed with exit code ${code}. Keeping current app instance.`);
    }

    if (pendingBuild && !shuttingDown) {
      pendingBuild = false;
      scheduleBuild('pending changes');
    }
  });
}

function scheduleBuild(reason) {
  if (shuttingDown) return;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    log(`Change detected (${reason}).`);
    runBuild();
  }, 120);
}

function closeWatchers(map) {
  for (const watcher of map.values()) {
    watcher.close();
  }
  map.clear();
}

function refreshDirectoryWatches() {
  closeWatchers(directoryWatchers);

  const stack = [...watchRoots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;

    let stat;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    try {
      const watcher = fs.watch(current, (eventType, filename) => {
        const name = filename ? filename.toString() : '(unknown)';
        scheduleBuild(`${eventType} ${path.relative(projectRoot, path.join(current, name))}`);
        refreshDirectoryWatches();
      });
      directoryWatchers.set(current, watcher);
    } catch (error) {
      log(`Failed to watch ${current}: ${error.message}`);
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.git')) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
}

function refreshFileWatches() {
  closeWatchers(fileWatchers);

  for (const filePath of watchFiles) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const watcher = fs.watch(filePath, () => {
        scheduleBuild(path.relative(projectRoot, filePath));
      });
      fileWatchers.set(filePath, watcher);
    } catch (error) {
      log(`Failed to watch ${filePath}: ${error.message}`);
    }
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  closeWatchers(directoryWatchers);
  closeWatchers(fileWatchers);
  if (buildProcess) buildProcess.kill('SIGTERM');
  stopElectron();
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

refreshDirectoryWatches();
refreshFileWatches();
runBuild();
