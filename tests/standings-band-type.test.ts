/**
 * The band's type contract.
 *
 * `src/utils/team-band.ts` measures every franchise's ink at WCAG's 3:1
 * LARGE-TEXT floor, and that floor is only earned while the text on the band is
 * actually large: ≥18.66px bold (14pt bold). Measured at the body floor
 * instead, eight AFL clubs — including the Micks' green at 3.20:1 — would need
 * dark ink or a darkened fill.
 *
 * So the font sizes in the band's CSS are not a styling preference, they are
 * the premise of the contrast calculation, and nothing else in the codebase
 * connects the two. Someone tidying the standings table back toward the 12px
 * cells the other variants use would take the whole table sub-AA without a
 * single test going red. This is that test.
 *
 * It reads the CSS as text on purpose: the rule has to hold in the file that
 * ships, not in a re-implementation of it here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BAND_INK_MIN_RATIO } from '../src/utils/team-band';
import { AA_LARGE_TEXT_RATIO } from '../src/utils/team-color-contrast';

const SOURCE = resolve(__dirname, '../src/components/theleague/standings/StandingsTable.astro');
const css = readFileSync(SOURCE, 'utf8');

/** WCAG: bold text counts as "large" from 14pt = 18.66px. */
const LARGE_TEXT_PX = 18.66;
const REM_PX = 16;

/** Every `font-size` declared inside a block whose selector mentions the band. */
function bandFontSizes(): Array<{ selector: string; px: number }> {
  const out: Array<{ selector: string; px: number }> = [];
  const blocks = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, rawSelector, body] of blocks) {
    const selector = rawSelector.replace(/\s+/g, ' ').trim();
    if (!/st-row--band|band-name|band-crest|band-team/.test(selector)) continue;
    for (const [, value, unit] of body.matchAll(/font-size:\s*([\d.]+)(rem|px)/g)) {
      out.push({ selector, px: unit === 'rem' ? parseFloat(value) * REM_PX : parseFloat(value) });
    }
  }
  return out;
}

describe('standings band — the type keeps the contrast measurement valid', () => {
  it('measures its ink at the large-text floor, not the body floor', () => {
    // If this ever changes, the sizes below are no longer the right premise —
    // re-derive the bands before relaxing anything here.
    expect(BAND_INK_MIN_RATIO).toBe(AA_LARGE_TEXT_RATIO);
  });

  it('declares band type at 18.66px or larger, at every breakpoint', () => {
    const sizes = bandFontSizes();
    expect(sizes.length).toBeGreaterThan(0);
    const tooSmall = sizes
      .filter((s) => s.px < LARGE_TEXT_PX)
      .map((s) => `${s.selector} → ${s.px}px`);
    expect(tooSmall).toEqual([]);
  });

  it('sets the band cells bold, which the large-text floor also requires', () => {
    const cellRule = /tbody tr\.st-row--band td\s*\{([^}]*)\}/.exec(css);
    expect(cellRule).not.toBeNull();
    const weight = /font-weight:\s*(\d+)/.exec(cellRule![1]);
    expect(weight).not.toBeNull();
    expect(Number(weight![1])).toBeGreaterThanOrEqual(700);
  });

  it('cancels the global dark-mode crest swap on the band', () => {
    // The band is the club's colour in BOTH themes, so a crest chosen for a
    // dark CARD has no business on it. `bandCrestSrc` picks by fill; this rule
    // stops `TeamIconDarkStyles` overriding that after sunset.
    expect(css).toMatch(/html\.dark\)?\s*\.band-crest\s*\{[^}]*content:\s*normal/);
  });
});
