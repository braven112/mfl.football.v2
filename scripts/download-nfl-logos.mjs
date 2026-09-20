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

import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { optimize } from 'svgo';
import {
  ALIASES,
  CANONICAL_CODES,
  KEEP_COMMITTED,
  nflDotComLogoUrl,
} from './lib/nfl-logo-sources.mjs';

/**
 * How far a refreshed mark may drift from the committed one before this
 * script refuses to write it and asks for a human look (percent mean pixel
 * distance, rendered on white).
 *
 * The committed art now comes from this same upstream, so a routine re-run
 * scores ~0 and passes silently. Anything meaningfully above that means
 * NFL.com changed the artwork — a rebrand, or a club's cut flipping to its
 * dark variant, which is the failure that would otherwise put a white-bodied
 * mark on a white cell. 8% sits well above raster rounding noise and well
 * below the smallest real change measured here (WSH's rebrand, ~20%).
 */
const DRIFT_THRESHOLD_PCT = 8;

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const logosDir = path.join(projectRoot, 'public', 'assets', 'nfl-logos');
const dryRun = process.argv.includes('--dry-run');
const acceptAll = process.argv.includes('--accept-all');
/** Codes the operator has explicitly looked at and approved this run. */
const accepted = new Set(
  process.argv
    .filter((a) => a.startsWith('--accept='))
    .flatMap((a) => a.slice('--accept='.length).split(','))
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
);

const logoUrl = nflDotComLogoUrl;

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
export async function trimViewBox(svg, code) {
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

/**
 * Mean per-pixel distance between two SVGs rendered on white, as a percent.
 *
 * Rendered ON WHITE deliberately: that is the background the player cell
 * uses, so a cut that flips to its for-dark variant (white body, thin
 * keyline) scores as the large change it visually is, rather than being
 * flattened away by comparing on transparency.
 */
async function renderDrift(svgA, svgB) {
  const N = 96;
  const render = (svg) =>
    sharp(Buffer.from(svg), { density: 200 })
      .resize(N, N, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer({ resolveWithObject: true });

  const [a, b] = await Promise.all([render(svgA), render(svgB)]);
  let sum = 0;
  const px = a.data.length / a.info.channels;
  for (let i = 0; i < a.data.length; i += a.info.channels) {
    const dr = a.data[i] - b.data[i];
    const dg = a.data[i + 1] - b.data[i + 1];
    const db = a.data[i + 2] - b.data[i + 2];
    sum += Math.sqrt(dr * dr + dg * dg + db * db);
  }
  // 441 = the maximum possible RGB distance (sqrt(3) * 255).
  return (sum / px / 441) * 100;
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

/**
 * The full NFL.com -> committed-file transform, exported so other tooling
 * (e.g. the source-set comparison page generator) can render a candidate set
 * through exactly the same pipeline rather than approximating it.
 */
export function optimizeAndTrimSvg(raw, code) {
  if (!/^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(raw)) {
    throw new Error(`not an SVG (${raw.length} bytes)`);
  }
  return trimViewBox(optimize(raw, svgoConfig).data, code);
}

async function buildLogo(code) {
  const res = await fetch(logoUrl(code), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NFLLogoDownloader/2.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const raw = await res.text();
  const trimmed = await optimizeAndTrimSvg(raw, code);
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

  // Drift gate. The committed art comes from this same upstream, so a mark
  // that now renders differently means NFL.com changed it — a rebrand, or a
  // cut flipping to its dark variant. Neither should land unlooked-at, so
  // hold it back and make the operator pass --accept=CODE after seeing it.
  const held = [];
  for (const [code, svg] of [...built]) {
    if (acceptAll || accepted.has(code)) continue;
    let committed;
    try {
      committed = await fs.readFile(path.join(logosDir, `${code}.svg`), 'utf-8');
    } catch {
      continue; // No committed art to drift from — a new club.
    }
    const drift = await renderDrift(committed, svg);
    if (drift > DRIFT_THRESHOLD_PCT) {
      built.delete(code);
      held.push({ code, drift });
    }
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

  if (held.length) {
    console.log(`\n⚠️  ${held.length} mark(s) HELD BACK — NFL.com's artwork changed:`);
    for (const { code, drift } of held) {
      console.log(`     ${code.padEnd(4)} ${drift.toFixed(1)}% different from the committed file`);
    }
    console.log(
      '\n   Render each on BOTH a white and a dark background before deciding.\n' +
        '   A club that rebranded → adopt it. A cut that flipped to its for-dark\n' +
        '   variant (white body, thin keyline) → add it to KEEP_COMMITTED instead.\n' +
        `   Then re-run with --accept=${held.map((h) => h.code).join(',')}`,
    );
  }

  console.log(dryRun ? '\nDry run complete.' : '\n✅ Logos refreshed — review the diff, then commit.');
}

// Only run when invoked directly — the transform above is imported elsewhere.
// realpath both sides: node resolves a module specifier to its real path while
// argv[1] keeps whatever path the shell used, so a symlinked checkout would
// otherwise compare unequal and turn this script into a silent no-op that
// exits 0 having refreshed nothing.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  const real = (p) => {
    try {
      return fsSync.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
})();

if (invokedDirectly) {
  run().catch((err) => {
    console.error('✗ download-nfl-logos failed:', err);
    process.exitCode = 1;
  });
}
