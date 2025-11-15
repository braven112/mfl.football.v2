import chokidar from 'chokidar';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const watchPaths = [
  path.join(projectRoot, 'public', 'assets', 'theleague'),
  path.join(projectRoot, 'src', 'data', 'theleague.config.json'),
];

let runningProcess = null;
let pending = false;

const runSync = () => {
  if (runningProcess) {
    pending = true;
    return;
  }

  console.log('[watch-theleague] syncing aliases...');
  runningProcess = spawn('pnpm', ['run', 'sync:theleague'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  runningProcess.on('exit', () => {
    runningProcess = null;
    console.log('[watch-theleague] sync complete');
    if (pending) {
      pending = false;
      runSync();
    }
  });
};

const watcher = chokidar.watch(watchPaths, {
  ignoreInitial: true,
  persistent: true,
});

watcher.on('ready', () => {
  console.log('[watch-theleague] watching for asset changes...');
});

watcher.on('add', runSync);
watcher.on('change', runSync);
watcher.on('unlink', runSync);
