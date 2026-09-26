/**
 * The phone roster card's position pills (docs/plans/rosters-mobile-layout.md,
 * Q8): the site position palette as tokens, defined in BOTH themes, every
 * ink clearing 4.5:1 on its own fill. The second half pins every other copy
 * of the palette (charts, draft room, Best Ball) to the same six hexes.
 *
 * 4.5 and not 3: the pill label is 0.6875rem / 700, well under the
 * 18.66px-bold threshold where large-text contrast would apply
 * (design-system.md, "--league-accent is LIGHT in dark mode").
 *
 * The design-token guard only proves a token is defined SOMEWHERE; a token
 * defined in one theme only renders its other-theme value from the wrong
 * palette, which is the failure this file can see and that one cannot.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AA_BODY_TEXT_RATIO, contrastRatio } from '../src/utils/team-color-contrast';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const LIGHT = read('src/styles/tokens.css');
const DARK = read('src/styles/tokens-dark.css');
const SHEET = read('src/styles/rosters-mobile.css');

const POSITIONS = ['qb', 'rb', 'wr', 'te', 'pk', 'def', 'other'] as const;

const tokenValue = (css: string, name: string): string | null => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  return m ? m[1] : null;
};

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('position pill tokens — %s theme', (_theme, css) => {
  it.each(POSITIONS)('--pos-%s-ink clears 4.5:1 on --pos-%s-bg', (pos) => {
    const bg = tokenValue(css, `pos-${pos}-bg`);
    const ink = tokenValue(css, `pos-${pos}-ink`);
    expect(bg, `--pos-${pos}-bg must be a literal hex in this theme's token file`).not.toBeNull();
    expect(ink, `--pos-${pos}-ink must be a literal hex in this theme's token file`).not.toBeNull();
    expect(contrastRatio(ink!, bg!)).toBeGreaterThanOrEqual(AA_BODY_TEXT_RATIO);
  });
});

describe('the phone stylesheet paints the pills from the tokens', () => {
  it.each(POSITIONS)('reads --pos-%s-bg and --pos-%s-ink', (pos) => {
    expect(SHEET).toContain(`var(--pos-${pos}-bg)`);
    expect(SHEET).toContain(`var(--pos-${pos}-ink)`);
  });
});

/**
 * ONE position palette. Four copies drifted apart (the roster charts, the
 * analytics donut, the draft room and Best Ball each had their own), so a QB
 * was indigo on one page and red on the next. Every copy now reads these.
 */
const SITE_PALETTE: Record<string, string> = {
  QB: '#c41e3a',
  RB: '#2563eb',
  WR: '#16a34a',
  TE: '#9333ea',
  PK: '#ea580c',
  DEF: '#0891b2',
};

describe('every position palette is the site palette', () => {
  const hexOf = (src: string, key: string) =>
    src.match(new RegExp(`\\b${key}:\\s*'[^']*?(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();

  it.each([
    'src/constants/roster-constants.ts',
    'src/utils/roster-analytics.ts',
    'src/types/draft-room.ts',
    'src/pages/afl-fantasy/rosters.astro',
  ])('%s', (file) => {
    const src = read(file);
    for (const [pos, hex] of Object.entries(SITE_PALETTE)) {
      expect(hexOf(src, pos), `${file} ${pos}`).toBe(hex);
    }
  });

  it('the draft room light theme and Best Ball fallbacks', () => {
    const dr = read('src/styles/draft-room.css');
    const bb = read('src/pages/best-ball-1/rosters.astro');
    for (const [pos, hex] of Object.entries(SITE_PALETTE)) {
      const key = pos.toLowerCase();
      expect(dr, `--dr-pos-${key}`).toContain(`--dr-pos-${key}: ${hex};`);
      expect(bb, `bb fallback ${key}`).toContain(`var(--dr-pos-${key}, ${hex})`);
    }
  });
});
