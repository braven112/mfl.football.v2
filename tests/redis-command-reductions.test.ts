/**
 * Guards for the Redis command-count reductions applied to
 *   - src/utils/owner-activity.ts recordVisit (5 cmds → 1 via EVAL)
 *   - src/pages/api/schefter/cooker-status.ts GET (3 cmds → cached for 15s)
 *
 * Upstash bills per command, not per byte, so these invariants are the actual
 * cost control for the free tier. Any refactor that re-introduces multiple
 * round-trips per page view (or drops the cache) will regress our monthly
 * command budget.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

// ── FakeRedis that counts every command ──────────────────────────────────

type Call = { cmd: string; args: unknown[] };

class CountingRedis {
  calls: Call[] = [];
  hashes = new Map<string, Map<string, string>>();
  ttls = new Map<string, number>(); // expiresAt ms

  private record(cmd: string, args: unknown[]) {
    this.calls.push({ cmd, args });
  }
  count(cmd?: string): number {
    if (!cmd) return this.calls.length;
    return this.calls.filter((c) => c.cmd === cmd).length;
  }

  async hset(key: string, data: Record<string, unknown>) {
    this.record('HSET', [key, data]);
    const h = this.hashes.get(key) ?? new Map();
    for (const [f, v] of Object.entries(data)) h.set(f, String(v));
    this.hashes.set(key, h);
    return Object.keys(data).length;
  }
  async hgetall(key: string) {
    this.record('HGETALL', [key]);
    const h = this.hashes.get(key);
    if (!h) return null;
    return Object.fromEntries(h);
  }
  async hincrby(key: string, field: string, inc: number) {
    this.record('HINCRBY', [key, field, inc]);
    const h = this.hashes.get(key) ?? new Map();
    const cur = Number(h.get(field) ?? 0);
    const next = cur + inc;
    h.set(field, String(next));
    this.hashes.set(key, h);
    return next;
  }
  async expire(key: string, seconds: number) {
    this.record('EXPIRE', [key, seconds]);
    this.ttls.set(key, Date.now() + seconds * 1000);
    return 1;
  }
  async llen(_key: string) {
    this.record('LLEN', [_key]);
    return 0;
  }
  async get<T>(_key: string): Promise<T | null> {
    this.record('GET', [_key]);
    return null;
  }

  /**
   * Minimal EVAL emulator. Upstash/Redis run Lua server-side and bill it as
   * ONE command; this stub records exactly one call so the command-budget
   * assertions are meaningful. It also executes just enough of the script's
   * intent to let the assertions verify side-effects (hset + 3×hincrby).
   */
  async eval<T = unknown>(_script: string, keys: string[], args: (string | number)[]): Promise<T> {
    this.record('EVAL', [keys, args]);
    const [activityKey, pvKey, globalPagesKey, ownerPagesKey] = keys;
    const [franchiseId, nowMs, ttlSec, page] = args;

    // HSET activity
    const act = this.hashes.get(activityKey) ?? new Map();
    act.set(String(franchiseId), String(nowMs));
    this.hashes.set(activityKey, act);

    // HINCRBY pageviews + EXPIRE on first touch
    const pv = this.hashes.get(pvKey) ?? new Map();
    const pvCur = Number(pv.get(String(franchiseId)) ?? 0);
    pv.set(String(franchiseId), String(pvCur + 1));
    this.hashes.set(pvKey, pv);
    if (!this.ttls.has(pvKey)) {
      this.ttls.set(pvKey, Date.now() + Number(ttlSec) * 1000);
    }

    // HINCRBY global pages
    const gp = this.hashes.get(globalPagesKey) ?? new Map();
    const gpCur = Number(gp.get(String(page)) ?? 0);
    gp.set(String(page), String(gpCur + 1));
    this.hashes.set(globalPagesKey, gp);

    // HINCRBY owner pages
    const op = this.hashes.get(ownerPagesKey) ?? new Map();
    const opCur = Number(op.get(String(page)) ?? 0);
    op.set(String(page), String(opCur + 1));
    this.hashes.set(ownerPagesKey, op);

    return 1 as T;
  }
}

