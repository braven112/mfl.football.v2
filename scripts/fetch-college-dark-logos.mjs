#!/usr/bin/env node
/**
 * Fetch ESPN's dark-optimized NCAA college logos into public/ so the
 * dark-mode swap (src/utils/college-logo-dark-css.ts) can serve them
 * same-origin — the college twin of scripts/fetch-nfl-dark-logos.mjs
 * (see that file for the broken-image rationale; `content: url(...)` has
 * no error fallback).
 *
 * The logo set comes from src/data/college-logos.json: every distinct
 * `logoDark` URL of the form .../ncaa/500-dark/{id}.png is mirrored to
 * public/assets/college-logos/dark/{id}.png, keyed by the ESPN NCAA id.
 * A `logoDark` that doesn't match that pattern (none today) is skipped and
 * simply keeps its remote swap.
 *
 * Runs during prebuild (parallel lane). Output:
 *  - public/assets/college-logos/dark/{id}.png    (gitignored, per-deploy)
 *  - src/data/college-dark-logos-manifest.json    ({ ids: [...] } — the ids
 *    whose dark PNG is actually present on disk after this run)
 *
 * Same safety contract as the NFL mirror: college-logo-dark-css.ts emits a
 * local swap only for manifest-listed ids and keeps the ESPN URL otherwise,
 * so a failed fetch degrades to the previous remote behavior. Committed
 * manifest default is `{ "ids": [] }`. Never exits non-zero on network
 * failure — prebuild fetches are non-fatal.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mirrorDarkLogos } from './lib/dark-logo-mirror.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const NCAA_DARK_URL_RE = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500-dark\/(\d+)\.png$/;

/** Distinct mirrorable {key: id, url} pairs from college-logos.json. */
export function collectCollegeDarkLogos(collegeLogos) {
  const byId = new Map();
  for (const entry of Object.values(collegeLogos)) {
    const dark = entry?.logoDark;
    const id = typeof dark === 'string' ? dark.match(NCAA_DARK_URL_RE)?.[1] : undefined;
    if (id) byId.set(id, { key: id, url: dark });
  }
  return [...byId.values()];
}

async function main() {
  const collegeLogos = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'data', 'college-logos.json'), 'utf8'),
  );
  await mirrorDarkLogos({
    label: 'fetch-college-dark-logos',
    items: collectCollegeDarkLogos(collegeLogos),
    outDir: path.join(ROOT, 'public', 'assets', 'college-logos', 'dark'),
    manifestPath: path.join(ROOT, 'src', 'data', 'college-dark-logos-manifest.json'),
    manifestField: 'ids',
    // Matches the NFL mirror's conservative rate; ~236 files still complete
    // in a few seconds and stay well clear of any per-IP CDN throttling.
    concurrency: 6,
  });
}

// Importable for tests without side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // Per-logo network failures are non-fatal inside mirrorDarkLogos; this
    // catch means a structural failure — exit non-zero so prebuild logs ✗.
    console.error(`[fetch-college-dark-logos] failed: ${err.message}`);
    process.exit(1);
  });
}
