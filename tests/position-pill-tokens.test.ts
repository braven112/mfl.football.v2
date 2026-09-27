/**
 * ONE site position palette (QB red, RB blue, WR green, TE purple, PK
 * orange, DEF cyan). Four copies had drifted apart, so a QB was indigo on
 * one page and red on the next; this pins every copy to the same hexes.
 * (The phone roster card shows the position as plain text, so there are no
 * pill tokens any more.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
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
    'src/components/afl-family/RostersPage.astro',
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
