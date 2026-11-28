#!/usr/bin/env node
/**
 * Write each registry league's app colors (store-app plan decision 22).
 *
 *   node scripts/build-app-league-themes.mjs
 *
 * Re-run after changing a league's `theme` in src/config/leagues-data.mjs,
 * editing a theme in src/themes/, or adding a league.
 * `tests/mfl-live-app-league-themes.test.ts` fails while the committed file
 * disagrees with what this writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_LEAGUE_THEMES_FILE,
  buildAppLeagueThemes,
  serializeAppLeagueThemes,
} from './lib/app-league-themes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, APP_LEAGUE_THEMES_FILE);
const next = serializeAppLeagueThemes(buildAppLeagueThemes());
let prev = '';
try {
  prev = fs.readFileSync(file, 'utf8');
} catch {
  // First run: nothing written yet.
}
if (prev === next) {
  console.log(`${APP_LEAGUE_THEMES_FILE}: unchanged`);
} else {
  fs.writeFileSync(file, next);
  console.log(`${APP_LEAGUE_THEMES_FILE}: written`);
}
