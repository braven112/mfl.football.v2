#!/usr/bin/env node
/**
 * Refresh the committed NFL team logos in public/assets/nfl-logos/.
 *
 * MANUAL script — not a prebuild step. These SVGs are COMMITTED (see
 * docs/claude/rules/theming-and-assets.md § "NFL team logos"): they are
 * rendered by every player cell, a 404 here is cache-poisonous rather than
 * cosmetic, and the directory must never be gitignored. Run this when a team
 * rebrands, then commit the diff.
 *
 *   node scripts/download-nfl-logos.mjs            # fetch + write
 *   node scripts/download-nfl-logos.mjs --dry-run  # report the diff only
 *
 * ── Why NFL.com and not mflscripts ────────────────────────────────────────
 * This used to pull https://www.mflscripts.com/.../nflTeamsvg_2/{CODE}.svg.
 * That mirror is frozen: as of 2026-09 it still served the PRE-rebrand
 * Titans mark (navy #1f3263 sword) and the pre-rebrand Rams mark, both of
 * which the league replaced in 2026. `static.www.nfl.com/league/api/clubs/
 * logos/{CODE}.svg` is the league's own club endpoint, so it flips the day a
 * club rebrands — which is the whole point of re-running this script.
 *
 * ── Two transforms, both load-bearing ─────────────────────────────────────
 * NFL.com's export is NOT drop-in. Applying it raw is a visible regression:
 *
 *  1. SQUARE PADDING. Every NFL.com mark sits inset inside a 500x500 box,
 *     while the art this repo has always shipped is tight-cropped. Measured
 *     across all 32, a raw swap renders marks at 0.76x–1.00x of their current
 *     size, and UNEVENLY — PIT/TEN/IND/LV/NYG lose ~24% while BAL/DAL/SEA
 *     barely move, so player cells would end up with visibly mismatched logo
 *     weights. `trimViewBox` rasterizes the mark, finds its real ink bounding
 *     box, and rewrites the viewBox to it (width/height stripped), which is
 *     exactly the shape the existing committed files already have.
 *  2. WEIGHT. NFL.com ships full-precision unoptimized paths — JAX is 151KB
 *     raw against 25KB today, and this art is served to every phone on every
 *     player row. svgo at floatPrecision 2 gives back ~53%.
 *
 * `removeViewBox` MUST stay disabled in the svgo preset: it strips a viewBox
 * that matches width/height, which is precisely our input, and a viewBox-less
 * SVG renders at a fixed intrinsic size instead of filling its cell.
 *
 * ── Aliases ───────────────────────────────────────────────────────────────
 * Several pages render the RAW MFL/legacy feed code without normalizing, so
 * each canonical mark is also written under every alias that resolves to it
 * (TEAM_CODE_MAP in src/utils/nfl-logo.ts — GBP, KCC, OAK, STL, SD, …).
 * Relocated-team codes are aliases of the CURRENT club, not historical marks:
 * STL.svg is today's Rams logo, which is the long-standing behavior here.
 *
 * The three shield files (FA/UFA/NFL) have no upstream club endpoint and are
 * never touched by this script.
 *
 * Guard: tests/nfl-logo-assets.test.ts (every canonical code and every alias
 * has a well-formed committed SVG).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { optimize } from 'svgo';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const logosDir = path.join(projectRoot, 'public', 'assets', 'nfl-logos');
const dryRun = process.argv.includes('--dry-run');

/**
 * Canonical ESPN codes — mirrors getAllNFLTeamCodes() in src/utils/nfl-logo.ts
 * (TS, not importable from a node script). tests/nfl-logo-assets.test.ts is
 * what fails if the two ever diverge.
 */
const CANONICAL_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH',
];

/**
 * Canonical code → the code NFL.com's club endpoint uses. Washington is the
 * only disagreement: we canonicalize on ESPN's WSH, NFL.com serves WAS
 * (WSH 404s there).
 */
const NFL_DOT_COM_CODE = { WSH: 'WAS' };

/**
 * Alias filename → canonical code it renders as. Mirrors TEAM_CODE_MAP in
 * src/utils/nfl-logo.ts, minus the FA/UFA/FA* shield entries this script
 * does not own.
 */
/**
 * Clubs whose NFL.com mark is NOT the right primary for a light player cell,
 * so this script leaves their committed art alone.
 *
 * NFL.com's club endpoint is not editorially uniform: for some clubs it
 * serves a reversed (light-background) cut or the club's SECONDARY mark
 * rather than the primary everything else on this site shows. Measured
 * against the art it would replace, exactly three of the 32 differ for that
 * reason rather than because the club rebranded — the other three big movers
 * (TEN 32%, LAR 20%, WSH 20%) are real 2026 rebrands and ARE adopted.
 *
 * Revisit a code here only against a rendered before/after, never on the
 * strength of the upstream having changed: "NFL.com updated it" is what put
 * a white-filled Jets oval on a white cell in the first place.
 */
const KEEP_COMMITTED = {
  CHI: "NFL.com serves the bear head (the Bears' secondary); the primary is the orange C",
  NYG: "NFL.com serves an outlined 'ny'; the primary is the solid blue NY",
  NYJ: 'NFL.com serves the reversed oval (green on white) — invisible-edged on a white cell',
};

const ALIASES = {
  WAS: 'WSH', JAC: 'JAX', GBP: 'GB', KCC: 'KC', NEP: 'NE',
  NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', HST: 'HOU',
  BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', OAK: 'LV', SDC: 'LAC',
  SD: 'LAC', RAM: 'LAR', STL: 'LAR',
};

