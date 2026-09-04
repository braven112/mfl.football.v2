/**
 * Tests for the Owners' Poll storage layer (src/utils/owners-poll-store.ts)
 * and its two routes (/api/owners-poll/ballot, /api/owners-poll/turnout).
 *
 * Follows tests/autocut-storage.test.ts: mock the shared redis client with a
 * Map-backed fake, mint real session JWTs, and invoke the exported handlers
 * with a synthetic APIContext.
 *
 * The rules under test are the ones that have already been bugs somewhere in
 * this repo — session-only identity, fail-closed on an unattributable league,
 * `?league=` as a check rather than an input, and a turnout endpoint that can
 * never name a voter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '../src/utils/session';
import { LEAGUES } from '../src/config/leagues';

// ---------------------------------------------------------------------------
// Mocks (hoisted above the module imports below)
// ---------------------------------------------------------------------------

const hashes = new Map<string, Map<string, unknown>>();
const strings = new Map<string, unknown>();
let redisAvailable = true;

const fakeRedis = {
  get: vi.fn(async (key: string) => strings.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    strings.set(key, value);
    return 'OK';
  }),
  hget: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field) ?? null),
  hgetall: vi.fn(async (key: string) => {
    const h = hashes.get(key);
    return h ? Object.fromEntries(h) : null;
  }),
  hset: vi.fn(async (key: string, fieldValues: Record<string, unknown>) => {
    const h = hashes.get(key) ?? new Map();
    for (const [f, v] of Object.entries(fieldValues)) h.set(f, v);
    hashes.set(key, h);
    return 1;
  }),
  hlen: vi.fn(async (key: string) => hashes.get(key)?.size ?? 0),
  incr: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
};
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => (redisAvailable ? fakeRedis : null),
}));

import { GET as ballotGET, POST as ballotPOST } from '../src/pages/api/owners-poll/ballot';
import { GET as turnoutGET } from '../src/pages/api/owners-poll/turnout';
import { ownersPollBallotsKey, ownersPollCurrentKey } from '../src/utils/owners-poll-ballot.mjs';
import { resolveOwnersPollCaller } from '../src/utils/owners-poll-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THELEAGUE = LEAGUES.theleague;
const AFL = LEAGUES['afl-fantasy'];
const FIELD = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));
const OK = ['0001', '0002', '0003', '0004', '0005', '0006', '0007'];

const OPEN_WINDOW = {
  year: 2026,
  week: 5,
  // Wide open around "now" so the tests don't depend on the wall clock.
  opensAt: '2000-01-01T00:00:00.000Z',
  closesAt: '2099-01-01T00:00:00.000Z',
  slots: 7,
  eligibleFranchiseIds: FIELD,
};

function openTheBallot(window: object = OPEN_WINDOW) {
  strings.set(ownersPollCurrentKey(THELEAGUE.navSlug), window);
}

function sessionCookie(franchiseId = '0003', leagueId: string = THELEAGUE.id) {
  const token = createSessionToken({
    userId: 'test-user',
    username: 'Test Owner',
    franchiseId,
    leagueId,
    role: 'owner',
  });
  return `session_token=${token}`;
}

function makeContext(request: Request) {
  return { request, url: new URL(request.url) } as any;
}

function req(url: string, init: RequestInit = {}) {
  return new Request(`http://test.invalid${url}`, init);
}

function authed(url: string, cookie: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return req(url, { ...init, headers });
}

beforeEach(() => {
  hashes.clear();
  strings.clear();
  redisAvailable = true;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe('resolveOwnersPollCaller', () => {
  it('accepts an owner with a franchise in a poll-enabled league', () => {
    const result = resolveOwnersPollCaller(authed('/api/owners-poll/ballot', sessionCookie()));
    expect(result.ok).toBe(true);
    expect(result.ok && result.caller.franchiseId).toBe('0003');
    expect(result.ok && result.caller.scope).toBe(THELEAGUE.navSlug);
  });

  it('refuses an unauthenticated caller', () => {
    const result = resolveOwnersPollCaller(authed('/api/owners-poll/ballot', null));
    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('refuses a session with no franchise rather than sharing a key', () => {
    const result = resolveOwnersPollCaller(authed('/api/owners-poll/ballot', sessionCookie('')));
    expect(result).toEqual({ ok: false, reason: 'no-franchise' });
  });

  it('fails CLOSED on a league it cannot attribute', () => {
    // Defaulting here would address another league's franchise 0001.
    const result = resolveOwnersPollCaller(
      authed('/api/owners-poll/ballot', sessionCookie('0003', 'not-a-league')),
    );
    expect(result).toEqual({ ok: false, reason: 'unknown-league' });
  });

  it('treats ?league= as a CHECK against the session, never an input', () => {
    // An owner logged into TheLeague browsing the AFL's pages must not have
    // their AFL-page ballot land in TheLeague's bucket.
    const mismatch = resolveOwnersPollCaller(
      authed(`/api/owners-poll/ballot?league=${AFL.navSlug}`, sessionCookie()),
    );
    expect(mismatch).toEqual({ ok: false, reason: 'league-mismatch' });

    const match = resolveOwnersPollCaller(
      authed(`/api/owners-poll/ballot?league=${THELEAGUE.navSlug}`, sessionCookie()),
    );
    expect(match.ok).toBe(true);
  });

  it('refuses a league whose poll is disabled', () => {
    const result = resolveOwnersPollCaller(
      authed('/api/owners-poll/ballot', sessionCookie('0003', AFL.id)),
    );
    expect(result).toEqual({ ok: false, reason: 'poll-disabled' });
  });
});

describe('POST /api/owners-poll/ballot', () => {
  it('stores a valid ballot under the league-scoped hash', async () => {
    openTheBallot();
    const res = await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie(), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK }),
        }),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ballot.ranking).toEqual(OK);
    expect(body.turnout).toEqual({ ballotsIn: 1, eligible: 16 });

    const key = ownersPollBallotsKey(THELEAGUE.navSlug, 2026, 5);
    expect(hashes.get(key)?.has('0003')).toBe(true);
  });

  it('writes the caller\'s OWN franchise, ignoring one supplied in the body', async () => {
    openTheBallot();
    await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie('0003'), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK, franchiseId: '0011' }),
        }),
      ),
    );
    const key = ownersPollBallotsKey(THELEAGUE.navSlug, 2026, 5);
    expect(hashes.get(key)?.has('0003')).toBe(true);
    expect(hashes.get(key)?.has('0011')).toBe(false);
  });

  it('rejects an invalid ballot with the reason', async () => {
    openTheBallot();
    const res = await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie(), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK.slice(0, 5) }),
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/exactly 7/);
  });

  it('refuses a write when no ballot is open', async () => {
    const res = await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie(), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK }),
        }),
      ),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe('none');
  });

  it('refuses a write after close', async () => {
    openTheBallot({ ...OPEN_WINDOW, closesAt: '2000-01-02T00:00:00.000Z' });
    const res = await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie(), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK }),
        }),
      ),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe('closed');
  });

  it('preserves submittedAt when an owner edits their ballot', async () => {
    openTheBallot();
    const post = (ranking: string[]) =>
      ballotPOST(
        makeContext(
          authed('/api/owners-poll/ballot', sessionCookie(), {
            method: 'POST',
            body: JSON.stringify({ ranking }),
          }),
        ),
      );

    const first = await (await post(OK)).json();
    const edited = await (await post([...OK.slice(1), '0001'])).json();

    expect(edited.ballot.submittedAt).toBe(first.ballot.submittedAt);
    expect(edited.ballot.ranking).toEqual([...OK.slice(1), '0001']);
    // Still one ballot, not two.
    expect(edited.turnout.ballotsIn).toBe(1);
  });

  it('reports a storage outage rather than claiming success', async () => {
    openTheBallot();
    redisAvailable = false;
    const res = await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie(), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK }),
        }),
      ),
    );
    // No window is readable without Redis, so this is refused upstream of the
    // write — the point is that it is never a 200.
    expect(res.status).not.toBe(200);
  });
});

describe('GET /api/owners-poll/ballot', () => {
  it('returns only the caller\'s own ballot, never anyone else\'s', async () => {
    openTheBallot();
    const key = ownersPollBallotsKey(THELEAGUE.navSlug, 2026, 5);
    hashes.set(
      key,
      new Map([
        ['0003', JSON.stringify({ franchiseId: '0003', ranking: OK, submittedAt: null, updatedAt: null })],
        ['0009', JSON.stringify({ franchiseId: '0009', ranking: OK, submittedAt: null, updatedAt: null })],
      ]),
    );

    const res = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))));
    const body = await res.json();
    expect(body.ballot.franchiseId).toBe('0003');
    expect(JSON.stringify(body)).not.toContain('0009');
  });

  it('never leaks a running tally while the ballot is open', async () => {
    openTheBallot();
    const res = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    const body = await res.json();
    // Counts yes, consensus no — releasing running totals would let late
    // voters game the result.
    expect(body.turnout).toBeDefined();
    expect(body.consensus).toBeUndefined();
    expect(body.ranked).toBeUndefined();
  });

  it('reports no open ballot without erroring', async () => {
    const res = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'none', window: null, ballot: null });
  });

  it('sets no-store so a ballot is never cached across owners', async () => {
    openTheBallot();
    const res = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/owners-poll/turnout', () => {
  it('returns counts only — never who voted', async () => {
    openTheBallot();
    const key = ownersPollBallotsKey(THELEAGUE.navSlug, 2026, 5);
    hashes.set(
      key,
      new Map([
        ['0003', JSON.stringify({ franchiseId: '0003', ranking: OK })],
        ['0009', JSON.stringify({ franchiseId: '0009', ranking: OK })],
      ]),
    );

    const res = await turnoutGET(makeContext(req(`/api/owners-poll/turnout?league=${THELEAGUE.navSlug}`)));
    const body = await res.json();
    expect(body.turnout).toEqual({ ballotsIn: 2, eligible: 16 });

    // The count-only decision has to hold at the endpoint, not just in the
    // GroupMe copy — no franchise id, no ranking, anywhere in the response.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('0003');
    expect(serialized).not.toContain('0009');
    expect(fakeRedis.hgetall).not.toHaveBeenCalled();
    expect(fakeRedis.hlen).toHaveBeenCalled();
  });

  it('works unauthenticated', async () => {
    openTheBallot();
    const res = await turnoutGET(makeContext(req(`/api/owners-poll/turnout?league=${THELEAGUE.navSlug}`)));
    expect(res.status).toBe(200);
  });

  it('404s a league that does not run the poll, and an unknown one', async () => {
    const afl = await turnoutGET(makeContext(req(`/api/owners-poll/turnout?league=${AFL.navSlug}`)));
    expect(afl.status).toBe(404);
    const junk = await turnoutGET(makeContext(req('/api/owners-poll/turnout?league=nope')));
    expect(junk.status).toBe(404);
    const missing = await turnoutGET(makeContext(req('/api/owners-poll/turnout')));
    expect(missing.status).toBe(404);
  });

  it('reports no turnout when no ballot is open', async () => {
    const res = await turnoutGET(makeContext(req(`/api/owners-poll/turnout?league=${THELEAGUE.navSlug}`)));
    expect(await res.json()).toEqual({ status: 'none', turnout: null });
  });
});
