import { describe, it, expect } from 'vitest';
import {
  getFranchiseBrand,
  FRANCHISE_BRAND_FALLBACK,
  franchiseGradient,
} from '../src/utils/franchise-brand';

describe('franchise-brand', () => {
  it('indexes the brand primary + secondary from config', () => {
    const b = getFranchiseBrand('0001'); // Pacific Pigskins
    expect(b.colorPrimary).toBe('#bd1f2b');
    expect(b.colorSecondary).toBe('#181818');
  });

  it('keeps `color` as the legacy chart/graph color (untouched by the brand work)', () => {
    // The owner-activity chart still reads `color`; it must not be repurposed.
    expect(getFranchiseBrand('0001').color).toBe('#cc2936');
  });

  it('surfaces tertiary/quaternary from the config, per franchise', () => {
    // Every TheLeague franchise defines all four since the four-colour pass,
    // so this half now checks that each one gets ITS OWN pair out of the
    // config rather than a shared constant — which is what the previous
    // "undefined for an unknown id" assertion had quietly become once the
    // only franchise without a tertiary was one that isn't in the config.
    const ninjas = getFranchiseBrand('0005');
    expect(ninjas.colorTertiary).toBe('#ffffff');
    expect(ninjas.colorQuaternary).toBe('#de3f3f');

    const pigskins = getFranchiseBrand('0001');
    expect(pigskins.colorTertiary).toBe('#ffffff');
    expect(pigskins.colorQuaternary).toBe('#a1a1a1');
    expect(pigskins.colorQuaternary).not.toBe(ninjas.colorQuaternary);
  });

  it('falls back (with a defined secondary, and no invented tertiary) for an unknown franchise', () => {
    const b = getFranchiseBrand('9999');
    expect(b.color).toBe(FRANCHISE_BRAND_FALLBACK.color);
    expect(b.colorPrimary).toBeTruthy();
    expect(b.colorSecondary).toBeTruthy();
    // The fallback carries a pair and nothing more — a hero that reaches for a
    // tertiary on an unknown franchise must get `undefined`, not a stand-in.
    expect(b.colorTertiary).toBeUndefined();
    expect(b.colorQuaternary).toBeUndefined();
  });

  it('franchiseGradient still works for single-color callers', () => {
    expect(franchiseGradient('#cc2936')).toBe('linear-gradient(160deg, #0b0e12 0%, #cc2936 150%)');
  });
});
