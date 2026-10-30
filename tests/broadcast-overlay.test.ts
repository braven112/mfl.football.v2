import { describe, it, expect } from 'vitest';
import {
  BIG_PLAY_MIN_POINTS,
  detectBigPlays,
  formatChance,
  leagueShortName,
  overlayColumnFrom,
  overlayEdgeFrom,
  overlaySizeFrom,
  moveWatch,
  overlayGames,
  overlayModeFrom,
  overlayWatchList,
  stepOverlay,
  watchNote,
  winBarShare,
} from '../src/utils/broadcast-overlay';
import type { BroadcastLeaguePanel, BroadcastPollResponse, BroadcastTeam } from '../src/types/live-broadcast';
import type { PlayerMeta } from '../src/types/live-scoring';

const team = (franchiseId: string, name: string): BroadcastTeam => ({
  franchiseId,
  name,
  nameShort: name,
  abbrev: name.slice(0, 3).toUpperCase(),
  icon: '',
  iconSmall: '',
  primary: '#111111',
  secondary: '#222222',
  swatch: '#336699',
  gradient: '',
});

const panel = (leagueId: string, matchups: BroadcastLeaguePanel['matchups'], status: BroadcastLeaguePanel['status'] = 'ok') =>
  ({ leagueId, leagueName: `League ${leagueId}`, slug: '', franchiseId: '0001', home: true, matchups, status }) as BroadcastLeaguePanel;

const meta: Record<string, PlayerMeta> = {
  qb: { id: 'qb', name: 'Brock Purdy', position: 'QB', nflTeam: 'SF', headshot: '', espnId: null, projected: 0 },
  rb: { id: 'rb', name: 'Kenneth Walker', position: 'RB', nflTeam: 'SEA', headshot: '', espnId: null, projected: 0 },
  bn: { id: 'bn', name: 'Bench Guy', position: 'WR', nflTeam: 'KC', headshot: '', espnId: null, projected: 0 },
};

const poll: BroadcastPollResponse = {
  ok: true,
  week: 7,
  fetchedAt: '2026-10-26T20:00:00Z',
  moments: [],
  redZone: [],
  games: [],
  leagues: [
    {
      leagueId: 'A',
      ok: true,
      live: true,
      winProbability: [0.992],
      teams: {
        '0001': {
          live: 120.82,
          projectedFinal: 130.5,
          remainingPoints: 10,
          yetToPlay: 1,
          players: [
            { id: 'rb', live: 9.4, secondsRemaining: 1800, status: 'starter', projected: 19 },
            { id: 'bn', live: 30, secondsRemaining: 0, status: 'nonstarter' },
            { id: 'qb', live: 12, secondsRemaining: 0, status: 'starter', projected: 20 },
          ],
        },
        '0002': { live: 86.72, projectedFinal: 88, remainingPoints: 1, yetToPlay: 0, players: [] },
      },
    },
  ],
};

describe('overlay games', () => {
  const panels = [
    panel('A', [{ index: 0, mine: team('0001', 'Greco'), opponent: team('0002', 'Nick') }]),
    panel('B', [{ index: 0, mine: team('0001', 'Bye'), opponent: null }]),
  ];

  it('lists every game with an opponent and skips a bye', () => {
    const games = overlayGames(panels, poll, meta);
    expect(games.map((g) => g.key)).toEqual(['A:0']);
    expect(games[0].mine.live).toBe(120.82);
    expect(games[0].opponent.live).toBe(86.72);
    expect(games[0].winChance).toBe(0.992);
  });

  it('shows starters only, in position order, with each player projected', () => {
    const [game] = overlayGames(panels, poll, meta);
    expect(game.mine.lineup.map((p) => p.name)).toEqual(['Brock Purdy', 'Kenneth Walker']);
    // Half his game left: live plus half his full-game projection.
    expect(game.mine.lineup[1].projected).toBeCloseTo(9.4 + 19 / 2);
    // A finished player is worth exactly what he scored.
    expect(game.mine.lineup[0].projected).toBe(12);
  });

  it("carries each club's on-dark crest and the league id for its logo", () => {
    const withArt = panel('A', [
      {
        index: 0,
        mine: { ...team('0001', 'Mine'), iconSmall: '/mine.png', iconSmallStroke: '#fff' },
        opponent: { ...team('0002', 'Them'), iconSmall: '/them.png' },
      },
    ]);
    const [game] = overlayGames([withArt], poll, meta);
    expect(game.leagueId).toBe('A');
    expect(game.mine.icon).toBe('/mine.png');
    expect(game.mine.iconStroke).toBe('#fff');
    expect(game.opponent.icon).toBe('/them.png');
    expect(game.opponent.iconStroke).toBeUndefined();
  });

  it('marks a game unreadable when its league feed failed', () => {
    const failed = { ...poll, leagues: [{ ...poll.leagues[0], ok: false }] };
    expect(overlayGames(panels, failed, meta)[0].readable).toBe(false);
  });
});

