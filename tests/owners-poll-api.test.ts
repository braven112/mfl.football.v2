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
import { readFileSync } from 'node:fs';
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
import { POST as affirmPOST } from '../src/pages/api/owners-poll/affirm';
import { POST as windowPOST, GET as windowGET } from '../src/pages/api/owners-poll/window';
import {
  ownersPollStandingKey,
  ownersPollCurrentKey,
  ownersPollPauseKey,
} from '../src/utils/owners-poll-ballot.mjs';
import { resolveOwnersPollCaller,
  resolvePollCycle,
} from '../src/utils/owners-poll-store';
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

/**
 * Voting is ALWAYS open now — the cycle is derived, not stored — so there is
 * nothing to open. Kept as a no-op so the suite still reads as "given an open
 * ballot", which is the precondition every one of these tests wants.
 */
function openTheBallot(_window: object = OPEN_WINDOW) {}

/** The one thing that CAN stop voting: a commissioner pause. */
function pauseTheBallot() {
  strings.set(ownersPollPauseKey(THELEAGUE.navSlug), new Date().toISOString());
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
    // getAuthUser now voids a token naming a non-registry league outright,
    // so it fails closed one step earlier than the league lookup.
    const result = resolveOwnersPollCaller(
      authed('/api/owners-poll/ballot', sessionCookie('0003', 'not-a-league')),
    );
    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
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

    const key = ownersPollStandingKey(THELEAGUE.navSlug, 2026);
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
    const key = ownersPollStandingKey(THELEAGUE.navSlug, 2026);
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

  it('ACCEPTS a write at any time — voting never closes', async () => {
    // The old model refused a ballot between Thursday's close and the next
    // Tuesday's column. That dead period is the thing standing votes removed:
    // a ballot cast now simply counts toward the next announce.
    const res = await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie(), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK }),
        }),
      ),
    );
    expect(res.status).toBe(200);
  });

  it('refuses a write only while the commissioner has paused voting', async () => {
    pauseTheBallot();
    const res = await ballotPOST(
      makeContext(
        authed('/api/owners-poll/ballot', sessionCookie(), {
          method: 'POST',
          body: JSON.stringify({ ranking: OK }),
        }),
      ),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe('paused');
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
    const key = ownersPollStandingKey(THELEAGUE.navSlug, 2026);
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

  it('reports an OPEN ballot even with nothing stored — the cycle is derived', async () => {
    const res = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('open');
    expect(Date.parse(body.window.closesAt)).toBeGreaterThan(Date.now());
  });

  it('reports paused when the commissioner has stopped voting', async () => {
    pauseTheBallot();
    const res = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    expect(await res.json()).toEqual({ status: 'paused', window: null, ballot: null });
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
    const key = ownersPollStandingKey(THELEAGUE.navSlug, 2026);
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

  it('reports no turnout only when voting is paused', async () => {
    pauseTheBallot();
    const res = await turnoutGET(makeContext(req(`/api/owners-poll/turnout?league=${THELEAGUE.navSlug}`)));
    expect(await res.json()).toEqual({ status: 'paused', turnout: null });
  });
});

describe('"Still good" — affirming a standing ballot', () => {
  const THREE_WEEKS_AGO = new Date(Date.now() - 22 * 86400 * 1000).toISOString();
  const YESTERDAY = new Date(Date.now() - 86400 * 1000).toISOString();

  function standing(updatedAt: string, ranking = OK, franchiseId = '0003') {
    hashes.set(
      ownersPollStandingKey(THELEAGUE.navSlug, 2026),
      new Map([
        [
          franchiseId,
          JSON.stringify({ franchiseId, ranking, submittedAt: THREE_WEEKS_AGO, updatedAt }),
        ],
      ]),
    );
  }

  it('flags a ballot nobody has touched in three weeks', async () => {
    openTheBallot();
    standing(THREE_WEEKS_AGO);
    const body = await (
      await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))))
    ).json();
    expect(body.stale).toBe(true);
    expect(body.staleAfterWeeks).toBe(3);
  });

  it('does not flag a ballot edited yesterday', async () => {
    openTheBallot();
    standing(YESTERDAY);
    const body = await (
      await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))))
    ).json();
    expect(body.stale).toBe(false);
  });

  it('bumps updatedAt without touching the ranking', async () => {
    openTheBallot();
    standing(THREE_WEEKS_AGO);
    const res = await affirmPOST(
      makeContext(authed('/api/owners-poll/affirm', sessionCookie('0003'), { method: 'POST' })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ballot.ranking).toEqual(OK);
    expect(Date.parse(body.ballot.updatedAt)).toBeGreaterThan(Date.parse(THREE_WEEKS_AGO));
    // submittedAt is the owner's FIRST ballot of the season and never moves.
    expect(body.ballot.submittedAt).toBe(THREE_WEEKS_AGO);
  });

  it('never takes a ranking from the request — the stored one wins', async () => {
    // An owner who edited on their phone and then pressed "Still good" on a
    // stale desktop tab must not overwrite the newer ballot with the older one.
    openTheBallot();
    standing(THREE_WEEKS_AGO);
    const ctx = makeContext(
      authed('/api/owners-poll/affirm', sessionCookie('0003'), {
        method: 'POST',
        body: JSON.stringify({
          ranking: ['0016', '0015', '0014', '0013', '0012', '0011', '0010'],
        }),
      }),
    );
    const body = await (await affirmPOST(ctx)).json();
    expect(body.ballot.ranking).toEqual(OK);
  });

  it('refuses when there is no ballot on file to affirm', async () => {
    openTheBallot();
    const res = await affirmPOST(
      makeContext(authed('/api/owners-poll/affirm', sessionCookie('0003'), { method: 'POST' })),
    );
    expect(res.status).toBe(409);
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

describe('POST /api/owners-poll/window (commissioner pause switch)', () => {

  it('pauses voting for the whole league', async () => {
    const res = await postWindow({ action: 'pause' }, commishCookie());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('paused');

    const ballot = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    expect((await ballot.json()).status).toBe('paused');
  });

  it('a pause NEVER touches standing ballots', async () => {
    const key = ownersPollStandingKey(THELEAGUE.navSlug, 2026);
    hashes.set(key, new Map([['0003', JSON.stringify({ franchiseId: '0003', ranking: OK })]]));

    await postWindow({ action: 'pause' }, commishCookie());
    expect(hashes.get(key)?.size).toBe(1);

    await postWindow({ action: 'resume' }, commishCookie());
    const ballot = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie('0003'))));
    const body = await ballot.json();
    expect(body.status).toBe('open');
    // The vote survived the pause intact — that is the whole promise of a
    // standing ballot, and a pause is the one thing that could have broken it.
    expect(body.ballot.ranking).toEqual(OK);
  });

  it('resume restores voting', async () => {
    await postWindow({ action: 'pause' }, commishCookie());
    const res = await postWindow({ action: 'resume' }, commishCookie());
    expect((await res.json()).status).toBe('open');

    const ballot = await ballotGET(makeContext(authed('/api/owners-poll/ballot', sessionCookie())));
    expect((await ballot.json()).status).toBe('open');
  });

  it('reports the standing ballots already on file', async () => {
    hashes.set(
      ownersPollStandingKey(THELEAGUE.navSlug, 2026),
      new Map([['0003', JSON.stringify({ franchiseId: '0003', ranking: OK })]]),
    );
    const body = await (await postWindow({ action: 'resume' }, commishCookie())).json();
    expect(body.ballotsIn).toBe(1);
  });

  it('rejects any action but pause/resume', async () => {
    const res = await postWindow({ action: 'open', week: 3 }, commishCookie());
    expect(res.status).toBe(400);
  });

  it('refuses a plain owner', async () => {
    // This writes league-wide state that changes what every owner sees.
    const res = await postWindow({ action: 'pause' }, sessionCookie('0009'));
    expect(res.status).toBe(403);
    expect(strings.size).toBe(0);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await postWindow({ action: 'pause' }, null);
    expect(res.status).toBe(403);
    expect(strings.size).toBe(0);
  });

  it('reports a storage outage instead of claiming success', async () => {
    redisAvailable = false;
    const res = await postWindow({ action: 'pause' }, commishCookie());
    expect(res.status).toBe(503);
  });
});

