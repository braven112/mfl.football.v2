import { describe, it, expect } from 'vitest';
import {
  colorDistance,
  relativeLuminance,
  shiftLightness,
  pickContrastingColor,
  forceContrast,
  ensureLegibleOn,
  resolveTeamColorPair,
  contrastRatio,
  ensureContrastOn,
  AA_LARGE_TEXT_RATIO,
  AA_BODY_TEXT_RATIO,
  DEFAULT_MIN_CONTRAST,
} from '../src/utils/team-color-contrast';
import { getTeamAccentPair } from '../src/utils/team-colors';
import theleagueConfig from '../src/data/theleague.config.json';

describe('colorDistance', () => {
  it('is 0 for identical colors and large for black↔white', () => {
    expect(colorDistance('#123456', '#123456')).toBeCloseTo(0, 6);
    expect(colorDistance('#000000', '#ffffff')).toBeGreaterThan(90);
  });
});

describe('relativeLuminance / shiftLightness', () => {
  it('orders black < gray < white', () => {
    expect(relativeLuminance('#000000')).toBeLessThan(relativeLuminance('#808080'));
    expect(relativeLuminance('#808080')).toBeLessThan(relativeLuminance('#ffffff'));
  });
  it('lightens toward white and darkens toward black', () => {
    expect(relativeLuminance(shiftLightness('#808080', 0.5))).toBeGreaterThan(relativeLuminance('#808080'));
    expect(relativeLuminance(shiftLightness('#808080', -0.5))).toBeLessThan(relativeLuminance('#808080'));
  });
});

describe('pickContrastingColor', () => {
  it('returns the first candidate that clears the threshold', () => {
    expect(pickContrastingColor('#000000', ['#010101', '#ffffff', '#00ff00'])).toBe('#ffffff');
  });
  it('falls back to the most-different candidate when none clear it', () => {
    expect(pickContrastingColor('#000000', ['#010101', '#030303', '#020202'])).toBe('#030303');
  });
  it('with forceAdjust, guarantees the result clears the threshold', () => {
    const out = pickContrastingColor('#000000', ['#010101', '#020202'], DEFAULT_MIN_CONTRAST, true);
    expect(colorDistance('#000000', out)).toBeGreaterThanOrEqual(DEFAULT_MIN_CONTRAST);
  });
  it('ignores invalid hex candidates', () => {
    expect(pickContrastingColor('#000000', ['nope', '', '#ffffff'])).toBe('#ffffff');
  });
});

describe('forceContrast / ensureLegibleOn', () => {
  it('forceContrast pushes a near-identical color apart', () => {
    const out = forceContrast('#101820', '#111921', 25);
    expect(colorDistance('#101820', out)).toBeGreaterThanOrEqual(25);
  });
  it('ensureLegibleOn lifts a near-black off a dark background', () => {
    const out = ensureLegibleOn('#181818', '#191c21', 18);
    expect(colorDistance(out, '#191c21')).toBeGreaterThanOrEqual(18);
  });
});

