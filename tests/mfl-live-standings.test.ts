/**
 * `/live/standings` — every watched league's standings under one switch.
 *
 * What this pins:
 *  - the league set is the owner's OWN leagues, narrowed by the MFL Live
 *    selection — the same rule `/live` follows — and never widened by it;
 *  - one league that cannot be read comes back as that league's `null`
 *    ("couldn't read the standings"), not a missing section or a blank page;
 *  - a poll that could not read a league holds that league's last good table,
 *    keyed by (week, league) because franchise ids collide across leagues;
 *  - the page renders in process and the menu links to it beside Live board.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const discoverBoardLeagues = vi.fn();
const assembleMflLeagueBoard = vi.fn();

vi.mock('../src/utils/cross-league-live', () => ({
  discoverBoardLeagues: (...a: unknown[]) => discoverBoardLeagues(...a),
  CROSS_LEAGUE_FAN_OUT_LIMIT: 8,
}));
vi.mock('../src/utils/live/mfl-league-board', () => ({
  assembleMflLeagueBoard: (...a: unknown[]) => assembleMflLeagueBoard(...a),
}));

const { assembleMflLiveStandings } = await import('../src/utils/live/mfl-live-standings');
const { holdLastGood } = await import('../src/components/shared/live/LiveStandingsBoard');

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const user = { id: 'mfl-cookie', name: 'Owner', franchiseId: '0001', leagueId: '13522', role: 'owner' as const };
const league = (id: string) =>
  ({ id, name: `League ${id}`, franchiseId: '0001', registered: null, host: null, isSession: false }) as any;
const row = (franchiseId: string) => ({ franchiseId, rank: 1, wins: 1, losses: 0, ties: 0 }) as any;

beforeEach(() => {
  discoverBoardLeagues.mockReset();
  assembleMflLeagueBoard.mockReset();
  assembleMflLeagueBoard.mockImplementation(async ({ league: l }: { league: { id: string } }) => ({
    board: { panels: [{ standings: [row(`${l.id}-f`)], matchups: [] }] },
  }));
});

describe('assembleMflLiveStandings', () => {
  it('reads every league when nothing is selected, in the owner’s league order', async () => {
    discoverBoardLeagues.mockResolvedValue([league('a'), league('b')]);
    const out = await assembleMflLiveStandings({ user, week: 4 });
    expect(out.leagues.map((l) => l.leagueId)).toEqual(['a', 'b']);
    expect(out.week).toBe(4);
  });

  it('narrows to the selection, and ignores ids the account is not in', async () => {
    discoverBoardLeagues.mockResolvedValue([league('a'), league('b'), league('c')]);
    const out = await assembleMflLiveStandings({ user, week: 4, leaguesCookie: 'b,zzz' });
    expect(out.leagues.map((l) => l.leagueId)).toEqual(['b']);
    expect(assembleMflLeagueBoard).toHaveBeenCalledTimes(1);
  });

  it('turns one league’s failure into that league’s null, keeping the rest', async () => {
    discoverBoardLeagues.mockResolvedValue([league('a'), league('b')]);
    assembleMflLeagueBoard.mockImplementation(async ({ league: l }: { league: { id: string } }) => {
      if (l.id === 'a') throw new Error('MFL down');
      return { board: { panels: [{ standings: [row('b-f')], matchups: [] }] } };
    });
    const out = await assembleMflLiveStandings({ user, week: 4 });
    expect(out.leagues[0]).toMatchObject({ leagueId: 'a', standings: null, matchups: [] });
    expect(out.leagues[1].standings).toHaveLength(1);
  });
});

describe('holdLastGood', () => {
  const table = (leagueId: string, standings: unknown) =>
    ({ leagueId, leagueName: leagueId, standings, matchups: [] }) as any;

  it('holds a league’s last readable table across a poll that could not read it', () => {
    const memory = new Map();
    holdLastGood({ week: 4, year: 2026, leagues: [table('a', [row('x')])] }, memory, 1000);
    const held = holdLastGood({ week: 4, year: 2026, leagues: [table('a', null)] }, memory, 2000);
    expect(held[0].table.standings).toHaveLength(1);
    expect(held[0].heldSince).toBe(1000);
  });

  it('never carries a table into a different week or league', () => {
    const memory = new Map();
    holdLastGood({ week: 4, year: 2026, leagues: [table('a', [row('x')])] }, memory, 1000);
    const otherWeek = holdLastGood({ week: 5, year: 2026, leagues: [table('a', null)] }, memory, 2000);
    const otherLeague = holdLastGood({ week: 4, year: 2026, leagues: [table('b', null)] }, memory, 2000);
    expect(otherWeek[0].table.standings).toBeNull();
    expect(otherLeague[0].table.standings).toBeNull();
  });
});

describe('wiring', () => {
  it('the menu lists Live standings directly after Live board', () => {
    const menu = read('src/components/shared/mfl-live/MflAppMenu.astro');
    const board = menu.indexOf("href: '/live',");
    const standings = menu.indexOf("href: '/live/standings'");
    const settings = menu.indexOf("href: '/live/settings'");
    expect(board).toBeGreaterThan(-1);
    expect(standings).toBeGreaterThan(board);
    expect(settings).toBeGreaterThan(standings);
  });

  it('the page assembles in process and never fetches its own API to render', () => {
    const page = read('src/pages/live/standings.astro');
    const frontmatter = page.split('---')[1] ?? '';
    expect(frontmatter).toContain('assembleMflLiveStandings');
    expect(frontmatter).not.toMatch(/fetch\(/);
  });

  it('the tables share one switch — the island passes a controlled mode', () => {
    const island = read('src/components/shared/live/LiveStandingsBoard.tsx');
    expect(island).toMatch(/<LvStandings[\s\S]*?mode=\{mode\}/);
  });

  it('the poll route refuses a signed-out request', () => {
    const route = read('src/pages/api/live-standings.ts');
    expect(route).toMatch(/if \(!user\) return json\(\{ ok: false, error: 'unauthenticated' \}, 401\)/);
  });
});
