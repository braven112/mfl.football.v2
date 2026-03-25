/**
 * Suggestion Box Storage
 *
 * Stores ideas and comments in Upstash Redis using HSET per entity,
 * following the contract-storage.ts pattern for atomic writes.
 *
 * Keys:
 *   sb:ideas              → Hash { ideaId: JSON(Idea) }
 *   sb:comments:{ideaId}  → Hash { commentId: JSON(Comment) }
 *   sb:ideas:activity      → Sorted Set (score=ms, member=ideaId)
 *   sb:last-seen           → Hash { franchiseId: ISO timestamp }
 *   sb:rate:{franchiseId}  → String + TTL for rate limiting
 */

import type { Idea, Comment } from '../types/suggestions';

type RedisClient = {
  hget: <T>(key: string, field: string) => Promise<T | null>;
  hgetall: <T>(key: string) => Promise<Record<string, T> | null>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
  zadd: (key: string, ...args: unknown[]) => Promise<number>;
  zrangebyscore: (key: string, min: number | string, max: number | string) => Promise<string[]>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

const KEYS = {
  ideas: 'sb:ideas',
  commentsPrefix: 'sb:comments:',
  activity: 'sb:ideas:activity',
  lastSeen: 'sb:last-seen',
  ratePrefix: 'sb:rate:',
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
    console.warn('[suggestions] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

export function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// ── Ideas ──

export async function getAllIdeas(): Promise<Idea[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const all = await redis.hgetall<Idea>(KEYS.ideas);
    if (!all || Object.keys(all).length === 0) return [];
    const ideas = Object.values(all);
    // Pinned first, then newest first
    ideas.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return ideas;
  } catch (err) {
    console.error('[suggestions] Failed to read ideas:', err);
    return [];
  }
}

export async function getIdeaById(id: string): Promise<Idea | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    return await redis.hget<Idea>(KEYS.ideas, id);
  } catch (err) {
    console.error('[suggestions] Failed to read idea:', err);
    return null;
  }
}

export async function saveIdea(idea: Idea): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hset(KEYS.ideas, { [idea.id]: idea });
    // Update activity sorted set
    const ts = new Date(idea.lastActivityAt).getTime();
    await redis.zadd(KEYS.activity, { score: ts, member: idea.id });
    return true;
  } catch (err) {
    console.error('[suggestions] Failed to save idea:', err);
    return false;
  }
}

export async function deleteIdea(id: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hdel(KEYS.ideas, id);
    // Also delete all comments for this idea
    const commentsKey = `${KEYS.commentsPrefix}${id}`;
    const comments = await redis.hgetall<Comment>(commentsKey);
    if (comments) {
      for (const commentId of Object.keys(comments)) {
        await redis.hdel(commentsKey, commentId);
      }
    }
    return true;
  } catch (err) {
    console.error('[suggestions] Failed to delete idea:', err);
    return false;
  }
}

// ── Comments ──

export async function getCommentsForIdea(ideaId: string): Promise<Comment[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const all = await redis.hgetall<Comment>(`${KEYS.commentsPrefix}${ideaId}`);
    if (!all || Object.keys(all).length === 0) return [];
    const comments = Object.values(all);
    comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return comments;
  } catch (err) {
    console.error('[suggestions] Failed to read comments:', err);
    return [];
  }
}

export async function getCommentById(ideaId: string, commentId: string): Promise<Comment | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    return await redis.hget<Comment>(`${KEYS.commentsPrefix}${ideaId}`, commentId);
  } catch (err) {
    console.error('[suggestions] Failed to read comment:', err);
    return null;
  }
}

export async function saveComment(comment: Comment): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hset(`${KEYS.commentsPrefix}${comment.ideaId}`, { [comment.id]: comment });
    return true;
  } catch (err) {
    console.error('[suggestions] Failed to save comment:', err);
    return false;
  }
}

export async function deleteComment(ideaId: string, commentId: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hdel(`${KEYS.commentsPrefix}${ideaId}`, commentId);
    return true;
  } catch (err) {
    console.error('[suggestions] Failed to delete comment:', err);
    return false;
  }
}

// ── Rate Limiting ──

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 3600; // 1 hour

export async function checkRateLimit(franchiseId: string): Promise<{ allowed: boolean; count: number }> {
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

// ── Activity Tracking ──

export async function getLastSeen(franchiseId: string): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    return await redis.hget<string>(KEYS.lastSeen, franchiseId);
  } catch {
    return null;
  }
}

export async function setLastSeen(franchiseId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.hset(KEYS.lastSeen, { [franchiseId]: new Date().toISOString() });
  } catch (err) {
    console.error('[suggestions] Failed to set last-seen:', err);
  }
}

export async function getIdeasWithActivitySince(since: string): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const sinceMs = new Date(since).getTime();
    return await redis.zrangebyscore(KEYS.activity, sinceMs, '+inf');
  } catch {
    return [];
  }
}

/** Look up team name from config by franchiseId */
export async function resolveTeamName(franchiseId: string): Promise<string> {
  try {
    const config = await import('../data/theleague.config.json');
    const team = (config.default?.teams ?? config.teams ?? [])
      .find((t: { franchiseId: string; name: string }) => t.franchiseId === franchiseId);
    if (team) return team.name;
  } catch { /* use fallback */ }
  return 'Unknown Team';
}
