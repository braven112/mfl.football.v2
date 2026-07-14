/**
 * Shared Upstash Redis client
 *
 * Canonical `getRedis()` + `RedisClient` type, extracted from ~26 near-
 * identical inline copies that used to live across src/pages/api and
 * src/utils. Every copy resolved credentials via the same triple fallback
 * (UPSTASH_REDIS_REST_URL || KV_REST_API_URL || STORAGE_REST_API_URL, and
 * the matching *_TOKEN chain), dynamically imported '@upstash/redis' so the
 * dependency is never eagerly bundled, memoized the client (or null) after
 * the first resolution, and warned-then-returned-null on any failure so a
 * missing/broken Redis config degrades storage features instead of
 * crashing the route.
 *
 * `RedisClient` is a hand-rolled superset of every method signature used by
 * any call site (some files only ever called `get`/`set`, others used sorted
 * sets, hashes, pipelines, or `eval`). Import only the methods you need —
 * TypeScript's structural typing means callers don't have to implement the
 * whole surface.
 */

export type RedisPipelineClient = {
  hgetall: (key: string) => void;
  exec: <T>() => Promise<T>;
};

export type RedisScanResult<T = string> = [string, T[]];

export type RedisClient = {
  // Strings
  get: <T = unknown>(key: string) => Promise<T | null>;
  set: (
    key: string,
    value: unknown,
    opts?: { ex?: number; nx?: boolean },
  ) => Promise<unknown>;
  mget: <T = unknown>(...keys: string[]) => Promise<(T | null)[]>;
  del: (key: string) => Promise<unknown>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  ttl: (key: string) => Promise<number>;

  // Hashes
  hget: <T = unknown>(key: string, field: string) => Promise<T | null>;
  hgetall: <T = unknown>(key: string) => Promise<Record<string, T> | T | null>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
  hincrby: (key: string, field: string, increment: number) => Promise<number>;
  hlen: (key: string) => Promise<number>;

  // Sorted sets
  zadd: (key: string, ...args: unknown[]) => Promise<unknown>;
  zincrby: (key: string, increment: number, member: string) => Promise<number | string>;
  zremrangebyscore: (
    key: string,
    min: number | string,
    max: number | string,
  ) => Promise<unknown>;
  zremrangebyrank: (key: string, start: number, stop: number) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  zcount: (key: string, min: number | string, max: number | string) => Promise<number>;
  zrange: <T = unknown>(
    key: string,
    start: number | string,
    stop: number | string,
    opts?: { rev?: boolean; withScores?: boolean },
  ) => Promise<T[]>;
  zrangebyscore: <T = unknown>(
    key: string,
    min: number | string,
    max: number | string,
    opts?: { offset?: number; count?: number },
  ) => Promise<T[]>;
  zrevrangebyscore: <T = unknown>(
    key: string,
    max: number | string,
    min: number | string,
    opts?: { offset?: number; count?: number },
  ) => Promise<T[]>;

  // Sets
  sadd: (key: string, ...members: string[]) => Promise<number>;
  srem: (key: string, ...members: string[]) => Promise<number>;
  smembers: <T = string>(key: string) => Promise<T[]>;
  scard: (key: string) => Promise<number>;
  scan: (
    cursor: number | string,
    opts?: { match?: string; count?: number },
  ) => Promise<RedisScanResult>;

  // Lists
  lpush: (key: string, ...values: unknown[]) => Promise<number>;
  llen: (key: string) => Promise<number>;
  lrange: <T = string>(key: string, start: number, stop: number) => Promise<T[]>;

  // Misc
  pipeline: () => RedisPipelineClient;
  eval: <T = unknown>(script: string, keys: string[], args: (string | number)[]) => Promise<T>;
};

let _redis: RedisClient | null | undefined;

/**
 * Resolve the shared Upstash Redis client, memoized after first resolution.
 * Returns null (never throws) when credentials are absent or the
 * '@upstash/redis' import fails, so callers can treat "no Redis" as a
 * degraded-storage case rather than a hard error.
 */
export async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[redis-client] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}