// ── owner-activity recordVisit ───────────────────────────────────────────

describe('owner-activity recordVisit — command budget', () => {
  // Inject a fake Redis by overriding the module-level _redis via the dynamic
  // import pattern. The module caches redis via `_redis` (module scope), so
  // we reset modules between tests.
  beforeEach(async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
  });

  async function loadModuleWithRedis(redis: CountingRedis) {
    // Provide the REST env vars so getRedis() wouldn't short-circuit, then
    // stub the @upstash/redis import to return our counting redis.
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    const { vi } = await import('vitest');
    vi.doMock('@upstash/redis', () => ({
      Redis: class {
        constructor() {
          return redis as unknown as object;
        }
      },
    }));
    const mod = await import('../src/utils/owner-activity');
    return mod;
  }

  it('issues exactly ONE Redis command per recordVisit (EVAL)', async () => {
    const redis = new CountingRedis();
    const mod = await loadModuleWithRedis(redis);
    await mod.recordVisit('13522', '0001', '/roster');
    expect(redis.count()).toBe(1);
    expect(redis.count('EVAL')).toBe(1);
    expect(redis.count('HSET')).toBe(0);
    expect(redis.count('HINCRBY')).toBe(0);
    expect(redis.count('EXPIRE')).toBe(0);
  });

  it('still applies all four writes through the Lua script', async () => {
    const redis = new CountingRedis();
    const mod = await loadModuleWithRedis(redis);
    await mod.recordVisit('13522', '0001', '/roster?view=cards');

    const today = new Date().toISOString().slice(0, 10);
    // activity:{leagueId} — last-seen timestamp stored as a string ms value
    const activity = redis.hashes.get('activity:13522');
    expect(activity?.get('0001')).toMatch(/^\d{13,}$/);

    // pageviews:{leagueId}:{today} — franchise count should be 1
    const pv = redis.hashes.get(`pageviews:13522:${today}`);
    expect(pv?.get('0001')).toBe('1');

    // Global + owner page counts keyed by the normalized path
    const global = redis.hashes.get('pages:13522');
    expect(global?.get('/roster')).toBe('1');
    const owner = redis.hashes.get('pages:13522:0001');
    expect(owner?.get('/roster')).toBe('1');
  });

  it('EXPIRE on the daily pageview key is set exactly once per day (via TTL guard in Lua)', async () => {
    const redis = new CountingRedis();
    const mod = await loadModuleWithRedis(redis);
    // Three hits in quick succession — should all be one command each, and
    // only one of them should set the TTL on the pageview key.
    await mod.recordVisit('13522', '0001', '/');
    await mod.recordVisit('13522', '0002', '/');
    await mod.recordVisit('13522', '0001', '/roster');
    expect(redis.count()).toBe(3);
    const today = new Date().toISOString().slice(0, 10);
    expect(redis.ttls.has(`pageviews:13522:${today}`)).toBe(true);
  });

  it('falls back to the 5-command path when EVAL throws (compatibility guard)', async () => {
    const redis = new CountingRedis();
    // Sabotage EVAL so we exercise the fallback branch. The fallback path is
    // intentionally verbose — pinning the 5 commands here prevents a future
    // refactor from silently breaking Upstash-without-EVAL deployments.
    redis.eval = async () => {
      throw new Error('NOSCRIPT fake');
    };
    const mod = await loadModuleWithRedis(redis);
    await mod.recordVisit('13522', '0001', '/');
    const nonEval = redis.calls.filter((c) => c.cmd !== 'EVAL');
    expect(nonEval.map((c) => c.cmd).sort()).toEqual(
      ['EXPIRE', 'HINCRBY', 'HINCRBY', 'HINCRBY', 'HSET'].sort(),
    );
  });
});

// ── cooker-status in-process cache ───────────────────────────────────────

