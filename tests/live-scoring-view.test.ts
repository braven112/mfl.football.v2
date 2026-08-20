/**
 * Behavior tests for the live-scoring island's derived view model.
 *
 * Each block below covers something the page previously INVENTED (the quarter
 * and clock), or a gate that is wrong in a way an owner would notice
 * immediately (a red-zone flag on a player whose team is on defense).
 */

import { describe, it, expect } from 'vitest';
import {
  buildMoments,
  formatGameClock,
  formatPlayClock,
  isPlayerInRedZone,
  playerDownDistance,
  selectMatchupMoments,
  type LiveMoment,
} from '../src/utils/live-scoring-view';
import type {
  LivePlayerRow,
  LiveScoringPlay,
  NflGame,
  PlayerMeta,
} from '../src/types/live-scoring';

const game = (over: Partial<NflGame> = {}): NflGame => ({
  id: '1',
  state: 'in',
  shortDetail: '8:12 - 3rd',
  period: 3,
  clock: '8:12',
  home: { code: 'WSH', score: 14 },
  away: { code: 'KC', score: 21 },
  possession: 'KC',
  date: '',
  situation: {
    isRedZone: true,
    possession: 'KC',
    downDistanceText: '1st & Goal at WSH 8',
    shortDownDistanceText: '1st & Goal',
    lastPlay: 'P.Mahomes pass short right to T.Kelce for 12 yards.',
  },
  ...over,
});

describe('formatGameClock', () => {
  it('shows ESPN’s real clock for a live game', () => {
    expect(formatGameClock('in-progress', game())).toBe('8:12 - 3rd');
  });

  it('assembles a quarter + clock only when shortDetail is missing', () => {
    expect(formatGameClock('in-progress', game({ shortDetail: '', period: 2, clock: '1:44' })))
      .toBe('Q2 1:44');
    expect(formatGameClock('in-progress', game({ shortDetail: '', period: 0, clock: '' })))
      .toBe('In progress');
  });

  it('says Final for a finished game regardless of the MFL-derived state', () => {
    expect(formatGameClock('in-progress', game({ state: 'post', shortDetail: 'Final' }))).toBe('Final');
  });

  it('NEVER fabricates a quarter when there is no ESPN game', () => {
    // The old clockLabel() divided MFL's gameSecondsRemaining by 900 and
    // printed e.g. "Q3 7:24" — a confident number that is not the game clock.
    // Without a real game we print the state and no numbers, on purpose.
    for (const out of [
      formatGameClock('in-progress', undefined),
      formatGameClock('final', undefined),
      formatGameClock('not-started', undefined),
    ]) {
      expect(out).not.toMatch(/Q\d|\d+:\d\d/);
    }
    expect(formatGameClock('in-progress', undefined)).toBe('In progress');
    expect(formatGameClock('final', undefined)).toBe('Final');
    expect(formatGameClock('not-started', undefined)).toBe('Yet to play');
  });

  it('shows the kickoff time for a game that has not started', () => {
    expect(formatGameClock('not-started', game({ state: 'pre', shortDetail: 'Sun 1:00 PM ET' })))
      .toBe('Sun 1:00 PM ET');
  });
});

describe('isPlayerInRedZone', () => {
  it('flags a player whose own team has the ball inside the 20', () => {
    expect(isPlayerInRedZone(game(), 'KC')).toBe(true);
  });

  it('does NOT flag the opponent — the red zone belongs to the possessing team', () => {
    // This is the whole point of the gate: without it, a Commanders receiver
    // gets a red-zone badge while Washington is on defense.
    expect(isPlayerInRedZone(game(), 'WSH')).toBe(false);
  });

  it('does not flag when the drive is not in the red zone', () => {
    const g = game();
    expect(isPlayerInRedZone({ ...g, situation: { ...g.situation!, isRedZone: false } }, 'KC')).toBe(false);
  });

  it('ignores a situation left on a game that is no longer in progress', () => {
    expect(isPlayerInRedZone(game({ state: 'post' }), 'KC')).toBe(false);
    expect(isPlayerInRedZone(game({ state: 'pre' }), 'KC')).toBe(false);
  });

  it('is false with no game, no situation, no possession, or no team', () => {
    expect(isPlayerInRedZone(undefined, 'KC')).toBe(false);
    expect(isPlayerInRedZone(game({ situation: null }), 'KC')).toBe(false);
    const g = game();
    expect(isPlayerInRedZone({ ...g, situation: { ...g.situation!, possession: '' } }, 'KC')).toBe(false);
    expect(isPlayerInRedZone(game(), '')).toBe(false);
  });
});

