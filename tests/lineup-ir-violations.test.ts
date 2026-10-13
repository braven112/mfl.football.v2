import { describe, expect, it } from 'vitest';
import { findIrViolations } from '../src/utils/lineup-ir-violations';
import { getLeagueBySlug } from '../src/config/leagues';

const AFL = ['Doubtful', 'Out', 'IR'];
const inj = (injuryStatus: string) => ({ injuryStatus, injuryBodyPart: '', expectedReturn: '' });
const roster = [
  { id: '15708', name: 'Breece Hall', rosterStatus: 'INJURED_RESERVE' },
  { id: '2', name: 'Out Guy', rosterStatus: 'INJURED_RESERVE' },
  { id: '3', name: 'Healthy Guy', rosterStatus: 'INJURED_RESERVE' },
  { id: '4', name: 'Starter Q', rosterStatus: 'ROSTER' },
];
const injuries = { '15708': inj('Questionable'), '2': inj('Out'), '4': inj('Questionable') } as any;

describe('findIrViolations', () => {
  it('flags an IR player whose designation does not qualify, or who has none', () => {
    // 2026-10-13: MFL refused an AFL lineup over Hall, on IR while Questionable.
    expect(findIrViolations(roster, injuries, AFL)).toEqual([
      { id: '15708', name: 'Breece Hall', injuryStatus: 'Questionable' },
      { id: '3', name: 'Healthy Guy', injuryStatus: null },
    ]);
  });

  it('never flags a player who is not on IR', () => {
    expect(findIrViolations(roster, injuries, AFL).map((v) => v.id)).not.toContain('4');
  });

  it('says nothing for a league with no declared IR rule', () => {
    expect(findIrViolations(roster, injuries, undefined)).toEqual([]);
  });

  it('reads an empty injury feed as missing, not as everyone healthy', () => {
    expect(findIrViolations(roster, {}, AFL)).toEqual([]);
  });

  it('the AFL declares its constitutional rule', () => {
    expect(getLeagueBySlug('afl-fantasy')?.irEligibleInjuryStatuses).toEqual(AFL);
  });
});