describe('cooker-status GET — in-process cache', () => {
  beforeEach(async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
  });

  async function loadModuleWithRedis(redis: CountingRedis) {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    const { vi } = await import('vitest');
    vi.doMock('@upstash/redis', () => ({
      Redis: class {
        constructor() {
          return redis as unknown as object;
        }
      },
    }));
    const mod = await import('../src/pages/api/schefter/cooker-status');
    return mod;
  }

  // Astro's APIRoute expects a full APIContext; the handler only reads
  // `request`, so a minimal shim is sufficient at runtime. Cast through
  // `unknown` to satisfy TS without re-stating the APIContext surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function invokeGet(mod: any): Promise<Response> {
    const ctx = { request: new Request('http://localhost/api/schefter/cooker-status') };
    return mod.GET(ctx);
  }

  it('calls Redis once on the first request, then serves from cache for subsequent calls within 15s', async () => {
    const redis = new CountingRedis();
    const mod = await loadModuleWithRedis(redis);
    mod._resetCookerCacheForTests();

    const r1 = await invokeGet(mod);
    const r2 = await invokeGet(mod);
    const r3 = await invokeGet(mod);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    // 3 requests, but Redis was touched for only the first one:
    //   1× LLEN + 1× GET + 1× GET = 3 commands total (not 9).
    expect(redis.count('LLEN')).toBe(1);
    expect(redis.count('GET')).toBe(2);
    expect(redis.count()).toBe(3);
  });

  it('re-fetches when the cache expires', async () => {
    const redis = new CountingRedis();
    const mod = await loadModuleWithRedis(redis);
    mod._resetCookerCacheForTests();

    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-18T12:00:00Z'));
      await invokeGet(mod);
      expect(redis.count()).toBe(3);

      // 14s later — still cached.
      vi.setSystemTime(new Date('2026-04-18T12:00:14Z'));
      await invokeGet(mod);
      expect(redis.count()).toBe(3);

      // 16s later — cache has expired, another Redis fetch.
      vi.setSystemTime(new Date('2026-04-18T12:00:16Z'));
      await invokeGet(mod);
      expect(redis.count()).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the same payload shape from cache as from a fresh fetch', async () => {
    const redis = new CountingRedis();
    const mod = await loadModuleWithRedis(redis);
    mod._resetCookerCacheForTests();

    const r1 = await invokeGet(mod);
    const r2 = await invokeGet(mod);
    expect(await r1.clone().json()).toEqual(await r2.clone().json());
  });
});

// ── Source-level guards ─────────────────────────────────────────────────

describe('source-level invariants', () => {
  it('owner-activity uses a Lua EVAL for recordVisit', () => {
    const src = read('src/utils/owner-activity.ts');
    expect(src).toMatch(/RECORD_VISIT_LUA/);
    expect(src).toMatch(/redis\.eval\(/);
    expect(src).toMatch(/HSET/);
    expect(src).toMatch(/HINCRBY/);
    expect(src).toMatch(/redis\.call\('TTL',\s*KEYS\[2\]\)/);
  });

  it('cooker-status keeps a 15s cache window', () => {
    const src = read('src/pages/api/schefter/cooker-status.ts');
    expect(src).toMatch(/CACHE_TTL_MS\s*=\s*15_000/);
    expect(src).toMatch(/_cache\s*=\s*\{\s*data/);
  });

  it('cooker-status serves from cache BEFORE calling getRedis()', () => {
    // Ordering is what makes the cache actually save commands. A cache that
    // runs AFTER getRedis() would still avoid the 3 reads but would churn
    // the redis client import every call.
    const src = read('src/pages/api/schefter/cooker-status.ts');
    const cacheCheckIdx = src.indexOf('_cache.expiresAt > now');
    const getRedisIdx = src.indexOf('const redis = await getRedis();');
    expect(cacheCheckIdx).toBeGreaterThan(-1);
    expect(getRedisIdx).toBeGreaterThan(-1);
    expect(cacheCheckIdx).toBeLessThan(getRedisIdx);
  });
});