describe('GET /api/owners-poll/window', () => {
  const getWindow = (cookie: string | null) =>
    windowGET(makeContext(authed('/api/owners-poll/window', cookie)));

  it('reports the derived open cycle, then a pause', async () => {
    const open = await (await getWindow(commishCookie())).json();
    expect(open.status).toBe('open');
    expect(Date.parse(open.window.closesAt)).toBeGreaterThan(Date.now());

    await postWindow({ action: 'pause' }, commishCookie());
    const paused = await (await getWindow(commishCookie())).json();
    expect(paused.status).toBe('paused');
    expect(paused.window).toBeNull();
  });
});

/**
 * The commissioner panel and the route it drives, pinned together.
 *
 * Removing the quorum turned this route from open/close into pause/resume and
 * left PollWindowAdmin.tsx still POSTing `action: 'open'` and `action: 'close'`
 * — which the route answers with a 400. Nothing failed at build time: both
 * sides compiled, the panel rendered, and every button simply errored. A
 * contract carried in a string literal across a fetch has no type to break, so
 * it needs a test.
 *
 * Scanned from source rather than exercised, because the panel is a React
 * island whose fetch is the only thing worth asserting: which action names it
 * is willing to send.
 */
describe('the commissioner panel speaks the window route’s vocabulary', () => {
  const read = (p: string) =>
    readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

  it('sends only actions the route accepts', () => {
    const panel = read('src/components/shared/owners-poll/PollWindowAdmin.tsx');
    const sent = new Set(
      [...panel.matchAll(/act\((['"])([a-z-]+)\1\)/g)].map((m) => m[2]),
    );
    expect(sent.size).toBeGreaterThan(0);
    for (const action of sent) {
      expect(['pause', 'resume']).toContain(action);
    }
  });

  it('still offers both of them, so neither half of the switch is unreachable', () => {
    const panel = read('src/components/shared/owners-poll/PollWindowAdmin.tsx');
    expect(panel).toMatch(/act\('pause'\)/);
    expect(panel).toMatch(/act\('resume'\)/);
  });

  it('reads the two states the route actually reports', () => {
    const panel = read('src/components/shared/owners-poll/PollWindowAdmin.tsx');
    // 'closed' / 'pending' / 'none' are gone from the route's vocabulary; a
    // panel still branching on them renders a state that can never arrive.
    expect(panel).not.toMatch(/status === '(closed|pending|none)'/);
    expect(panel).toMatch(/status === 'paused'/);
  });
});

describe('the poll closes for the offseason', () => {
  // CLAUDE.md's named trap: `getCurrentSeasonYear` rolls at LABOR DAY, so from
  // February until then it names last season — a year that resolves fine and
  // whose feeds are complete by definition. Gating on "the year resolves" or
  // "the feeds have a completed week" therefore leaves the ballot live all
  // offseason, taking votes into a standing hash for a season already played.
  //
  // The homepage card gates on isSeasonWindowOpen; before this the API did not,
  // so the two disagreed — card hidden, ballot page still accepting votes.

  it('refuses a ballot in the offseason', async () => {
    const june = new Date('2026-06-15T12:00:00Z');
    expect(resolvePollCycle(THELEAGUE, june)).toBeNull();
  });

  it('accepts one in season', async () => {
    const october = new Date('2026-10-15T12:00:00Z');
    expect(resolvePollCycle(THELEAGUE, october)).not.toBeNull();
  });
});
