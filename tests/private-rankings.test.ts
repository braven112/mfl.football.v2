import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadPrivateBoard, clearPrivateBoardCache } from '../src/utils/private-rankings';
import { buildView, parseViewQuery, viewHref, PAGE_SIZE, type BoardFile } from '../src/utils/private-rankings-view';
import { isSiteOwnerIn } from '../src/utils/site-owner';
import { getLeagueBySlug } from '../src/config/leagues';
import type { AuthUser } from '../src/utils/auth';

const board = (players: BoardFile['players']): BoardFile => ({
  league: { key: 'theleague', label: 'The League' },
  generatedAt: '2026-11-21T00:00:00Z',
  mflYear: 2026,
  rookieClass: 2026,
  sources: {},
  players,
});

const P = {
  gibbs: { id: '1', name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', age: 24, dynasty: { fbg: 5, dlf: 3, avg: 4 }, season: { ros: 1, rosPts: 150 } },
  bowers: { id: '2', name: 'Brock Bowers', pos: 'TE', team: 'LV', age: 23, dynasty: { fbg: 1, dlf: 8, avg: 4.5 }, season: { ros: 12, rosPts: 110 } },
  love: { id: '3', name: 'Jeremiyah Love', pos: 'RB', team: 'ARI', age: 21, dynasty: { fbg: 17, avg: 17 }, rookie: { fbg: 1, dlf: 1, avg: 1, rsp: { posRank: 'RB1', score: 89.3, grade: 'Starter', tier: 'A' } } },
  noId: { id: null, name: 'Prospect X', pos: 'WR', team: '', age: null, rookie: { rsp: { posRank: 'WR9', score: 70, grade: null, tier: 'C' } } },
};

describe('private rankings view', () => {
  const b = board([P.bowers, P.love, P.gibbs, P.noId]);
  const rosters = new Map([['1', ['0001']], ['2', ['0005']]]);

  it('sorts a tab by its default column and leaves players without that tab out', () => {
    const v = buildView(b, parseViewQuery(new URLSearchParams()), rosters, '0001');
    expect(v.rows.map((r) => r.player.name)).toEqual(['Jahmyr Gibbs', 'Brock Bowers', 'Jeremiyah Love']);
  });

  it('filters by position and by who rosters the player', () => {
    const rb = buildView(b, parseViewQuery(new URLSearchParams('pos=RB')), rosters, '0001');
    expect(rb.rows.map((r) => r.player.name)).toEqual(['Jahmyr Gibbs', 'Jeremiyah Love']);
    const mine = buildView(b, parseViewQuery(new URLSearchParams('own=mine')), rosters, '0001');
    expect(mine.rows.map((r) => r.player.name)).toEqual(['Jahmyr Gibbs']);
    const fa = buildView(b, parseViewQuery(new URLSearchParams('view=rookies&own=available')), rosters, '0001');
    expect(fa.rows.map((r) => r.player.name)).toEqual(['Jeremiyah Love', 'Prospect X']);
    const other = buildView(b, parseViewQuery(new URLSearchParams('own=rostered')), rosters, '0001');
    expect(other.rows.map((r) => r.player.name)).toEqual(['Brock Bowers']);
  });

  it('puts players with no value for the sort last in either direction', () => {
    const v = buildView(b, parseViewQuery(new URLSearchParams('view=rookies&sort=fbg&dir=desc')), null, null);
    expect(v.rows.map((r) => r.player.name)).toEqual(['Jeremiyah Love', 'Prospect X']);
  });

  it('caps a long tab unless all=1', () => {
    const many = board(Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ id: String(i), name: `P${i}`, pos: 'WR', team: '', age: null, dynasty: { avg: i + 1 } })));
    expect(buildView(many, parseViewQuery(new URLSearchParams()), null, null)).toMatchObject({ truncated: true, total: PAGE_SIZE + 5 });
    expect(buildView(many, parseViewQuery(new URLSearchParams('all=1')), null, null).rows).toHaveLength(PAGE_SIZE + 5);
  });

  it('builds short links and resets the sort when the tab changes', () => {
    const q = parseViewQuery(new URLSearchParams('sort=dlf&dir=asc&pos=WR'));
    expect(viewHref('/x', 'afl', q, { view: 'season' })).toBe('/x?league=afl&view=season&pos=WR');
    expect(viewHref('/x', 'theleague', q, {})).toBe('/x?league=theleague&pos=WR&sort=dlf&dir=asc');
  });

  it('ignores unknown query values', () => {
    expect(parseViewQuery(new URLSearchParams('view=hack&pos=K&own=x&sort=nope'))).toMatchObject({ view: 'dynasty', pos: 'all', own: 'all', sort: 'avg' });
  });
});

