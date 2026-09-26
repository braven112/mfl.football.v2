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

import { isDemoDeploy } from './deploy-environment';
import { demoKeyPrefix } from './demo-request-context';

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
  hgetall: <T = unknown>(key: string) => Promise<Record<string, T> | null>;
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
  lrem: (key: string, count: number, value: unknown) => Promise<number>;

  // Counters
  decr: (key: string) => Promise<number>;

  // Sorted-set removal (used by the tip undo path)
  zrem: (key: string, ...members: string[]) => Promise<number>;

  // Misc
  pipeline: () => RedisPipelineClient;
  eval: <T = unknown>(script: string, keys: string[], args: (string | number)[]) => Promise<T>;
};

let _redis: RedisClient | null | undefined;

/** Methods whose FIRST argument is a key. */
const KEY_FIRST = new Set([
  'get', 'set', 'incr', 'decr', 'expire', 'ttl', 'hget', 'hgetall', 'hset', 'hdel', 'hincrby', 'hlen',
  'zadd', 'zincrby', 'zremrangebyscore', 'zremrangebyrank', 'zcard', 'zcount', 'zrange', 'zrangebyscore',
  'zrevrangebyscore', 'zrem', 'sadd', 'srem', 'smembers', 'scard', 'lpush', 'llen', 'lrange', 'lrem',
]);
/** Methods whose EVERY string argument is a key. */
const ALL_KEYS = new Set(['mget', 'del', 'exists', 'unlink']);

/**
 * The custom-site demo's key namespace (docs/plans/custom-site-demo.md).
 *
 * On a demo deployment every key is rewritten to `demo:<token>:<key>` for the
 * prospect the request belongs to (`demo:anon:` before sign-in), so each
 * prospect's simulated league — MFL overlay, contract declarations, watch
 * list, every cache — is private to them. Applied at this one choke point so
 * no feature has to remember it. Demo LINK records (`demo:tokens:*`) are the
 * one deliberate exception: they are looked up before anyone is signed in.
 *
 * The prefix is read per call, never captured: this client is memoized for
 * the process and serves every prospect.
 */
export function namespaceForDemo(client: RedisClient): RedisClient {
  const scoped = (key: unknown) =>
    typeof key === 'string' && !key.startsWith('demo:tokens:') ? `${demoKeyPrefix()}${key}` : key;
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        if (typeof value !== 'function' || typeof prop !== 'string') return value;
        if (prop === 'pipeline' || prop === 'multi') {
          return (...args: unknown[]) => wrap(value.apply(obj, args));
        }
        if (KEY_FIRST.has(prop)) {
          return (key: unknown, ...rest: unknown[]) => value.call(obj, scoped(key), ...rest);
        }
        if (ALL_KEYS.has(prop)) {
          return (...keys: unknown[]) => value.apply(obj, keys.flat().map(scoped));
        }
        if (prop === 'eval' || prop === 'evalsha') {
          return (script: unknown, keys: unknown[] = [], args: unknown[] = []) =>
            value.call(obj, script, keys.map(scoped), args);
        }
        if (prop === 'scan') {
          return async (cursor: unknown, opts: { match?: string; count?: number } = {}) => {
            const prefix = demoKeyPrefix();
            const [next, keys] = (await value.call(obj, cursor, { ...opts, match: `${prefix}${opts.match ?? '*'}` })) as [
              string,
              string[],
            ];
            return [next, keys.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k))];
          };
        }
        return value.bind(obj);
      },
    });
  return wrap(client);
}
let _warnedImportFailure = false;

/**
 * Resolve the shared Upstash Redis client, memoized after first resolution.
 * Returns null (never throws) when credentials are absent or the
 * '@upstash/redis' import fails, so callers can treat "no Redis" as a
 * degraded-storage case rather than a hard error.
 *
 * Memoization notes (this client is shared by ~25 consumers, so a cached
 * result affects all of them):
 * - a successful client is cached for the process lifetime;
 * - missing credentials cache null (matching the majority of the inline
 *   copies this replaced — env vars don't appear mid-process in practice);
 * - a FAILED '@upstash/redis' import does NOT cache null, so a transient
 *   cold-start failure is retried on the next call instead of locking the
 *   whole process into redis-less mode. The warn is once-per-process to
 *   avoid log spam if the failure is persistent.
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
    const client = new Redis({ url, token }) as unknown as RedisClient;
    _redis = isDemoDeploy() ? namespaceForDemo(client) : client;
    return _redis;
  } catch (err) {
    if (!_warnedImportFailure) {
      _warnedImportFailure = true;
      console.warn('[redis-client] Redis unavailable:', err);
    }
    return null;
  }
}