describe('playerDownDistance', () => {
  it('shows down & distance only for the team with the ball', () => {
    expect(playerDownDistance(game(), 'KC')).toBe('1st & Goal');
    expect(playerDownDistance(game(), 'WSH')).toBe('');
  });

  it('falls back to the long form when ESPN omits the short one', () => {
    const g = game();
    expect(
      playerDownDistance({ ...g, situation: { ...g.situation!, shortDownDistanceText: '' } }, 'KC'),
    ).toBe('1st & Goal at WSH 8');
  });

  it('is empty for a game that is not in progress', () => {
    expect(playerDownDistance(game({ state: 'post' }), 'KC')).toBe('');
  });
});

describe('formatPlayClock', () => {
  it('pairs the real quarter with the real clock', () => {
    expect(formatPlayClock({ period: 1, clock: '11:49' })).toBe('Q1 11:49');
  });
  it('labels overtime rather than printing Q5', () => {
    expect(formatPlayClock({ period: 5, clock: '4:02' })).toBe('OT 4:02');
  });
  it('degrades instead of inventing a half of the pair', () => {
    expect(formatPlayClock({ period: 0, clock: '2:00' })).toBe('2:00');
    expect(formatPlayClock({ period: 2, clock: '' })).toBe('Q2');
    expect(formatPlayClock({ period: 0, clock: '' })).toBe('');
  });
});

