#!/usr/bin/env node
/**
 * Mirror ESPN's dark-optimized NFL logo cuts into Storybook's OWN static dir,
 * so Chromatic snapshots never touch a CDN.
 *
 * WHY THIS EXISTS SEPARATELY FROM scripts/fetch-nfl-dark-logos.mjs
 *
 * The production mirror writes to `public/assets/nfl-logos/dark/`, which is
 * gitignored and rebuilt by prebuild on every deploy. Storybook's build runs
 * `storybook build` with NO prebuild, so in CI that directory does not exist
 * and `src/data/nfl-dark-logos-manifest.json` is its committed `{"codes": []}`
 * default — which makes `buildNflLogoDarkCss()` fall back to ESPN URLs for all
 * 32 teams. `.storybook/preview.ts` injects that stylesheet, so every DARK
 * snapshot of a component rendering an NFL logo fetched `content: url(...)`
 * live from `a.espncdn.com` at capture time. `content: url()` has no error
 * fallback and Chromatic's 300ms settle does not cover a cross-origin round
 * trip, so a CDN hiccup rendered a blank/broken mark and failed the build for
 * a reason that had nothing to do with the diff (the Bengals mark in
 * Roster/PlayerCell, Sep 2026).
 *
 * These files are COMMITTED, unlike the production mirror. That is the whole
 * point: a visual baseline has to be reproducible from a checkout alone, so
 * re-fetching them per CI run would just move the same flake earlier. They
 * live under `.storybook/static/` and are served at `/storybook-nfl-dark/`
 * — a Storybook-only prefix, exactly like `/storybook-fonts` — so they can
 * never be confused with, or collide with, what `public/` serves.
 *
 * Run this by hand when ESPN changes a mark (a re-run producing a byte diff
 * is a real logo change and should be reviewed as a Chromatic diff):
 *
 *   pnpm mirror:storybook-dark-logos
 *
 * `tests/storybook-dark-logo-mirror.test.ts` fails if the mirrored set ever
 * drifts from the 32 canonical codes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mirrorDarkLogos } from './lib/dark-logo-mirror.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.storybook', 'static', 'nfl-dark');
const MANIFEST_PATH = path.join(ROOT, '.storybook', 'nfl-dark-manifest.json');

// Canonical ESPN team codes — mirrors getAllNFLTeamCodes() in
// src/utils/nfl-logo.ts (TS, not importable from a node script). The guard
// test locks the two lists in sync.
export const STORYBOOK_NFL_TEAM_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
];

async function main() {
  await mirrorDarkLogos({
    label: 'mirror-storybook-dark-logos',
    items: STORYBOOK_NFL_TEAM_CODES.map((code) => ({
      key: code,
      url: `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${code}.png`,
    })),
    outDir: OUT_DIR,
    // Written next to the images and imported by .storybook/nfl-dark-mirror.ts,
    // so the manifest, the files and the CSS the preview injects cannot drift.
    manifestPath: MANIFEST_PATH,
    manifestField: 'codes',
    // Gentler than the prebuild mirrors' 6: this runs by hand, not on a deploy
    // clock, and ESPN's edge answered a wider fan-out's first request with a
    // spurious 404 on every attempt, losing one logo per run.
    concurrency: 3,
  });

  // Unlike the prebuild mirrors, this one is NOT allowed to half-succeed: a
  // partial commit would bake a CDN dependency back into the exact snapshots
  // it exists to make offline. Fail loudly and leave the previous commit's
  // files in place.
  const written = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).codes;
  const missing = STORYBOOK_NFL_TEAM_CODES.filter((code) => !written.includes(code));
  if (missing.length) {
    throw new Error(`incomplete mirror — missing ${missing.join(', ')}; do not commit, re-run`);
  }
  console.log(
    `[mirror-storybook-dark-logos] ${written.length}/${STORYBOOK_NFL_TEAM_CODES.length} mirrored into ${OUT_DIR}`,
  );
}

// Importable for tests without side effects (the guard test imports
// STORYBOOK_NFL_TEAM_CODES — importing must never hit the network).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`[mirror-storybook-dark-logos] failed: ${err.message}`);
    process.exit(1);
  });
}