describe('private rankings loader', () => {
  beforeEach(() => clearPrivateBoardCache());
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('says so when the token is missing instead of fetching', async () => {
    let called = false;
    const r = await loadPrivateBoard('theleague', { env: {}, fetchImpl: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: false, reason: 'no-token' });
    expect(called).toBe(false);
  });

  it('reads the board from the private repo with the token', async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get('Authorization') };
      return new Response(JSON.stringify(board([P.gibbs])));
    }) as unknown as typeof fetch;
    const r = await loadPrivateBoard('afl', { env: { BRANDON_FANTASY_TOKEN: 't0k' }, fetchImpl });
    expect(r.ok).toBe(true);
    expect(seen!.url).toBe('https://api.github.com/repos/braven112/brandon-fantasy/contents/data/rankings-board/afl.json');
    expect(seen!.auth).toBe('Bearer t0k');
  });

  it('tries the tokens already set up, in order, and remembers the one that works', async () => {
    const tried: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get('Authorization')!;
      tried.push(auth);
      return auth === 'Bearer admin' ? new Response(JSON.stringify(board([P.gibbs]))) : new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const env = { VERCEL_BEAT_REPORTER_TOKEN: 'beat', BEAT_REPORTER_TOKEN: 'beat', GH_TOKEN: 'admin' };
    expect((await loadPrivateBoard('theleague', { env, fetchImpl })).ok).toBe(true);
    // The same token under two names is tried once.
    expect(tried).toEqual(['Bearer beat', 'Bearer admin']);
    tried.length = 0;
    await loadPrivateBoard('theleague', { env, fetchImpl, fresh: true });
    expect(tried).toEqual(['Bearer admin']);
  });

  it('names the tokens it tried when none can read the repo', async () => {
    const r = await loadPrivateBoard('theleague', { env: { VERCEL_BEAT_REPORTER_TOKEN: 'b' }, fetchImpl: ok({}, 404) });
    expect(r).toMatchObject({ ok: false, reason: 'no-access' });
    expect(!r.ok && r.message).toContain('VERCEL_BEAT_REPORTER_TOKEN');
  });

  it('serves the last good copy when a refresh fails', async () => {
    const env = { BRANDON_FANTASY_TOKEN: 't' };
    await loadPrivateBoard('theleague', { env, fetchImpl: ok(board([P.gibbs])) });
    const r = await loadPrivateBoard('theleague', { env, fresh: true, fetchImpl: ok({}, 500) });
    expect(r.ok && r.board.players[0].name).toBe('Jahmyr Gibbs');
  });

  it('refuses a board name that is not a plain slug', async () => {
    expect(await loadPrivateBoard('../secrets', { env: { BRANDON_FANTASY_TOKEN: 't' }, fetchImpl: ok({}) })).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('site owner gate', () => {
  const tl = getLeagueBySlug('theleague')!;
  const afl = getLeagueBySlug('afl-fantasy')!;
  const user = (leagueId: string, franchiseId: string, role: AuthUser['role'] = 'owner') =>
    ({ id: 'u', username: 'u', franchiseId, leagueId, role, name: 'u' }) as unknown as AuthUser;

  it('opens only for the owner franchise in the league the session belongs to', () => {
    expect(isSiteOwnerIn(user(tl.id, '0001'), 'theleague')).toBe(true);
    expect(isSiteOwnerIn(user(afl.id, '0001'), 'afl-fantasy')).toBe(true);
    // Both leagues have a franchise 0001: an AFL session is not TheLeague's.
    expect(isSiteOwnerIn(user(afl.id, '0001'), 'theleague')).toBe(false);
    // A commissioner is not the owner.
    expect(isSiteOwnerIn(user(tl.id, '0000', 'commissioner'), 'theleague')).toBe(false);
    expect(isSiteOwnerIn(user(tl.id, '0007', 'admin'), 'theleague')).toBe(false);
    expect(isSiteOwnerIn(null, 'theleague')).toBe(false);
  });

  it('gates both routes with isSiteOwnerIn, not the commissioner gate', () => {
    for (const slug of ['theleague', 'afl-fantasy']) {
      const src = readFileSync(path.join('src/pages', slug, 'admin/my-rankings.astro'), 'utf8');
      expect(src).toMatch(/isSiteOwnerIn\(user, league\.slug\)/);
      expect(src).not.toMatch(/isCommissionerOrAdmin/);
    }
  });
});

describe('the board data never enters this repo', () => {
  it('has no rankings-board file anywhere under src/, data/ or public/', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.includes('rankings-board')) hits.push(full);
      }
    };
    for (const root of ['src', 'data', 'public']) walk(root);
    expect(hits).toEqual([]);
  });

  it('keeps the loader out of browser code', () => {
    // The loader carries the token; only server code (the page component) may import it.
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx?|astro|mjs)$/.test(entry.name) && /private-rankings['"]/.test(readFileSync(full, 'utf8'))) importers.push(full);
      }
    };
    walk('src');
    expect(importers.sort()).toEqual(['src/components/shared/MyRankingsPage.astro']);
    const page = readFileSync('src/components/shared/MyRankingsPage.astro', 'utf8');
    expect(page).not.toMatch(/<script/);
  });
});
