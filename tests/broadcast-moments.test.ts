/**
 * The broadcast board's editorial rules, as tests.
 *
 * Each block below is a way this screen can lie to someone watching it from
 * ten feet away while the real game is on the other television.
 */

import { describe, it, expect } from 'vitest';
import type { LiveScoringPlay, NflGame, PlayerMeta } from '../src/types/live-scoring';
import {
  MOMENT_MAX_AGE_MS,
  REVEAL_MINE_MS,
  REVEAL_OPPONENT_MS,
  buildBroadcastMoments,
  classifyPlay,
  isMomentFresh,
  revealDuration,
  selectRedZoneAlerts,
  selectRevealQueue,
  type LeagueViewer,
} from '../src/utils/broadcast-moments';

const NOW = Date.parse('2026-09-13T20:30:00Z');
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

const play = (over: Partial<LiveScoringPlay> = {}): LiveScoringPlay => ({
  playId: 'p1',
  gameId: 'g1',
  sequence: 1,
  period: 3,
  clock: '4:08',
  text: 'Player 1 12 Yd pass from Player 9 (Kick)',
  typeAbbrev: 'TD',
  typeText: 'Passing Touchdown',
  nflTeam: 'KC',
  scoreValue: 6,
  playerIds: ['1'],
  wallclock: at(10),
  ...over,
});

const meta: Record<string, PlayerMeta> = {
  '1': { id: '1', name: 'Rashee Rice', position: 'WR', nflTeam: 'KC', headshot: '', espnId: null, projected: 12 },
  '2': { id: '2', name: 'Bijan Robinson', position: 'RB', nflTeam: 'ATL', headshot: '', espnId: null, projected: 16 },
  '9': { id: '9', name: 'Patrick Mahomes', position: 'QB', nflTeam: 'KC', headshot: '', espnId: null, projected: 21 },
};

const league = (over: Partial<LeagueViewer> = {}): LeagueViewer => ({
  leagueId: '13522',
  leagueName: 'TheLeague',
  franchiseId: '0001',
  franchiseName: 'Pacific Pigskins',
  opponentIds: ['0002'],
  opponentNames: { '0002': 'Rivals' },
  players: { '0001': [{ id: '1' }], '0002': [{ id: '2' }] },
  ...over,
});

describe('classifyPlay — what earns a television', () => {
  it('takes touchdowns, two-pointers, field goals, safeties', () => {
    expect(classifyPlay(play())).toBe('touchdown');
    expect(classifyPlay(play({ twoPoint: true }))).toBe('two-point');
    expect(classifyPlay(play({ typeAbbrev: 'FG', typeText: 'Field Goal Good', scoreValue: 3 }))).toBe('field-goal');
    expect(classifyPlay(play({ typeAbbrev: 'SF', typeText: 'Safety', scoreValue: 2 }))).toBe('safety');
  });

  it('takes a turnover and a long non-scoring gain', () => {
    expect(classifyPlay(play({ typeAbbrev: '', typeText: 'Interception Return', scoreValue: 0, isTurnover: true }))).toBe('turnover');
    expect(classifyPlay(play({ typeAbbrev: '', typeText: 'Pass Reception', scoreValue: 0, yards: 57 }))).toBe('big-play');
  });

  it('never interrupts the screen for an extra point', () => {
    // It scores, it is real, and nobody wants a television to shout about it.
    expect(classifyPlay(play({ typeAbbrev: 'PAT', typeText: 'Extra Point Good', scoreValue: 1, playerIds: ['9'] }))).toBeNull();
  });
});

