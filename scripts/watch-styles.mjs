#!/usr/bin/env node
/**
 * Watch SCSS files and auto-rebuild all league CSS bundles on change.
 * Uses chokidar (already installed via Astro).
 *
 * Usage: pnpm watch:styles
 */

import chokidar from 'chokidar';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src/assets/css/src');

let building = false;

function rebuild() {
  if (building) return;
  building = true;
  try {
    execSync('node scripts/build-styles.mjs', { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    console.error('❌ Build failed');
  }
  building = false;
}

// Initial build
rebuild();

// Watch all .scss files in the CSS source directory
const watcher = chokidar.watch(`${srcDir}/**/*.scss`, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200 },
});

watcher.on('all', (event, filePath) => {
  const rel = path.relative(rootDir, filePath);
  console.log(`\n🔄 ${event}: ${rel}`);
  rebuild();
});

console.log(`\n👀 Watching ${srcDir}/**/*.scss for changes...\n`);
