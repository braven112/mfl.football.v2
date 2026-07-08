import { describe, it, expect } from 'vitest';
import {
  colorDistance,
  relativeLuminance,
  shiftLightness,
  pickContrastingColor,
  forceContrast,
  ensureLegibleOn,
  resolveTeamColorPair,
  DEFAULT_MIN_CONTRAST,
} from '../src/utils/team-color-contrast';

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
