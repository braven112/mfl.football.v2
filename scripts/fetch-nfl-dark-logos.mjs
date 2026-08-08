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
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'nfl-logos', 'dark');
const MANIFEST_PATH = path.join(ROOT, 'src', 'data', 'nfl-dark-logos-manifest.json');

// Canonical ESPN team codes. Mirrors getAllNFLTeamCodes() in
// src/utils/nfl-logo.ts (TS, not importable from a node script);
// tests/nfl-logo-dark-css.test.ts locks the two lists in sync.
export const NFL_TEAM_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
];

const DARK_LOGO_URL = (code) => `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${code}.png`;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function isValidPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 1024 && buf.subarray(0, 4).equals(PNG_MAGIC);
}

async function fetchDarkLogo(code) {
  const res = await fetch(DARK_LOGO_URL(code), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isValidPng(buf)) throw new Error(`response is not a PNG (${buf.length} bytes)`);
  return buf;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let fetched = 0;
  let failed = 0;

  // Modest concurrency — 32 small files, no need to hammer the CDN.
  const queue = [...NFL_TEAM_CODES];
  const workers = Array.from({ length: 6 }, async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      const outPath = path.join(OUT_DIR, `${code}.png`);
      try {
        const buf = await fetchDarkLogo(code);
        const tmpPath = `${outPath}.tmp`;
        fs.writeFileSync(tmpPath, buf);
        fs.renameSync(tmpPath, outPath);
        fetched++;
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${code}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  // The manifest reflects what is actually on disk (this run's fetches plus
  // any still-valid file from a previous local run), not what we attempted.
  const codes = NFL_TEAM_CODES.filter((code) => {
    const p = path.join(OUT_DIR, `${code}.png`);
    try {
      return isValidPng(fs.readFileSync(p));
    } catch {
      return false;
    }
  }).sort();

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify({ codes }, null, 2)}\n`);

  console.log(
    `[fetch-nfl-dark-logos] ${fetched} fetched, ${failed} failed; manifest lists ${codes.length}/${NFL_TEAM_CODES.length} teams`,
  );
  if (codes.length < NFL_TEAM_CODES.length) {
    console.warn(
      '[fetch-nfl-dark-logos] missing teams fall back to the ESPN CDN swap (pre-self-hosting behavior)',
    );
  }
}

// Importable for tests without side effects (tests import NFL_TEAM_CODES).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // Non-fatal by contract: a failed fetch leaves the committed manifest (or
    // the last successful one) in place and the CSS falls back to ESPN URLs.
    console.error(`[fetch-nfl-dark-logos] failed: ${err.message}`);
  });
}
