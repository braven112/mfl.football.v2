/**
 * Suggestion Box Storage
 *
 * Stores ideas and comments in Upstash Redis using HSET per entity,
 * following the contract-storage.ts pattern for atomic writes.
 *
 * EVERY function here takes a `scope` (see ./suggestions-scope) and there is no
 * default: the board is per-league, and a defaulted scope is how one league's
 * ideas end up on another league's page. TheLeague's scope reproduces the
 * original unprefixed key strings byte-for-byte, so nothing written before the
 * AFL got a board needs migrating.
 *
 * Keys (TheLeague / every other league):
 *   sb:ideas               → Hash { ideaId: JSON(Idea) }        sb:{scope}:ideas
 *   sb:comments:{ideaId}   → Hash { commentId: JSON(Comment) }  sb:{scope}:comments:{ideaId}
 *   sb:ideas:activity      → Sorted Set (score=ms, member=ideaId)
 *   sb:last-seen           → Hash { franchiseId: ISO timestamp }
 *   sb:rate:{franchiseId}  → String + TTL for rate limiting
 *
 * `sb:last-seen` and `sb:rate:` are the two that were outright WRONG unscoped
 * rather than merely mixed: they key on franchiseId alone, and both leagues
 * have a franchise 0001, so AFL 0001 reading the board would have marked
 * TheLeague 0001's unread badge as read.
 */

import type { Idea, Comment } from '../types/suggestions';
import { getRedis } from './redis-client';
import {
  leagueSlugForSuggestionsScope,
  scopedBoardKey,
  type SuggestionsScope,
} from './suggestions-scope';
import { getLeagueTeamBrands } from './league-team-brands';

const BASE_KEYS = {
  ideas: 'sb:ideas',
  commentsPrefix: 'sb:comments:',
  activity: 'sb:ideas:activity',
  lastSeen: 'sb:last-seen',
  ratePrefix: 'sb:rate:',
} as const;

/** The five keys a board uses, resolved for one league. */
const keys = (scope: SuggestionsScope) => ({
  ideas: scopedBoardKey(BASE_KEYS.ideas, scope),
  activity: scopedBoardKey(BASE_KEYS.activity, scope),
  lastSeen: scopedBoardKey(BASE_KEYS.lastSeen, scope),
  comments: (ideaId: string) =>
    scopedBoardKey(`${BASE_KEYS.commentsPrefix}${ideaId}`, scope),
  rate: (franchiseId: string) =>
    scopedBoardKey(`${BASE_KEYS.ratePrefix}${franchiseId}`, scope),
});

export function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// ── Ideas ──

export async function getAllIdeas(scope: SuggestionsScope): Promise<Idea[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const all = await redis.hgetall<Idea>(keys(scope).ideas);
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

export async function getIdeaById(scope: SuggestionsScope, id: string): Promise<Idea | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    return await redis.hget<Idea>(keys(scope).ideas, id);
  } catch (err) {
    console.error('[suggestions] Failed to read idea:', err);
    return null;
  }
}

export async function saveIdea(scope: SuggestionsScope, idea: Idea): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  const k = keys(scope);
  try {
    await redis.hset(k.ideas, { [idea.id]: idea });
    // Update activity sorted set
    const ts = new Date(idea.lastActivityAt).getTime();
    await redis.zadd(k.activity, { score: ts, member: idea.id });
    return true;
  } catch (err) {
    console.error('[suggestions] Failed to save idea:', err);
    return false;
  }
}

export async function deleteIdea(scope: SuggestionsScope, id: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hdel(keys(scope).ideas, id);
    // Also delete all comments for this idea
    const commentsKey = keys(scope).comments(id);
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

export async function getCommentsForIdea(scope: SuggestionsScope, ideaId: string): Promise<Comment[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const all = await redis.hgetall<Comment>(keys(scope).comments(ideaId));
    if (!all || Object.keys(all).length === 0) return [];
    const comments = Object.values(all);
    comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return comments;
  } catch (err) {
    console.error('[suggestions] Failed to read comments:', err);
    return [];
  }
}

export async function getCommentById(scope: SuggestionsScope, ideaId: string, commentId: string): Promise<Comment | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    return await redis.hget<Comment>(keys(scope).comments(ideaId), commentId);
  } catch (err) {
    console.error('[suggestions] Failed to read comment:', err);
    return null;
  }
}

export async function saveComment(scope: SuggestionsScope, comment: Comment): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hset(keys(scope).comments(comment.ideaId), { [comment.id]: comment });
    return true;
  } catch (err) {
    console.error('[suggestions] Failed to save comment:', err);
    return false;
  }
}

export async function deleteComment(scope: SuggestionsScope, ideaId: string, commentId: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    await redis.hdel(keys(scope).comments(ideaId), commentId);
    return true;
  } catch (err) {
    console.error('[suggestions] Failed to delete comment:', err);
    return false;
  }
}

// ── Rate Limiting ──

const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW = 3600; // 1 hour

export async function checkRateLimit(scope: SuggestionsScope, franchiseId: string): Promise<{ allowed: boolean; count: number }> {
  const redis = await getRedis();
  if (!redis) return { allowed: true, count: 0 };

  try {
    const key = keys(scope).rate(franchiseId);
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

export async function getLastSeen(scope: SuggestionsScope, franchiseId: string): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    return await redis.hget<string>(keys(scope).lastSeen, franchiseId);
  } catch {
    return null;
  }
}

export async function setLastSeen(scope: SuggestionsScope, franchiseId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.hset(keys(scope).lastSeen, { [franchiseId]: new Date().toISOString() });
  } catch (err) {
    console.error('[suggestions] Failed to set last-seen:', err);
  }
}

export async function getIdeasWithActivitySince(scope: SuggestionsScope, since: string): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const sinceMs = new Date(since).getTime();
    return await redis.zrangebyscore(keys(scope).activity, sinceMs, '+inf');
  } catch {
    return [];
  }
}

/**
 * Team name for a franchise, in the league whose board this is.
 *
 * Was a hardcoded import of TheLeague's config, which on the AFL's board would
 * have stamped every post with a TheLeague team's name — both leagues have a
 * franchise 0001, so it would have resolved to a real (wrong) name rather than
 * failing visibly. `getLeagueTeamBrands` reads whichever league's config the
 * scope names.
 */
export function resolveTeamName(scope: SuggestionsScope, franchiseId: string): string {
  const brands = getLeagueTeamBrands(leagueSlugForSuggestionsScope(scope));
  return brands[franchiseId]?.name ?? 'Unknown Team';
}
