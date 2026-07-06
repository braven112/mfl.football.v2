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

  it('surfaces tertiary/quaternary only when the team defines them', () => {
    // Mariachi Ninjas carry a full four-color palette.
    const ninjas = getFranchiseBrand('0005');
    expect(ninjas.colorTertiary).toBe('#ffffff');
    expect(ninjas.colorQuaternary).toBe('#de3f3f');
    // Pigskins only define primary + secondary.
    const pigskins = getFranchiseBrand('0001');
    expect(pigskins.colorTertiary).toBeUndefined();
    expect(pigskins.colorQuaternary).toBeUndefined();
  });

  it('falls back (with a defined secondary) for an unknown franchise', () => {
    const b = getFranchiseBrand('9999');
    expect(b.color).toBe(FRANCHISE_BRAND_FALLBACK.color);
    expect(b.colorPrimary).toBeTruthy();
    expect(b.colorSecondary).toBeTruthy();
  });

  it('franchiseGradient still works for single-color callers', () => {
    expect(franchiseGradient('#cc2936')).toBe('linear-gradient(160deg, #0b0e12 0%, #cc2936 150%)');
  });
});
