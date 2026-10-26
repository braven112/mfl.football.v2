/**
 * Schefter Reaction Storage
 *
 * Stores reactions in Upstash Redis using one hash per post.
 * Key: schefter:reactions:{postId}
 * Fields: emoji → JSON array of franchiseIds
 *
 * Follows the contract-storage.ts Redis pattern.
 *
 * The batch readers consult REACTED_POSTS_INDEX before touching a hash, so
 * any new write path must SADD the post there too or its reactions vanish
 * from every feed.
 */

import { SCHEFTER_REACTIONS, SCHEFTER_RUMOR_REACTIONS } from '../types/schefter';
import type { SchefterReactionMap, SchefterReactionResponse } from '../types/schefter';
import { getRedis } from './redis-client';
import { GLOBAL_SCHEFTER_NAMESPACES, REACTED_POSTS_INDEX } from '../../scripts/lib/schefter-keys.mjs';

// postId-keyed and shared across leagues by design — see schefter-keys.mjs.
const KEY_PREFIX = GLOBAL_SCHEFTER_NAMESPACES.reactions;
/**
 * Anonymous reactions key-space. Members are hashedOwnerId (same hash used for
 * tip identity) — never franchiseId. Used by rumor_mill posts to avoid
 * revealing "Pigskins reacted 🔥" signals that could correlate with tip patterns.
 */
const ANON_KEY_PREFIX = GLOBAL_SCHEFTER_NAMESPACES.reactionsAnon;

/**
 * Marks an index as complete. The index sets only start filling when this
 * code ships, so a set WITHOUT the marker may be missing posts reacted to
 * before then — the first reader seeds it from a SCAN and adds the marker.
 */
const INDEX_SEEDED = '__seeded__';

type IndexKind = keyof typeof REACTED_POSTS_INDEX;
type RedisLike = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

/**
 * Rebuild both index sets from the reaction hashes that exist. One-time: a
 * SCAN is one command per 1000 keys, against ~500 per feed view without it.
 * Idempotent, so two cold readers racing to seed is harmless.
 */
async function seedReactedIndex(redis: RedisLike): Promise<void> {
  const regular: string[] = [];
  const anon: string[] = [];
  let cursor: string | number = 0;
  do {
    const [next, keys] = await redis.scan(cursor, { match: `${KEY_PREFIX}*`, count: 1000 });
    for (const key of keys) {
      // The anon prefix nests inside the regular one, so test it first.
      if (key.startsWith(ANON_KEY_PREFIX)) anon.push(key.slice(ANON_KEY_PREFIX.length));
      else if (key.startsWith(KEY_PREFIX)) regular.push(key.slice(KEY_PREFIX.length));
    }
    cursor = next;
  } while (String(cursor) !== '0');
  await redis.sadd(REACTED_POSTS_INDEX.regular, INDEX_SEEDED, ...regular);
  await redis.sadd(REACTED_POSTS_INDEX.anon, INDEX_SEEDED, ...anon);
}

/**
 * The subset of `postIds` that has ever carried a reaction — the only posts
 * whose hash is worth reading. One SMEMBERS instead of one HGETALL per post.
 */
async function reactedAmong(redis: RedisLike, kind: IndexKind, postIds: string[]): Promise<string[]> {
  let members = await redis.smembers<string>(REACTED_POSTS_INDEX[kind]);
  if (!members.includes(INDEX_SEEDED)) {
    await seedReactedIndex(redis);
    members = await redis.smembers<string>(REACTED_POSTS_INDEX[kind]);
  }
  const reacted = new Set(members);
  return postIds.filter((id) => reacted.has(id));
}

/** Validate that an emoji is in the allowed set */
export function isValidReaction(emoji: string): boolean {
  return (SCHEFTER_REACTIONS as readonly string[]).includes(emoji);
}

/** Validate that an emoji is in the rumor-reaction subset (🔥 💯 🤔 📉) */
export function isValidRumorReactionEmoji(emoji: string): boolean {
  return (SCHEFTER_RUMOR_REACTIONS as readonly string[]).includes(emoji);
}

