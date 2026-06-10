/**
 * Shared per-franchise rate limiter (Redis fixed window).
 *
 * Mirrors the pattern proven in api/rules-qa.ts: INCR a per-franchise key,
 * set the TTL on first increment, reject once the count exceeds the cap.
 * Fails open if Redis is unavailable — these limits protect LLM spend,
 * not data integrity, and the endpoints already require authentication.
 */

type RedisClient = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};

let loggedMissingRedis = false;

async function getRedis(): Promise<RedisClient | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token }) as unknown as RedisClient;
  } catch (error) {
    if (!loggedMissingRedis) {
      loggedMissingRedis = true;
      console.warn('[rate-limit] Redis unavailable:', error);
    }
    return null;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests made in the current window (0 if Redis unavailable) */
  count: number;
}

/**
 * Check and consume one request against a fixed-window rate limit.
 *
 * @param scope    Namespace for the limit, e.g. 'ai-reply' or 'groupme-rewrite'
 * @param id       Caller identity — use the franchiseId from the session
 * @param max      Max requests per window
 * @param windowSeconds  Window length in seconds
 */
export async function checkRateLimit(
  scope: string,
  id: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const redis = await getRedis();
    if (!redis) return { allowed: true, count: 0 };

    const key = `rate:${scope}:${id}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return { allowed: count <= max, count };
  } catch (e) {
    console.warn(`[rate-limit] check failed for ${scope}:`, e);
    return { allowed: true, count: 0 };
  }
}
