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

/**
 * An SVG dark cut (NFL.com is the only vector source) needs its own check: it
 * has no magic bytes and is an order of magnitude smaller than a PNG, so the
 * PNG floor would reject every real one. A 200-byte floor still catches the
 * case the PNG floor exists for — a CDN error page saved under a .svg name.
 */
export function isValidSvg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 200) return false;
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/.test(
    buf.subarray(0, 512).toString('utf-8'),
  );
}

/** Validate fetched bytes against the format the caller declared for them. */
export function isValidAsset(buf, format) {
  return format === 'svg' ? isValidSvg(buf) : isValidPng(buf);
}

async function fetchAsset(url, format) {
  return fetchWithRetry(url, {
    attempts: 3,
    baseDelayMs: 500,
    // One overall budget per logo (not per attempt) — AbortSignal.timeout
    // starts ticking at creation and fetchWithRetry reuses fetchOptions
    // across attempts, so a per-attempt-sized value would starve retries.
    fetchOptions: { signal: AbortSignal.timeout(45000) },
    parse: async (res) => {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isValidAsset(buf, format)) {
        throw new Error(`response is not a valid ${format.toUpperCase()} (${buf.length} bytes)`);
      }
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
 * @param {Array<{ key: string, url: string, format?: 'png'|'svg' }>} opts.items
 *   one per logo; `key` becomes the local filename (`{key}.{format}`) and
 *   manifest entry. `format` defaults to 'png' — the college mirror passes
 *   none and is unaffected.
 * @param {(buf: Buffer, item: object) => Promise<Buffer>|Buffer} [opts.transform]
 *   applied to the fetched bytes before they are written. The NFL mirror uses
 *   it to run an SVG cut through the same optimise + ink-box trim its LIGHT
 *   art goes through, so a theme swap does not change the mark's rendered
 *   size.
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
  transform,
}) {
  fs.mkdirSync(outDir, { recursive: true });

  let fetched = 0;
  let failed = 0;

  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const format = item.format ?? 'png';
      const outPath = path.join(outDir, `${item.key}.${format}`);
      const tmpPath = `${outPath}.tmp`;
      try {
        let buf = await fetchAsset(item.url, format);
        if (transform) buf = Buffer.from(await transform(buf, item));
        fs.writeFileSync(tmpPath, buf);
        fs.renameSync(tmpPath, outPath);
        fetched++;
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${item.key}: ${err.message}`);
        fs.rmSync(tmpPath, { force: true });
        // NOTE: a 404 here is NOT treated as "permanently missing upstream" —
        // ESPN's CDN serves transient 404s (observed: PIT 404'd on one Vercel
        // build minutes after fetching fine), so build-time inference would
        // randomly drop a real team's dark swap for a whole deploy. Logos
        // known to have no dark cut at all are curated instead (see
        // KNOWN_MISSING_NCAA_DARK_IDS in src/utils/college-logo-dark-css.ts).
      }
    }
  });
  await Promise.all(workers);

  // The manifest reflects what is actually on disk (this run's fetches plus
  // any still-valid file from a previous local run), not what we attempted.
  const present = items
    .filter((item) => {
      const format = item.format ?? 'png';
      const p = path.join(outDir, `${item.key}.${format}`);
      try {
        return isValidAsset(fs.readFileSync(p), format);
      } catch {
        return false;
      }
    })
    .map((item) => item.key)
    .sort();

  // Formats are recorded ONLY when something is not a PNG, so a mirror whose
  // cuts are all PNG (the college one) writes a byte-identical manifest to
  // before this field existed.
  const formats = {};
  for (const item of items) {
    if ((item.format ?? 'png') !== 'png' && present.includes(item.key)) {
      formats[item.key] = item.format;
    }
  }

  // tmp+rename like the PNGs above — this tracked JSON is statically imported
  // by astro build, so a truncated half-write would break every subsequent
  // build/dev/test until manually reverted.
  const manifestTmp = `${manifestPath}.tmp`;
  const manifest = { [manifestField]: present };
  if (Object.keys(formats).length) {
    manifest.formats = Object.fromEntries(Object.keys(formats).sort().map((k) => [k, formats[k]]));
  }
  fs.writeFileSync(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(manifestTmp, manifestPath);

  console.log(
    `[${label}] ${fetched} fetched, ${failed} failed; manifest lists ${present.length}/${items.length} logos`,
  );
  if (present.length < items.length) {
    console.warn(`[${label}] missing logos fall back to the ESPN CDN swap (pre-self-hosting behavior)`);
  }
}