const logoUrl = (code) =>
  `https://static.www.nfl.com/league/api/clubs/logos/${NFL_DOT_COM_CODE[code] ?? code}.svg`;

const svgoConfig = {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    // NOTE: never add 'removeViewBox'. Our input's viewBox matches its
    // width/height, which is exactly the case that plugin strips, and a
    // viewBox-less SVG renders at a fixed intrinsic size instead of filling
    // its cell. svgo 4 dropped it from preset-default, so plain
    // preset-default is already safe — it only comes back if someone adds it.
    'preset-default',
    'removeDimensions',
  ],
};

/**
 * Rewrite an SVG's viewBox to the bounding box of its visible ink, so the
 * mark fills its box the way the existing committed art does.
 *
 * Rasterizes at 4x the viewBox and reads the alpha channel; alpha > 8 rather
 * than > 0 ignores the near-transparent fringe antialiasing leaves behind,
 * which would otherwise report a box a pixel or two wide on every edge.
 */
async function trimViewBox(svg, code) {
  const match = svg.match(/viewBox="([\d.\-\s]+)"/);
  if (!match) throw new Error('no viewBox to trim');
  const [vx, vy, vw, vh] = match[1].trim().split(/\s+/).map(Number);
  if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) {
    throw new Error(`unusable viewBox "${match[1]}"`);
  }

  const RASTER = 1000;
  const { data, info } = await sharp(Buffer.from(svg), { density: 300 })
    .resize(RASTER, RASTER, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('rasterized to nothing (empty or unrenderable SVG)');

  // Back to user units, with a half-unit of slack so antialiased edges are
  // not clipped by the rounding.
  const sx = vw / info.width;
  const sy = vh / info.height;
  const PAD = 0.5;
  const nx = Math.max(vx, vx + minX * sx - PAD);
  const ny = Math.max(vy, vy + minY * sy - PAD);
  const nw = Math.min(vx + vw, vx + (maxX + 1) * sx + PAD) - nx;
  const nh = Math.min(vy + vh, vy + (maxY + 1) * sy + PAD) - ny;

  const round = (n) => Number(n.toFixed(2));
  const trimmed = `${round(nx)} ${round(ny)} ${round(nw)} ${round(nh)}`;
  const coverage = Math.max(nw / vw, nh / vh);
  if (coverage < 0.2) {
    // A mark occupying under a fifth of its own box means the raster went
    // wrong (a filter or mask sharp could not resolve), not a small logo.
    throw new Error(`trim looks wrong for ${code}: ink covers only ${(coverage * 100).toFixed(0)}% of the viewBox`);
  }
  return svg.replace(match[0], `viewBox="${trimmed}"`);
}

async function writeIfChanged(file, content) {
  let existing = null;
  try {
    existing = await fs.readFile(file, 'utf-8');
  } catch {
    /* new file */
  }
  if (existing === content) return 'unchanged';
  if (!dryRun) await fs.writeFile(file, content, 'utf-8');
  return existing === null ? 'added' : 'changed';
}

async function buildLogo(code) {
  const res = await fetch(logoUrl(code), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFLLogoDownloader/2.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const raw = await res.text();
  if (!/^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(raw)) {
    throw new Error(`response is not an SVG (${raw.length} bytes)`);
  }

  const optimized = optimize(raw, svgoConfig).data;
  const trimmed = await trimViewBox(optimized, code);
  return { svg: trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`, rawBytes: raw.length };
}

async function run() {
  await fs.mkdir(logosDir, { recursive: true });
  console.log(`📁 ${logosDir}${dryRun ? '  (dry run — nothing will be written)' : ''}\n`);

  const built = new Map();
  const failures = [];

  for (const code of CANONICAL_CODES) {
    if (KEEP_COMMITTED[code]) {
      console.log(`· ${code.padEnd(4)} kept — ${KEEP_COMMITTED[code]}`);
      continue;
    }
    try {
      const { svg, rawBytes } = await buildLogo(code);
      built.set(code, svg);
      const saved = Math.round((1 - svg.length / rawBytes) * 100);
      console.log(`✓ ${code.padEnd(4)} ${String(rawBytes).padStart(7)}b → ${String(svg.length).padStart(6)}b (-${saved}%)`);
    } catch (err) {
      failures.push(code);
      console.error(`✗ ${code.padEnd(4)} ${err.message}`);
    }
  }

  // A partial run must not write: the canonical file and its aliases have to
  // move together, and half a refresh leaves two teams' art disagreeing
  // across pages that normalize and pages that don't.
  if (failures.length) {
    console.error(`\n✗ ${failures.length} logo(s) failed (${failures.join(', ')}) — writing nothing.`);
    process.exitCode = 1;
    return;
  }

  const counts = { added: 0, changed: 0, unchanged: 0 };
  const touched = [];
  for (const [code, svg] of built) {
    const targets = [code, ...Object.keys(ALIASES).filter((a) => ALIASES[a] === code)];
    for (const target of targets) {
      const result = await writeIfChanged(path.join(logosDir, `${target}.svg`), svg);
      counts[result]++;
      if (result !== 'unchanged') touched.push(`${target} (${result})`);
    }
  }

  console.log(`\n📊 ${counts.changed} changed, ${counts.added} added, ${counts.unchanged} unchanged`);
  if (touched.length) console.log(`   ${touched.join(', ')}`);
  console.log(dryRun ? '\nDry run complete.' : '\n✅ Logos refreshed — review the diff, then commit.');
}

run().catch((err) => {
  console.error('✗ download-nfl-logos failed:', err);
  process.exitCode = 1;
});
