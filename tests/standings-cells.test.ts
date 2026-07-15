import { describe, it, expect } from 'vitest';
import {
  parseWLT,
  deriveAllPlayWLT,
  safeParseFloat,
  safeParseInt,
  formatRecord,
  resolveAllPlayRecord,
  calculateGamesBack,
  formatGamesBack,
} from '../src/components/theleague/standings/standings-cells';

describe('parseWLT', () => {
  it('parses a full W-L-T triple', () => {
    expect(parseWLT('12-3-1')).toEqual({ w: 12, l: 3, t: 1 });
  });
  it('defaults missing/empty to zeros', () => {
    expect(parseWLT(undefined)).toEqual({ w: 0, l: 0, t: 0 });
    expect(parseWLT('')).toEqual({ w: 0, l: 0, t: 0 });
    expect(parseWLT('9-6')).toEqual({ w: 9, l: 6, t: 0 });
  });
});

describe('deriveAllPlayWLT', () => {
  it('derives from a 240-game season (2020 and earlier)', () => {
    // .655 * 240 = 157.2 -> 157 wins
    expect(deriveAllPlayWLT('.655', 2016)).toEqual({ w: 157, l: 83, t: 0 });
  });
  it('derives from a 255-game season (2021+)', () => {
    // .776 * 255 = 197.88 -> 198 wins
    expect(deriveAllPlayWLT('.776', 2021)).toEqual({ w: 198, l: 57, t: 0 });
  });
  it('returns null when the percentage is missing', () => {
    expect(deriveAllPlayWLT(undefined, 2016)).toBeNull();
    expect(deriveAllPlayWLT('', 2016)).toBeNull();
  });
  it('returns null for NaN percentages', () => {
    expect(deriveAllPlayWLT('not-a-number', 2016)).toBeNull();
  });
  // Q8 (docs/standings-table-design.md §2.3.1): the STRICT guard. A literal
  // "0" pct with no recorded record must NOT fabricate a full 0-240-0 / 0-255-0
  // season. This is the single approved behavior change of Phase 6 — the
  // formerly-unguarded TheLeague Playoff-Standings view now reads N/A too.
  it('returns null for a zero percentage (does not fabricate a season)', () => {
    expect(deriveAllPlayWLT('0', 2010)).toBeNull();
    expect(deriveAllPlayWLT('0', 2016)).toBeNull();
    expect(deriveAllPlayWLT('0', 2021)).toBeNull();
    expect(deriveAllPlayWLT('.000', 2010)).toBeNull();
  });
});

describe('formatRecord', () => {
  it('renders full W-L-T by default', () => {
    expect(formatRecord({ w: 12, l: 3, t: 0 })).toBe('12-3-0');
    expect(formatRecord({ w: 12, l: 3, t: 1 })).toBe('12-3-1');
  });
  it('omits a zero tie segment when requested (tier table convention)', () => {
    expect(formatRecord({ w: 12, l: 3, t: 0 }, true)).toBe('12-3');
    expect(formatRecord({ w: 12, l: 3, t: 1 }, true)).toBe('12-3-1');
  });
  it('renders N/A for a null record', () => {
    expect(formatRecord(null)).toBe('N/A');
    expect(formatRecord(null, true)).toBe('N/A');
  });
});

describe('resolveAllPlayRecord', () => {
  it('prefers a recorded all_play_wlt', () => {
    expect(resolveAllPlayRecord({ all_play_wlt: '200-55-0', all_play_pct: '.999' }, 2021)).toEqual({
      w: 200,
      l: 55,
      t: 0,
    });
  });
  it('derives from pct when the record is absent', () => {
    expect(resolveAllPlayRecord({ all_play_pct: '.655' }, 2016)).toEqual({ w: 157, l: 83, t: 0 });
  });
  it('is null for the zero-pct historical case (Q8)', () => {
    expect(resolveAllPlayRecord({ all_play_pct: '0' }, 2010)).toBeNull();
    expect(formatRecord(resolveAllPlayRecord({ all_play_pct: '0' }, 2010))).toBe('N/A');
  });
});

describe('safeParseFloat / safeParseInt', () => {
  it('formats floats to fixed decimals', () => {
    expect(safeParseFloat('123.456', 1)).toBe('123.5');
    expect(safeParseFloat('.659', 3)).toBe('0.659');
  });
  it('defaults empty floats to zero at the requested precision', () => {
    expect(safeParseFloat(undefined, 3)).toBe('0.000');
    expect(safeParseFloat('', 1)).toBe('0.0');
  });
  it('parses ints and defaults empties to 0', () => {
    expect(safeParseInt('42')).toBe('42');
    expect(safeParseInt(undefined)).toBe('0');
    expect(safeParseInt('')).toBe('0');
  });
});

describe('calculateGamesBack / formatGamesBack', () => {
  const teams = [
    { divw: '10', divl: '2' },
    { divw: '8', divl: '4' },
    { divw: '6', divl: '6' },
  ];
  it('is zero for the division leader', () => {
    expect(calculateGamesBack(teams[0], teams)).toBe(0);
    expect(formatGamesBack(0)).toBe('—');
  });
  it('computes half-game-back distance from the leader', () => {
    expect(calculateGamesBack(teams[1], teams)).toBe(2);
    expect(formatGamesBack(2)).toBe('2.0');
    expect(calculateGamesBack(teams[2], teams)).toBe(4);
  });
  it('is zero for an empty group', () => {
    expect(calculateGamesBack({ divw: '1', divl: '1' }, [])).toBe(0);
  });
});