describe('buildBroadcastMoments — whose play is it', () => {
  it('sides the owner and his opponent correctly', () => {
    const moments = buildBroadcastMoments([play(), play({ playId: 'p2', playerIds: ['2'] })], [league()], meta);
    expect(moments.map((m) => [m.playerName, m.side])).toEqual([
      ['Rashee Rice', 'mine'],
      ['Bijan Robinson', 'opponent'],
    ]);
    expect(moments[1].franchiseName).toBe('Rivals');
  });

  it('ignores a play involving nobody the viewer has a stake in', () => {
    // Not an omission — the whole premise is that this board speaks only about
    // the owner's own teams.
    expect(buildBroadcastMoments([play({ playerIds: ['77'] })], [league()], meta)).toEqual([]);
  });

  it('reads ONE play as two opposite moments across two leagues', () => {
    // The same touchdown: my starter in TheLeague, my opponent's in the AFL.
    // This is the case a single-league ticker cannot represent at all.
    const afl = league({
      leagueId: '19621',
      leagueName: 'AFL',
      franchiseName: 'AFL Team',
      opponentIds: ['0007'],
      opponentNames: { '0007': 'AFL Rival' },
      players: { '0001': [{ id: '2' }], '0007': [{ id: '1' }] },
    });
    const moments = buildBroadcastMoments([play()], [league(), afl], meta);

    expect(moments).toHaveLength(2);
    expect(moments.map((m) => [m.leagueName, m.side])).toEqual([
      ['TheLeague', 'mine'],
      ['AFL', 'opponent'],
    ]);
    // Distinct keys, or the second silently replaces the first.
    expect(new Set(moments.map((m) => m.key)).size).toBe(2);
  });

  it('keys on the league, because both leagues have a franchise 0001', () => {
    const afl = league({ leagueId: '19621', leagueName: 'AFL', players: { '0001': [{ id: '1' }] } });
    const moments = buildBroadcastMoments([play()], [league(), afl], meta);
    expect(moments).toHaveLength(2);
    expect(moments[0].key).not.toBe(moments[1].key);
  });

  it('credits BOTH franchises when an AFL duplicate roster starts the same man', () => {
    // duplicatePlayers: one NFL player started by two franchises at once. A
    // Map<playerId, fid> keeps the last one written and drops the other.
    const dup = league({
      leagueId: '19621',
      leagueName: 'AFL',
      opponentIds: ['0007', '0008'],
      opponentNames: { '0007': 'Rival A', '0008': 'Rival B' },
      players: { '0007': [{ id: '1' }], '0008': [{ id: '1' }] },
      franchiseId: '0099',
    });
    const moments = buildBroadcastMoments([play()], [dup], meta);
    expect(moments).toHaveLength(2);
    expect(moments.map((m) => m.franchiseName).sort()).toEqual(['Rival A', 'Rival B']);
  });

  it('calls a player started by BOTH sides of one matchup mine', () => {
    const both = league({ players: { '0001': [{ id: '1' }], '0002': [{ id: '1' }] } });
    const moments = buildBroadcastMoments([play()], [both], meta);
    expect(moments).toHaveLength(1);
    expect(moments[0].side).toBe('mine');
  });

  it('never fabricates a clock', () => {
    const [m] = buildBroadcastMoments([play()], [league()], meta);
    expect(m.clock).toBe('Q3 4:08');

    // No period and no clock means no clock text — not an invented one.
    const [blank] = buildBroadcastMoments([play({ period: 0, clock: '' })], [league()], meta);
    expect(blank.clock).toBe('');
  });
});

describe('staleness — a reveal is about the present', () => {
  it('keeps a fresh moment and drops one past the window', () => {
    expect(isMomentFresh({ wallclock: at(10) }, NOW)).toBe(true);
    expect(isMomentFresh({ wallclock: at(MOMENT_MAX_AGE_MS / 1000 + 30) }, NOW)).toBe(false);
  });

  it('treats a moment it cannot DATE as stale, never as fresh', () => {
    // ESPN omits wallclock on a small number of plays. Showing an undateable
    // play full-screen risks revealing a first-quarter touchdown at 4pm;
    // dropping it costs one reveal of something the scoreboard already shows.
    expect(isMomentFresh({ wallclock: '' }, NOW)).toBe(false);
    expect(isMomentFresh({ wallclock: 'not a date' }, NOW)).toBe(false);
  });

  it('rejects a moment from the future', () => {
    expect(isMomentFresh({ wallclock: at(-600) }, NOW)).toBe(false);
  });

  it('drops stale moments out of the queue rather than showing them late', () => {
    const fresh = buildBroadcastMoments([play({ playId: 'fresh', wallclock: at(5) })], [league()], meta);
    const old = buildBroadcastMoments([play({ playId: 'old', wallclock: at(400) })], [league()], meta);
    const queue = selectRevealQueue([...fresh, ...old], { now: NOW });
    expect(queue.map((m) => m.playId)).toEqual(['fresh']);
  });
});