describe('resolveTeamColorPair', () => {
  const homeSet = { colorPrimary: '#123456', colorSecondary: '#abcdef', color: '#ff8800' };

  it('home always uses its primary (chart color only as last resort)', () => {
    expect(resolveTeamColorPair(homeSet, { colorPrimary: '#00ff00' }).home).toBe('#123456');
    expect(resolveTeamColorPair({ color: '#abcdef' }, { colorPrimary: '#00ff00' }).home).toBe('#abcdef');
  });

  it('away uses its primary when it contrasts with home', () => {
    // home black, away primary white → clears threshold
    expect(resolveTeamColorPair({ colorPrimary: '#000000' }, { colorPrimary: '#ffffff', colorSecondary: '#00ff00', color: '#ff0000' }).away).toBe('#ffffff');
  });

  it('away falls to secondary, then to chart color', () => {
    const home = { colorPrimary: '#000000' };
    expect(resolveTeamColorPair(home, { colorPrimary: '#010101', colorSecondary: '#ffffff', color: '#ff0000' }).away).toBe('#ffffff');
    expect(resolveTeamColorPair(home, { colorPrimary: '#010101', colorSecondary: '#020202', color: '#ffffff' }).away).toBe('#ffffff');
  });

  it('without forceAdjust returns the most-different available when all are close', () => {
    const r = resolveTeamColorPair({ colorPrimary: '#000000' }, { colorPrimary: '#010101', colorSecondary: '#020202', color: '#030303' });
    expect(r.away).toBe('#030303');
    expect(colorDistance(r.home, r.away)).toBeLessThan(DEFAULT_MIN_CONTRAST);
  });

  it('with forceAdjust always yields two distinct colors', () => {
    const r = resolveTeamColorPair(
      { colorPrimary: '#000000' },
      { colorPrimary: '#010101', colorSecondary: '#020202', color: '#030303' },
      { forceAdjust: true },
    );
    expect(colorDistance(r.home, r.away)).toBeGreaterThanOrEqual(DEFAULT_MIN_CONTRAST);
  });

  it('with a background, keeps both colors legible (near-black home on dark card)', () => {
    const r = resolveTeamColorPair(
      { colorPrimary: '#181818' },   // near-black primary (7 real franchises)
      { colorPrimary: '#e9e9e9' },
      { background: '#191c21', forceAdjust: true },
    );
    expect(colorDistance(r.home, '#191c21')).toBeGreaterThanOrEqual(18);
    expect(colorDistance(r.away, '#191c21')).toBeGreaterThanOrEqual(18);
    expect(colorDistance(r.home, r.away)).toBeGreaterThanOrEqual(DEFAULT_MIN_CONTRAST);
  });

  it('handles missing color sets with safe fallbacks', () => {
    const r = resolveTeamColorPair(undefined, undefined);
    expect(r.home).toMatch(/^#[0-9a-f]{6}$/i);
    expect(r.away).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('contrastRatio', () => {
  it('spans 1 (identical) to 21 (black on white)', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 6);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#cc2936', '#262626')).toBeCloseTo(contrastRatio('#262626', '#cc2936'), 10);
  });

  it('catches what ΔE misses — distinct hues that are still unreadable', () => {
    // Cowboy Up navy on the dark card: clearly a different color, invisible.
    expect(colorDistance('#0d2b56', '#262626')).toBeGreaterThan(18);
    expect(contrastRatio('#0d2b56', '#262626')).toBeLessThan(1.2);
  });
});

describe('ensureContrastOn', () => {
  it('leaves a color that already passes untouched', () => {
    expect(ensureContrastOn('#ffcd00', '#262626', AA_LARGE_TEXT_RATIO)).toBe('#ffcd00');
  });

  it('lightens on a dark background until the floor is cleared', () => {
    const out = ensureContrastOn('#1a1a1a', '#262626', AA_LARGE_TEXT_RATIO);
    expect(contrastRatio(out, '#262626')).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
    expect(relativeLuminance(out)).toBeGreaterThan(relativeLuminance('#1a1a1a'));
  });

  it('darkens on a light background until the floor is cleared', () => {
    const out = ensureContrastOn('#ffcd00', '#ffffff', AA_LARGE_TEXT_RATIO);
    expect(contrastRatio(out, '#ffffff')).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
    expect(relativeLuminance(out)).toBeLessThan(relativeLuminance('#ffcd00'));
  });

  it('honors a stricter body-text floor', () => {
    const out = ensureContrastOn('#4b92db', '#ffffff', AA_BODY_TEXT_RATIO);
    expect(contrastRatio(out, '#ffffff')).toBeGreaterThanOrEqual(AA_BODY_TEXT_RATIO);
  });

  it('passes non-hex input through untouched', () => {
    expect(ensureContrastOn('var(--x)', '#262626')).toBe('var(--x)');
  });
});

describe('franchise accents are readable in both themes', () => {
  // Guards the Pecking Order's rank numerals and brand edges, which take their
  // color straight from getTeamAccentPair. Before this rule, seven TheLeague
  // franchises rendered their accent below 3:1 on the dark card — Bring The
  // Pain's near-black at 1.15:1, Cowboy Up's navy at 1.08:1.
  const SURFACES = { light: '#ffffff', dark: '#262626' };

  it.each((theleagueConfig as any).teams.map((t: any) => [t.nameMedium ?? t.franchiseId, t.franchiseId]))(
    '%s clears 3:1 on both card surfaces',
    (_name: string, franchiseId: string) => {
      const { light, dark } = getTeamAccentPair(franchiseId, 'theleague');
      expect(contrastRatio(light, SURFACES.light)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
      expect(contrastRatio(dark, SURFACES.dark)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
    },
  );

  it('falls back to a readable accent for an unknown franchise', () => {
    const { light, dark } = getTeamAccentPair('9999', 'theleague');
    expect(contrastRatio(light, SURFACES.light)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
    expect(contrastRatio(dark, SURFACES.dark)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_RATIO);
  });
});
