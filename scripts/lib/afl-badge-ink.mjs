/**
 * Pure helpers for the AFL badge ink measurement.
 *
 * Deliberately side-effect free and browser-free so `tests/afl-badge-viewbox.test.ts`
 * can import them without launching Chromium — importing the measurement SCRIPT
 * would re-measure and rewrite the fixture on every test run, which would make
 * the guard vacuously pass.
 */
import { createHash } from 'node:crypto';

/** Light/dark pairs, relative to public/. Order is the fixture's order. */
export const BADGE_PAIRS = [
  ['assets/afl/premier.svg', 'assets/afl/premier-dark.svg'],
  ['assets/afl/dleague.svg', 'assets/afl/dleague-dark.svg'],
  ['assets/afl/conferences/al.svg', 'assets/afl/conferences/al-dark.svg'],
  ['assets/afl/conferences/nl.svg', 'assets/afl/conferences/nl-dark.svg'],
];

/**
 * Hash of everything but the root `<svg …>` line — i.e. the artwork.
 * A viewBox edit passes through (that's the thing under test); a path edit
 * invalidates the stored measurement so a stale fixture can't vouch for it.
 */
export function artworkHash(svgText) {
  const body = svgText.replace(/<svg\b[^>]*>/s, '');
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

export function parseViewBox(svgText) {
  const m = svgText.match(/<svg\b[^>]*?viewBox="([^"]*)"/s);
  if (!m) throw new Error('no viewBox on root <svg>');
  return m[1].trim().split(/[\s,]+/).map(Number);
}
