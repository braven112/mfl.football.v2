#!/usr/bin/env node
/**
 * Measure how legible each team crest is on the DARK card surface, and write
 * the list of crests that need a white outline to survive there.
 *
 * Why this exists: the compact homepage standings cards render the crest
 * INSTEAD of the team name, so the crest is the row's only identifier. A
 * franchise whose logo is mostly near-black (Badd Boys, Da Dangsters, …)
 * disappears into the dark card. The real fix is a hand-authored `iconDark`,
 * but only 1 of 24 AFL teams has one, so crests without a dark variant get a
 * generated white stroke instead (see src/utils/crest-dark-stroke-css.ts).
 *
 * A crest is judged by the fraction of its OPAQUE pixels that clear WCAG 3:1
 * against `--card-surface` in tokens-dark.css. Teams that already declare an
 * `iconDark` are skipped outright — they swap to artwork drawn for dark mode,
 * so their light crest's score is irrelevant.
 *
 * Run: pnpm measure:crest-contrast        (writes the manifest)
 *      pnpm measure:crest-contrast --report   (prints every score, writes nothing)
 *
 * The manifest is COMMITTED. Re-run this after adding or replacing any team
 * icon, or after adding an `iconDark`; `tests/crest-dark-stroke.test.ts` fails
 * if the committed manifest drifts from what the current assets measure.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `--card-surface` from src/styles/tokens-dark.css — the solid behind a dark card. */
export const DARK_CARD_SURFACE = [0x26, 0x26, 0x26];

/**
 * A crest needs the stroke when fewer than this fraction of its opaque pixels
 * clear 3:1 on the dark card. 0.5 = "less than half the logo is legible".
 * Above it, a white outline reads as an unnecessary halo rather than a help.
 */
export const STROKE_THRESHOLD = 0.5;

/** Contrast floor a pixel must clear to count as legible. */
const MIN_RATIO = 3;

/** Ignore near-transparent antialiasing fringe. */
const MIN_ALPHA = 128;

function relativeLuminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const BG_LUM = relativeLuminance(DARK_CARD_SURFACE);

function contrastRatio(pixel) {
  const l = relativeLuminance(pixel);
  return (Math.max(l, BG_LUM) + 0.05) / (Math.min(l, BG_LUM) + 0.05);
}

/**
 * Fraction of a crest's opaque pixels that clear MIN_RATIO on the dark card.
 * Returns null when the file can't be read or has no opaque pixels.
 */
export async function measureCrest(absPath) {
  let raw;
  try {
    raw = await sharp(absPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }
  const { data } = raw;
  let opaque = 0;
  let legible = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;
    opaque++;
    if (contrastRatio([data[i], data[i + 1], data[i + 2]]) >= MIN_RATIO) legible++;
  }
  return opaque === 0 ? null : legible / opaque;
}

/**
 * Resolve a config `icon` value to a file under public/. AFL configs store
 * ABSOLUTE production URLs (a long-standing quirk documented in
 * docs/claude/insights/features/dark-mode-team-icons.md) while the files
 * themselves live locally, so take the pathname either way.
 */
export function iconToPublicPath(icon) {
  const pathname = icon.startsWith('http') ? new URL(icon).pathname : icon;
  return path.join(ROOT, 'public', pathname);
}

export async function measureAllCrests() {
  const leagues = [
    { slug: 'theleague', config: JSON.parse(readFileSync(path.join(ROOT, 'src/data/theleague.config.json'), 'utf8')) },
    { slug: 'afl', config: JSON.parse(readFileSync(path.join(ROOT, 'data/afl-fantasy/afl.config.json'), 'utf8')) },
  ];

  const results = [];
  for (const { slug, config } of leagues) {
    for (const team of config.teams ?? []) {
      if (!team.icon) continue;
      // A hand-authored dark variant always wins — never stroke those.
      // Note what the manifest therefore is and isn't: it records what the
      // PIXELS measure, so a team can appear here and still render un-stroked
      // because its config sets `iconStrokeDark: false`. That opt-out is applied
      // at CSS-build time, deliberately not baked in here — regenerating this
      // file must never silently drop a human's override.
      if (team.iconDark) {
        results.push({ league: slug, franchiseId: team.franchiseId, name: team.name, icon: team.icon, hasIconDark: true, legible: null });
        continue;
      }
      const legible = await measureCrest(iconToPublicPath(team.icon));
      results.push({ league: slug, franchiseId: team.franchiseId, name: team.name, icon: team.icon, hasIconDark: false, legible });
    }
  }
  return results;
}

/** The manifest shape: every crest that scores below the threshold. */
export function buildManifest(results) {
  const needsStroke = results
    .filter((r) => !r.hasIconDark && r.legible !== null && r.legible < STROKE_THRESHOLD)
    .map((r) => ({
      league: r.league,
      franchiseId: r.franchiseId,
      name: r.name,
      icon: r.icon,
      legible: Number(r.legible.toFixed(4)),
    }))
    .sort((a, b) => (a.league === b.league ? a.franchiseId.localeCompare(b.franchiseId) : a.league.localeCompare(b.league)));

  return { threshold: STROKE_THRESHOLD, minRatio: MIN_RATIO, background: '#262626', needsStroke };
}

const MANIFEST_PATH = path.join(ROOT, 'src/data/crest-dark-stroke-manifest.json');

// Only run when invoked directly — the test imports the helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportOnly = process.argv.includes('--report');
  const results = await measureAllCrests();

  if (reportOnly) {
    for (const league of ['theleague', 'afl']) {
      console.log(`\n===== ${league} — crest legibility on ${'#262626'} =====`);
      const rows = results.filter((r) => r.league === league)
        .sort((a, b) => (a.legible ?? 2) - (b.legible ?? 2));
      for (const r of rows) {
        const score = r.hasIconDark ? '  n/a' : `${(r.legible * 100).toFixed(0)}%`.padStart(5);
        const note = r.hasIconDark ? 'has iconDark (swaps)' : r.legible < STROKE_THRESHOLD ? '<-- stroke' : '';
        console.log(`${score}  ${r.name.padEnd(26)} ${note}`);
      }
    }
    process.exit(0);
  }

  const manifest = buildManifest(results);
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const byLeague = manifest.needsStroke.reduce((acc, e) => ({ ...acc, [e.league]: (acc[e.league] ?? 0) + 1 }), {});
  console.log(`Wrote ${path.relative(ROOT, MANIFEST_PATH)} — ${manifest.needsStroke.length} crest(s) need a stroke`, byLeague);
}
