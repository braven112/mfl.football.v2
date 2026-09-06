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
  del: vi.fn(async (key: string) => {
    const had = strings.delete(key);
    return had ? 1 : 0;
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
import { POST as windowPOST, GET as windowGET } from '../src/pages/api/owners-poll/window';
import { ownersPollBallotsKey, ownersPollCurrentKey } from '../src/utils/owners-poll-ballot.mjs';
import { resolveOwnersPollCaller } from '../src/utils/owners-poll-store';
import { resolveOwnersPollAccess } from '../src/utils/owners-poll-access';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THELEAGUE = LEAGUES.theleague;
const AFL = LEAGUES['afl-fantasy'];
// The league that does NOT run the poll. Best Ball, not the AFL: the AFL ran
// the poll from Sep 2026, and a test that keeps using it as the disabled case
// stops testing anything the moment it is enabled.
const NO_POLL = LEAGUES['best-ball-1'];
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

function sessionCookie(
  franchiseId = '0003',
  leagueId: string = THELEAGUE.id,
  role: 'owner' | 'commissioner' = 'owner',
) {
  const token = createSessionToken({
    userId: 'test-user',
    username: 'Test Owner',
    franchiseId,
    leagueId,
    role,
  });
  return `session_token=${token}`;
}

const commishCookie = (franchiseId = '0003', leagueId: string = THELEAGUE.id) =>
  sessionCookie(franchiseId, leagueId, 'commissioner');

function postWindow(body: unknown, cookie: string | null, leagueParam?: string) {
  const path = leagueParam
    ? `/api/owners-poll/window?league=${leagueParam}`
    : '/api/owners-poll/window';
  return windowPOST(
    makeContext(
      authed(path, cookie, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    ),
  );
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
      authed('/api/owners-poll/ballot', sessionCookie('0003', NO_POLL.id)),
    );
    expect(result).toEqual({ ok: false, reason: 'poll-disabled' });
  });

  it('admits an AFL owner to the AFL poll', () => {
    // The AFL runs the poll as of Sep 2026, on its OWN scope. Two leagues both
    // have a franchise 0001, so the scope is the thing that keeps their
    // ballots apart.
    const result = resolveOwnersPollCaller(
      authed(`/api/owners-poll/ballot?league=${AFL.navSlug}`, sessionCookie('0003', AFL.id)),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.caller.scope).toBe('afl');
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
    const noPoll = await turnoutGET(
      makeContext(req(`/api/owners-poll/turnout?league=${NO_POLL.navSlug}`)),
    );
    expect(noPoll.status).toBe(404);
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

describe('prefill from last week', () => {
  const lastWeek = ['0009', '0010', '0011', '0012', '0013', '0014', '0015'];

  function storeLastWeeksBallot(ranking = lastWeek, franchiseId = '0003') {
    hashes.set(
      ownersPollBallotsKey(THELEAGUE.navSlug, 2026, 4),
      new Map([[franchiseId, JSON.stringify({ franchiseId, ranking })]]),
    );
  }

  it('offers last week\'s ballot when this week has none', async () => {
    openTheBallot();
    storeLastWeeksBallot();
    const res = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))));
    const body = await res.json();
    expect(body.ballot).toBeNull();
    expect(body.prefill).toEqual(lastWeek);
  });

  it('does NOT offer a prefill once this week\'s ballot exists', async () => {
    // Shipping both would let a stale prefill overwrite a submitted ballot.
    openTheBallot();
    storeLastWeeksBallot();
    hashes.set(
      ownersPollBallotsKey(THELEAGUE.navSlug, 2026, 5),
      new Map([['0003', JSON.stringify({ franchiseId: '0003', ranking: OK })]]),
    );
    const body = await (
      await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))))
    ).json();
    expect(body.ballot.ranking).toEqual(OK);
    expect(body.prefill).toBeNull();
  });

  it('offers nothing in week 1', async () => {
    openTheBallot({ ...OPEN_WINDOW, week: 1 });
    const body = await (
      await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))))
    ).json();
    expect(body.prefill).toBeNull();
  });

  it('drops a prefill that no longer validates against this week\'s field', async () => {
    // A franchise left the league since last week. Prefilling a ballot the
    // owner would have to repair is worse than prefilling nothing.
    openTheBallot();
    storeLastWeeksBallot([...lastWeek.slice(0, 6), '0099']);
    const body = await (
      await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))))
    ).json();
    expect(body.prefill).toBeNull();
  });

  it('never offers another owner\'s ballot as a prefill', async () => {
    openTheBallot();
    storeLastWeeksBallot(lastWeek, '0011');
    const body = await (
      await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))))
    ).json();
    expect(body.prefill).toBeNull();
  });
});

