/**
 * Schefter Reply Storage
 *
 * Stores replies in Upstash Redis using one hash per post.
 * Key: schefter:replies:{postId}
 * Fields: replyId → JSON(SchefterReply)
 *
 * Follows the suggestions-storage.ts pattern.
 */

import type { SchefterReply } from '../types/schefter-replies';

type RedisClient = {
  hget: <T>(key: string, field: string) => Promise<T | null>;
  hgetall: <T>(key: string) => Promise<Record<string, T> | null>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

const KEYS = {
  repliesPrefix: 'schefter:replies:',
  ratePrefix: 'schefter:reply-rate:',
} as const;

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[schefter-replies] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

export function generateReplyId(): string {
  return `sfr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Get all replies for a post, sorted chronologically */
export async function getRepliesForPost(postId: string): Promise<SchefterReply[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const all = await redis.hgetall<SchefterReply>(`${KEYS.repliesPrefix}${postId}`);
    if (!all || Object.keys(all).length === 0) return [];
    const replies = Object.values(all);
    replies.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return replies;
  } catch (err) {
    console.error('[schefter-replies] Failed to read replies:', err);
    return [];
  }
}

/** Get a single reply by ID */
export async function getReplyById(postId: string, replyId: string): Promise<SchefterReply | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    return await redis.hget<SchefterReply>(`${KEYS.repliesPrefix}${postId}`, replyId);
  } catch (err) {
    console.error('[schefter-replies] Failed to read reply:', err);
    return null;
  }
}

/** Save a reply to Redis */
export async function saveReply(reply: SchefterReply): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hset(`${KEYS.repliesPrefix}${reply.postId}`, { [reply.id]: reply });
    return true;
  } catch (err) {
    console.error('[schefter-replies] Failed to save reply:', err);
    return false;
  }
}

/** Rate limit: 10 replies per hour per franchise */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 3600;

export async function checkReplyRateLimit(franchiseId: string): Promise<{ allowed: boolean; count: number }> {
  const redis = await getRedis();
  if (!redis) return { allowed: true, count: 0 };

  try {
    const key = `${KEYS.ratePrefix}${franchiseId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW);
    }
    return { allowed: count <= RATE_LIMIT_MAX, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

/** Resolve team name and icon from config */
export async function resolveTeamInfo(franchiseId: string): Promise<{ name: string; icon: string }> {
  try {
    const config = await import('../data/theleague.config.json');
    const team = (config.default?.teams ?? config.teams ?? [])
      .find((t: { franchiseId: string; name: string; icon?: string }) => t.franchiseId === franchiseId);
    if (team) return { name: team.name, icon: team.icon ?? '' };
  } catch { /* use fallback */ }
  return { name: 'Unknown Team', icon: '' };
}
