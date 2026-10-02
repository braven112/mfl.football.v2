import { describe, it, expect } from 'vitest';
import { parseLockedPlayers, isPlayerLocked, lockedUnitKey, dropLocksIn } from '../src/utils/mfl-locked-players';

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

  it('a lock only refuses in an FCFS window — in the waiver window MFL locks the whole pool', () => {
    // 2026-09-30: every AFL and TheLeague free agent read `locked` mid-week,
    // and refusing on it turned down every waiver claim in both leagues.
    const locked = parseLockedPlayers(AFL);
    expect(dropLocksIn(locked, 'waiver')).toBeNull();
    expect(dropLocksIn(locked, 'unknown')).toBeNull();
    expect(isPlayerLocked(dropLocksIn(locked, 'fcfs'), '0530', '00')).toBe(true);
  });
});

// Every page or route that reads MFL's lock list must gate it on the FCFS
// window. The shared Free Agents page was extracted while the hotfix landed on
// its predecessor, and a copy that reads the raw list refuses every waiver
// claim in the league (#1280).
// The call-site guard ("every lock reader gates on the waiver window") lives in
// tests/mfl-locks-window-gate.test.ts: the raw reader is private now, and every
// consumer must read through fetchDropLocks.