describe('resolveOwnersPollAccess (page gate)', () => {
  const url = (path: string) => new URL(`http://test.invalid${path}`);

  it('admits an owner to their own league\'s ballot page', () => {
    const access = resolveOwnersPollAccess(
      authed('/theleague/pecking-order/ballot', sessionCookie()),
      url('/theleague/pecking-order/ballot'),
    );
    expect(access?.user.franchiseId).toBe('0003');
    expect(access?.league.slug).toBe('theleague');
  });

  it('refuses an unauthenticated visitor, so the route can redirect', () => {
    expect(
      resolveOwnersPollAccess(
        authed('/theleague/pecking-order/ballot', null),
        url('/theleague/pecking-order/ballot'),
      ),
    ).toBeNull();
  });

  it('refuses a session from another league', () => {
    // Franchise ids collide across leagues — an AFL 0001 opening TheLeague's
    // ballot would be voting as a different team.
    expect(
      resolveOwnersPollAccess(
        authed('/theleague/pecking-order/ballot', sessionCookie('0001', AFL.id)),
        url('/theleague/pecking-order/ballot'),
      ),
    ).toBeNull();
  });

  it('refuses a session with no franchise', () => {
    expect(
      resolveOwnersPollAccess(
        authed('/theleague/pecking-order/ballot', sessionCookie('')),
        url('/theleague/pecking-order/ballot'),
      ),
    ).toBeNull();
  });

  it('mirrors the API: a page never renders a ballot the API would refuse', () => {
    // Same session, same verdict from both gates — for every case above.
    //
    // The two gates learn WHICH league is being addressed differently: the
    // page from its own path, the API from `?league=`. So the API request has
    // to carry the param, exactly as every client does (BallotBuilder and
    // LineupBallotStrip are both handed `leagueParam`). Dropping it does not
    // make this stricter — it makes the API resolve the session's own league
    // and admit an AFL owner who was never asking about TheLeague, which is
    // right for the API and simply not the same question the page answered.
    const cases: Array<[string | null, string]> = [
      [sessionCookie(), 'admit'],
      [null, 'refuse'],
      [sessionCookie(''), 'refuse'],
      [sessionCookie('0001', AFL.id), 'refuse'],
      [sessionCookie('0003', 'not-a-league'), 'refuse'],
    ];
    for (const [cookie, expected] of cases) {
      const page = resolveOwnersPollAccess(
        authed('/theleague/pecking-order/ballot', cookie),
        url('/theleague/pecking-order/ballot'),
      );
      const api = resolveOwnersPollCaller(
        authed(`/api/owners-poll/ballot?league=${THELEAGUE.navSlug}`, cookie),
      );
      expect(Boolean(page), `page gate for ${expected}`).toBe(expected === 'admit');
      expect(api.ok, `api gate for ${expected}`).toBe(expected === 'admit');
    }
  });

  it('admits an AFL owner to the AFL ballot page, on the AFL scope', () => {
    const access = resolveOwnersPollAccess(
      authed('/afl-fantasy/pecking-order/ballot', sessionCookie('0003', AFL.id)),
      url('/afl-fantasy/pecking-order/ballot'),
    );
    expect(access?.league.slug).toBe('afl-fantasy');
    expect(access?.league.navSlug).toBe('afl');
  });
});

