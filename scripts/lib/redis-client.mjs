/**
 * The @upstash/redis SDK half of the shared Redis plumbing.
 *
 * Split out of scripts/lib/redis.mjs in Sep 2026. That module serves two
 * audiences: scripts that only POST command arrays to the Upstash REST URL
 * (node built-ins and `fetch`, nothing else) and scripts that want the SDK
 * client. While both lived in one file, every REST-only caller declared a
 * node_modules dependency it never used — and eleven of them run in workflows
 * that deliberately install nothing, so "does this job need pnpm install?"
 * could not be answered from the import graph at all.
 *
 * Keep this file as the ONLY place in scripts/lib that names '@upstash/redis'.
 * tests/workflow-install-guard.test.ts walks the graph of every no-install
 * workflow's entrypoints and fails if one reaches a package; folding this back
 * into redis.mjs re-breaks that guard for five workflows at once.
 */

/**
 * Construct an @upstash/redis client from an already-resolved config
 * (see getRedisConfig in ./redis.mjs).
 * Callers own memoization, required-vs-optional handling, and logging —
 * this only shares the dynamic-import + construction step.
 */
export async function createUpstashClient(config) {
  const { Redis } = await import('@upstash/redis');
  return new Redis({ url: config.url, token: config.token });
}
