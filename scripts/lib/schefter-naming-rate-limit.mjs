/**
 * Schefter Naming Rate Limit
 *
 * Per-(tipster, target) cap on how many times one tipster can unlock direct
 * naming of one franchise via the rumor-mill explicit-pick path. Without this
 * cap, a single petty owner could grind on one rival and trigger named-team
 * posts indefinitely. With it, the third explicit-pick of the same target by
 * the same tipster within 30 days silently demotes back to division-fuzz —
 * the tip still files, the tipster sees no error, but Schefter doesn't name
 * the team in the resulting post.
 *
 * The increment lives at submission time in src/pages/api/schefter/tip.ts;
 * the read lives in scripts/schefter-rumor-scan.mjs's anonymizeTips() to
 * decide between franchise-explicit-pick scope (under cap) and division-fuzz
 * (over cap).
 *
 * Redis key:
 *   schefter:tipster_target_count:{tipsterHash}:{franchiseId}
 *     STRING counter, EXPIRE 30d on first set. Each subsequent INCR within
 *     the window keeps the existing TTL (EXPIRE is idempotent on key reset
 *     only). Once the count hits MAX_EXPLICIT_PICKS_PER_TARGET + 1 the
 *     anonymizer demotes; the key continues to count for 30d so we know
 *     when the tipster can resume direct naming on the same target.
 */

const NAMING_RATE_LIMIT_PREFIX = 'schefter:tipster_target_count:';
const NAMING_RATE_LIMIT_TTL_SEC = 30 * 24 * 60 * 60; // 30d

/**
 * Cap = 2 means: tipster can unlock direct naming on the same target on
 * picks 1 and 2 in the window; pick 3 (and onward) silently demote to
 * division-fuzz. Tuned to allow follow-up tips on a story the tipster
 * actually cares about while denying grind-on-one-rival behavior.
 */
export const MAX_EXPLICIT_PICKS_PER_TARGET = 2;

function buildKey(tipsterHash, franchiseId) {
  return `${NAMING_RATE_LIMIT_PREFIX}${tipsterHash}:${franchiseId}`;
}

/**
 * Increment the (tipster, target) counter on a fresh explicit-pick submission.
 * Idempotent only at the Redis-call level: every call increments. Set the TTL
 * on first observation so the key auto-cleans after 30 days of inactivity.
 *
 * @param {string} tipsterHash - hashedOwnerId of the submitting tipster
 * @param {string} franchiseId - franchise the tipster picked from the dropdown
 * @param {import('@upstash/redis').Redis} redis
 * @returns {Promise<number>} new counter value, or 0 if redis missing / no-op
 */
export async function incrementNamingTarget(tipsterHash, franchiseId, redis) {
  if (!redis || !tipsterHash || !franchiseId) return 0;
  const key = buildKey(tipsterHash, franchiseId);
  const next = await redis.incr(key);
  // EXPIRE on first observation only — re-applying it on every INCR would
  // reset the rolling-30d window and let a determined tipster keep their
  // counter alive forever via small bursts. Only set TTL when the counter
  // just crossed from missing → 1.
  if (next === 1) {
    await redis.expire(key, NAMING_RATE_LIMIT_TTL_SEC);
  }
  return Number.isFinite(next) ? next : 0;
}

/**
 * Returns true when this (tipster, target) pair has already used its cap of
 * MAX_EXPLICIT_PICKS_PER_TARGET picks in the current 30-day window. The
 * scanner reads this in anonymizeTips() to decide whether the tip carries
 * franchise-explicit-pick scope (false → name allowed) or division-fuzz
 * (true → demote to anonymous division reference).
 *
 * Counts strictly greater than the cap demote, NOT equal. With cap=2:
 *   count=1 → not over (first explicit pick of the window)
 *   count=2 → not over (second explicit pick — still within cap)
 *   count=3 → OVER (third+ pick demotes to division-fuzz)
 *
 * Returns `false` when redis is missing — fail open so a Redis outage
 * doesn't accidentally suppress every named-team post.
 *
 * @param {string} tipsterHash
 * @param {string} franchiseId
 * @param {import('@upstash/redis').Redis} redis
 * @returns {Promise<boolean>}
 */
export async function isOverNamingRateLimit(tipsterHash, franchiseId, redis) {
  if (!redis || !tipsterHash || !franchiseId) return false;
  const key = buildKey(tipsterHash, franchiseId);
  const raw = await redis.get(key);
  const count = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '0'), 10);
  if (!Number.isFinite(count) || count <= 0) return false;
  return count > MAX_EXPLICIT_PICKS_PER_TARGET;
}
