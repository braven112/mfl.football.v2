#!/usr/bin/env node
/**
 * Build a league's seasonal franchise marks (src/config/seasonal-themes.mjs)
 * from black-on-white artwork into the white-on-transparent PNGs the site
 * swaps in while the season is open.
 *
 *   node scripts/build-seasonal-marks.mjs <source-dir> [--league theleague] [--season halloween]
 *
 * Which file is each franchise's mark is NOT inferred from the folder (it
 * holds every draft round): src/data/seasonal-marks/<league>-<season>.json
 * names the locked pick per franchise id, and every id must be present in
 * <source-dir>. Output: public/assets/<league>/<marks>/<franchiseId>.png,
 * 200×200, the mark trimmed and centred like the 100×100 icons it replaces
 * (shown at 2×).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SEASONAL_THEMES } from '../src/config/seasonal-themes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const sourceDir = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const league = flag('league', 'theleague');
const season = SEASONAL_THEMES[flag('season', 'halloween')];
if (!sourceDir || !season?.marks) {
  console.error('usage: node scripts/build-seasonal-marks.mjs <source-dir> [--league <navSlug>] [--season <id>]');
  process.exit(1);
}

const SIZE = 200;
const manifestPath = path.join(ROOT, 'src/data/seasonal-marks', `${league}-${season.id}.json`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const outDir = path.join(ROOT, 'public/assets', league, season.marks);
fs.mkdirSync(outDir, { recursive: true });

const picks = Object.entries(manifest).filter(([id]) => /^\d{4}$/.test(id));
for (const [id, file] of picks) {
  // Ink coverage becomes alpha: black → opaque, white → clear.
  const alpha = await sharp(path.join(sourceDir, file), { density: 144 }).flatten({ background: '#fff' }).greyscale().negate().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = alpha.info;
  const white = await sharp({ create: { width, height, channels: 3, background: '#fff' } })
    .joinChannel(alpha.data, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  const trimmed = await sharp(white).trim({ threshold: 1 }).toBuffer();
  await sharp(trimmed)
    .resize(SIZE - 8, SIZE - 8, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(outDir, `${id}.png`));
  console.log(`${file} → ${path.relative(ROOT, path.join(outDir, `${id}.png`))}`);
}
console.log(`${picks.length} marks`);
