/**
 * The NFL game drill-in's player lists (`buildNflGamePlayers`).
 *
 * Pins the rules its header states: a rostered player's number is the board's
 * own row (never a recomputation), a free agent is scored by the league's
 * rules from the box score and waits for those rules rather than printing 0,
 * a free-agent DEFENSE is never invented, ownership is a LIST, and "FA" is
 * only claimed when the board holds the whole league.
 */
import { describe, expect, it } from 'vitest';
import { buildNflGamePlayers, gameSecondsLeft } from '../src/utils/live/nfl-game-players';
import type { LiveMatchup, LivePanel, LiveTeam } from '../src/types/live';
import type { LivePlayerRow, NflGame, PlayerBoxScore, PlayerMeta } from '../src/types/live-scoring';
import type { PositionRuleSet } from '../src/utils/live/scoring-rules';

const game: NflGame = {
  id: '401',
  state: 'in',
  shortDetail: '7:24 - 3rd',
  period: 3,
  clock: '7:24',
  home: { code: 'KC', score: 17 },
  away: { code: 'BUF', score: 14 },
  possession: 'KC',
  date: '2026-11-22T21:25Z',
};

const meta = (id: string, name: string, position: string, nflTeam: string): PlayerMeta => ({
  id,
  name,
  position,
  nflTeam,
  headshot: '',
  espnId: null,
  projected: 0,
});

const row = (id: string, live: number, projected?: number): LivePlayerRow => ({
  id,
  live,
  secondsRemaining: 1200,
  status: 'starter',
  ...(projected === undefined ? {} : { projected }),
});

const team = (franchiseId: string, name: string, players: LivePlayerRow[], bench: LivePlayerRow[] = []): LiveTeam =>
  ({
    franchiseId,
    name,
    nameShort: name,
    initials: name.slice(0, 2).toUpperCase(),
    icon: '',
    iconAlt: '',
    rung: 'league',
    live: 0,
    projectedFinal: 0,
    remainingPoints: 0,
    yetToPlay: 0,
    players,
    bench,
  }) as LiveTeam;

const matchup = (a: LiveTeam, b: LiveTeam, index = 0): LiveMatchup =>
  ({ index, sides: [a, b], viewerSide: null, p0: 0.5, colorVars: {} }) as unknown as LiveMatchup;

const panel = (matchups: LiveMatchup[], viewerFranchiseId: string | null = '0001'): LivePanel =>
  ({
    leagueId: '13522',
    leagueName: 'TheLeague',
    slug: 'theleague',
    registered: true,
    viewerFranchiseId,
    status: 'ok',
    matchups,
  }) as LivePanel;

const RULES: PositionRuleSet[] = [
  {
    positions: ['QB', 'RB', 'WR', 'TE'],
    rules: [
      { event: ['CY'], kind: 'per', points: 0.1, every: 1, lo: -999, hi: 999 },
      { event: ['CC'], kind: 'per', points: 1, every: 1, lo: 0, hi: 99 },
    ] as unknown as PositionRuleSet['rules'],
  },
  { positions: ['Def'], rules: [] },
];

const boardMeta: Record<string, PlayerMeta> = {
  r1: meta('r1', 'Rostered Receiver', 'WR', 'KC'),
  r2: meta('r2', 'Bench Back', 'RB', 'BUF'),
  d1: meta('d1', 'Kansas City Chiefs', 'Def', 'KC'),
  o1: meta('o1', 'Other Game QB', 'QB', 'DAL'),
};

const pool: PlayerMeta[] = [
  meta('r1', 'Rostered Receiver', 'WR', 'KC'),
  meta('f1', 'Free Agent Receiver', 'WR', 'BUF'),
  meta('f2', 'Quiet Tight End', 'TE', 'KC'),
  meta('fd', 'Buffalo Bills', 'Def', 'BUF'),
  meta('fk', 'Free Kicker', 'PK', 'KC'),
];

const box: Record<string, PlayerBoxScore> = {
  r1: { playerId: 'r1', nflTeam: 'KC', statLine: '5 rec, 64 yds', gameId: '401', stats: { CC: 5, CY: 64 } },
  f1: { playerId: 'f1', nflTeam: 'BUF', statLine: '3 rec, 40 yds', gameId: '401', stats: { CC: 3, CY: 40 } },
};

