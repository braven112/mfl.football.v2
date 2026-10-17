/**
 * Sleeper leagues on MFL Live: the player id join, the week → snapshot
 * conversion, and the per-team game clock.
 *
 * The id join is the one place a bug here resolves the WRONG PERSON rather
 * than failing (docs/claude/rules/live-scoring.md), so its rungs and its
 * refusal to guess on an ambiguous name are pinned explicitly.
 */

import { describe, expect, it } from 'vitest';
import { buildSleeperPlayerMap, UNRESOLVED_PREFIX } from '../src/utils/sleeper/players';
import {
  buildSleeperLeagueMeta,
  findViewerRoster,
  isSleeperLeagueId,
  secondsRemainingByTeam,
  sleeperBoardLeagueId,
  sleeperLeagueIdOf,
  sleeperWeekToSnapshot,
} from '../src/utils/sleeper/live';
import { normalizeSleeperUsername, sleeperAvatarUrl } from '../src/utils/sleeper/client';
import { sleeperLinkKey } from '../src/utils/sleeper/link';
import { hasLiveSignal } from '../src/utils/live-scoring-snapshot';
import type { NflGame } from '../src/types/live-scoring';
import type { SleeperMatchupEntry } from '../src/utils/sleeper/client';

const MFL = [
  { id: '13116', name: 'Mahomes, Patrick', position: 'QB', team: 'KCC', espn_id: '3139477', rotowire_id: '11839' },
  { id: '15281', name: "Chase, Ja'Marr", position: 'WR', team: 'CIN', espn_id: '4362628', rotowire_id: '15183' },
  { id: '20001', name: 'Williams, Mike', position: 'WR', team: 'NYJ' },
  { id: '20002', name: 'Williams, Mike', position: 'WR', team: 'PIT' },
  { id: '20003', name: 'Tucker, Justin', position: 'PK', team: 'BAL' },
  { id: '0507', name: 'Chiefs, Kansas City', position: 'Def', team: 'KCC' },
];

const SLEEPER = {
  '4046': { full_name: 'Patrick Mahomes', position: 'QB', team: 'KC', espn_id: 3139477 },
  // No ESPN id on Sleeper's side — the RotoWire rung has to catch him.
  '7564': { full_name: "Ja'Marr Chase", position: 'WR', team: 'CIN', espn_id: null, rotowire_id: 15183 },
  // Two MFL players share this name and position: must resolve to NOBODY.
  '9001': { full_name: 'Mike Williams', position: 'WR', team: 'NYJ' },
  // Unique name + position, no shared ids.
  '1945': { full_name: 'Justin Tucker', position: 'K', team: 'BAL' },
  KC: { first_name: 'Kansas City', last_name: 'Chiefs', position: 'DEF', team: 'KC' },
  // Not a fantasy position — dropped from the compact map.
  '9999': { full_name: 'Long Snapper', position: 'LS', team: 'KC' },
};

describe('buildSleeperPlayerMap', () => {
  const map = buildSleeperPlayerMap(SLEEPER, MFL);

  it('joins on the ESPN id first', () => {
    expect(map['4046'].mfl).toBe('13116');
  });

  it('falls back to the RotoWire id when Sleeper has no ESPN id', () => {
    expect(map['7564'].mfl).toBe('15281');
  });

  it('refuses a name two MFL players share, rather than picking one', () => {
    expect(map['9001'].mfl).toBe('');
    expect(map['9001'].name).toBe('Mike Williams');
  });

  it('matches a unique name + position, translating K to PK', () => {
    expect(map['1945']).toMatchObject({ mfl: '20003', position: 'PK' });
  });

  it('maps a team defence by club', () => {
    expect(map.KC).toMatchObject({ mfl: '0507', position: 'Def', team: 'KC' });
  });

  it('keeps fantasy positions only', () => {
    expect(map['9999']).toBeUndefined();
  });
});

describe('sleeperWeekToSnapshot', () => {
  const players = buildSleeperPlayerMap(SLEEPER, MFL);
  const seconds = new Map([
    ['KC', 1800],
    ['CIN', 0],
    ['BAL', 3600],
  ]);
  const week: SleeperMatchupEntry[] = [
    {
      roster_id: 1,
      matchup_id: 2,
      points: 31.5,
      starters: ['4046', '7564', '0'],
      starters_points: [22.5, 9, 0],
      players: ['4046', '7564', '9001'],
      players_points: { '4046': 22.5, '7564': 9, '9001': 4 },
    },
    {
      roster_id: 2,
      matchup_id: 2,
      points: 10,
      starters: ['1945', 'KC'],
      starters_points: [3, 7],
      players: ['1945', 'KC'],
      players_points: { '1945': 3, KC: 7 },
    },
    // No head-to-head game this week.
    { roster_id: 3, matchup_id: null, points: 0, starters: [], players: [] },
  ];
  const snap = sleeperWeekToSnapshot(week, players, seconds);

  it('pairs rosters by matchup_id and leaves a roster with none unpaired', () => {
    expect(snap.matchups).toEqual([{ home: '1', away: '2' }]);
  });

  it("takes Sleeper's own totals rather than re-scoring", () => {
    expect(snap.scores).toMatchObject({ '1': 31.5, '2': 10 });
  });

  it('drops empty starter slots and keys rows by MFL id', () => {
    expect(snap.players['1'].map((r) => r.id)).toEqual(['13116', '15281']);
    expect(snap.players['1'].map((r) => r.live)).toEqual([22.5, 9]);
  });

  it('puts the bench in its own map, under a sleeper: id when unresolved', () => {
    expect(snap.bench['1']).toEqual([
      { id: `${UNRESOLVED_PREFIX}9001`, live: 4, secondsRemaining: 0, status: 'nonstarter' },
    ]);
  });

  it("takes each starter's clock from his club's game", () => {
    expect(snap.players['1'].map((r) => r.secondsRemaining)).toEqual([1800, 0]);
    expect(snap.playersYetToPlay['2']).toBe(1);
  });

  it('reads as live once lineups exist, and as not-played when the week is empty', () => {
    expect(hasLiveSignal(snap)).toBe(true);
    expect(hasLiveSignal(sleeperWeekToSnapshot([], players, seconds))).toBe(false);
  });
});

