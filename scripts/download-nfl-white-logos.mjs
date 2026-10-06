#!/usr/bin/env node
/**
 * Download every club's WHITE KNOCKOUT mark into
 * `public/assets/nfl-logos/white/{CODE}.png`, trimmed and downscaled.
 *
 * Run by hand, not in prebuild, and the output is COMMITTED — the same call
 * as the light SVGs and the reversed cuts. The source is ESPN's
 * `primary_logo_white.png` (brand kit `espn.primaryWhite`, mark id
 * `whiteKnockout`), which ships at 4096px and ~190 KB a club: far too heavy
 * for a faint watermark, and a CDN `src` is what `nfl-logo-url.ts` exists to
 * keep off the page. Committing a 512px copy makes it same-origin everywhere
 * (dev, slim previews, Storybook) with no manifest or fallback to manage.
 *
 *   node scripts/download-nfl-white-logos.mjs
 *
 * Plan: docs/plans/nfl-mark-assignments.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { resolveMark } from './lib/nfl-mark-sources.mjs';
import { NFL_TEAM_CODES } from './fetch-nfl-dark-logos.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WHITE_DIR = path.join(ROOT, 'public', 'assets', 'nfl-logos', 'white');

/** Longest edge after the transparent margin is trimmed. */
const SIZE = 512;

async function main() {
  fs.mkdirSync(WHITE_DIR, { recursive: true });
  const failures = [];
  for (const code of NFL_TEAM_CODES) {
    const { url } = resolveMark(code, 'whiteKnockout');
    if (!url) {
      failures.push(`${code}: no whiteKnockout in the brand kit`);
      continue;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const out = await sharp(buf)
        .trim()
        .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      fs.writeFileSync(path.join(WHITE_DIR, `${code}.png`), out);
      console.log(`  ✓ ${code} ${(out.length / 1024).toFixed(1)} KB`);
    } catch (err) {
      failures.push(`${code}: ${err.message}`);
    }
  }
  if (failures.length) {
    console.error(`[download-nfl-white-logos] ${failures.length} failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}

main();
