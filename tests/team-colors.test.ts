import { describe, it, expect } from 'vitest';
import {
  getTeamColor,
  getTeamColorPrimary,
  getTeamColorSecondary,
  getTeamColorTertiary,
  getTeamColorQuaternary,
  getTeamColors,
  darken,
} from '../src/utils/team-colors';

describe('team-colors', () => {
  describe('graph color (legacy, unchanged)', () => {
    it('returns the TheLeague chart color for a single-arg call', () => {
      // Pigskins graph color must remain untouched by the brand-color work.
      expect(getTeamColor('0001')).toBe('#cc2936');
    });

    it('falls back to gray for an unknown franchise', () => {
      expect(getTeamColor('9999')).toBe('#6b7280');
    });

    it('AFL teams have no graph color -> gray', () => {
      expect(getTeamColor('0001', 'afl')).toBe('#6b7280');
    });
  });

  describe('brand colors from config', () => {
    it('reads primary + secondary for TheLeague', () => {
      expect(getTeamColorPrimary('0001')).toBe('#bd1f2b');
      expect(getTeamColorSecondary('0001')).toBe('#181818');
    });

    it('reads tertiary / quaternary when defined', () => {
      // Da Dangsters was given a white tertiary in review.
      expect(getTeamColorTertiary('0002')).toBe('#ffffff');
      // Mariachi Ninjas carry both a tertiary and quaternary.
      expect(getTeamColorTertiary('0005')).toBe('#ffffff');
      expect(getTeamColorQuaternary('0005')).toBe('#de3f3f');
    });

    it('returns undefined tertiary/quaternary when not defined', () => {
      // Pigskins only have primary + secondary.
      expect(getTeamColorTertiary('0001')).toBeUndefined();
      expect(getTeamColorQuaternary('0001')).toBeUndefined();
    });

    it('reads AFL brand colors with the league argument', () => {
      // Thundering Herd -> USC cardinal + gold.
      expect(getTeamColorPrimary('0014', 'afl')).toBe('#990000');
      expect(getTeamColorSecondary('0014', 'afl')).toBe('#ffc72c');
    });

    it('getTeamColors returns the defined palette in order', () => {
      expect(getTeamColors('0005')).toEqual(['#181818', '#2f8b59', '#ffffff', '#de3f3f']);
      expect(getTeamColors('0001')).toEqual(['#bd1f2b', '#181818']);
    });
  });

  describe('fallbacks', () => {
    it('primary falls back to gray for an unknown franchise', () => {
      expect(getTeamColorPrimary('9999')).toBe('#6b7280');
    });

    it('secondary falls back to a darkened primary when none is defined', () => {
      // Unknown franchise -> primary is GRAY (#6b7280); secondary darkens it 40%.
      const sec = getTeamColorSecondary('9999');
      expect(sec).toMatch(/^#[0-9a-f]{6}$/);
      expect(sec).toBe('#40444d');
    });
  });

  describe('darken (secondary-fallback linchpin)', () => {
    it('darkens a valid 6-digit hex toward black', () => {
      expect(darken('#6b7280')).toBe('#40444d');
      expect(darken('#ffffff', 0.5)).toBe('#808080');
    });

    it('always returns a valid 6-digit hex, never the raw input', () => {
      // Malformed / short / non-hex input must not propagate into a CSS gradient.
      for (const bad of ['not-a-color', '#abc', '#12345', 'rgb(1,2,3)', '']) {
        expect(darken(bad)).toMatch(/^#[0-9a-f]{6}$/);
        expect(darken(bad)).toBe('#6b7280'); // neutral GRAY fallback
      }
    });
  });
});
