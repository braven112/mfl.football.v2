/**
 * AFL tier/conference badge viewBox guard.
 *
 * These four `-dark` badges got their viewBox wrong twice in a single PR
 * (Aug 2026), and neither mistake was visible in a screenshot:
 *
 *  1. The dark files pad their viewBox to hold a white halo. Because every
 *     consumer sizes them `height: X; width: auto`, extra padding means the
 *     dark mark draws SMALLER than its light twin at the same CSS height —
 *     ~11-15% smaller, which quietly broke an optical size match that had been
 *     tuned in light mode.
 *  2. The first fix normalized the dark viewBoxes against `getBBox()`, which
 *     excludes stroke and filter effects. The halo IS a stroke, so that fix
 *     CLIPPED it on all four assets (~1px at a 40px render — a shaved white
 *     outline, invisible unless you go looking).
 *
 * So this locks the two properties that were broken, against ink measured from
 * rendered pixels (alpha bbox), not geometry:
 *
 *  - containment: the viewBox must fully contain the true ink, or the halo is
 *    being cut off;
 *  - parity: each dark badge must draw at the same apparent height as its light
 *    twin at a shared CSS height.
 *
 * Regenerate the fixture after ANY badge artwork or viewBox edit:
 *   node scripts/measure-afl-badge-ink.mjs
 * The artwork hash below fails the test if the art changed without a re-measure,
 * so a stale fixture can't silently vouch for new pixels.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BADGE_PAIRS, artworkHash, parseViewBox } from '../scripts/lib/afl-badge-ink.mjs';
import fixture from './fixtures/afl-badge-ink.json';

const ROOT = join(__dirname, '..');
const publicPath = (rel: string) => join(ROOT, 'public', rel);

interface Measured {
  viewBox: number[];
  ink: number[];
  artworkHash: string;
}
const measured = fixture as unknown as Record<string, Measured>;

/** Apparent height of the ink when the badge is drawn at `cssHeight`. */
function drawnInkHeight(m: Measured, cssHeight = 40): number {
  const [, , , vh] = m.viewBox;
  return (m.ink[3] / vh) * cssHeight;
}

const ALL = BADGE_PAIRS.flat() as string[];

describe('AFL badge assets — measured ink is current', () => {
  it.each(ALL)('%s artwork matches the measurement on file', (rel) => {
    const m = measured[rel];
    expect(m, `${rel} missing from the fixture — run scripts/measure-afl-badge-ink.mjs`).toBeDefined();
    const svg = readFileSync(publicPath(rel), 'utf8');
    expect(
      artworkHash(svg),
      `${rel} artwork changed since the ink was measured. Re-run: node scripts/measure-afl-badge-ink.mjs`,
    ).toBe(m.artworkHash);
  });

  it.each(ALL)('%s viewBox matches the measurement on file', (rel) => {
    const svg = readFileSync(publicPath(rel), 'utf8');
    expect(
      parseViewBox(svg),
      `${rel} viewBox changed since the ink was measured. Re-run: node scripts/measure-afl-badge-ink.mjs`,
    ).toEqual(measured[rel].viewBox);
  });
});

describe('AFL badge viewBoxes contain their halo', () => {
  // The halo is a stroke/filter, so it sits OUTSIDE the geometry box. A viewBox
  // that merely fits the paths shaves it. Any negative slack here is a clip.
  //
  // Honest limitation: ink is measured by RENDERING through the viewBox, so a
  // clipped badge reports ink flush to the edge (slack 0) rather than negative
  // — this check can't catch a clip on its own. It guards a hand-edited or
  // mismatched fixture. The parity check below is what actually catches a clip,
  // because shaving the halo makes the ink fill more of a smaller box and the
  // mark draws BIGGER than its light twin. Both were verified to fail against
  // the real Aug 2026 regression before being committed.
  it.each(ALL)('%s is not clipped on any edge', (rel) => {
    const { viewBox, ink } = measured[rel];
    const [vx, vy, vw, vh] = viewBox;
    const [ix, iy, iw, ih] = ink;
    const slack = {
      left: ix - vx,
      top: iy - vy,
      right: vx + vw - (ix + iw),
      bottom: vy + vh - (iy + ih),
    };
    for (const [edge, value] of Object.entries(slack)) {
      // Light badges are authored tight to their ink, so 0 is expected there;
      // only a NEGATIVE value means pixels are being cut off.
      expect(value, `${rel} clipped on the ${edge} by ${(-value).toFixed(2)} user units`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('AFL badge dark variants draw the same size as their light twins', () => {
  it.each(BADGE_PAIRS as [string, string][])(
    '%s and %s draw at the same apparent height',
    (light, dark) => {
      const lightH = drawnInkHeight(measured[light]);
      const darkH = drawnInkHeight(measured[dark]);
      const delta = Math.abs(darkH / lightH - 1);
      expect(
        delta,
        `${dark} draws ${(delta * 100).toFixed(1)}% off ${light} at a 40px slot ` +
          `(${darkH.toFixed(2)}px vs ${lightH.toFixed(2)}px). Toggling the theme would visibly resize it.`,
      ).toBeLessThan(0.03);
    },
  );
});
