/**
 * The branding a new league starts from (scripts/suggest-league-branding.mjs).
 * It is only a suggestion, but it ships to every page until a commissioner
 * edits it, so its names must fit the display limits and its colours must be
 * real brand colours rather than the art's dark background.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LIMITS, dominantColors, suggestNames } from '../scripts/suggest-league-branding.mjs';
import { MAX_SHORT_NAME_LENGTH, MAX_TEAM_NAME_LENGTH } from '../src/utils/team-names';

const px = (rgb: number[], n: number) => Array.from({ length: n }, () => [...rgb, 255]).flat();

describe('suggestNames', () => {
  it('keeps a short name whole and trims MFL whitespace', () => {
    expect(suggestNames('Goats ', 'Goats')).toEqual({
      name: 'Goats',
      nameMedium: 'Goats',
      nameShort: 'Goats',
      abbrev: 'GOATS',
      aliases: [],
    });
  });

  it('shortens a long name to its mascot and fits every limit', () => {
    const s = suggestNames('Philadelphia Screaming Eagles', 'Philadelphia');
    expect(s.nameMedium.length).toBeLessThanOrEqual(MAX_TEAM_NAME_LENGTH);
    expect(s.nameShort).toBe('Eagles');
    expect(s.abbrev.length).toBeLessThanOrEqual(LIMITS.abbrev);
    expect(s.aliases).toContain('Eagles');
  });

  it('matches the display limits the site enforces', () => {
    expect(LIMITS.medium).toBe(MAX_TEAM_NAME_LENGTH);
    expect(LIMITS.short).toBe(MAX_SHORT_NAME_LENGTH);
  });
});

describe('dominantColors', () => {
  it('prefers a saturated colour over a larger dark background', () => {
    const rgba = Uint8Array.from([...px([30, 30, 34], 600), ...px([20, 180, 170], 80), ...px([230, 90, 20], 60)]);
    const c = dominantColors(rgba)!;
    expect(c.primary).toMatch(/^#1[0-9a-f]b[0-9a-f]a/);
    expect(c.secondary).toMatch(/^#e/);
  });

  it('ignores transparent pixels and falls back sensibly on neutral art', () => {
    const rgba = Uint8Array.from([...Array.from({ length: 50 }, () => [255, 0, 0, 0]).flat(), ...px([245, 245, 245], 100)]);
    const c = dominantColors(rgba)!;
    expect(c.primary).toBe('#f5f5f5');
    expect(c.secondary).toBe('#181818');
  });

  it('returns null for an empty image', () => {
    expect(dominantColors(new Uint8Array(0))).toBeNull();
  });
});

describe('the archies suggestion as committed', () => {
  const cfg = JSON.parse(readFileSync(new URL('../data/archies/archies.config.json', import.meta.url), 'utf8'));
  it('has every franchise with names inside the limits and hex colours', () => {
    expect(cfg.teams).toHaveLength(99);
    for (const t of cfg.teams) {
      expect(t.nameMedium.length, t.name).toBeLessThanOrEqual(MAX_TEAM_NAME_LENGTH);
      expect(t.nameShort.length, t.name).toBeLessThanOrEqual(MAX_SHORT_NAME_LENGTH);
      expect(t.colorPrimary).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.colorSecondary).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.division, t.name).toBeTruthy();
    }
  });
});
