#!/usr/bin/env node
/**
 * Fetch ESPN's dark-optimized NFL team logos into public/ so the dark-mode
 * logo swap (src/utils/nfl-logo-dark-css.ts) can serve them same-origin.
 *
 * Why: the dark-mode swap replaces every rendered NFL logo <img> with
 * `content: url(...)` pointing at ESPN's `500-dark` CDN cut. A CSS content
 * replacement has NO error fallback — if the cross-origin fetch fails (flaky
 * mobile connection, CDN hiccup, blocker), the browser renders a broken-image
 * icon instead of the perfectly good local SVG still sitting in the src
 * attribute. That's exactly what broke the AFL players page in Aug 2026.
 * Self-hosting the dark cut removes the third-party dependency at render time.
 *
 * Runs during prebuild (parallel lane). Output:
 *  - public/assets/nfl-logos/dark/{CODE}.png   (gitignored, rebuilt per deploy)
 *  - src/data/nfl-dark-logos-manifest.json     ({ codes: [...] } — the teams
 *    whose dark PNG is actually present on disk after this run)
 *
 * The manifest is the safety contract: nfl-logo-dark-css.ts emits a local
 * `/assets/nfl-logos/dark/{CODE}.png` swap only for codes listed there and
 * falls back to the ESPN CDN URL (the pre-Aug-2026 behavior) for anything
 * missing. A total fetch failure therefore degrades to the status quo, never
 * to a stylesheet pointing at files that don't exist. The committed manifest
 * default is `{ "codes": [] }` so dev/test environments that never ran this
 * script keep the remote behavior too.
 *
 * Never exits non-zero on network failure — prebuild fetches are non-fatal.
 * Sibling: scripts/fetch-college-dark-logos.mjs (same pattern, NCAA cuts).
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { mirrorDarkLogos } from './lib/dark-logo-mirror.mjs';
import { assignedMark, resolveMark } from './lib/nfl-mark-sources.mjs';
import { optimizeAndTrimSvg } from './download-nfl-logos.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Canonical ESPN team codes. Mirrors getAllNFLTeamCodes() in
// src/utils/nfl-logo.ts (TS, not importable from a node script);
// tests/nfl-logo-dark-css.test.ts locks the two lists in sync.
export const NFL_TEAM_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
];

/**
 * Which cut each club's dark mark comes from.
 *
 * Was ESPN's `500-dark` for all 32. Now the per-club assignment decides
 * (src/data/nfl-mark-assignments.json): a club with no entry still resolves to
 * `espnDark`, so the default path is unchanged and only the clubs that chose
 * something else move. See docs/plans/nfl-mark-assignments.md.
 */
function darkItems() {
  return NFL_TEAM_CODES.map((code) => {
    const markId = assignedMark(code, 'dark');
    const { url, format } = resolveMark(code, markId);
    if (!url) {
      // `primary` is the committed file, not something to fetch. No club
      // assigns it to dark today; if one does, it needs its own handling
      // rather than a mirror entry pointing at nothing.
      throw new Error(`${code}: dark mark "${markId}" is not fetchable`);
    }
    return { key: code, url, format, markId };
  });
}

async function main() {
  const items = darkItems();
  const nonDefault = items.filter((i) => i.markId !== 'espnDark');
  if (nonDefault.length) {
    console.log(
      `[fetch-nfl-dark-logos] per-club assignments: ${nonDefault
        .map((i) => `${i.key}=${i.markId}(${i.format})`)
        .join(', ')}`,
    );
  }

  await mirrorDarkLogos({
    label: 'fetch-nfl-dark-logos',
    items,
    outDir: path.join(ROOT, 'public', 'assets', 'nfl-logos', 'dark'),
    manifestPath: path.join(ROOT, 'src', 'data', 'nfl-dark-logos-manifest.json'),
    manifestField: 'codes',
    concurrency: 6,
    // An SVG cut goes through the same optimise + ink-box trim the LIGHT art
    // does. Without it the dark mark keeps NFL.com's square padding while the
    // light one is tight-cropped, and the logo visibly changes size when the
    // theme flips.
    transform: async (buf, item) =>
      item.format === 'svg'
        ? Buffer.from(await optimizeAndTrimSvg(buf.toString('utf-8'), item.key))
        : buf,
  });
}

// Importable for tests without side effects (tests import NFL_TEAM_CODES).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // Per-logo network failures are handled inside mirrorDarkLogos and stay
    // non-fatal (the manifest + CSS fall back to ESPN URLs). Reaching this
    // catch means something structural broke (fs error, bad manifest write) —
    // exit non-zero so the prebuild log shows ✗ instead of a false ✓. The
    // prebuild orchestrator still treats fetch failures as non-fatal.
    console.error(`[fetch-nfl-dark-logos] failed: ${err.message}`);
    process.exit(1);
  });
}
