/**
 * Guard: the MFL Live board's store mode (`mflOnly`, `?source=mfl`).
 *
 * The store build of the MFL Live app may not carry ESPN data, NFL club marks
 * or colours, or player headshots (docs/plans/mfl-live-store-app.md, Legal).
 * Store mode must therefore never even FETCH from ESPN, and nothing ESPN- or
 * NFL-derived may reach its payload — while the MFL scores stay exactly as
 * they are on the web board.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emptyLiveSnapshot, type LiveSnapshot } from '../src/utils/live-scoring-snapshot';

const discoverBoardLeagues = vi.fn();
const readCrossLeagueLive = vi.fn();
const fetchNflScoreboard = vi.fn();
const loadNflGameDetail = vi.fn();
const getSleeperLink = vi.fn();
const discoverSleeperBoardLeagues = vi.fn();
const readSleeperLive = vi.fn();
const loadMflNflClock = vi.fn();

vi.mock('../src/utils/cross-league-live', () => ({
  discoverBoardLeagues: (...a: unknown[]) => discoverBoardLeagues(...a),
  readCrossLeagueLive: (...a: unknown[]) => readCrossLeagueLive(...a),
  CROSS_LEAGUE_FAN_OUT_LIMIT: 8,
}));
vi.mock('../src/utils/nfl-scoreboard-source', () => ({
  fetchNflScoreboard: (...a: unknown[]) => fetchNflScoreboard(...a),
}));
vi.mock('../src/utils/nfl-game-detail-source', () => ({
  loadNflGameDetail: (...a: unknown[]) => loadNflGameDetail(...a),
}));
vi.mock('../src/utils/sleeper/link', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSleeperLink: (...a: unknown[]) => getSleeperLink(...a),
}));
vi.mock('../src/utils/sleeper/live', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discoverSleeperBoardLeagues: (...a: unknown[]) => discoverSleeperBoardLeagues(...a),
  readSleeperLive: (...a: unknown[]) => readSleeperLive(...a),
}));
vi.mock('../src/utils/sleeper/store-clock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadMflNflClock: (...a: unknown[]) => loadMflNflClock(...a),
}));
vi.mock('../src/utils/sleeper/players', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSleeperPlayerMap: async () => ({}),
}));
vi.mock('../src/utils/sleeper/player-fixes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readViewerFixes: async () => ({}),
}));
vi.mock('../src/utils/player-map', () => ({
  getPlayerMap: () =>
    new Map([
      ['p1', { name: 'Player One', position: 'QB', nflTeam: 'DAL', headshot: 'https://example.test/h1.png' }],
      ['p2', { name: 'Player Two', position: 'WR', nflTeam: 'KC', headshot: 'https://example.test/h2.png' }],
    ]),
}));

const { assembleMflLiveBoard } = await import('../src/utils/mfl-live-board');

const user = { id: 'mfl-cookie', name: 'Brandon', franchiseId: '0001', leagueId: '13522', role: 'owner' as const };

// An OUTSIDE league whose franchises are named after NFL clubs, so the web
// board would put the Cowboys' and Chiefs' marks and colours on them.
const league = {
  id: '99999',
  name: 'Outside league',
  franchiseId: '0001',
  franchiseName: 'Dallas Cowboys',
  registered: null,
  host: null,
  isSession: false,
} as any;

function played(): LiveSnapshot {
  return {
    ...emptyLiveSnapshot(),
    scores: { '0001': 87.4, '0002': 79.1 },
    remaining: { '0001': 1800, '0002': 1800 },
    matchups: [{ home: '0001', away: '0002' }],
    players: {
      '0001': [{ id: 'p1', live: 12.3, secondsRemaining: 900, status: 'starter' }],
      '0002': [{ id: 'p2', live: 9.9, secondsRemaining: 0, status: 'starter' }],
    },
    playersYetToPlay: { '0001': 2, '0002': 3 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  discoverBoardLeagues.mockResolvedValue([league]);
  readCrossLeagueLive.mockResolvedValue([
    {
      league,
      ok: true,
      snapshot: played(),
      projections: new Map<string, number>(),
      franchiseNames: { '0001': 'Dallas Cowboys', '0002': 'Chiefs' },
      hasSignal: true,
    },
  ]);
  fetchNflScoreboard.mockResolvedValue({
    ok: true,
    week: 2,
    games: [{ id: 'g1', home: 'DAL', away: 'KC' }],
  });
  loadNflGameDetail.mockResolvedValue(null);
  getSleeperLink.mockResolvedValue(null);
  discoverSleeperBoardLeagues.mockResolvedValue([]);
  readSleeperLive.mockResolvedValue([]);
  loadMflNflClock.mockResolvedValue(new Map([['DAL', 1800]]));
});

describe('store mode', () => {
  it('never reads ESPN', async () => {
    await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true });
    expect(fetchNflScoreboard).not.toHaveBeenCalled();
    expect(loadNflGameDetail).not.toHaveBeenCalled();
  });

  it('ships no games strip, ticker or red zone', async () => {
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true });
    expect(board.games).toEqual([]);
    expect(board.moments).toEqual([]);
    expect(board.redZone).toEqual([]);
  });

  it('ships no headshots', async () => {
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true });
    for (const meta of Object.values(board.playerMeta)) expect(meta.headshot).toBe('');
  });

  it('ships no NFL club mark for a franchise named after a club', async () => {
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true });
    const m = board.leagues[0].matchups[0];
    for (const team of [m.mine, m.opponent]) {
      expect(team.rung).not.toBe('nfl');
      expect(team.icon).not.toMatch(/nfl-logos/);
    }
  });

  it('keeps the MFL scores exactly as the web board has them', async () => {
    const web = (await assembleMflLiveBoard({ user, week: 2, year: 2026 })).board.leagues[0].matchups[0];
    const store = (await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true })).board.leagues[0]
      .matchups[0];
    expect(store.mine.live).toBe(web.mine.live);
    expect(store.opponent.live).toBe(web.opponent.live);
    expect(store.mine.yetToPlay).toBe(web.mine.yetToPlay);
    expect(store.winProbability).toBe(web.winProbability);
  });

  it('the web board is unchanged: it still reads ESPN and still matches NFL names', async () => {
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    expect(fetchNflScoreboard).toHaveBeenCalled();
    expect(board.games).toHaveLength(1);
    expect(board.leagues[0].matchups[0].mine.rung).toBe('nfl');
  });
});

describe('store mode, Sleeper leagues', () => {
  const sleeperLeague = {
    id: 'sl-L1',
    name: 'Sleeper dynasty',
    franchiseId: '1',
    franchiseName: 'Dallas Cowboys',
    registered: null,
    host: null,
    isSession: false,
    provider: 'sleeper',
  } as any;

  function sleeperRead(clock: ReadonlyMap<string, number> | null) {
    return [
      {
        league: sleeperLeague,
        ok: !!clock,
        snapshot: clock
          ? {
              ...emptyLiveSnapshot(),
              scores: { '1': 50, '2': 40 },
              matchups: [{ home: '1', away: '2' }],
              players: {
                '1': [{ id: 'p1', live: 20, secondsRemaining: clock.get('DAL') ?? 0, status: 'starter' }],
                '2': [{ id: 'sleeper:999', live: 8, secondsRemaining: 0, status: 'starter' }],
              },
            }
          : null,
        projections: new Map<string, number>(),
        hasSignal: !!clock,
        franchiseNames: { '1': 'Dallas Cowboys', '2': 'Rival' },
        franchiseIcons: {},
      },
    ];
  }

  beforeEach(() => {
    getSleeperLink.mockResolvedValue({ userId: 'u1', username: 'brandon' });
    discoverSleeperBoardLeagues.mockResolvedValue([sleeperLeague]);
    readSleeperLive.mockImplementation(async ({ clock }: { clock: ReadonlyMap<string, number> | null }) =>
      sleeperRead(clock),
    );
  });

  it('shows the linked Sleeper leagues, clocked by MFL rather than ESPN', async () => {
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true });
    expect(fetchNflScoreboard).not.toHaveBeenCalled();
    expect(loadMflNflClock).toHaveBeenCalledWith({ year: 2026, week: 2 });
    expect(readSleeperLive.mock.calls[0][0].clock.get('DAL')).toBe(1800);
    const panel = board.leagues.find((l) => l.leagueId === 'sl-L1')!;
    expect(panel.provider).toBe('sleeper');
    expect(panel.status).toBe('ok');
    expect(panel.matchups[0].noProjections).toBe(true);
    expect(panel.matchups[0].mine.live).toBe(50);
  });

  it('a Sleeper team named after a club gets no NFL mark, and no row gets a headshot', async () => {
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true });
    const m = board.leagues.find((l) => l.leagueId === 'sl-L1')!.matchups[0];
    for (const team of [m.mine, m.opponent]) {
      expect(team.rung).not.toBe('nfl');
      expect(team.icon).not.toMatch(/nfl-logos/);
    }
    for (const meta of Object.values(board.playerMeta)) expect(meta.headshot).toBe('');
  });

  it('an unreadable MFL clock marks the Sleeper league unavailable, never Final', async () => {
    loadMflNflClock.mockResolvedValue(null);
    const { board } = await assembleMflLiveBoard({ user, week: 2, year: 2026, mflOnly: true });
    expect(board.leagues.find((l) => l.leagueId === 'sl-L1')!.status).toBe('unavailable');
  });

  it('the web board still clocks Sleeper from the ESPN scoreboard', async () => {
    await assembleMflLiveBoard({ user, week: 2, year: 2026 });
    expect(loadMflNflClock).not.toHaveBeenCalled();
    expect(fetchNflScoreboard).toHaveBeenCalled();
  });
});
