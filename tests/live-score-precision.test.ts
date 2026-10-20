import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SCORE_PRECISION, formatScore, parseScorePrecision } from '../src/utils/live/score-precision';
import { registryScorePrecision } from '../src/utils/live/read';

/**
 * The live board prints points with the league's OWN MFL decimal setting.
 * It printed one decimal against MFL's two, so a 135.43–135.18 final read as
 * 135.4–135.2 and owners comparing the two sites saw numbers that disagreed.
 */
describe('live score precision', () => {
  it('parses MFL\'s precision setting', () => {
    expect(parseScorePrecision('2')).toBe(2);
    expect(parseScorePrecision('0')).toBe(0);
    expect(parseScorePrecision(1)).toBe(1);
    expect(parseScorePrecision(undefined)).toBeUndefined();
    expect(parseScorePrecision('')).toBeUndefined();
    expect(parseScorePrecision('abc')).toBeUndefined();
    expect(parseScorePrecision('1.5')).toBeUndefined();
    expect(parseScorePrecision('9')).toBeUndefined();
  });

  it('formats to the league\'s places, matching MFL', () => {
    expect(formatScore(135.43, 2)).toBe('135.43');
    expect(formatScore(8.48, 2)).toBe('8.48');
    expect(formatScore(8.48, 1)).toBe('8.5');
    expect(formatScore(18, 0)).toBe('18');
    expect(formatScore(6.71)).toBe((6.71).toFixed(DEFAULT_SCORE_PRECISION));
    expect(formatScore(Number.NaN, 2)).toBe('0.00');
  });

  it('reads each registry league\'s setting from its committed league.json', () => {
    for (const slug of ['theleague', 'afl-fantasy'] as const) {
      expect(registryScorePrecision(slug)).toBe(2);
    }
  });

  it('no live score component hardcodes its decimal places', () => {
    for (const f of ['LvMatchupCard', 'LvMatchupDetail', 'LvPlayerRow']) {
      const src = readFileSync(`src/components/shared/live/${f}.tsx`, 'utf8');
      expect(src, f).not.toMatch(/toFixed\(\d\)/);
      expect(src, f).toContain('useScoreFormat()');
    }
  });
});
