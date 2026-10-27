#!/usr/bin/env node
/**
 * Render every registry league's dark-theme logo as the PNG the MFL Live
 * phone app draws beside the league's name.
 *
 *   node scripts/build-app-league-logos.mjs
 *
 * Why a PNG at all: the registry's logos are mostly SVG, and React Native's
 * `<Image>` cannot draw SVG on Android without a native module the app does
 * not ship. So each `logo.dark` is rendered once, here, to a 192×192
 * transparent square (the mark fitted, never cropped — a crest is somebody's
 * logo) at public/assets/logos/app/<slug>.png, and the server names that file
 * (`appLeagueLogo`, src/utils/live/app-league-logo.ts).
 *
 * Re-run after changing a league's `logo` in src/config/leagues-data.mjs, or
 * adding a league. `tests/mfl-live-app-league-logos.test.ts` fails while a
 * league with a logo has no rendered PNG.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 192;
const outDir = path.join(ROOT, 'public/assets/logos/app');
fs.mkdirSync(outDir, { recursive: true });

for (const league of ALL_LEAGUES) {
  const src = league.logo?.dark;
  if (!src) continue;
  const file = path.join(ROOT, 'public', src);
  if (!fs.existsSync(file)) {
    console.warn(`skip ${league.slug}: ${src} is not on disk`);
    continue;
  }
  const out = path.join(outDir, `${league.slug}.png`);
  // A dense render so a small viewBox still rasterizes sharply at 192px.
  await sharp(file, { density: 384 })
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`${league.slug}: ${src} -> ${path.relative(ROOT, out)}`);
}