const board = panel([
  matchup(team('0001', 'Pigskins', [row('r1', 12.4, 15), row('d1', 4)]), team('0002', 'Magicians', [row('o1', 20)], [row('r2', 0, 8)])),
]);

describe('buildNflGamePlayers', () => {
  it('uses the board row for a rostered player, never a recomputation', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    const r1 = out.home.players.find((p) => p.row.id === 'r1')!;
    // The box score would score him 11.4; MFL's row says 12.4 and wins.
    expect(r1.row.live).toBe(12.4);
    expect(r1.owners.map((o) => o.franchiseId)).toEqual(['0001']);
    expect(r1.owners[0].mine).toBe(true);
    expect(r1.hasProjection).toBe(true);
  });

  it('puts each player on his own NFL team and drops other games', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    const ids = (s: typeof out.home) => [...s.players, ...s.quiet].map((p) => p.row.id);
    expect(ids(out.home)).toEqual(expect.arrayContaining(['r1', 'd1', 'f2']));
    expect(ids(out.away)).toEqual(expect.arrayContaining(['r2', 'f1']));
    expect([...ids(out.home), ...ids(out.away)]).not.toContain('o1');
  });

  it('keeps a rostered bench player even with no stats', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    expect(out.away.players.map((p) => p.row.id)).toContain('r2');
  });

  it('scores a free agent from the box score with the league rules', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    const f1 = out.away.players.find((p) => p.row.id === 'f1')!;
    expect(f1.row.live).toBeCloseTo(7, 5);
    expect(f1.freeAgent).toBe(true);
    expect(f1.owners).toEqual([]);
    expect(f1.hasProjection).toBe(false);
    expect(out.meta.f1?.name).toBe('Free Agent Receiver');
  });

  it('folds eligible free agents with no stats into the quiet list', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    expect(out.home.quiet.map((p) => p.row.id)).toEqual(['f2']);
  });

  it('leaves out positions the league does not score', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    const all = [...out.home.players, ...out.home.quiet].map((p) => p.row.id);
    expect(all).not.toContain('fk');
  });

  it('never invents a free-agent defense', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    const all = [...out.away.players, ...out.away.quiet].map((p) => p.row.id);
    expect(all).not.toContain('fd');
    // A rostered defense still shows, with MFL's number.
    expect(out.home.players.find((p) => p.row.id === 'd1')?.row.live).toBe(4);
  });

  it('holds free agents back until the rules load, rather than printing 0', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: undefined, rostersComplete: true });
    expect(out.freeAgentsPending).toBe(true);
    const all = [...out.away.players, ...out.away.quiet, ...out.home.players, ...out.home.quiet].map((p) => p.row.id);
    expect(all).not.toContain('f1');
    expect(all).toContain('r1');
  });

  it('only claims FA when the board holds the whole league', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: false });
    const f1 = out.away.players.find((p) => p.row.id === 'f1')!;
    expect(f1.freeAgent).toBe(false);
    expect(f1.owners).toEqual([]);
  });

  it('lists every franchise that rosters the same player (the AFL)', () => {
    const afl = panel([
      matchup(team('0001', 'Smokane', [row('r1', 12.4)]), team('0002', 'Indians', [])),
      matchup(team('0013', 'Micks', [row('r1', 12.4)]), team('0014', 'Bruins', []), 1),
    ]);
    const out = buildNflGamePlayers({ game, panel: afl, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    const r1 = out.home.players.find((p) => p.row.id === 'r1')!;
    expect(r1.owners.map((o) => o.franchiseId)).toEqual(['0001', '0013']);
  });

  it('sorts by points, highest first', () => {
    const out = buildNflGamePlayers({ game, panel: board, meta: boardMeta, pool, boxScore: box, rules: RULES, rostersComplete: true });
    const lives = out.home.players.map((p) => p.row.live);
    expect([...lives].sort((a, b) => b - a)).toEqual(lives);
  });
});

describe('gameSecondsLeft', () => {
  it('reads ESPN’s own clock', () => {
    expect(gameSecondsLeft(game)).toBe(900 + 7 * 60 + 24);
    expect(gameSecondsLeft({ ...game, state: 'pre' })).toBe(3600);
    expect(gameSecondsLeft({ ...game, state: 'post' })).toBe(0);
  });
});
