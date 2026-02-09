import chokidar from 'chokidar';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const watchPaths = [
  path.join(projectRoot, 'public', 'assets', 'afl'),
  path.join(projectRoot, 'data', 'afl-fantasy', 'afl.config.json'),
];

let runningProcess = null;
let pending = false;

const aliasExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const isAliasFile = (filePath) => {
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  if (!aliasExtensions.has(ext)) return false;
  const name = path.basename(base, ext);
  return /^\d{4}$/.test(name);
};

const runSync = () => {
  if (runningProcess) {
    pending = true;
    return;
  }

  console.log('[watch-afl] syncing aliases...');
  runningProcess = spawn('pnpm', ['run', 'sync:afl'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  runningProcess.on('exit', () => {
    runningProcess = null;
    console.log('[watch-afl] sync complete');
    if (pending) {
      pending = false;
      runSync();
    }
  });
};

const watcher = chokidar.watch(watchPaths, {
  ignoreInitial: true,
  persistent: true,
  ignored: (watchedPath) => {
    if (isAliasFile(watchedPath)) return true;
    return watchedPath.endsWith('afl.assets.json');
  },
});

watcher.on('ready', () => {
  console.log('[watch-afl] watching for asset changes...');
});

watcher.on('add', runSync);
watcher.on('change', runSync);
watcher.on('unlink', runSync);
