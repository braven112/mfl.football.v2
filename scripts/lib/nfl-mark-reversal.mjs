/**
 * Deriving a club's REVERSED cut from its committed light SVG.
 *
 * Broadcast graphics draw a reversed mark on dark grounds — the body knocked
 * out and the keyline taking a club colour — and no public source publishes
 * one. ESPN, NFL.com, Fox's web CDN, nflverse, Sleeper and mflscripts were all
 * checked; every one serves the standard mark. Our committed SVGs carry flat,
 * discrete fills, so the reversal is a colour swap rather than a redraw.
 *
 * It is a DERIVATION, not the club's official reversed artwork, and will differ
 * from what a broadcast truck renders. That is why the map is curated per club
 * and reviewed on a dark render rather than computed for all 32 — the
 * mechanical pass nominated ten and six of those were declined on review.
 *
 * The swap is pure and total: an unmatched `from` colour is an ERROR, never a
 * silent skip. A logo refresh that moves one fill would otherwise turn a
 * reversal into a no-op (the mark ships unchanged and invisible on dark) or
 * into a mess (half the fills swapped), with nothing to notice it by.
 *
 * Plan: docs/plans/nfl-mark-assignments.md § "Derived marks — the reversed cut".
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const REVERSALS_PATH = path.join(ROOT, 'src', 'data', 'nfl-mark-reversals.json');
export const LIGHT_DIR = path.join(ROOT, 'public', 'assets', 'nfl-logos');
export const REVERSED_DIR = path.join(LIGHT_DIR, 'reversed');

/**
 * Lowercase, six-digit form of a hex colour.
 *
 * SVG authors and svgo both shorten `#000000` to `#000`, and the curated map is
 * written long for readability — comparing the raw strings would miss every
 * shortened fill. ARI's keyline is exactly that case.
 */
export function normalizeHex(hex) {
  const h = String(hex).trim().replace('#', '').toLowerCase();
  if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  return `#${h}`;
}

export function loadReversals(file = REVERSALS_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf-8')).clubs;
}

/** Every colour the file actually paints with, normalized. */
export function fillsIn(svg) {
  const out = new Set();
  for (const m of svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{3,6})"/g)) {
    out.add(normalizeHex(m[1]));
  }
  return out;
}

/**
 * Apply one club's reversal to its committed SVG.
 *
 * Swaps are applied SIMULTANEOUSLY, from a single pass over the file, because
 * Washington's map exchanges its two colours: applied in sequence, the first
 * swap would paint every burgundy gold and the second would paint all of it —
 * both the original gold and the just-made gold — burgundy, leaving a
 * single-colour blob.
 */
export function reverseSvg(svg, map) {
  const lookup = new Map(map.map((m) => [normalizeHex(m.from), normalizeHex(m.to)]));
  const present = fillsIn(svg);
  const missing = [...lookup.keys()].filter((from) => !present.has(from));
  if (missing.length) {
    throw new Error(
      `reversal source colours absent from the committed SVG: ${missing.join(', ')} ` +
        `(present: ${[...present].join(', ')}). The art moved — re-review the map, ` +
        'do not loosen this check.',
    );
  }
  return svg.replace(/((?:fill|stroke|stop-color)=")(#[0-9a-fA-F]{3,6})(")/g, (whole, pre, hex, post) => {
    const to = lookup.get(normalizeHex(hex));
    return to ? `${pre}${to}${post}` : whole;
  });
}