describe('overlay controls', () => {
  it('wraps Left/Right through the games', () => {
    expect(stepOverlay(0, 1, 3)).toBe(1);
    expect(stepOverlay(2, 1, 3)).toBe(0);
    expect(stepOverlay(0, -1, 3)).toBe(2);
    expect(stepOverlay(0, 1, 0)).toBe(0);
  });

  it('reads the mode hint, defaulting to the panel', () => {
    expect(overlayModeFrom('bar')).toBe('bar');
    expect(overlayModeFrom('panel')).toBe('panel');
    expect(overlayModeFrom('expanded')).toBe('expanded');
    expect(overlayModeFrom(null)).toBe('panel');
  });

  it('reads the edge hint, defaulting to the top', () => {
    expect(overlayEdgeFrom('bottom')).toBe('bottom');
    expect(overlayEdgeFrom('top')).toBe('top');
    expect(overlayEdgeFrom(null)).toBe('top');
    expect(overlayEdgeFrom('left')).toBe('top');
  });

  it('reads the corner box hints, defaulting to a small box on the right', () => {
    expect(overlayColumnFrom('left')).toBe('left');
    expect(overlayColumnFrom(null)).toBe('right');
    expect(overlayColumnFrom('bottom')).toBe('right');
    expect(overlaySizeFrom('quarter')).toBe('quarter');
    expect(overlaySizeFrom(null)).toBe('small');
    expect(overlaySizeFrom('expanded')).toBe('small');
  });

  it("splits the win bar by the board's win chance, so a decided game shows one colour", () => {
    expect(winBarShare(0.71)).toBeCloseTo(71);
    expect(winBarShare(1)).toBe(100);
    expect(winBarShare(0)).toBe(0);
    expect(winBarShare(1.4)).toBe(100);
    expect(winBarShare(Number.NaN)).toBe(50);
  });

  it('names a league that has no logo by a short name', () => {
    expect(leagueShortName('Best Ball 2026')).toBe('BB26');
    expect(leagueShortName('Dynasty')).toBe('DYNAST');
    expect(leagueShortName('  ')).toBe('');
    expect(leagueShortName('The Big Fantasy League Of Friends')).toBe('TBFLO');
  });

  it('prints 100% only for a settled game', () => {
    expect(formatChance(1)).toBe('100%');
    expect(formatChance(0)).toBe('0%');
    expect(formatChance(0.9999)).toBe('99.9%');
    expect(formatChance(0.992)).toBe('99.2%');
  });
});

describe('overlay watch list', () => {
  const panels = [panel('A', [{ index: 0, mine: team('0001', 'Greco'), opponent: team('0002', 'Nick') }])];
  // Sun Oct 25 2026, 1:00 PM ET = 17:00Z; 8:20 PM ET = 00:20Z Monday.
  const slate: BroadcastPollResponse['games'] = [
    { id: 'g1', state: 'pre', shortDetail: 'Sun 1:00 PM ET', period: 0, clock: '', home: { code: 'SF', score: 0 }, away: { code: 'SEA', score: 0 }, possession: null, date: '2026-10-25T17:00Z', broadcast: 'FOX' },
    { id: 'g2', state: 'in', shortDetail: '8:12 - 3rd', period: 3, clock: '8:12', home: { code: 'KC', score: 7 }, away: { code: 'DEN', score: 3 }, possession: null, date: '2026-10-26T00:20Z', broadcast: 'NBC' },
    { id: 'g3', state: 'post', shortDetail: 'Final', period: 4, clock: '', home: { code: 'SEA', score: 0 }, away: { code: 'LAR', score: 0 }, possession: null, date: '2026-10-25T17:00Z', broadcast: 'CBS' },
  ];
  const games = () => overlayGames(panels, { ...poll, games: slate }, { ...meta, bn: { ...meta.bn, nflTeam: 'KC' } });

  it("lists my starters' unfinished games, live first, and skips a game with none of them", () => {
    const rows = overlayWatchList(games(), slate);
    // The bench player's KC game is not listed: starters only.
    expect(rows.map((r) => r.id)).toEqual(['g1']);
    expect(rows[0]).toMatchObject({
      label: 'SEA @ SF',
      query: 'Seattle Seahawks vs San Francisco 49ers',
      network: 'FOX',
      players: ['Walker', 'Purdy'], // away team's first
      regional: true,
    });
  });

  it('labels a regional Sunday game by whether the owner has Sunday Ticket', () => {
    const [row] = overlayWatchList(games(), slate);
    expect(watchNote(row, true)).toBe('FOX · Sunday Ticket');
    expect(watchNote(row, false)).toBe('FOX · local only');
    expect(watchNote({ ...row, regional: false, network: 'NBC' }, false)).toBe('NBC');
  });

  it('moves through the rows and the closing Hide row without wrapping', () => {
    expect(moveWatch(0, -1, 2)).toBe(0);
    expect(moveWatch(1, 1, 2)).toBe(2);
    expect(moveWatch(2, 1, 2)).toBe(2);
  });
});