describe('POST /api/owners-poll/window (commissioner control)', () => {
  it('opens a real window a commissioner can then vote in', async () => {
    const res = await postWindow({ action: 'open', week: 3, hours: 48 }, commishCookie());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: 'open', quorum: 8, eligibleVoters: 16 });
    expect(body.window).toMatchObject({ week: 3, slots: 7 });
    expect(body.hours).toBeCloseTo(48, 0);

    // The window it wrote must be the one the OWNER-facing route now reads.
    const ballot = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    const ballotBody = await ballot.json();
    expect(ballotBody.status).toBe('open');
    expect(ballotBody.window.week).toBe(3);
  });

  it('refuses a plain owner', async () => {
    // This writes league-wide state that changes what every owner sees.
    const res = await postWindow({ action: 'open', week: 3 }, sessionCookie('0009'));
    expect(res.status).toBe(403);
    expect(strings.size).toBe(0);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await postWindow({ action: 'open', week: 3 }, null)).status).toBe(403);
  });

  it('refuses a commissioner of ANOTHER league', async () => {
    // isCommissionerOrAdmin is league-scoped; the ?league= check is too, and
    // it is the one doing the work here. Since Sep 2026 BOTH leagues run the
    // poll, so an AFL commissioner is a real commissioner of a real poll —
    // what makes this a refusal is that the request addresses TheLeague's.
    const res = await postWindow(
      { action: 'open', week: 3 },
      commishCookie('0001', AFL.id),
      THELEAGUE.navSlug,
    );
    expect(res.status).toBe(403);
    expect(strings.size).toBe(0);
  });

  it('lets an AFL commissioner open the AFL ballot, on the AFL scope', async () => {
    // The port's end-to-end check: the AFL's own numbers come back (10 slots,
    // quorum 12, 24 eligible voters — one league-wide ballot, not one per
    // conference), and the window lands under the AFL key, never TheLeague's.
    const res = await postWindow(
      { action: 'open', week: 3, hours: 48 },
      commishCookie('0001', AFL.id),
      AFL.navSlug,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 'open',
      quorum: 12,
      eligibleVoters: 24,
      window: { week: 3, slots: 10 },
    });
    expect([...strings.keys()]).toEqual(['poll:afl:current']);
  });

  it('validates the week and the hours rather than writing junk', async () => {
    for (const body of [
      { action: 'open' },
      { action: 'open', week: 0 },
      { action: 'open', week: 99 },
      { action: 'open', week: 3, hours: 0 },
      { action: 'open', week: 3, hours: 100000 },
      { action: 'sideways' },
    ]) {
      expect((await postWindow(body, commishCookie())).status).toBe(400);
    }
    expect(strings.size).toBe(0);
  });

  it('defaults to the real Thursday schedule when no hours are given', async () => {
    const body = await (await postWindow({ action: 'open', week: 3 }, commishCookie())).json();
    const closes = new Date(body.window.closesAt);
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
    }).format(closes);
    expect(weekday).toBe('Thu');
  });

  it('close stops voting WITHOUT touching ballots', async () => {
    await postWindow({ action: 'open', week: 3, hours: 48 }, commishCookie());
    hashes.set(
      ownersPollBallotsKey(THELEAGUE.navSlug, new Date().getUTCFullYear(), 3),
      new Map([['0003', JSON.stringify({ franchiseId: '0003', ranking: OK })]]),
    );

    const res = await postWindow({ action: 'close' }, commishCookie());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('closed');

    // Voting is off...
    const ballot = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    expect((await ballot.json()).status).toBe('none');
    // ...but the vote itself survives, so re-opening picks it back up.
    const key = ownersPollBallotsKey(THELEAGUE.navSlug, new Date().getUTCFullYear(), 3);
    expect(hashes.get(key)?.size).toBe(1);
  });

  it('reports existing ballots when re-opening a week', async () => {
    // A commissioner recovering from a failed run should not be surprised by a
    // non-zero count on a "fresh" open.
    const year = new Date().getUTCFullYear();
    hashes.set(
      ownersPollBallotsKey(THELEAGUE.navSlug, year, 3),
      new Map([['0003', JSON.stringify({ franchiseId: '0003', ranking: OK })]]),
    );
    const body = await (
      await postWindow({ action: 'open', week: 3, year, hours: 24 }, commishCookie())
    ).json();
    expect(body.ballotsIn).toBe(1);
  });

  it('close on nothing is a clean no-op', async () => {
    const res = await postWindow({ action: 'close' }, commishCookie());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('none');
  });

  it('reports a storage outage instead of claiming success', async () => {
    redisAvailable = false;
    const res = await postWindow({ action: 'open', week: 3, hours: 24 }, commishCookie());
    expect(res.status).toBe(503);
  });
});

describe('GET /api/owners-poll/window', () => {
  it('is commissioner-only', async () => {
    expect(
      (await windowGET(makeContext(authed('/api/owners-poll/window', sessionCookie('0009'))))).status,
    ).toBe(403);
    expect(
      (await windowGET(makeContext(authed('/api/owners-poll/window', null)))).status,
    ).toBe(403);
  });

  it('reports no window, then the open one', async () => {
    const before = await (
      await windowGET(makeContext(authed('/api/owners-poll/window', commishCookie())))
    ).json();
    expect(before).toMatchObject({ status: 'none', window: null, eligibleVoters: 16 });

    await postWindow({ action: 'open', week: 6, hours: 12 }, commishCookie());
    const after = await (
      await windowGET(makeContext(authed('/api/owners-poll/window', commishCookie())))
    ).json();
    expect(after.status).toBe('open');
    expect(after.window.week).toBe(6);
  });
});
