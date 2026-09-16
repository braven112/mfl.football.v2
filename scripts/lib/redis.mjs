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
 * The SDK client factory (`createUpstashClient`) deliberately does NOT live
 * here — it is in ./redis-client.mjs, so that THIS module stays reachable
 * from scripts that run in workflows with no `pnpm install`. Import both when
 * you need both; the config resolver is shared.
 *
 * Two flavors of caller, then:
 *
 *  - REST-only (this file alone): apply-pending-contracts, apply-august-cuts,
 *    the push-* fan-outs, cut-watch — dependency-free, node built-ins + fetch.
 *  - SDK (this file + ./redis-client.mjs): schefter-scan / -rumor-scan /
 *    -trade-speculation / -lineup-check, roger-groupme-reply,
 *    map-groupme-owners. Those differ in memoization, required-vs-optional
 *    semantics, and log wording, so each keeps its own wrapper (memo
 *    variable, required-throw, warn message) around the shared plumbing.
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
