/**
 * Tests for the merged /api/lineup route (Phase 2 registry sweep).
 *
 * api/lineup.ts and api/afl-fantasy/lineup.ts used to be 92% identical,
 * differing only in a hardcoded MFL league id and which year-rollover
 * function they called. They're now one implementation in api/lineup.ts
 * that resolves the league from the session user's `leagueId` via the
 * registry; api/afl-fantasy/lineup.ts re-exports its GET/POST so the old
 * path keeps working.
 *
 * Coverage here:
 *  - Unauthenticated GET/POST → 401 on both the canonical route and the
 *    thin AFL re-export (proves the re-export actually delegates, not just
 *    that it imports without throwing).
 *  - The AFL re-export's GET/POST are the exact same function references as
 *    the canonical route's — not copies that could drift again.
 *  - League resolution: a session scoped to AFL's leagueId reaches MFL with
 *    AFL's league id and MFL host; a session scoped to TheLeague reaches MFL
 *    with TheLeague's id. This is the behavior the merge must preserve for
 *    both leagues.
 *
 * Full MFL round-trips are mocked — this is a unit test of the route's
 * league-resolution/year-selection wiring, not an MFL integration test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { getLeagueBySlug } from '../src/config/leagues';

const mflFetchMock = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: any[]) => mflFetchMock(...args),
}));

import { GET as lineupGET, POST as lineupPOST } from '../src/pages/api/lineup';
import { GET as aflGET, POST as aflPOST } from '../src/pages/api/afl-fantasy/lineup';

function makeContext(request: Request) {
  return {
    request,
    url: new URL(request.url),
    params: {},
    props: {},
    redirect: () => new Response('', { status: 302 }),
    rewrite: (() => new Response('')) as any,
    cookies: {} as any,
    locals: {} as any,
    site: new URL('http://test.invalid'),
    generator: 'astro',
    clientAddress: '127.0.0.1',
  } as any;
}

function sessionCookieFor(leagueId: string, franchiseId: string | null = '0001') {
  const token = createSessionToken({
    userId: 'mfl-user-1',
    username: 'Test Owner',
    franchiseId: franchiseId ?? '',
    leagueId,
    role: 'owner',
  });
  return `session_token=${token}`;
}

describe('merged /api/lineup route — re-export identity', () => {
  it('afl-fantasy/lineup.ts re-exports the exact same GET/POST as api/lineup.ts', () => {
    expect(aflGET).toBe(lineupGET);
    expect(aflPOST).toBe(lineupPOST);
  });
});

describe('merged /api/lineup route — auth gate', () => {
  it('GET /api/lineup returns 401 when unauthenticated', async () => {
    const res = await lineupGET(makeContext(new Request('http://test.invalid/api/lineup')));
    expect(res.status).toBe(401);
  });

  it('POST /api/lineup returns 401 when unauthenticated', async () => {
    const res = await lineupPOST(
      makeContext(
        new Request('http://test.invalid/api/lineup', {
          method: 'POST',
          body: JSON.stringify({ week: 1, starters: [] }),
        })
      )
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/afl-fantasy/lineup returns 401 when unauthenticated (via re-export)', async () => {
    const res = await aflGET(makeContext(new Request('http://test.invalid/api/afl-fantasy/lineup')));
    expect(res.status).toBe(401);
  });

  it('POST /api/afl-fantasy/lineup returns 401 when unauthenticated (via re-export)', async () => {
    const res = await aflPOST(
      makeContext(
        new Request('http://test.invalid/api/afl-fantasy/lineup', {
          method: 'POST',
          body: JSON.stringify({ week: 1, starters: [] }),
        })
      )
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated but no franchise is associated', async () => {
    const cookie = sessionCookieFor(getLeagueBySlug('theleague')!.id, null);
    const res = await lineupGET(
      makeContext(
        new Request('http://test.invalid/api/lineup', { headers: { cookie } })
      )
    );
    expect(res.status).toBe(403);
  });
});

describe('merged /api/lineup route — league resolution', () => {
  beforeEach(() => {
    mflFetchMock.mockReset();
    mflFetchMock.mockResolvedValue({
      json: async () => ({}),
      text: async () => '',
    } as Response);
  });

  it('resolves TheLeague from the session and calls MFL with TheLeague\'s id/host', async () => {
    const theleague = getLeagueBySlug('theleague')!;
    const cookie = sessionCookieFor(theleague.id);
    const res = await lineupGET(
      makeContext(
        new Request('http://test.invalid/api/lineup?week=3', { headers: { cookie } })
      )
    );
    expect(res.status).toBe(200);
    expect(mflFetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(mflFetchMock.mock.calls[0][0].url);
    expect(calledUrl).toContain(`L=${theleague.id}`);
  });

  it('resolves AFL from the session and calls MFL with AFL\'s id/host — via the canonical route', async () => {
    const afl = getLeagueBySlug('afl-fantasy')!;
    const cookie = sessionCookieFor(afl.id);
    const res = await lineupGET(
      makeContext(
        new Request('http://test.invalid/api/lineup?week=3', { headers: { cookie } })
      )
    );
    expect(res.status).toBe(200);
    expect(mflFetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(mflFetchMock.mock.calls[0][0].url);
    expect(calledUrl).toContain(`L=${afl.id}`);
  });

  it('resolves AFL from the session via the /api/afl-fantasy/lineup re-export identically', async () => {
    const afl = getLeagueBySlug('afl-fantasy')!;
    const cookie = sessionCookieFor(afl.id);
    const res = await aflGET(
      makeContext(
        new Request('http://test.invalid/api/afl-fantasy/lineup?week=3', { headers: { cookie } })
      )
    );
    expect(res.status).toBe(200);
    expect(mflFetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(mflFetchMock.mock.calls[0][0].url);
    expect(calledUrl).toContain(`L=${afl.id}`);
  });

  it('falls back to the default league when leagueId does not match the registry', async () => {
    const cookie = sessionCookieFor('not-a-real-league-id');
    const res = await lineupGET(
      makeContext(
        new Request('http://test.invalid/api/lineup?week=3', { headers: { cookie } })
      )
    );
    expect(res.status).toBe(200);
    const calledUrl = String(mflFetchMock.mock.calls[0][0].url);
    expect(calledUrl).toContain(`L=${getLeagueBySlug('theleague')!.id}`);
  });
});
