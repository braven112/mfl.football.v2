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

// ── Endpoint behavior ───────────────────────────────────────────────────────

describe('GET /api/schefter/style-book', () => {
  it('returns an empty response when the leaderboard is empty', async () => {
    const res = await callEndpoint();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
    expect(body.totals).toEqual({ seasonShots: 0, authors: 0 });
    expect(body.seasonYear).toBeGreaterThan(2024);
  });

  it('returns entries ordered by seasonCount desc', async () => {
    const lb = new Map<string, number>([
      ['Dead Cap Walking', 3],
      ['Wabbits', 1],
      ['Vitside Mafia', 2],
    ]);
    // Find the correct leaderboard key — the endpoint uses getCurrentLeagueYear()
    // Pre-populate a leaderboard for each plausible year.
    const years = [2025, 2026, 2027];
    for (const y of years) fakeRedis.zsets.set(`schefter:style_book:leaderboard:${y}`, new Map(lb));

    // Also populate lifetime + last-shot for one of them so we can assert
    // the enrichment path works.
    fakeRedis.strings.set('schefter:style_book:dead_cap_walking', 5);
    fakeRedis.strings.set('schefter:style_book:last_shot_at:dead_cap_walking', 1_700_000_000_000);

    const res = await callEndpoint();
    const body = await res.json();
    expect(body.entries.map((e: any) => e.author)).toEqual([
      'Dead Cap Walking',
      'Vitside Mafia',
      'Wabbits',
    ]);
    expect(body.entries[0].seasonCount).toBe(3);

    const dcw = body.entries[0];
    expect(dcw.lifetimeCount).toBe(5);
    expect(dcw.lastShotAt).toBe(1_700_000_000_000);

    // Vitside has no lifetime record — should degrade to 0 / null.
    const vit = body.entries[1];
    expect(vit.lifetimeCount).toBe(0);
    expect(vit.lastShotAt).toBeNull();
  });

  it('aggregates season totals correctly', async () => {
    const lb = new Map<string, number>([
      ['A', 5],
      ['B', 3],
      ['C', 1],
    ]);
    for (const y of [2025, 2026, 2027]) fakeRedis.zsets.set(`schefter:style_book:leaderboard:${y}`, new Map(lb));

    const res = await callEndpoint();
    const body = await res.json();
    expect(body.totals.seasonShots).toBe(9);
    expect(body.totals.authors).toBe(3);
  });

  it('never exposes hashes or internal keys in the response', async () => {
    const lb = new Map<string, number>([['Dead Cap Walking', 2]]);
    for (const y of [2025, 2026, 2027]) fakeRedis.zsets.set(`schefter:style_book:leaderboard:${y}`, new Map(lb));

    const res = await callEndpoint();
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/schefter:style_book:/);
    expect(serialized).not.toMatch(/hashedOwnerId/);
    expect(serialized).not.toMatch(/dead_cap_walking/); // normalized key should NOT leak
  });

  it('caches the response (second call makes no Redis reads)', async () => {
    const lb = new Map<string, number>([['Dead Cap Walking', 1]]);
    for (const y of [2025, 2026, 2027]) fakeRedis.zsets.set(`schefter:style_book:leaderboard:${y}`, new Map(lb));

    await callEndpoint();
    const zrangeCallsAfterFirst = fakeRedis.zrangeCalls.length;
    const getCallsAfterFirst = fakeRedis.getCalls.length;

    await callEndpoint();
    // The second call must be served from cache — no new Redis commands.
    expect(fakeRedis.zrangeCalls.length).toBe(zrangeCallsAfterFirst);
    expect(fakeRedis.getCalls.length).toBe(getCallsAfterFirst);
  });

  it('requests descending order with scores from the leaderboard ZSET', async () => {
    fakeRedis.zsets.set(`schefter:style_book:leaderboard:2026`, new Map([['X', 1]]));
    fakeRedis.zsets.set(`schefter:style_book:leaderboard:2027`, new Map([['X', 1]]));
    fakeRedis.zsets.set(`schefter:style_book:leaderboard:2025`, new Map([['X', 1]]));
    await callEndpoint();
    expect(fakeRedis.zrangeCalls[0].rev).toBe(true);
    expect(fakeRedis.zrangeCalls[0].withScores).toBe(true);
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

  it('renders an empty state when the dossier is empty', () => {
    expect(pageSrc).toMatch(/The dossier is empty this season/);
  });

  it('escapes HTML in author names', () => {
    expect(pageSrc).toMatch(/escapeHtml/);
  });
});
