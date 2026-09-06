#!/usr/bin/env node
/**
 * Measure how legible each TV network mark is on BOTH card surfaces, and write
 * the lists that need an outline to survive there.
 *
 * The sibling of `measure-crest-contrast.mjs`, for `public/assets/tv-logos/`
 * — the channel and Sunday Ticket carrier marks the Sunday Ticket board draws
 * from `data/theleague/broadcast-mappings.json`. Same rule, same numbers: a
 * mark is judged by the fraction of its opaque pixels clearing 3:1 against
 * `--card-surface`, and a mark that declares a `logoDark` (white artwork drawn
 * for dark surfaces — DAZN's, YouTube TV's) is skipped in the DARK pass
 * outright because it swaps rather than strokes.
 *
 * The LIGHT pass exists because the marks made the reverse problem real: a
 * broadcaster whose brand IS pale (Channel 5's yellow 5, Kayo's light green)
 * is invisible on a white card the way a black crest is on #262626, and there
 * is no light-mode artwork to swap to. It runs over the same entries — every
 * file the mapping renders as a `logo`, so a white `logoDark` is not in the set
 * and cannot be flagged for a surface it never appears on.
 *
 * The two passes do NOT share a threshold, and that is the point. Dark uses
 * 0.5: with only a third of a black wordmark clearing #262626 it is genuinely
 * hard to read. Light uses 0.25, because on white the common shape is a mark
 * whose INTERIOR is pale — CBS's white lettering, NBC's peacock, Prime's
 * arrow — and those read fine off their dark silhouettes; ringing them would
 * put a halo on marks nobody struggles with. Below a quarter the mark is not
 * "partly pale", it IS pale, and the measured gap is wide (Kayo 18%, then
 * nothing until Prime at 36%).
 *
 * Run: pnpm measure:tv-logo-contrast            (writes the manifest)
 *      pnpm measure:tv-logo-contrast --report   (prints every score, writes nothing)
 *
 * The manifest is COMMITTED. Re-run after adding or replacing a mark, or after
 * adding a `logoDark`; `tests/tv-logo-theme-stroke.test.ts` fails if the
 * committed manifest drifts from what the current assets measure.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { measureCrest, STROKE_THRESHOLD, DARK_CARD_SURFACE, LIGHT_CARD_SURFACE } from './measure-crest-contrast.mjs';

/**
 * A mark needs the LIGHT-card ring below this. Deliberately stricter than the
 * dark pass — see the header: a mark with pale DETAIL is not a pale mark.
 */
export const LIGHT_STROKE_THRESHOLD = 0.25;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPPINGS_PATH = path.join(ROOT, 'data/theleague/broadcast-mappings.json');
const MANIFEST_PATH = path.join(ROOT, 'src/data/tv-logo-stroke-manifest.json');
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
  // The official Sunday Ticket mark in the page headline (SUNDAY_TICKET_LOGO).
  add('page/headline', 'nfl-sunday-ticket.png', null);
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
}

export async function measureAllTvLogos(mappings) {
  const results = [];
  for (const entry of collectTvLogos(mappings)) {
    const file = path.join(ROOT, 'public', TV_LOGO_DIR, entry.file);
    // The light score is measured for every mark, dark-variant declarers
    // included: `logoDark` says what to draw on the DARK card and has no
    // bearing on whether the light artwork survives the white one.
    const legibleLight = await measureCrest(file, LIGHT_CARD_SURFACE);
    if (entry.logoDark) {
      results.push({ ...entry, legible: null, legibleLight });
      continue;
    }
    const legible = await measureCrest(file, DARK_CARD_SURFACE);
    results.push({ ...entry, legible, legibleLight });
  }
  return results;
}

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/**
 * The manifest: marks that need a ring on the dark card, marks that need one
 * on the light card, and marks that swap to dark artwork instead.
 */
export function buildTvLogoManifest(results) {
  return {
    threshold: STROKE_THRESHOLD,
    lightThreshold: LIGHT_STROKE_THRESHOLD,
    minRatio: 3,
    background: hex(DARK_CARD_SURFACE),
    lightBackground: hex(LIGHT_CARD_SURFACE),
    needsStroke: results
      .filter((r) => !r.logoDark && r.legible !== null && r.legible < STROKE_THRESHOLD)
      .map((r) => ({ file: r.file, legible: Number(r.legible.toFixed(3)) })),
    needsLightStroke: results
      .filter((r) => r.legibleLight !== null && r.legibleLight < LIGHT_STROKE_THRESHOLD)
      .map((r) => ({ file: r.file, legible: Number(r.legibleLight.toFixed(3)) })),
    darkVariants: results.filter((r) => r.logoDark).map((r) => ({ file: r.file, dark: r.logoDark })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportOnly = process.argv.includes('--report');
  const results = await measureAllTvLogos();
  for (const r of results) {
    const dark = r.legible === null ? `swap → ${r.logoDark}` : `${(r.legible * 100).toFixed(1)}%${r.legible < STROKE_THRESHOLD ? ' ← stroke' : ''}`;
    const light = r.legibleLight === null ? 'n/a' : `${(r.legibleLight * 100).toFixed(1)}%${r.legibleLight < LIGHT_STROKE_THRESHOLD ? ' ← stroke' : ''}`;
    console.log(`${r.file.padEnd(22)} dark ${dark.padEnd(24)} light ${light}`);
  }
  if (!reportOnly) {
    const manifest = buildTvLogoManifest(results);
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `\nWrote ${path.relative(ROOT, MANIFEST_PATH)}: ${manifest.needsStroke.length} stroked on dark, ` +
      `${manifest.needsLightStroke.length} on light, ${manifest.darkVariants.length} swapped.`,
    );
  }
}
