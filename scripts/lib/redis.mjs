/**
 * Shared Redis helpers for node scripts.
 *
 * Two flavors, both built on the same triple-fallback credential resolver
 * (`getRedisConfig`) used everywhere else in the repo
 * (UPSTASH_REDIS_REST_URL || KV_REST_API_URL || STORAGE_REST_API_URL, and
 * the matching *_TOKEN chain):
 *
 *  - `redisCommand(redis, body)` — raw REST command execution (POST the
 *    command array to the base REST URL). No @upstash/redis dependency.
 *    Was duplicated between scripts/apply-pending-contracts.mjs and
 *    scripts/sync-draft-pick-contracts.mjs (the latter called a
 *    `${url}/hset`-shaped path form that issues the same HSET — migrated
 *    to the shared command-array form here, same net Redis effect).
 *
 *  - `createUpstashClient(config)` — the "resolve config, dynamically
 *    import '@upstash/redis', construct" plumbing shared by the
 *    schefter-scan.mjs / schefter-rumor-scan.mjs / schefter-trade-speculation.mjs
 *    getRedis() variants. Those three differ in memoization, required-vs-
 *    optional semantics, and log wording, so callers keep their own
 *    wrapper (memo variable, required-throw, warn message) around this and
 *    just delegate the shared plumbing.
 */

/** Resolve Redis REST credentials from the standard triple-fallback env chain. */
export function getRedisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

/** Execute a raw Upstash REST command, e.g. redisCommand(redis, ['HSET', key, field, value]). */
export async function redisCommand(redis, body) {
  const res = await fetch(redis.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Redis command failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.result;
}

/**
 * Construct an @upstash/redis client from an already-resolved config.
 * Callers own memoization, required-vs-optional handling, and logging —
 * this only shares the dynamic-import + construction step.
 */
export async function createUpstashClient(config) {
  const { Redis } = await import('@upstash/redis');
  return new Redis({ url: config.url, token: config.token });
}
