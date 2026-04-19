/**
 * Tests for GET /api/schefter/style-book.
 *
 * Contract pins:
 *  - Response shape: { seasonYear, entries[], totals }
 *  - Empty state when no leaderboard exists
 *  - Descending order by seasonCount
 *  - normalizeAuthorKey() in the API matches the listener's normalization
 *    (same display-name in → same Redis key) so lifetime + last-shot
 *    lookups resolve on real data.
 *  - Lifetime + last-shot fetches are best-effort (individual failures
 *    degrade that entry, don't kill the response).
 *  - Cache TTL: second call returns cached data without re-reading Redis.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  GET,
  normalizeAuthorKey as apiNormalize,
  _resetStyleBookCacheForTests,
} from '../src/pages/api/schefter/style-book';
import {
  normalizeAuthorKey as listenerNormalize,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/schefter-groupme-listen.mjs';

// ── FakeRedis (subset used by style-book.ts) ────────────────────────────────

class FakeRedis {
  strings = new Map<string, string | number>();
  zsets = new Map<string, Map<string, number>>();
  getCalls: string[] = [];
  zrangeCalls: Array<{ key: string; rev: boolean; withScores: boolean }> = [];
  zcardCalls: string[] = [];

  async get(key: string) {
    this.getCalls.push(key);
    return this.strings.has(key) ? this.strings.get(key) ?? null : null;
  }
  async zrange(
    key: string,
    _start: number,
    _stop: number,
    opts?: { rev?: boolean; withScores?: boolean },
  ) {
    this.zrangeCalls.push({
      key,
      rev: !!opts?.rev,
      withScores: !!opts?.withScores,
    });
    const map = this.zsets.get(key);
    if (!map) return [];
    const sorted = Array.from(map.entries()).sort((a, b) =>
      opts?.rev ? b[1] - a[1] : a[1] - b[1],
    );
    if (opts?.withScores) {
      return sorted.flatMap(([member, score]) => [member, score]);
    }
    return sorted.map(([member]) => member);
  }
  async zcard(key: string) {
    this.zcardCalls.push(key);
    return this.zsets.get(key)?.size ?? 0;
  }
}

// Shim the Upstash module so the endpoint's dynamic import returns our fake.
const fakeRedis = new FakeRedis();

// Point the route at our fake via dependency injection through the module cache.
// The endpoint does a dynamic `import('@upstash/redis')` at runtime — we
// intercept it so we don't need the real client.
import { vi } from 'vitest';
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return fakeRedis as unknown as never;
    }
  },
}));

// Required for the Upstash-mock path: env vars must exist for `getRedis()` to
// attempt the dynamic import in the first place. Values are irrelevant.
process.env.UPSTASH_REDIS_REST_URL = 'http://fake-redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

async function callEndpoint() {
  const req = new Request('http://test.invalid/api/schefter/style-book');
  // The GET handler ignores `params`, `redirect`, etc. — a minimal shape is fine.
  const res = await GET({
    request: req,
    url: new URL(req.url),
    params: {},
    props: {},
    redirect: () => new Response('', { status: 302 }),
    rewrite: (() => new Response('')) as any,
    cookies: {} as any,
    locals: {} as any,
    site: new URL('http://test.invalid'),
    generator: 'astro',
    clientAddress: '127.0.0.1',
    preferredLocale: null,
    preferredLocaleList: null,
    currentLocale: null,
    routePattern: '/api/schefter/style-book',
  } as any);
  return res;
}

beforeEach(() => {
  _resetStyleBookCacheForTests();
  fakeRedis.strings.clear();
  fakeRedis.zsets.clear();
  fakeRedis.getCalls.length = 0;
  fakeRedis.zrangeCalls.length = 0;
  fakeRedis.zcardCalls.length = 0;
});

// ── Normalization parity ────────────────────────────────────────────────────

describe('normalizeAuthorKey — parity with the listener', () => {
  const cases = [
    'Dead Cap Walking',
    'Da Dangsters!',
    '  Pacific Pigskins  ',
    'Wascawy Wabbits',
    "Music City Mafia",
    'MCM',
    '',
  ];

  for (const name of cases) {
    it(`produces identical keys for "${name}"`, () => {
      expect(apiNormalize(name)).toBe(listenerNormalize(name));
    });
  }
});

// ── Helpers for multi-year leaderboard population ───────────────────────────

function populateNamedLeaderboard(lb: Map<string, number>) {
  for (const y of [2025, 2026, 2027]) {
    fakeRedis.zsets.set(`schefter:style_book:leaderboard:${y}`, new Map(lb));
  }
}

function populateAnonLeaderboard(lb: Map<string, number>) {
  for (const y of [2025, 2026, 2027]) {
    fakeRedis.zsets.set(`schefter:style_book:anon_leaderboard:${y}`, new Map(lb));
  }
}

// ── Endpoint behavior ───────────────────────────────────────────────────────

describe('GET /api/schefter/style-book', () => {
  it('returns empty named + anonymous pools when nothing is tracked', async () => {
    const res = await callEndpoint();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.named).toEqual({ entries: [], totals: { seasonShots: 0, authors: 0 } });
    expect(body.anonymous).toEqual({ entries: [], totals: { seasonShots: 0, authors: 0 } });
    expect(body.seasonYear).toBeGreaterThan(2024);
  });

  it('returns named entries ordered by seasonCount desc', async () => {
    populateNamedLeaderboard(new Map<string, number>([
      ['Dead Cap Walking', 3],
      ['Wabbits', 1],
      ['Vitside Mafia', 2],
    ]));

    // Lifetime + last-shot enrichment for one author
    fakeRedis.strings.set('schefter:style_book:dead_cap_walking', 5);
    fakeRedis.strings.set('schefter:style_book:last_shot_at:dead_cap_walking', 1_700_000_000_000);

    const res = await callEndpoint();
    const body = await res.json();
    expect(body.named.entries.map((e: any) => e.author)).toEqual([
      'Dead Cap Walking',
      'Vitside Mafia',
      'Wabbits',
    ]);
    expect(body.named.entries[0].seasonCount).toBe(3);
    expect(body.named.entries[0].lifetimeCount).toBe(5);
    expect(body.named.entries[0].lastShotAt).toBe(1_700_000_000_000);

    // Vitside has no lifetime record — should degrade to 0 / null.
    expect(body.named.entries[1].lifetimeCount).toBe(0);
    expect(body.named.entries[1].lastShotAt).toBeNull();
  });

  it('returns anonymous entries by codename (never hash)', async () => {
    // Anon leaderboard keys on the tipster HASH. Codename resolves via
    // schefter:tipster:codename:{hash}. Entries without a codename are dropped.
    const hashA = 'a'.repeat(64);
    const hashB = 'b'.repeat(64);
    const hashC = 'c'.repeat(64);
    populateAnonLeaderboard(new Map<string, number>([
      [hashA, 4],
      [hashB, 2],
      [hashC, 1], // missing codename — should be dropped
    ]));
    fakeRedis.strings.set(`schefter:tipster:codename:${hashA}`, 'Burner Phone');
    fakeRedis.strings.set(`schefter:tipster:codename:${hashB}`, 'The Ghost');
    // hashC intentionally omitted
    fakeRedis.strings.set(`schefter:style_book:anon:${hashA}`, 7);
    fakeRedis.strings.set(`schefter:style_book:anon:last_shot_at:${hashA}`, 1_700_000_000_000);

    const res = await callEndpoint();
    const body = await res.json();
    expect(body.anonymous.entries.map((e: any) => e.codename)).toEqual([
      'Burner Phone',
      'The Ghost',
    ]);
    expect(body.anonymous.entries[0].seasonCount).toBe(4);
    expect(body.anonymous.entries[0].lifetimeCount).toBe(7);
    expect(body.anonymous.entries[0].lastShotAt).toBe(1_700_000_000_000);

    // Verify hashes never appear in the response body.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(hashA);
    expect(serialized).not.toContain(hashB);
    expect(serialized).not.toContain(hashC);
  });

  it('returns named + anonymous pools in parallel (non-interfering)', async () => {
    populateNamedLeaderboard(new Map<string, number>([['Dead Cap Walking', 2]]));
    const hashA = 'd'.repeat(64);
    populateAnonLeaderboard(new Map<string, number>([[hashA, 5]]));
    fakeRedis.strings.set(`schefter:tipster:codename:${hashA}`, 'Smoke Signal');

    const res = await callEndpoint();
    const body = await res.json();
    expect(body.named.entries).toHaveLength(1);
    expect(body.named.entries[0].author).toBe('Dead Cap Walking');
    expect(body.anonymous.entries).toHaveLength(1);
    expect(body.anonymous.entries[0].codename).toBe('Smoke Signal');
  });

  it('aggregates season totals correctly for both pools', async () => {
    populateNamedLeaderboard(new Map<string, number>([['A', 5], ['B', 3]]));
    const hashA = 'e'.repeat(64);
    const hashB = 'f'.repeat(64);
    populateAnonLeaderboard(new Map<string, number>([[hashA, 2], [hashB, 1]]));
    fakeRedis.strings.set(`schefter:tipster:codename:${hashA}`, 'Back-Channel');
    fakeRedis.strings.set(`schefter:tipster:codename:${hashB}`, 'Hot Mic');

    const res = await callEndpoint();
    const body = await res.json();
    expect(body.named.totals.seasonShots).toBe(8);
    expect(body.named.totals.authors).toBe(2);
    expect(body.anonymous.totals.seasonShots).toBe(3);
    expect(body.anonymous.totals.authors).toBe(2);
  });

  it('never exposes hashes or internal keys in the response', async () => {
    populateNamedLeaderboard(new Map<string, number>([['Dead Cap Walking', 2]]));
    const hashA = '0'.repeat(64);
    populateAnonLeaderboard(new Map<string, number>([[hashA, 1]]));
    fakeRedis.strings.set(`schefter:tipster:codename:${hashA}`, 'Unnamed Source');

    const res = await callEndpoint();
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/schefter:style_book:/);
    expect(serialized).not.toMatch(/schefter:tipster:codename:/);
    expect(serialized).not.toMatch(/hashedOwnerId/);
    expect(serialized).not.toMatch(/dead_cap_walking/);
    expect(serialized).not.toContain(hashA);
  });

  it('caches the response (second call makes no Redis reads)', async () => {
    populateNamedLeaderboard(new Map<string, number>([['Dead Cap Walking', 1]]));

    await callEndpoint();
    const zrangeCallsAfterFirst = fakeRedis.zrangeCalls.length;
    const getCallsAfterFirst = fakeRedis.getCalls.length;

    await callEndpoint();
    expect(fakeRedis.zrangeCalls.length).toBe(zrangeCallsAfterFirst);
    expect(fakeRedis.getCalls.length).toBe(getCallsAfterFirst);
  });

  it('requests descending order with scores from BOTH leaderboard ZSETs', async () => {
    populateNamedLeaderboard(new Map<string, number>([['X', 1]]));
    populateAnonLeaderboard(new Map<string, number>([[''.padEnd(64, '1'), 1]]));
    fakeRedis.strings.set(`schefter:tipster:codename:${''.padEnd(64, '1')}`, 'The Ledger');
    await callEndpoint();
    // Both ZRANGE calls should have rev + withScores set
    for (const call of fakeRedis.zrangeCalls) {
      expect(call.rev).toBe(true);
      expect(call.withScores).toBe(true);
    }
    // And both leaderboard keys should have been queried.
    const keys = fakeRedis.zrangeCalls.map((c) => c.key);
    expect(keys.some((k) => k.startsWith('schefter:style_book:leaderboard:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('schefter:style_book:anon_leaderboard:'))).toBe(true);
  });
});

// ── Source-level contract (page) ────────────────────────────────────────────

describe('style-book page — contract', () => {
  const pageSrc = readFileSync(
    path.join(process.cwd(), 'src/pages/theleague/schefter/style-book.astro'),
    'utf8',
  );

  it('marks the page as not prerendered (needs server-side fetch)', () => {
    expect(pageSrc).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });

  it('fetches from the public /api/schefter/style-book endpoint', () => {
    expect(pageSrc).toMatch(/\/api\/schefter\/style-book/);
  });

  it('renders empty states for both leaderboards', () => {
    // Named (group chat) empty state
    expect(pageSrc).toMatch(/The group chat file is empty/);
    // Anonymous (tip line) empty state
    expect(pageSrc).toMatch(/The tip-line file is empty/);
  });

  it('renders both named and anonymous boards', () => {
    expect(pageSrc).toMatch(/Group Chat file/);
    expect(pageSrc).toMatch(/Anonymous Tip-line file/);
    expect(pageSrc).toMatch(/data-style-book-named-list/);
    expect(pageSrc).toMatch(/data-style-book-anon-list/);
  });

  it('escapes HTML in author names', () => {
    expect(pageSrc).toMatch(/escapeHtml/);
  });
});
