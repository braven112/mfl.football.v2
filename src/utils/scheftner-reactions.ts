/**
 * Scheftner Reaction Storage
 *
 * Stores reactions in Upstash Redis using one hash per post.
 * Key: scheftner:reactions:{postId}
 * Fields: emoji → JSON array of franchiseIds
 *
 * Follows the contract-storage.ts Redis pattern.
 */

import { SCHEFTNER_REACTIONS } from '../types/scheftner';
import type { ScheftnerReactionMap, ScheftnerReactionResponse } from '../types/scheftner';

const KEY_PREFIX = 'scheftner:reactions:';

type RedisClient = {
  hget: <T>(key: string, field: string) => Promise<T | null>;
  hgetall: <T>(key: string) => Promise<Record<string, T> | null>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  hdel: (key: string, ...fields: string[]) => Promise<number>;
};

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
    console.warn('[scheftner-reactions] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

/** Validate that an emoji is in the allowed set */
export function isValidReaction(emoji: string): boolean {
  return (SCHEFTNER_REACTIONS as readonly string[]).includes(emoji);
}

/** Get all reactions for a post, with optional user highlight */
export async function getReactions(
  postId: string,
  userFranchiseId?: string,
): Promise<ScheftnerReactionResponse> {
  const redis = await getRedis();
  if (!redis) return { reactions: {}, userReaction: null };

  try {
    const all = await redis.hgetall<string[]>(KEY_PREFIX + postId);
    if (!all || Object.keys(all).length === 0) {
      return { reactions: {}, userReaction: null };
    }

    const reactions: Record<string, number> = {};
    let userReaction: string | null = null;

    for (const [emoji, franchiseIds] of Object.entries(all)) {
      const ids = Array.isArray(franchiseIds) ? franchiseIds : [];
      if (ids.length > 0) {
        reactions[emoji] = ids.length;
        if (userFranchiseId && ids.includes(userFranchiseId)) {
          userReaction = emoji;
        }
      }
    }

    return { reactions, userReaction };
  } catch (err) {
    console.error('[scheftner-reactions] Read error:', err);
    return { reactions: {}, userReaction: null };
  }
}

/** Get raw reaction map (franchiseIds per emoji) for a post */
export async function getReactionMap(postId: string): Promise<ScheftnerReactionMap> {
  const redis = await getRedis();
  if (!redis) return {};

  try {
    const all = await redis.hgetall<string[]>(KEY_PREFIX + postId);
    if (!all || Object.keys(all).length === 0) return {};

    const map: ScheftnerReactionMap = {};
    for (const [emoji, franchiseIds] of Object.entries(all)) {
      const ids = Array.isArray(franchiseIds) ? franchiseIds : [];
      if (ids.length > 0) map[emoji] = ids;
    }
    return map;
  } catch (err) {
    console.error('[scheftner-reactions] Read error:', err);
    return {};
  }
}

/**
 * Toggle a reaction for a user on a post.
 * - If the user has no reaction: add it
 * - If the user has the same reaction: remove it
 * - If the user has a different reaction: swap it
 *
 * Returns the user's new reaction (null if removed).
 */
export async function toggleReaction(
  postId: string,
  franchiseId: string,
  emoji: string,
): Promise<string | null> {
  if (!isValidReaction(emoji)) return null;

  const redis = await getRedis();
  if (!redis) return null;

  const key = KEY_PREFIX + postId;

  try {
    // Read all reactions for this post
    const all = await redis.hgetall<string[]>(key);
    const reactionMap: Record<string, string[]> = {};

    if (all) {
      for (const [e, ids] of Object.entries(all)) {
        reactionMap[e] = Array.isArray(ids) ? [...ids] : [];
      }
    }

    // Find user's current reaction (if any)
    let currentEmoji: string | null = null;
    for (const [e, ids] of Object.entries(reactionMap)) {
      if (ids.includes(franchiseId)) {
        currentEmoji = e;
        break;
      }
    }

    // Remove user from current reaction
    if (currentEmoji) {
      reactionMap[currentEmoji] = reactionMap[currentEmoji].filter(id => id !== franchiseId);
      if (reactionMap[currentEmoji].length === 0) {
        await redis.hdel(key, currentEmoji);
        delete reactionMap[currentEmoji];
      } else {
        await redis.hset(key, { [currentEmoji]: reactionMap[currentEmoji] });
      }
    }

    // If clicking the same emoji, just remove (toggle off)
    if (currentEmoji === emoji) {
      return null;
    }

    // Add user to new emoji
    const existing = reactionMap[emoji] ?? [];
    existing.push(franchiseId);
    await redis.hset(key, { [emoji]: existing });

    return emoji;
  } catch (err) {
    console.error('[scheftner-reactions] Toggle error:', err);
    return null;
  }
}
