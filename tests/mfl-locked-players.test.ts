import { describe, it, expect } from 'vitest';
import { parseLockedPlayers, isPlayerLocked, lockedUnitKey } from '../src/utils/mfl-locked-players';

// Shapes captured from MFL's live `export?TYPE=freeAgents` (2026-09-24): the
// AFL answers one leagueUnit per conference, TheLeague a single LEAGUE unit
// object (not an array). The 49ers DEF (0530) had just been dropped in the AL.
const AFL = {
  freeAgents: {
    leagueUnit: [
      { unit: 'CONFERENCE00', player: [{ id: '0530', status: 'locked' }, { id: '16168' }] },
      { unit: 'CONFERENCE01', player: [{ id: '13672', status: 'locked' }, { id: '16168' }] },
    ],
  },
};
const THELEAGUE = {
  freeAgents: {
    leagueUnit: {
      unit: 'LEAGUE',
      player: [
        { id: '16168', salary: '425000.00' },
        { id: '13604', salary: '425000.00', status: 'locked' },
      ],
    },
  },
};

describe('mfl-locked-players', () => {
  it('keys conference units by conference id and a single pool by ""', () => {
    expect(lockedUnitKey('CONFERENCE00')).toBe('00');
    expect(lockedUnitKey('LEAGUE')).toBe('');
  });

  it('is per conference — locked in the AL says nothing about the NL', () => {
    const locked = parseLockedPlayers(AFL);
    expect(isPlayerLocked(locked, '0530', '00')).toBe(true);
    expect(isPlayerLocked(locked, '0530', '01')).toBe(false);
    expect(isPlayerLocked(locked, '13672', '01')).toBe(true);
    expect(isPlayerLocked(locked, '16168', '00')).toBe(false);
  });

  it('reads a single-pool league under the null conference', () => {
    const locked = parseLockedPlayers(THELEAGUE);
    expect(isPlayerLocked(locked, '13604', null)).toBe(true);
    expect(isPlayerLocked(locked, '16168', null)).toBe(false);
  });

  it('treats an MFL error body as unknown, never as "nobody is locked"', () => {
    expect(parseLockedPlayers({ error: 'An error has occurred' })).toBeNull();
    expect(parseLockedPlayers(null)).toBeNull();
    expect(isPlayerLocked(null, '0530', '00')).toBe(false);
  });
});