describe('overlay big plays', () => {
  const NOW = Date.parse('2026-10-26T20:00:30Z');
  const pollWith = (rb: number, qb = 12, opp = 0) =>
    ({
      ...poll,
      leagues: [
        {
          ...poll.leagues[0],
          teams: {
            '0001': {
              ...poll.leagues[0].teams['0001'],
              players: [
                { id: 'rb', live: rb, secondsRemaining: 1800, status: 'starter', projected: 19 },
                { id: 'qb', live: qb, secondsRemaining: 0, status: 'starter', projected: 20 },
              ],
            },
            '0002': {
              ...poll.leagues[0].teams['0002'],
              players: [{ id: 'bn', live: opp, secondsRemaining: 1800, status: 'starter', projected: 10 }],
            },
          },
        },
      ],
    }) as BroadcastPollResponse;
  const matchup = { index: 0, mine: team('0001', 'Hammers'), opponent: team('0002', 'Ghosts') };
  const gamesAt = (p: BroadcastPollResponse) => overlayGames([panel('A', [matchup])], p, meta);
  const moment = {
    key: 'p1:A:0001',
    playId: 'p1',
    leagueId: 'A',
    leagueName: 'League A',
    franchiseId: '0001',
    franchiseName: 'Hammers',
    side: 'mine' as const,
    kind: 'touchdown' as const,
    playerId: 'rb',
    playerName: 'Kenneth Walker',
    team: 'SEA',
    text: 'Kenneth Walker 48 Yd Run (Kick)',
    clock: 'Q3 4:08',
    wallclock: '2026-10-26T20:00:10Z',
    scoreValue: 6,
    yards: 48,
  };

  it('only sets baselines on the first poll', () => {
    const first = detectBigPlays(new Map(), gamesAt(pollWith(9.4)), [], NOW);
    expect(first.alerts).toEqual([]);
    expect(first.seen.get('A:0:rb')).toBe(9.4);
  });

  it("announces the viewer's starter gaining more than the threshold, with the board's play text", () => {
    const { seen } = detectBigPlays(new Map(), gamesAt(pollWith(9.4)), [], NOW);
    const { alerts } = detectBigPlays(seen, gamesAt(pollWith(20.2)), [moment], NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ playerId: 'rb', gained: 10.8, text: 'Kenneth Walker 48 Yd Run (Kick)' });
  });

  it('needs strictly more than the threshold', () => {
    const { seen } = detectBigPlays(new Map(), gamesAt(pollWith(9.4)), [], NOW);
    expect(detectBigPlays(seen, gamesAt(pollWith(9.4 + BIG_PLAY_MIN_POINTS)), [], NOW).alerts).toEqual([]);
    expect(detectBigPlays(seen, gamesAt(pollWith(9.4 + BIG_PLAY_MIN_POINTS + 0.1)), [], NOW).alerts).toHaveLength(1);
  });

  it("never announces the opponent's players", () => {
    const { seen } = detectBigPlays(new Map(), gamesAt(pollWith(9.4, 12, 0)), [], NOW);
    expect(detectBigPlays(seen, gamesAt(pollWith(9.4, 12, 20)), [], NOW).alerts).toEqual([]);
  });

  it('measures from the highest score seen, so a feed that blips to zero and back is no play', () => {
    let { seen } = detectBigPlays(new Map(), gamesAt(pollWith(9.4)), [], NOW);
    ({ seen } = detectBigPlays(seen, gamesAt(pollWith(0)), [], NOW));
    expect(detectBigPlays(seen, gamesAt(pollWith(9.4)), [], NOW).alerts).toEqual([]);
  });

  it('announces a play once when a second league catches up a poll later, naming both leagues', () => {
    const two = (a: number, b: number) =>
      overlayGames(
        [panel('A', [matchup]), panel('B', [matchup])],
        { ...pollWith(a), leagues: [pollWith(a).leagues[0], { ...pollWith(b).leagues[0], leagueId: 'B' }] },
        meta,
      );
    let state = detectBigPlays(new Map(), two(9.4, 9.4), [], NOW);
    state = detectBigPlays(state.seen, two(20.2, 9.4), [], NOW, state.recent);
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].alsoIn).toEqual(['League B']);
    state = detectBigPlays(state.seen, two(20.2, 20.2), [], NOW + 15_000, state.recent);
    expect(state.alerts).toEqual([]);
  });

  it('leaves the play text out when the play is stale', () => {
    const { seen } = detectBigPlays(new Map(), gamesAt(pollWith(9.4)), [], NOW);
    const old = { ...moment, wallclock: '2026-10-26T19:40:00Z' };
    expect(detectBigPlays(seen, gamesAt(pollWith(20.2)), [old], NOW).alerts[0].text).toBe('');
  });
});
