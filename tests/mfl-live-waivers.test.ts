/**
 * The MFL Football app's add/drop and waivers (package L):
 * `/api/mfl-live/waivers`, `/api/mfl-live/waivers-manage`, `/api/mfl-live/drop`.
 *
 * What this pins:
 *  - the league check (`requireOwnerLeague`) decides, and its refusal is
 *    returned untouched with nothing sent to MFL;
 *  - every MFL call acts as the team MFL lists for the account, in that
 *    league, on that league's own host, with the owner's own cookie — never a
 *    franchise or league from the request;
 *  - the app's payloads carry no headshots or ESPN ids (store rules);
 *  - the site's routes, now thin wrappers over the same helpers, still refuse
 *    a signed-out caller exactly as before.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireOwnerLeague = vi.fn();
const mflFetch = vi.fn();
const getRosters = vi.fn();

vi.mock('../src/utils/live/owner-league', () => ({
  requireOwnerLeague: (...a: unknown[]) => requireOwnerLeague(...a),
  appJson: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}));
vi.mock('../src/utils/mfl-fetch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mflFetch: (...a: unknown[]) => mflFetch(...a),
}));
vi.mock('../src/utils/mfl-matchup-api', () => ({
  createMFLApiClient: () => ({ getRosters: () => getRosters(), getRosterEntries: async () => ({}) }),
}));
vi.mock('../src/utils/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock('../src/utils/mfl-roster-cache', () => ({ bustRosterCaches: async () => {} }));
vi.mock('../src/utils/player-map', () => ({
  getPlayerMap: () =>
    new Map([
      ['15889', { name: 'Free Agent', position: 'WR', nflTeam: 'KC', headshot: 'https://example.test/h.png', espnId: '123' }],
      ['14059', { name: 'Bench Guy', position: 'RB', nflTeam: 'DAL', headshot: 'https://example.test/b.png', espnId: '456' }],
    ]),
}));

const waivers = await import('../src/pages/api/mfl-live/waivers');
const manage = await import('../src/pages/api/mfl-live/waivers-manage');
const drop = await import('../src/pages/api/mfl-live/drop');
const { bareMflHost, appOwnerContext } = await import('../src/utils/live/mfl-live-app-waivers');

// An OUTSIDE league (not in the registry): only the account's own MFL list knows it.
const owner = {
  user: { id: 'owner-cookie', franchiseId: '0001', leagueId: '13522' },
  league: {
    leagueId: '77777',
    leagueName: 'Outside league',
    franchiseId: '0009',
    franchiseName: 'Mine',
    year: 2026,
    host: 'https://www12.myfantasyleague.com',
  },
};

const PENDING = {
  pendingWaivers: {
    waiverRequest: { timestamp: '1788405970', addsDrops: '15889_14059', comments: '', round: '1' },
  },
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function call(route: { GET?: any; POST?: any }, method: 'GET' | 'POST', path: string, body?: unknown) {
  const url = new URL(`https://mfl.football${path}`);
  const request = new Request(url, {
    method,
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return route[method]({ request, url } as any) as Promise<Response>;
}

beforeEach(() => {
  requireOwnerLeague.mockReset();
  mflFetch.mockReset();
  getRosters.mockReset();
});

describe('the league check decides', () => {
  it.each([
    ['waivers GET', waivers, 'GET'],
    ['waivers POST', waivers, 'POST'],
    ['waivers-manage POST', manage, 'POST'],
    ['drop POST', drop, 'POST'],
  ] as const)('%s returns a refusal untouched and calls MFL not at all', async (_n, route, method) => {
    const refusal = new Response('{"error":"not your league"}', { status: 403 });
    requireOwnerLeague.mockResolvedValue(refusal);
    const res = await call(route, method, '/api/mfl-live/x?league=77777', method === 'POST' ? {} : undefined);
    expect(res).toBe(refusal);
    expect(requireOwnerLeague.mock.calls[0][1]).toBe('77777');
    expect(mflFetch).not.toHaveBeenCalled();
  });
});

describe('waivers-manage acts as the account’s own team', () => {
  it('deletes on the league’s own host, as the franchise MFL lists, with the owner cookie', async () => {
    requireOwnerLeague.mockResolvedValue(owner);
    mflFetch.mockImplementation(async ({ url }: { url: string }) =>
      url.includes('TYPE=pendingWaivers') ? json(mflFetch.mock.calls.length > 2 ? { pendingWaivers: {} } : PENDING) : json({}),
    );
    const res = await call(manage, 'POST', '/api/mfl-live/waivers-manage?league=77777', {
      action: 'delete',
      round: '1',
      addPlayerId: '15889',
      // A franchise in the body is ignored: the write acts as owner.league.franchiseId.
      franchiseId: '0001',
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    const del = mflFetch.mock.calls.map((c) => c[0]).find((o: any) => o.url.includes('DELETE='));
    expect(del.url).toBe('https://www12.myfantasyleague.com/2026/add_drop?L=77777&F=0009&DELETE=1_15889_14059');
    for (const [opts] of mflFetch.mock.calls) {
      expect(opts.mflUserCookie).toBe('owner-cookie');
      expect(opts.url).toContain('L=77777');
    }
  });
});

describe('store rules', () => {
  it('filed claims carry names but no headshot or ESPN id', async () => {
    requireOwnerLeague.mockResolvedValue(owner);
    mflFetch.mockImplementation(async ({ url }: { url: string }) =>
      url.includes('TYPE=pendingWaivers') ? json(PENDING) : json({}),
    );
    const res = await call(waivers, 'GET', '/api/mfl-live/waivers?league=77777');
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.claims).toHaveLength(1);
    expect(body.claims[0]).toMatchObject({ addName: 'Free Agent', dropName: 'Bench Guy' });
    expect(JSON.stringify(body)).not.toMatch(/headshot|espn/i);
    expect(body.context.addDropUrl).toBe('https://www12.myfantasyleague.com/2026/add_drop?L=77777');
  });
});

describe('drop', () => {
  it('refuses a player who is not on the account’s team, before any write', async () => {
    requireOwnerLeague.mockResolvedValue(owner);
    getRosters.mockResolvedValue({ '0009': ['14059'], '0001': ['15889'] });
    const res = await call(drop, 'POST', '/api/mfl-live/drop?league=77777', { playerId: '15889' });
    expect(res.status).toBe(403);
    expect(mflFetch).not.toHaveBeenCalled();
  });

  it('posts the cut to the league’s own host with the owner cookie', async () => {
    requireOwnerLeague.mockResolvedValue(owner);
    getRosters.mockResolvedValueOnce({ '0009': ['14059'] }).mockResolvedValueOnce({ '0009': [] });
    mflFetch.mockResolvedValue(new Response('<html>ok</html>', { status: 200 }));
    const res = await call(drop, 'POST', '/api/mfl-live/drop?league=77777', { playerId: '14059' });
    expect((await res.json()).success).toBe(true);
    const [opts] = mflFetch.mock.calls[0];
    expect(opts.url).toBe('https://www12.myfantasyleague.com/2026/add_drop');
    expect(opts.mflUserCookie).toBe('owner-cookie');
    expect(opts.body).toContain('drop_pid=14059');
  });
});

describe('the owner context', () => {
  it('takes only a myfantasyleague.com host', () => {
    expect(bareMflHost('https://www12.myfantasyleague.com')).toBe('www12.myfantasyleague.com');
    expect(bareMflHost('www49.myfantasyleague.com')).toBe('www49.myfantasyleague.com');
    expect(bareMflHost('https://evil.example.com')).toBeNull();
    expect(bareMflHost(null)).toBeNull();
  });

  it('is null without a host, and keeps registry inputs for our own leagues', async () => {
    expect(appOwnerContext({ id: 'c' }, { ...owner.league, host: null } as any)).toBeNull();
    const { getLeagueBySlug } = await import('../src/config/leagues');
    const afl = getLeagueBySlug('afl-fantasy')!;
    const ctx = appOwnerContext({ id: 'c' }, { ...owner.league, leagueId: afl.id, host: null } as any)!;
    expect(ctx.host).toBe(afl.mflHost);
    expect(ctx.slug).toBe('afl-fantasy');
    expect(ctx.duplicatePlayers).toBe(true);
    expect(ctx.insightActor).toBeNull();
  });
});

describe('the site routes still refuse a signed-out caller', () => {
  it.each(['waiver-claim', 'waiver-claims', 'cut-player'])('/api/%s → 401', async (name) => {
    const route = await import(`../src/pages/api/${name}.ts`);
    const res = await call(route, 'POST', `/api/${name}`, {});
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('Authentication required. Please sign in.');
    expect(mflFetch).not.toHaveBeenCalled();
  });
});