/** Get all reactions for a post, with optional user highlight */
export async function getReactions(
  postId: string,
  userFranchiseId?: string,
): Promise<SchefterReactionResponse> {
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
    console.error('[schefter-reactions] Read error:', err);
    return { reactions: {}, userReaction: null };
  }
}

/** Get raw reaction map (franchiseIds per emoji) for a post */
export async function getReactionMap(postId: string): Promise<SchefterReactionMap> {
  const redis = await getRedis();
  if (!redis) return {};

  try {
    const all = await redis.hgetall<string[]>(KEY_PREFIX + postId);
    if (!all || Object.keys(all).length === 0) return {};

    const map: SchefterReactionMap = {};
    for (const [emoji, franchiseIds] of Object.entries(all)) {
      const ids = Array.isArray(franchiseIds) ? franchiseIds : [];
      if (ids.length > 0) map[emoji] = ids;
    }
    return map;
  } catch (err) {
    console.error('[schefter-reactions] Read error:', err);
    return {};
  }
}

/**
 * Batch-fetch reactions for multiple posts in one Redis round-trip.
 * Returns a map of postId → { reactions, userReaction }.
 */
export async function getBatchReactions(
  postIds: string[],
  userFranchiseId?: string,
): Promise<Record<string, SchefterReactionResponse>> {
  const result: Record<string, SchefterReactionResponse> = {};
  if (postIds.length === 0) return result;

  const redis = await getRedis();
  if (!redis) {
    for (const id of postIds) result[id] = { reactions: {}, userReaction: null };
    return result;
  }

  try {
    for (const id of postIds) result[id] = { reactions: {}, userReaction: null };
    // Only posts the index names have a hash; reading the rest bills a
    // command each to learn nothing.
    const reacted = await reactedAmong(redis, 'regular', postIds);
    if (reacted.length === 0) return result;
    const pipeline = redis.pipeline();
    for (const postId of reacted) {
      pipeline.hgetall(KEY_PREFIX + postId);
    }
    const results = await pipeline.exec<(Record<string, string[]> | null)[]>();

    for (let i = 0; i < reacted.length; i++) {
      const postId = reacted[i];
      const all = results[i];

      if (!all || Object.keys(all).length === 0) {
        result[postId] = { reactions: {}, userReaction: null };
        continue;
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

      result[postId] = { reactions, userReaction };
    }
  } catch (err) {
    console.error('[schefter-reactions] Batch read error:', err);
    for (const id of postIds) {
      if (!result[id]) result[id] = { reactions: {}, userReaction: null };
    }
  }

  return result;
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
    await redis.sadd(REACTED_POSTS_INDEX.regular, postId);

    return emoji;
  } catch (err) {
    console.error('[schefter-reactions] Toggle error:', err);
    return null;
  }
}

// ── Anonymous reaction path (rumor-mill posts) ──
//
// Identical semantics to toggleReaction, but keyed on `hashedOwnerId` instead
// of `franchiseId`, and stored in a separate Redis namespace so the identified
// reaction data for non-rumor posts cannot accidentally leak into rumor surfaces.
// The response NEVER returns the hashedOwnerId list — only counts + whether
// the caller themselves reacted.

/**
 * Get anonymous reaction counts for a single rumor post.
 * Only the caller's own reaction is returned — never anyone else's identity.
 */
export async function getAnonymousReactions(
  postId: string,
  userHashedOwnerId?: string,
): Promise<SchefterReactionResponse> {
  const redis = await getRedis();
  if (!redis) return { reactions: {}, userReaction: null };

  try {
    const all = await redis.hgetall<string[]>(ANON_KEY_PREFIX + postId);
    if (!all || Object.keys(all).length === 0) {
      return { reactions: {}, userReaction: null };
    }

    const reactions: Record<string, number> = {};
    let userReaction: string | null = null;

    for (const [emoji, members] of Object.entries(all)) {
      const ids = Array.isArray(members) ? members : [];
      if (ids.length > 0) {
        reactions[emoji] = ids.length;
        if (userHashedOwnerId && ids.includes(userHashedOwnerId)) {
          userReaction = emoji;
        }
      }
    }

    return { reactions, userReaction };
  } catch (err) {
    console.error('[schefter-reactions] Anonymous read error:', err);
    return { reactions: {}, userReaction: null };
  }
}

