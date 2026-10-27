/**
 * Sleeper leagues on MFL Live standings — `/live/standings` and the app's
 * Standings tab (`sleeper/standings.ts`).
 *
 * Pins what is different about a Sleeper table: Sleeper sends records but no
 * order, folds a week in only once it is processed (so a week must never be
 * added twice), puts no playoff game in the regular-season table, and has no
 * projections — so no Projected view, and no 0-0 "projected" tie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LiveMatchup, LiveTeam } from '../src/types/live';

const getSleeperLink = vi.fn();
const discoverSleeperBoardLeagues = vi.fn();
const loadMflNflClock = vi.fn();
const discoverBoardLeagues = vi.fn();

vi.mock('../src/utils/cross-league-live', () => ({
  discoverBoardLeagues: (...a: unknown[]) => discoverBoardLeagues(...a),
  readCrossLeagueLive: async () => [],
  CROSS_LEAGUE_FAN_OUT_LIMIT: 8,
}));
vi.mock('../src/utils/sleeper/link', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSleeperLink: (...a: unknown[]) => getSleeperLink(...a),
}));
vi.mock('../src/utils/sleeper/live', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discoverSleeperBoardLeagues: (...a: unknown[]) => discoverSleeperBoardLeagues(...a),
}));
vi.mock('../src/utils/sleeper/store-clock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadMflNflClock: (...a: unknown[]) => loadMflNflClock(...a),
}));
vi.mock('../src/utils/sleeper/players', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSleeperPlayerMap: async () => ({ s1: { mfl: 'p1', name: 'One', position: 'QB', team: 'DAL' } }),
}));
vi.mock('../src/utils/sleeper/player-fixes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readViewerFixes: async () => ({}),
}));
vi.mock('../src/utils/player-map', () => ({
  getPlayerMap: () => new Map([['p1', { name: 'One', position: 'QB', nflTeam: 'DAL', headshot: 'https://x.test/h.png' }]]),
}));

const { sleeperStandingsRows, sleeperWeekGamesCounted, isSleeperPlayoffWeek } = await import(
  '../src/utils/sleeper/standings'
);
const { assembleMflLiveStandings } = await import('../src/utils/live/mfl-live-standings');
const { clearSleeperLeagueCache } = await import('../src/utils/sleeper/live');
const { projectStandings } = await import('../src/utils/live/standings-projection');

const user = { id: 'mfl-cookie', name: 'Brandon', franchiseId: '0001', leagueId: '13522', role: 'owner' as const };

const roster = (id: number, wins: number, losses: number, fpts: number, owner = `u${id}`) => ({
  roster_id: id,
  owner_id: owner,
  players: [],
  settings: { wins, losses, ties: 0, fpts, fpts_decimal: 50 },
});

describe('sleeperStandingsRows', () => {
  it('orders by win percentage, then points for, and parses points', () => {
    const rows = sleeperStandingsRows([roster(1, 3, 4, 700), roster(2, 5, 2, 650), roster(3, 3, 4, 800)], 8, {
      start_week: 1,
    });
    expect(rows.map((r) => r.franchiseId)).toEqual(['2', '3', '1']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0].pointsFor).toBe(650.5);
  });
});

describe('sleeperWeekGamesCounted — never count a week twice', () => {
  it('0 before the week is processed, 1 after, null when the record does not fit', () => {
    expect(sleeperWeekGamesCounted({ wins: 4, losses: 3, ties: 0 }, 8, { start_week: 1 })).toBe(0);
    expect(sleeperWeekGamesCounted({ wins: 5, losses: 3, ties: 0 }, 8, { start_week: 1 })).toBe(1);
    expect(sleeperWeekGamesCounted({ wins: 2, losses: 1, ties: 0 }, 8, { start_week: 1 })).toBeNull();
  });

  it('a median league credits two results a week', () => {
    const median = { start_week: 1, league_average_match: 1 };
    expect(sleeperWeekGamesCounted({ wins: 8, losses: 6, ties: 0 }, 8, median)).toBe(0);
    expect(sleeperWeekGamesCounted({ wins: 9, losses: 7, ties: 0 }, 8, median)).toBe(1);
  });

  it('knows a playoff week', () => {
    expect(isSleeperPlayoffWeek(15, { playoff_week_start: 15 })).toBe(true);
    expect(isSleeperPlayoffWeek(14, { playoff_week_start: 15 })).toBe(false);
    expect(isSleeperPlayoffWeek(14, {})).toBe(false);
  });
});

describe('projectStandings with no projections', () => {
  const side = (franchiseId: string): LiveTeam => ({
    franchiseId,
    name: franchiseId,
    nameShort: franchiseId,
    initials: '',
    icon: '',
    iconAlt: '',
    rung: 'text',
    live: 0,
    projectedFinal: 0,
    remainingPoints: 0,
    yetToPlay: 1,
    players: [{ id: 'x', live: 0, secondsRemaining: 3600, status: 'starter' }],
    bench: [],
  });
  const unplayed: LiveMatchup = {
    index: 0,
    sides: [side('1'), side('2')],
    viewerSide: 0,
    p0: 0.5,
    noProjections: true,
    colorVars: {},
  };
  const rows = sleeperStandingsRows([roster(1, 4, 3, 700), roster(2, 4, 3, 600)], 8, { start_week: 1 });

  it('an unplayed Sleeper matchup adds no 0-0 tie to the Projected view', () => {
    const projected = projectStandings(rows, [unplayed], 'projected');
    expect(projected.every((r) => r.ties === 0 && !r.includesWeek)).toBe(true);
  });
});

describe('assembleMflLiveStandings with a linked Sleeper league', () => {
  const sleeperLeague = {
    id: 'sl-L1',
    name: 'Sleeper dynasty',
    franchiseId: '1',
    franchiseName: 'Mine',
    registered: null,
    host: null,
    isSession: false,
    provider: 'sleeper',
  } as any;
  let routes: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSleeperLeagueCache();
    discoverBoardLeagues.mockResolvedValue([]);
    getSleeperLink.mockResolvedValue({ userId: 'u1', username: 'brandon' });
    discoverSleeperBoardLeagues.mockResolvedValue([sleeperLeague]);
    loadMflNflClock.mockResolvedValue(new Map([['DAL', 1200]]));
    routes = {
      '/league/L1': { settings: { start_week: 1, playoff_week_start: 15 } },
      '/league/L1/rosters': [roster(1, 4, 3, 700), roster(2, 5, 2, 650)],
      '/league/L1/users': [
        { user_id: 'u1', display_name: 'Brandon', avatar: null, metadata: { team_name: 'Dallas Cowboys' } },
        { user_id: 'u2', display_name: 'Rival', avatar: null },
      ],
      '/league/L1/matchups/8': [
        { roster_id: 1, matchup_id: 1, points: 30, starters: ['s1'], starters_points: [30], players: ['s1'] },
        { roster_id: 2, matchup_id: 1, points: 10, starters: ['s1'], starters_points: [10], players: ['s1'] },
      ],
    };
    vi.stubGlobal('fetch', async (url: string) => {
      const path = String(url).replace('https://api.sleeper.app/v1', '');
      return path in routes
        ? new Response(JSON.stringify(routes[path]), { status: 200 })
        : new Response('', { status: 404 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds the Sleeper table, with Live but no Projected view, and no NFL marks', async () => {
    const out = await assembleMflLiveStandings({ user, week: 8, year: 2026, mflOnly: true, proLocked: false });
    expect(loadMflNflClock).toHaveBeenCalledWith({ year: 2026, week: 8 });
    const t = out.leagues.find((l) => l.leagueId === 'sl-L1')!;
    expect(t.provider).toBe('sleeper');
    expect(t.standings?.find((r) => r.isViewer)?.franchiseId).toBe('1');
    for (const r of t.standings ?? []) expect(r.rung).not.toBe('nfl');
    expect(t.matchups).toHaveLength(1);
    expect(t.matchups[0].noProjections).toBe(true);
    expect(t.views?.projected).toBeUndefined();
    expect(t.views?.final?.map((r) => r.franchiseId)).toEqual(['2', '1']);
    // Live adds this week's 30-10: both 5-3, and 1 leads on points (730.5 to 660.5).
    expect(t.views?.live?.map((r) => [r.franchiseId, r.wins])).toEqual([
      ['1', 5],
      ['2', 5],
    ]);
  });

  it('a playoff week shows the record alone', async () => {
    routes['/league/L1'] = { settings: { start_week: 1, playoff_week_start: 8 } };
    const out = await assembleMflLiveStandings({ user, week: 8, year: 2026, mflOnly: true });
    const t = out.leagues.find((l) => l.leagueId === 'sl-L1')!;
    expect(t.matchups).toEqual([]);
    expect(t.standings).toHaveLength(2);
  });

  it('an unreadable roster list is the "could not read" state, never a missing league', async () => {
    delete routes['/league/L1/rosters'];
    const out = await assembleMflLiveStandings({ user, week: 8, year: 2026, mflOnly: true });
    expect(out.leagues.find((l) => l.leagueId === 'sl-L1')?.standings).toBeNull();
  });
});