describe('the reveal queue', () => {
  it('plays a backlog oldest first, so the drive reads forwards', () => {
    const moments = buildBroadcastMoments(
      [
        play({ playId: 'second', wallclock: at(10) }),
        play({ playId: 'first', wallclock: at(40) }),
      ],
      [league()],
      meta,
    );
    expect(selectRevealQueue(moments, { now: NOW }).map((m) => m.playId)).toEqual(['first', 'second']);
  });

  it('never replays a moment that has already had its moment', () => {
    const moments = buildBroadcastMoments([play()], [league()], meta);
    const shown = new Set([moments[0].key]);
    expect(selectRevealQueue(moments, { now: NOW, shown })).toEqual([]);
  });

  it('is idempotent across polls — the same payload yields the same queue', () => {
    const moments = buildBroadcastMoments([play(), play({ playId: 'p2', playerIds: ['2'] })], [league()], meta);
    const a = selectRevealQueue(moments, { now: NOW }).map((m) => m.key);
    const b = selectRevealQueue(moments, { now: NOW }).map((m) => m.key);
    expect(a).toEqual(b);
  });

  it('leads with the owner’s own news when two land in the same instant', () => {
    const afl = league({
      leagueId: '19621',
      leagueName: 'AFL',
      opponentIds: ['0007'],
      opponentNames: { '0007': 'AFL Rival' },
      players: { '0001': [{ id: '2' }], '0007': [{ id: '1' }] },
    });
    const queue = selectRevealQueue(buildBroadcastMoments([play()], [afl, league()], meta), { now: NOW });
    expect(queue[0].side).toBe('mine');
  });
});

describe('reveal duration', () => {
  it('gives the owner the full moment and the opponent a shorter one', () => {
    expect(revealDuration({ side: 'mine' }, 1)).toBe(REVEAL_MINE_MS);
    expect(revealDuration({ side: 'opponent' }, 1)).toBe(REVEAL_OPPONENT_MS);
    expect(REVEAL_OPPONENT_MS).toBeLessThan(REVEAL_MINE_MS);
  });

  it('rushes a backlog rather than falling further behind', () => {
    expect(revealDuration({ side: 'mine' }, 9)).toBeLessThan(REVEAL_MINE_MS);
  });
});

describe('the red-zone banner', () => {
  const game = (over: Partial<NflGame> = {}): NflGame => ({
    id: 'g1',
    state: 'in',
    shortDetail: '4:08 - 3rd',
    period: 3,
    clock: '4:08',
    home: { code: 'KC', score: 14 },
    away: { code: 'ATL', score: 10 },
    possession: 'KC',
    date: '2026-09-13T17:00Z',
    situation: { isRedZone: true, possession: 'KC', downDistanceText: '1st & Goal at ATL 8', shortDownDistanceText: '1st & Goal', lastPlay: '' },
    ...over,
  });

  it('flags the viewer’s player when HIS team has the ball inside the 20', () => {
    const alerts = selectRedZoneAlerts([game()], [league()], meta);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].team).toBe('KC');
    expect(alerts[0].players.map((p) => p.playerName)).toEqual(['Rashee Rice']);
    expect(alerts[0].downDistance).toBe('1st & Goal');
  });

  it('does NOT flag him while his team is on defense', () => {
    // isRedZone belongs to the team with the ball. Reading it off the game
    // alone is exactly backwards for every player on the other roster.
    const alerts = selectRedZoneAlerts(
      [game({ situation: { isRedZone: true, possession: 'ATL', downDistanceText: '', shortDownDistanceText: '', lastPlay: '' } })],
      [league()],
      meta,
    );
    expect(alerts.map((a) => a.players.map((p) => p.playerName))).toEqual([['Bijan Robinson']]);
  });

  it('ignores a situation lingering on a game that has ended', () => {
    expect(selectRedZoneAlerts([game({ state: 'post' })], [league()], meta)).toEqual([]);
  });

  it('says nothing about a red-zone drive with none of his players in it', () => {
    const bare = league({ players: { '0001': [{ id: '2' }] }, opponentIds: [] });
    expect(selectRedZoneAlerts([game()], [bare], meta)).toEqual([]);
  });

  it('is derived fresh, so a drive that ends clears the banner', () => {
    expect(selectRedZoneAlerts([game({ situation: null })], [league()], meta)).toEqual([]);
  });
});
