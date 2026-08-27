/**
 * Draft unit selection — MFL's `draftResults.draftUnit` is an OBJECT in a
 * single-draft league and an ARRAY in a conference-drafting one.
 *
 * This shipped as a silent bug: `/api/draft/status` read `.draftPick` straight
 * off the raw value, so the AFL (CONFERENCE00 + CONFERENCE01) resolved to
 * `undefined` and the endpoint returned `picks: []` with a 200. An empty board
 * and a broken board looked identical. Both shapes are pinned here.
 */

import { describe, it, expect } from 'vitest';
import { selectDraftUnit } from '../src/utils/draft-utils';

const PICK = { player: '13589', pick: '01', franchise: '0001', round: '01' };

/** TheLeague / best-ball: one unnamed unit, as a bare object. */
const SINGLE_UNIT = { draftPick: [PICK] };

/** The AFL: two named conference units, as an array. */
const CONFERENCE_UNITS = [
  { unit: 'CONFERENCE00', draftPick: [{ ...PICK, franchise: '0001' }] },
  { unit: 'CONFERENCE01', draftPick: [{ ...PICK, franchise: '0013' }] },
];

describe('selectDraftUnit', () => {
  it('returns the object itself for a single-draft league', () => {
    expect(selectDraftUnit(SINGLE_UNIT)).toBe(SINGLE_UNIT);
  });

  it('returns the first unit when an array is given and none is requested', () => {
    // Backward compatibility: a caller that never passed `unit` (TheLeague,
    // best-ball) must keep getting a usable board, not null.
    expect(selectDraftUnit(CONFERENCE_UNITS)?.unit).toBe('CONFERENCE00');
  });

  it('finds a named unit in an array', () => {
    const nl = selectDraftUnit(CONFERENCE_UNITS, 'CONFERENCE01');
    expect(nl?.unit).toBe('CONFERENCE01');
    expect(nl?.draftPick?.[0].franchise).toBe('0013');
  });

  it('accepts a bare conference code, so callers can pass the config value', () => {
    // afl.config.json stores conference codes as "00" / "01"; MFL names the
    // units "CONFERENCE00" / "CONFERENCE01". Both must resolve.
    expect(selectDraftUnit(CONFERENCE_UNITS, '01')?.unit).toBe('CONFERENCE01');
    expect(selectDraftUnit(CONFERENCE_UNITS, '00')?.unit).toBe('CONFERENCE00');
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(selectDraftUnit(CONFERENCE_UNITS, ' conference01 ')?.unit).toBe('CONFERENCE01');
  });

  it('returns null for an unknown unit rather than falling back to the first', () => {
    // Showing the American League's board to a page that asked for the
    // National League's is worse than showing an error.
    expect(selectDraftUnit(CONFERENCE_UNITS, 'CONFERENCE07')).toBeNull();
  });

  it('returns null for missing or empty input', () => {
    expect(selectDraftUnit(undefined)).toBeNull();
    expect(selectDraftUnit([])).toBeNull();
  });
});
