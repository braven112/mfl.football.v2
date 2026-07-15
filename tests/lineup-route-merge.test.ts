/**
 * Tests for the merged lineup routes (Phase 2 registry sweep).
 *
 * api/lineup.ts and api/afl-fantasy/lineup.ts used to be 92% identical,
 * differing only in a hardcoded MFL league id and which year-rollover
 * function they called. They're now thin instantiations of
 * createLineupRoute (src/utils/lineup-route.ts), with the league pinned
 * PER ROUTE PATH — not resolved from the session.
 *
 * Why path-pinned matters (locked by the cross-league tests below):
 * /theleague/lineup gates only on franchiseId, so a dual-league owner
 * holding an AFL session can legitimately submit a TheLeague lineup via
 * /api/lineup. Resolving the league from the session would silently
 * retarget that write into the AFL league — a cross-league lineup
 * overwrite. Each path must always target its own league, exactly like
 * the pre-merge hardcoded routes.
 *
 * Full MFL round-trips are mocked — this is a unit test of the routes'
 * league-pinning and year-selection wiring, not an MFL integration test.
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

const THELEAGUE = getLeagueBySlug('theleague')!;
const AFL = getLeagueBySlug('afl-fantasy')!;

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

describe('lineup routes — auth gate', () => {
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

  it('GET /api/afl-fantasy/lineup returns 401 when unauthenticated', async () => {
    const res = await aflGET(makeContext(new Request('http://test.invalid/api/afl-fantasy/lineup')));
    expect(res.status).toBe(401);
  });

  it('POST /api/afl-fantasy/lineup returns 401 when unauthenticated', async () => {
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
    const cookie = sessionCookieFor(THELEAGUE.id, null);
    const res = await lineupGET(
      makeContext(new Request('http://test.invalid/api/lineup', { headers: { cookie } }))
    );
    expect(res.status).toBe(403);
  });
});

describe('lineup routes — league pinned per route path', () => {
  beforeEach(() => {
    mflFetchMock.mockReset();
    mflFetchMock.mockResolvedValue({
      json: async () => ({}),
      text: async () => '<status>OK</status>',
    } as Response);
  });

  it('/api/lineup always targets TheLeague — even for an AFL-scoped session (dual-league owner on /theleague/lineup)', async () => {
    const cookie = sessionCookieFor(AFL.id);
    const res = await lineupGET(
      makeContext(new Request('http://test.invalid/api/lineup?week=3', { headers: { cookie } }))
    );
    expect(res.status).toBe(200);
    const calledUrl = String(mflFetchMock.mock.calls[0][0].url);
    expect(calledUrl).toContain(`L=${THELEAGUE.id}`);
    expect(calledUrl).not.toContain(`L=${AFL.id}`);
  });

  it('/api/afl-fantasy/lineup always targets AFL — even for a TheLeague-scoped session', async () => {
    const cookie = sessionCookieFor(THELEAGUE.id);
    const res = await aflGET(
      makeContext(
        new Request('http://test.invalid/api/afl-fantasy/lineup?week=3', { headers: { cookie } })
      )
    );
    expect(res.status).toBe(200);
    const calledUrl = String(mflFetchMock.mock.calls[0][0].url);
    expect(calledUrl).toContain(`L=${AFL.id}`);
  });

  it('POST /api/lineup submits to TheLeague', async () => {
    const cookie = sessionCookieFor(THELEAGUE.id);
    const starters = Array.from({ length: 9 }, (_, i) => String(10000 + i));
    const res = await lineupPOST(
      makeContext(
        new Request('http://test.invalid/api/lineup', {
          method: 'POST',
          headers: { cookie },
          body: JSON.stringify({ week: 3, starters }),
        })
      )
    );
    expect(res.status).toBe(200);
    const call = mflFetchMock.mock.calls[0][0];
    expect(String(call.body)).toContain(`L=${THELEAGUE.id}`);
  });

  it('POST /api/afl-fantasy/lineup submits to AFL', async () => {
    const cookie = sessionCookieFor(AFL.id);
    const starters = Array.from({ length: 9 }, (_, i) => String(10000 + i));
    const res = await aflPOST(
      makeContext(
        new Request('http://test.invalid/api/afl-fantasy/lineup', {
          method: 'POST',
          headers: { cookie },
          body: JSON.stringify({ week: 3, starters }),
        })
      )
    );
    expect(res.status).toBe(200);
    const call = mflFetchMock.mock.calls[0][0];
    expect(String(call.body)).toContain(`L=${AFL.id}`);
  });

  it('a session with an unrecognized leagueId still reaches the path\'s pinned league (pre-merge behavior)', async () => {
    const cookie = sessionCookieFor('not-a-real-league-id');
    const res = await lineupGET(
      makeContext(new Request('http://test.invalid/api/lineup?week=3', { headers: { cookie } }))
    );
    expect(res.status).toBe(200);
    const calledUrl = String(mflFetchMock.mock.calls[0][0].url);
    expect(calledUrl).toContain(`L=${THELEAGUE.id}`);
  });
});
