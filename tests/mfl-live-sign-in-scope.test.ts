import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ALL_LEAGUES,
  MFL_LIVE_PILOT_LEAGUE_IDS,
  mflLiveSignInLeagueIds,
} from '../src/config/leagues-data.mjs';

/**
 * Who may sign in to MFL Live on the shared host.
 *
 * An owner in any REGISTERED league, or in an invited pilot league, and nobody
 * else. Before this, the shared /login sent TheLeague's id, which let TheLeague
 * owners in and refused everyone else, AFL and Best Ball owners included.
 */

const LOGIN_XML = '<?xml version="1.0"?><status MFL_USER_ID="user-cookie-abc"/>';
const LEAGUE_LOGIN = /^https:\/\/www\d+\.myfantasyleague\.com\/\d{4}\/login(?:[?#]|$)/;

function stubFetch(myleagues: Array<{ league_id: string; franchise_id: string }>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = typeof url === 'string' ? url : url.href;
      calls.push(href);
      const body = href.includes('TYPE=myleagues')
        ? JSON.stringify({ leagues: { league: myleagues } })
        : LOGIN_XML;
      return new Response(body, { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const [first, second] = ALL_LEAGUES.map((l) => l.id);
const pilot = MFL_LIVE_PILOT_LEAGUE_IDS[0];

describe('mflLiveSignInLeagueIds', () => {
  it('lists every registered league in registry order, then the pilot leagues', () => {
    expect(mflLiveSignInLeagueIds()).toEqual([
      ...ALL_LEAGUES.map((l) => l.id),
      ...MFL_LIVE_PILOT_LEAGUE_IDS,
    ]);
  });

  it('includes the 2026 pilot league 10105', () => {
    expect(mflLiveSignInLeagueIds()).toContain('10105');
  });
});

describe('authenticateWithMFL — a list of acceptable leagues', () => {
  it('scopes the session to the first LISTED league, not the first in myleagues', async () => {
    // myleagues order is nondeterministic, so put the later-listed league first.
    stubFetch([
      { league_id: pilot, franchise_id: '0007' },
      { league_id: second, franchise_id: '0003' },
      { league_id: first, franchise_id: '0012' },
    ]);
    const { authenticateWithMFL } = await import('../src/utils/mfl-login');
    const result = await authenticateWithMFL('owner', 'pw', mflLiveSignInLeagueIds(), 2026);
    expect(result.leagueId).toBe(first);
    expect(result.franchiseId).toBe('0012');
  });

  it('lets a pilot-league owner in when they are in no registered league', async () => {
    stubFetch([
      { league_id: '99999', franchise_id: '0001' },
      { league_id: pilot, franchise_id: '4' },
    ]);
    const { authenticateWithMFL } = await import('../src/utils/mfl-login');
    const result = await authenticateWithMFL('tester', 'pw', mflLiveSignInLeagueIds(), 2026);
    expect(result.leagueId).toBe(pilot);
    expect(result.franchiseId).toBe('0004');
  });

  it('refuses an account in none of the listed leagues', async () => {
    stubFetch([{ league_id: '99999', franchise_id: '0001' }]);
    const { authenticateWithMFL } = await import('../src/utils/mfl-login');
    const result = await authenticateWithMFL('stranger', 'pw', mflLiveSignInLeagueIds(), 2026);
    // The endpoint 401s on a missing franchiseId. That is the refusal.
    expect(result.franchiseId).toBe('');
    expect(result.error).toMatch(/invite-only/);
  });

  it('never makes the league-scoped commissioner login for a list', async () => {
    const calls = stubFetch([{ league_id: first, franchise_id: '0001' }]);
    const { authenticateWithMFL } = await import('../src/utils/mfl-login');
    await authenticateWithMFL('owner', 'pw', mflLiveSignInLeagueIds(), 2026);
    expect(calls.some((u) => LEAGUE_LOGIN.test(u))).toBe(false);
  });
});

describe('wiring', () => {
  it('the shared /login signs in with the mfl-live scope', () => {
    const page = readFileSync('src/pages/login.astro', 'utf8');
    expect(page).toMatch(/<LoginForm[^>]*\bscope="mfl-live"/s);
  });

  it('the endpoint takes the league list from the registry, never the request body', () => {
    const src = readFileSync('src/pages/api/auth/login.ts', 'utf8');
    expect(src).toMatch(/scope === 'mfl-live' \? mflLiveSignInLeagueIds\(\) : leagueId/);
  });

  it('a pilot-league session does not get TheLeague\'s team-preference cookie', () => {
    const src = readFileSync('src/pages/api/auth/login.ts', 'utf8');
    expect(src).toMatch(/resolvedLeagueId === THELEAGUE_ID\) \{\s*setTheLeaguePreference/);
  });
});

describe('the endpoint refuses uninvited leagues', () => {
  it('rejects a scalar leagueId that is not in the registry, before calling MFL', async () => {
    const calls = stubFetch([{ league_id: '99999', franchise_id: '0001' }]);
    const { POST } = await import('../src/pages/api/auth/login');
    for (const leagueId of ['99999', pilot, undefined, '']) {
      const res = await POST({
        request: new Request('https://v2.mfl.football/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'u', password: 'p', leagueId }),
        }),
        cookies: { set() {} },
      } as never);
      expect(res.status, `leagueId=${leagueId}`).toBe(400);
    }
    // Refused up front: no credential was relayed to MFL.
    expect(calls).toEqual([]);
  });
});