describe('secondsRemainingByTeam', () => {
  const game = (state: NflGame['state'], period: number, clock: string): NflGame => ({
    id: '1',
    state,
    shortDetail: '',
    period,
    clock,
    home: { code: 'WSH', score: 0 },
    away: { code: 'JAX', score: 0 },
    possession: null,
    date: '',
  });

  it('is a full game before kickoff and zero at the final', () => {
    expect(secondsRemainingByTeam([game('pre', 0, '15:00')]).get('WSH')).toBe(3600);
    expect(secondsRemainingByTeam([game('post', 4, '0:00')]).get('JAX')).toBe(0);
  });

  it('counts the quarters left plus the clock, and never reads a live game as final', () => {
    expect(secondsRemainingByTeam([game('in', 3, '7:30')]).get('WSH')).toBe(900 + 450);
    expect(secondsRemainingByTeam([game('in', 4, '0:00')]).get('WSH')).toBe(1);
    expect(secondsRemainingByTeam([game('in', 5, '4:00')]).get('WSH')).toBe(240);
  });
});

describe('league metadata and ids', () => {
  const meta = buildSleeperLeagueMeta(
    [
      { roster_id: 1, owner_id: 'u1' },
      { roster_id: 2, owner_id: 'u2', co_owners: ['u3'] },
    ],
    [
      { user_id: 'u1', display_name: 'brandon', avatar: 'abc123', metadata: { team_name: 'Pigskins' } },
      { user_id: 'u2', display_name: 'rival', avatar: null },
    ],
  );

  it("names a roster by its team name, else its owner's display name", () => {
    expect(meta.names).toEqual({ '1': 'Pigskins', '2': 'rival' });
    expect(meta.icons['1']).toBe('https://sleepercdn.com/avatars/thumbs/abc123');
  });

  it('finds the roster the viewer owns, or co-owns', () => {
    expect(findViewerRoster(meta, 'u1')).toBe('1');
    expect(findViewerRoster(meta, 'u3')).toBe('2');
    expect(findViewerRoster(meta, 'nobody')).toBeNull();
  });

  it('prefixes league ids so they never share a namespace with MFL ids', () => {
    const id = sleeperBoardLeagueId('1048313518937051136');
    expect(id).toBe('sl-1048313518937051136');
    expect(isSleeperLeagueId(id)).toBe(true);
    expect(isSleeperLeagueId('13522')).toBe(false);
    expect(sleeperLeagueIdOf(id)).toBe('1048313518937051136');
    // The selection cookie's id pattern (`/api/live-leagues`).
    expect(/^[A-Za-z0-9_-]{1,24}$/.test(id)).toBe(true);
  });
});

describe('linking', () => {
  it('normalizes a username and rejects anything else', () => {
    expect(normalizeSleeperUsername('  @Brandon_112 ')).toBe('brandon_112');
    expect(normalizeSleeperUsername('a/b')).toBeNull();
    expect(normalizeSleeperUsername('')).toBeNull();
    expect(normalizeSleeperUsername(42)).toBeNull();
  });

  it('builds avatar URLs only from plain ids or https URLs', () => {
    expect(sleeperAvatarUrl('abc')).toBe('https://sleepercdn.com/avatars/thumbs/abc');
    expect(sleeperAvatarUrl('https://sleepercdn.com/uploads/x.jpg')).toBe('https://sleepercdn.com/uploads/x.jpg');
    expect(sleeperAvatarUrl('javascript:alert(1)')).toBe('');
    expect(sleeperAvatarUrl(null)).toBe('');
  });

  it('keys the link on the MFL username, case-insensitively, never on the cookie', () => {
    const a = sleeperLinkKey({ name: 'Brandon' });
    expect(a).toBe(sleeperLinkKey({ name: 'brandon' }));
    expect(a).toMatch(/^live:sleeper:link:[0-9a-f]{32}$/);
    expect(sleeperLinkKey({ name: '' })).toBeNull();
  });
});
