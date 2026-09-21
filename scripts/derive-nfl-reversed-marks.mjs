#!/usr/bin/env node
/**
 * Write the derived reversed cuts from the curated colour map.
 *
 * Run by hand alongside `download-nfl-logos.mjs`, not in prebuild: the output
 * is COMMITTED art derived from committed art, so it belongs in the diff where
 * a human can look at it — the same reason the light SVGs are committed rather
 * than fetched at build time. The dark mirror is the opposite case (it is
 * fetched from a CDN, gitignored, and tracked by a manifest).
 *
 *   node scripts/derive-nfl-reversed-marks.mjs          # write
 *   node scripts/derive-nfl-reversed-marks.mjs --check  # verify, write nothing
 *
 * `--check` is what the guard test runs: it fails if any committed reversed
 * file disagrees with what the map would produce today, which catches both a
 * hand-edited output and a light SVG that moved underneath the map.
 *
 * Plan: docs/plans/nfl-mark-assignments.md § "Phase 3 — the reversed cut".
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LIGHT_DIR,
  REVERSED_DIR,
  loadReversals,
  reverseSvg,
} from './lib/nfl-mark-reversal.mjs';

export function derive() {
  const clubs = loadReversals();
  return Object.entries(clubs).map(([code, entry]) => {
    const lightPath = path.join(LIGHT_DIR, `${code}.svg`);
    if (!fs.existsSync(lightPath)) throw new Error(`${code}: no committed SVG at ${lightPath}`);
    const svg = fs.readFileSync(lightPath, 'utf-8');
    let out;
    try {
      out = reverseSvg(svg, entry.map);
    } catch (err) {
      throw new Error(`${code}: ${err.message}`);
    }
    return { code, svg: out, outPath: path.join(REVERSED_DIR, `${code}.svg`) };
  });
}

function main() {
  const check = process.argv.includes('--check');
  const results = derive();
  fs.mkdirSync(REVERSED_DIR, { recursive: true });

  let drifted = 0;
  for (const { code, svg, outPath } of results) {
    // Read and let a missing file BE the answer, rather than asking whether it
    // exists and then reading it — that pair is a race, and CodeQL flags it as
    // one. Only "not there" is absent; anything else is a real failure.
    let existing = null;
    try {
      existing = fs.readFileSync(outPath, 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (existing === svg) {
      console.log(`  ${code}  unchanged`);
      continue;
    }
    drifted += 1;
    if (check) {
      console.error(`  ${code}  DRIFT — ${existing === null ? 'not committed' : 'differs from the map'}`);
      continue;
    }
    fs.writeFileSync(outPath, svg);
    console.log(`  ${code}  ${existing === null ? 'written' : 'updated'} -> ${path.relative(process.cwd(), outPath)}`);
  }

  // A club dropped from the map must lose its file too, or the Brand Book keeps
  // offering a cut nothing derives any more.
  const keep = new Set(results.map((r) => `${r.code}.svg`));
  for (const f of fs.existsSync(REVERSED_DIR) ? fs.readdirSync(REVERSED_DIR) : []) {
    if (f.endsWith('.svg') && !keep.has(f)) {
      drifted += 1;
      if (check) console.error(`  ${f}  ORPHAN — no entry in the reversal map`);
      else {
        fs.unlinkSync(path.join(REVERSED_DIR, f));
        console.log(`  ${f}  removed (no longer in the map)`);
      }
    }
  }

  if (check && drifted) {
    console.error(`\n${drifted} file(s) out of step. Run: node scripts/derive-nfl-reversed-marks.mjs`);
    process.exit(1);
  }
  console.log(`\n${results.length} reversed cut(s) ${check ? 'verified' : 'up to date'}.`);
}

if (fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