describe('buildMoments', () => {
  const play = (over: Partial<LiveScoringPlay> = {}): LiveScoringPlay => ({
    playId: '100',
    gameId: '1',
    sequence: 1,
    period: 1,
    clock: '11:49',
    text: 'Javonte Williams 1 Yd Rush (Kick)',
    typeAbbrev: 'TD',
    typeText: 'Rushing Touchdown',
    nflTeam: 'DAL',
    scoreValue: 6,
    playerIds: ['A'],
    ...over,
  });

  const players: Record<string, LivePlayerRow[]> = {
    '0001': [{ id: 'A', live: 12, secondsRemaining: 900, status: 'starter' }],
    '0002': [{ id: 'B', live: 8, secondsRemaining: 900, status: 'starter' }],
  };
  const meta: Record<string, PlayerMeta> = {
    A: { id: 'A', name: 'Javonte Williams', position: 'RB', nflTeam: 'DAL', headshot: '', espnId: null, projected: 14 },
    B: { id: 'B', name: 'CeeDee Lamb', position: 'WR', nflTeam: 'DAL', headshot: '', espnId: null, projected: 16 },
  };

  it('attributes a play to the franchise that started the player', () => {
    const [m] = buildMoments([play()], players, meta);
    expect(m.fid).toBe('0001');
    expect(m.playerName).toBe('Javonte Williams');
    expect(m.clock).toBe('Q1 11:49');
    expect(m.typeAbbrev).toBe('TD');
    expect(m.text).toContain('1 Yd Rush');
  });

  it('emits one row per rostered starter, so a QB→WR TD reaches both owners', () => {
    const rows = buildMoments([play({ playerIds: ['A', 'B'] })], players, meta);
    expect(rows.map((r) => r.fid).sort()).toEqual(['0001', '0002']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('emits ONE row per play per franchise even when it credits two of that owner’s starters', () => {
    // A TD credits the scorer AND the kicker. An owner who starts both used to
    // see the identical line twice — that shipped, visibly, on the 2025 Week 1
    // board ("Derrick Henry 46 Yd Rush (Tyler Loop PAT Failed)" listed twice).
    const both: Record<string, LivePlayerRow[]> = {
      '0001': [
        { id: 'A', live: 12, secondsRemaining: 0, status: 'starter' },
        { id: 'B', live: 8, secondsRemaining: 0, status: 'starter' },
      ],
    };
    const rows = buildMoments([play({ playerIds: ['A', 'B'] })], both, meta);
    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe('A');
  });

  it('reaches BOTH owners when two franchises start the same player (AFL duplicate rosters)', () => {
    // The AFL runs duplicate-player conferences, and in a real week 85 of 131
    // starters are rostered by more than one franchise. A player→franchise map
    // keeps only the last one written, which drops the play from the other
    // owner's ticker entirely.
    const shared: Record<string, LivePlayerRow[]> = {
      '0002': [{ id: 'A', live: 12, secondsRemaining: 0, status: 'starter' }],
      '0017': [{ id: 'A', live: 12, secondsRemaining: 0, status: 'starter' }],
      '0021': [{ id: 'A', live: 12, secondsRemaining: 0, status: 'starter' }],
    };
    const rows = buildMoments([play()], shared, meta);
    expect(rows.map((r) => r.fid).sort()).toEqual(['0002', '0017', '0021']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it('does not duplicate a franchise that lists the same starter twice', () => {
    const doubled: Record<string, LivePlayerRow[]> = {
      '0002': [
        { id: 'A', live: 12, secondsRemaining: 0, status: 'starter' },
        { id: 'A', live: 12, secondsRemaining: 0, status: 'starter' },
      ],
    };
    expect(buildMoments([play()], doubled, meta)).toHaveLength(1);
  });

  it('drops a play involving nobody rostered rather than filling the ticker', () => {
    expect(buildMoments([play({ playerIds: ['Z'] })], players, meta)).toEqual([]);
    expect(buildMoments([play({ playerIds: [] })], players, meta)).toEqual([]);
  });

  it('is IDEMPOTENT across polls — the same payload never double-counts', () => {
    // The ticker is derived, not accumulated: /api/nfl-game-detail returns the
    // whole slate every poll. Re-deriving must produce exactly the same rows,
    // which is what makes the old accumulate-and-dedupe seen-set unnecessary.
    const once = buildMoments([play()], players, meta);
    const twice = buildMoments([play()], players, meta);
    expect(twice).toEqual(once);
  });

  it('preserves the order the route hands it, newest first', () => {
    // The route sorts the slate chronologically across games; re-sorting here
    // on `sequence` would re-break it, since sequence is per-game only.
    const slate = [
      play({ playId: '1', sequence: 900, period: 3, clock: '7:26' }),
      play({ playId: '2', sequence: 5, period: 4, clock: '11:42' }),
      play({ playId: '3', sequence: 400, period: 4, clock: '1:34' }),
    ];
    expect(buildMoments(slate, players, meta).map((m) => m.playId)).toEqual(['3', '2', '1']);
  });

  it('a re-poll that adds a later play appends without disturbing the earlier one', () => {
    const first = buildMoments([play()], players, meta);
    const second = buildMoments(
      [play(), play({ playId: '101', sequence: 2, playerIds: ['B'], text: 'CeeDee Lamb 8 Yd Pass' })],
      players,
      meta,
    );
    expect(second).toHaveLength(2);
    // Newest first.
    expect(second[0].playId).toBe('101');
    expect(second[1]).toEqual(first[0]);
  });

  it('returns nothing before lineups are known, instead of unowned rows', () => {
    expect(buildMoments([play()], {}, meta)).toEqual([]);
  });

  it('survives a player with no metadata', () => {
    const [m] = buildMoments([play()], players, {});
    expect(m.playerName).toBe('');
    expect(m.fid).toBe('0001');
  });
});

describe('selectMatchupMoments', () => {
  const m = (playId: string, fid: string, text = `play ${playId}`): LiveMoment => ({
    key: `${playId}:${fid}`,
    playId,
    fid,
    playerId: 'p',
    playerName: 'Player',
    team: 'DEN',
    text,
    clock: 'Q4 1:00',
    typeAbbrev: 'TD',
  });

  it('keeps only the two franchises in this matchup', () => {
    const rows = selectMatchupMoments(
      [m('1', '0006'), m('2', '0099'), m('3', '0017')],
      '0006',
      '0017',
    );
    expect(rows.map((r) => r.playId)).toEqual(['1', '3']);
  });

  it('shows a play ONCE when both sides of the matchup started a credited player', () => {
    // The AFL runs duplicate rosters, so this is normal there — and the ticker
    // carries no team attribution, so a second identical row says nothing.
    const rows = selectMatchupMoments(
      [m('9', '0006', 'Courtland Sutton 22 Yd pass from Bo Nix'),
       m('9', '0017', 'Courtland Sutton 22 Yd pass from Bo Nix')],
      '0006',
      '0017',
    );
    expect(rows).toHaveLength(1);
  });

  it('still lets the SAME play reach the other matchup that franchise plays', () => {
    // Dedupe is per rendered matchup, not global — an AFL doubleheader means
    // one franchise appears in two matchups and both should show its plays.
    const all = [m('9', '0006'), m('9', '0017')];
    expect(selectMatchupMoments(all, '0006', '0001')).toHaveLength(1);
    expect(selectMatchupMoments(all, '0017', '0002')).toHaveLength(1);
  });

  it('caps the list, keeping the newest rows (input is newest-first)', () => {
    const many = Array.from({ length: 20 }, (_, i) => m(String(i), '0006'));
    const rows = selectMatchupMoments(many, '0006', '0017');
    expect(rows).toHaveLength(8);
    expect(rows[0].playId).toBe('0');
  });

  it('returns an empty list when neither franchise has a play', () => {
    expect(selectMatchupMoments([m('1', '0099')], '0006', '0017')).toEqual([]);
    expect(selectMatchupMoments([], '0006', '0017')).toEqual([]);
  });
});
