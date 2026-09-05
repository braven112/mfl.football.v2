#!/usr/bin/env node
/**
 * Measure how legible each TV network mark is on the DARK card surface, and
 * write the list that needs a white outline to survive there.
 *
 * The sibling of `measure-crest-contrast.mjs`, for `public/assets/tv-logos/`
 * — the channel and Sunday Ticket carrier marks the Sunday Ticket board draws
 * from `data/theleague/broadcast-mappings.json`. Same rule, same numbers: a
 * mark is judged by the fraction of its opaque pixels clearing 3:1 against
 * `--card-surface` in dark mode, and a mark that declares a `logoDark` (white
 * artwork drawn for dark surfaces — DAZN's, YouTube TV's) is skipped outright
 * because it swaps rather than strokes.
 *
 * Run: pnpm measure:tv-logo-contrast            (writes the manifest)
 *      pnpm measure:tv-logo-contrast --report   (prints every score, writes nothing)
 *
 * The manifest is COMMITTED. Re-run after adding or replacing a mark, or after
 * adding a `logoDark`; `tests/tv-logo-dark-stroke.test.ts` fails if the
 * committed manifest drifts from what the current assets measure.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { measureCrest, STROKE_THRESHOLD, DARK_CARD_SURFACE } from './measure-crest-contrast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPPINGS_PATH = path.join(ROOT, 'data/theleague/broadcast-mappings.json');
const MANIFEST_PATH = path.join(ROOT, 'src/data/tv-logo-dark-stroke-manifest.json');
export const TV_LOGO_DIR = '/assets/tv-logos';

/**
 * Every mark the mapping file can put on the page, once each, with the dark
 * variant it names (if any). Channels and the per-country Sunday Ticket
 * carrier both count — the board renders both.
 */
export function collectTvLogos(mappings = JSON.parse(readFileSync(MAPPINGS_PATH, 'utf8'))) {
  const byFile = new Map();
  const add = (owner, logo, logoDark) => {
    if (!logo) return;
    const prev = byFile.get(logo);
    byFile.set(logo, { file: logo, logoDark: logoDark ?? prev?.logoDark ?? null, usedBy: [...(prev?.usedBy ?? []), owner] });
  };
  for (const [code, country] of Object.entries(mappings.countries ?? {})) {
    for (const [key, ch] of Object.entries(country.channels ?? {})) add(`${code}/${key}`, ch.logo, ch.logoDark);
    if (country.sundayTicket) add(`${code}/sundayTicket`, country.sundayTicket.logo, country.sundayTicket.logoDark);
  }
  // The RedZone mark is a constant on the board (REDZONE_LOGO), not a mapping entry.
  add('board/redzone', 'nfl-red-zone.png', null);
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
}

export async function measureAllTvLogos(mappings) {
  const results = [];
  for (const entry of collectTvLogos(mappings)) {
    if (entry.logoDark) {
      results.push({ ...entry, legible: null });
      continue;
    }
    const legible = await measureCrest(path.join(ROOT, 'public', TV_LOGO_DIR, entry.file));
    results.push({ ...entry, legible });
  }
  return results;
}

/** The manifest: marks below the threshold (stroke) and marks with a dark variant (swap). */
export function buildTvLogoManifest(results) {
  return {
    threshold: STROKE_THRESHOLD,
    minRatio: 3,
    background: `#${DARK_CARD_SURFACE.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
    needsStroke: results
      .filter((r) => !r.logoDark && r.legible !== null && r.legible < STROKE_THRESHOLD)
      .map((r) => ({ file: r.file, legible: Number(r.legible.toFixed(3)) })),
    darkVariants: results.filter((r) => r.logoDark).map((r) => ({ file: r.file, dark: r.logoDark })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportOnly = process.argv.includes('--report');
  const results = await measureAllTvLogos();
  for (const r of results) {
    const score = r.legible === null ? `swap → ${r.logoDark}` : `${(r.legible * 100).toFixed(1)}% legible${r.legible < STROKE_THRESHOLD ? '  ← stroke' : ''}`;
    console.log(`${r.file.padEnd(22)} ${score}`);
  }
  if (!reportOnly) {
    const manifest = buildTvLogoManifest(results);
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nWrote ${path.relative(ROOT, MANIFEST_PATH)}: ${manifest.needsStroke.length} stroked, ${manifest.darkVariants.length} swapped.`);
  }
}
