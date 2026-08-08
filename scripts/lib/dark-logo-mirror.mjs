/**
 * Shared mirror logic for self-hosting ESPN's dark-optimized logo cuts.
 *
 * The dark-mode logo swaps (src/utils/nfl-logo-dark-css.ts,
 * src/utils/college-logo-dark-css.ts) replace rendered logo <img>s with
 * `content: url(...)`. A CSS content replacement has NO error fallback — a
 * failed fetch renders a broken-image icon, not the light logo still in the
 * src attribute. Mirroring the dark cut into public/ during prebuild removes
 * that render-time third-party dependency; the manifest each mirror writes is
 * the safety contract that lets the CSS builders emit local paths only for
 * files a build actually has (see scripts/fetch-nfl-dark-logos.mjs and
 * scripts/fetch-college-dark-logos.mjs for the per-asset-family wiring).
 */

import fs from 'fs';
import path from 'path';
import { fetchWithRetry } from './fetch-retry.mjs';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// The 1KB floor is a sanity check against tiny error payloads served with a
// 200 (CDN edge error pages, empty placeholders): every real ESPN 500px logo
// cut is tens of KB, so anything under 1KB is not a usable logo.
export function isValidPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 1024 && buf.subarray(0, 4).equals(PNG_MAGIC);
}

async function fetchPng(url) {
  return fetchWithRetry(url, {
    attempts: 3,
    baseDelayMs: 500,
    // One overall budget per logo (not per attempt) — AbortSignal.timeout
    // starts ticking at creation and fetchWithRetry reuses fetchOptions
    // across attempts, so a per-attempt-sized value would starve retries.
    fetchOptions: { signal: AbortSignal.timeout(45000) },
    parse: async (res) => {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isValidPng(buf)) throw new Error(`response is not a PNG (${buf.length} bytes)`);
      return buf;
    },
  });
}

/**
 * Mirror a set of remote dark PNGs into `outDir` and write a manifest of the
 * keys whose file is actually valid on disk afterwards.
 *
 * @param {object} opts
 * @param {string} opts.label console prefix, e.g. 'fetch-nfl-dark-logos'
 * @param {Array<{ key: string, url: string }>} opts.items one per logo;
 *   `key` becomes the local filename (`{key}.png`) and manifest entry
 * @param {string} opts.outDir absolute path under public/
 * @param {string} opts.manifestPath absolute path of the manifest JSON
 * @param {string} opts.manifestField manifest key holding the array
 *   ('codes' for NFL team codes, 'ids' for ESPN NCAA ids)
 * @param {number} [opts.concurrency]
 */
export async function mirrorDarkLogos({
  label,
  items,
  outDir,
  manifestPath,
  manifestField,
  concurrency = 8,
}) {
  fs.mkdirSync(outDir, { recursive: true });

  let fetched = 0;
  let failed = 0;

  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const outPath = path.join(outDir, `${item.key}.png`);
      const tmpPath = `${outPath}.tmp`;
      try {
        const buf = await fetchPng(item.url);
        fs.writeFileSync(tmpPath, buf);
        fs.renameSync(tmpPath, outPath);
        fetched++;
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${item.key}: ${err.message}`);
        fs.rmSync(tmpPath, { force: true });
      }
    }
  });
  await Promise.all(workers);

  // The manifest reflects what is actually on disk (this run's fetches plus
  // any still-valid file from a previous local run), not what we attempted.
  const present = items
    .filter((item) => {
      const p = path.join(outDir, `${item.key}.png`);
      try {
        return isValidPng(fs.readFileSync(p));
      } catch {
        return false;
      }
    })
    .map((item) => item.key)
    .sort();

  fs.writeFileSync(manifestPath, `${JSON.stringify({ [manifestField]: present }, null, 2)}\n`);

  console.log(
    `[${label}] ${fetched} fetched, ${failed} failed; manifest lists ${present.length}/${items.length} logos`,
  );
  if (present.length < items.length) {
    console.warn(`[${label}] missing logos fall back to the ESPN CDN swap (pre-self-hosting behavior)`);
  }
}
