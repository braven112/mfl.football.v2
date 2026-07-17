import { describe, it, expect } from 'vitest';
import { isLeagueDraftOrderFinal, isDraftConducted } from '../src/utils/draft-utils';
import type { ToiletBowlResult } from '../src/types/standings';

const tb = (level: ToiletBowlResult['level'], id: string): ToiletBowlResult => ({
  level,
  franchiseId: id,
  franchiseName: `Team ${id}`,
});

describe('isLeagueDraftOrderFinal', () => {
  const allToiletBowl = [tb('winner', '0003'), tb('consolation', '0009'), tb('consolation2', '0012')];

  it('is final when the champion and all three toilet bowl comp slots are settled', () => {
    expect(isLeagueDraftOrderFinal('0007', allToiletBowl)).toBe(true);
  });

  it('stays a projection mid-season (no champion, no toilet bowl results)', () => {
    expect(isLeagueDraftOrderFinal('', [])).toBe(false);
  });

  it('stays a projection while the toilet bowl is still in progress', () => {
    expect(isLeagueDraftOrderFinal('0007', [tb('winner', '0003')])).toBe(false);
  });

  it('stays a projection when the championship is undecided', () => {
    expect(isLeagueDraftOrderFinal('', allToiletBowl)).toBe(false);
  });
});

describe('isDraftConducted', () => {
  const results = (picks: Array<Record<string, string>>) => ({
    draftResults: { draftUnit: { draftPick: picks } },
  });

  it('is true once real player selections exist', () => {
    expect(
      isDraftConducted(results([{ round: '01', pick: '01', franchise: '0007', player: '17472' }]))
    ).toBe(true);
  });

  it('is false for stubbed pick slots with no player', () => {
    expect(
      isDraftConducted(results([
        { round: '01', pick: '01', franchise: '0007', player: '' },
        { round: '01', pick: '02', franchise: '0002' },
      ]))
    ).toBe(false);
  });

  it('ignores placeholder player values that are not real ids', () => {
    expect(isDraftConducted(results([{ round: '01', pick: '01', player: '----' }]))).toBe(false);
  });

  it('is false when draft results are missing entirely', () => {
    expect(isDraftConducted(null)).toBe(false);
    expect(isDraftConducted({})).toBe(false);
  });

  it('handles a single non-array pick', () => {
    expect(
      isDraftConducted({
        draftResults: { draftUnit: { draftPick: { round: '01', pick: '01', player: '12345' } } },
      })
    ).toBe(true);
  });
});