/**
 * Batch-fetch anonymous reactions for multiple posts in one Redis round-trip.
 * Used by the news feed when rendering rumor_mill cards.
 */
export async function getBatchAnonymousReactions(
  postIds: string[],
  userHashedOwnerId?: string,
): Promise<Record<string, SchefterReactionResponse>> {
  const result: Record<string, SchefterReactionResponse> = {};
  if (postIds.length === 0) return result;

  const redis = await getRedis();
  if (!redis) {
    for (const id of postIds) result[id] = { reactions: {}, userReaction: null };
    return result;
  }

  try {
    for (const id of postIds) result[id] = { reactions: {}, userReaction: null };
    const reacted = await reactedAmong(redis, 'anon', postIds);
    if (reacted.length === 0) return result;
    const pipeline = redis.pipeline();
    for (const postId of reacted) {
      pipeline.hgetall(ANON_KEY_PREFIX + postId);
    }
    const results = await pipeline.exec<(Record<string, string[]> | null)[]>();

    for (let i = 0; i < reacted.length; i++) {
      const postId = reacted[i];
      const all = results[i];

      if (!all || Object.keys(all).length === 0) {
        result[postId] = { reactions: {}, userReaction: null };
        continue;
      }

      const reactions: Record<string, number> = {};
      let userReaction: string | null = null;

      for (const [emoji, members] of Object.entries(all)) {
        const ids = Array.isArray(members) ? members : [];
        if (ids.length > 0) {
          reactions[emoji] = ids.length;
          if (userHashedOwnerId && ids.includes(userHashedOwnerId)) {
            userReaction = emoji;
          }
        }
      }

      result[postId] = { reactions, userReaction };
    }
  } catch (err) {
    console.error('[schefter-reactions] Anonymous batch read error:', err);
    for (const id of postIds) {
      if (!result[id]) result[id] = { reactions: {}, userReaction: null };
    }
  }

  return result;
}

/**
 * Toggle an anonymous reaction for a user on a rumor post.
 * Rejects emoji outside the rumor-reaction subset.
 */
export async function toggleAnonymousReaction(
  postId: string,
  hashedOwnerId: string,
  emoji: string,
): Promise<string | null> {
  if (!isValidRumorReactionEmoji(emoji)) return null;

  const redis = await getRedis();
  if (!redis) return null;

  const key = ANON_KEY_PREFIX + postId;

  try {
    const all = await redis.hgetall<string[]>(key);
    const reactionMap: Record<string, string[]> = {};

    if (all) {
      for (const [e, members] of Object.entries(all)) {
        reactionMap[e] = Array.isArray(members) ? [...members] : [];
      }
    }

    let currentEmoji: string | null = null;
    for (const [e, ids] of Object.entries(reactionMap)) {
      if (ids.includes(hashedOwnerId)) {
        currentEmoji = e;
        break;
      }
    }

    if (currentEmoji) {
      reactionMap[currentEmoji] = reactionMap[currentEmoji].filter((id) => id !== hashedOwnerId);
      if (reactionMap[currentEmoji].length === 0) {
        await redis.hdel(key, currentEmoji);
        delete reactionMap[currentEmoji];
      } else {
        await redis.hset(key, { [currentEmoji]: reactionMap[currentEmoji] });
      }
    }

    if (currentEmoji === emoji) {
      return null;
    }

    const existing = reactionMap[emoji] ?? [];
    existing.push(hashedOwnerId);
    await redis.hset(key, { [emoji]: existing });
    await redis.sadd(REACTED_POSTS_INDEX.anon, postId);

    return emoji;
  } catch (err) {
    console.error('[schefter-reactions] Anonymous toggle error:', err);
    return null;
  }
}
