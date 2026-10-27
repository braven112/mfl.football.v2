/**
 * Guard: the store mode of MFL Live standings (`/api/live-standings?source=mfl`).
 *
 * The store build of the MFL Live app may not carry ESPN data, NFL club marks
 * or colours, or player headshots (docs/plans/mfl-live-store-app.md, Legal).
 * The standings tables and the league board share one assembler
 * (`assembleMflLeagueBoard`), so this pins its `mflOnly` plumbing on every
 * surface it produces: the matchup cards, the standings rows, the leaders
 * strip and the player map — while the MFL numbers stay exactly as the web
 * has them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyLiveSnapshot, type LiveSnapshot } from '../src/utils/live-scoring-snapshot';

const discoverBoardLeagues = vi.fn();
const readCrossLeagueLive = vi.fn();
const mflFetch = vi.fn();
const readLeaguePriorGameCounts = vi.fn();

vi.mock('../src/utils/cross-league-live', () => ({
  discoverBoardLeagues: (...a: unknown[]) => discoverBoardLeagues(...a),
  readCrossLeagueLive: (...a: unknown[]) => readCrossLeagueLive(...a),
  CROSS_LEAGUE_FAN_OUT_LIMIT: 8,
}));
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...a: unknown[]) => mflFetch(...a),
}));
vi.mock('../src/utils/mfl-schedule-pairings', () => ({
  readLeaguePriorGameCounts: (...a: unknown[]) => readLeaguePriorGameCounts(...a),
}));
vi.mock('../src/utils/player-map', () => ({
  getPlayerMap: () =>
    new Map([
      ['p1', { name: 'Player One', position: 'QB', nflTeam: 'DAL', headshot: 'https://example.test/h1.png' }],
      ['p2', { name: 'Player Two', position: 'WR', nflTeam: 'KC', headshot: 'https://example.test/h2.png' }],
    ]),
}));

const { assembleMflLiveStandings } = await import('../src/utils/live/mfl-live-standings');
const { assembleMflLeagueBoard } = await import('../src/utils/live/mfl-league-board');
const { __resetStandingsCache } = await import('../src/utils/live/standings');

const user = { id: 'mfl-cookie', name: 'Brandon', franchiseId: '0001', leagueId: '13522', role: 'owner' as const };

// An OUTSIDE league whose franchises are named after NFL clubs, so the web
// would put the Cowboys' and Chiefs' marks and colours on them.
const league = {
  id: '99999',
  name: 'Outside league',
  franchiseId: '0001',
  franchiseName: 'Dallas Cowboys',
  registered: null,
  host: null,
  isSession: false,
} as any;

const names = { '0001': 'Dallas Cowboys', '0002': 'Kansas City Chiefs' };

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
  __resetStandingsCache();
  discoverBoardLeagues.mockResolvedValue([league]);
  readCrossLeagueLive.mockResolvedValue([
    {
      league,
      ok: true,
      snapshot: played(),
      projections: new Map<string, number>([['p1', 20], ['p2', 15]]),
      franchiseNames: names,
      hasSignal: true,
    },
  ]);
  mflFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      leagueStandings: {
        franchise: [
          { id: '0001', fname: 'Dallas Cowboys', h2hw: '5', h2hl: '2', h2ht: '0', pf: '812.4' },
          { id: '0002', fname: 'Kansas City Chiefs', h2hw: '4', h2hl: '3', h2ht: '0', pf: '790.1' },
        ],
      },
    }),
  });
  readLeaguePriorGameCounts.mockResolvedValue(null);
});

const store = () => assembleMflLiveStandings({ user, week: 2, year: 2026, mflOnly: true });
const web = () => assembleMflLiveStandings({ user, week: 2, year: 2026 });

describe('standings store mode', () => {
  it('ships no NFL club mark on a standings row named after a club', async () => {
    const out = await store();
    const rows = out.leagues[0].standings ?? [];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.rung).not.toBe('nfl');
      expect(row.icon).not.toMatch(/nfl-logos/);
    }
  });

  it('ships no NFL club mark or colour on the week’s matchups', async () => {
    const out = await store();
    const m = out.leagues[0].matchups[0];
    for (const side of m.sides) {
      expect(side.rung).not.toBe('nfl');
      expect(side.icon).not.toMatch(/nfl-logos/);
    }
    const webColors = (await web()).leagues[0].matchups[0].colorVars;
    // The web resolves the Cowboys' and Chiefs' brand colours; store mode
    // must not be carrying the same pair.
    expect(m.colorVars).not.toEqual(webColors);
  });

  it('keeps every MFL number exactly as the web has it', async () => {
    const s = (await store()).leagues[0];
    const w = (await web()).leagues[0];
    expect(s.standings?.map((r) => [r.franchiseId, r.rank, r.wins, r.losses, r.pointsFor])).toEqual(
      w.standings?.map((r) => [r.franchiseId, r.rank, r.wins, r.losses, r.pointsFor]),
    );
    expect(s.matchups[0].sides.map((t) => [t.live, t.projectedFinal, t.yetToPlay])).toEqual(
      w.matchups[0].sides.map((t) => [t.live, t.projectedFinal, t.yetToPlay]),
    );
    expect(s.matchups[0].p0).toBe(w.matchups[0].p0);
  });

  it('the web tables are unchanged: they still match NFL names', async () => {
    const w = (await web()).leagues[0];
    expect(w.standings?.[0].rung).toBe('nfl');
    expect(w.matchups[0].sides[0].rung).toBe('nfl');
  });
});

describe('league board store mode (the shared assembler)', () => {
  it('blanks every headshot and keeps the leaders strip off NFL marks', async () => {
    const { board } = await assembleMflLeagueBoard({ user, league, week: 2, year: 2026, mflOnly: true });
    for (const meta of Object.values(board.playerMeta)) expect(meta.headshot).toBe('');
    const leaders = board.panels[0].leaders;
    for (const team of leaders?.teams ?? []) {
      expect(team.rung).not.toBe('nfl');
      expect(team.icon).not.toMatch(/nfl-logos/);
    }
  });

  it('the web board still carries headshots', async () => {
    const { board } = await assembleMflLeagueBoard({ user, league, week: 2, year: 2026 });
    expect(Object.values(board.playerMeta).some((m) => m.headshot)).toBe(true);
  });
});

describe('endpoint wiring', () => {
  const route = readFileSync(join(__dirname, '..', 'src/pages/api/live-standings.ts'), 'utf8');

  it('turns store mode on from `?source=mfl`', () => {
    expect(route).toContain("mflOnly: url.searchParams.get('source') === 'mfl'");
  });

  it('signs in through getBroadcastViewer, which accepts the app’s Bearer token', () => {
    expect(route).toContain('getBroadcastViewer(request)');
  });
});

describe('store views', () => {
  it('builds every view server-side for a Pro viewer', async () => {
    const out = await assembleMflLiveStandings({ user, week: 2, year: 2026, mflOnly: true, proLocked: false });
    const views = out.leagues[0].views;
    expect(Object.keys(views ?? {}).sort()).toEqual(['final', 'live', 'projected']);
    expect(views?.final?.map((r) => r.franchiseId)).toEqual(['0001', '0002']);
    expect(out.proLocked).toBe(false);
  });

  it('withholds Live and Projected from a viewer without Pro', async () => {
    const out = await assembleMflLiveStandings({ user, week: 2, year: 2026, mflOnly: true, proLocked: true });
    expect(Object.keys(out.leagues[0].views ?? {})).toEqual(['final']);
    expect(out.proLocked).toBe(true);
  });

  it('a league whose standings could not be read has no views, not empty ones', async () => {
    mflFetch.mockResolvedValue({ ok: false, json: async () => null });
    const out = await assembleMflLiveStandings({ user, week: 2, year: 2026, mflOnly: true });
    expect(out.leagues[0].standings).toBeNull();
    expect(out.leagues[0].views).toBeNull();
  });

  it('the web payload is unchanged: no views, no lock flag', async () => {
    const out = await web();
    expect(out.leagues[0].views).toBeUndefined();
    expect(out.proLocked).toBeUndefined();
  });
});
