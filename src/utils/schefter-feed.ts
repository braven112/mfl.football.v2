/**
 * Schefter Feed Utilities
 *
 * Read/write helpers for the Schefter feed JSON files.
 * Feed files live at:
 *   - src/data/theleague/schefter-feed.json
 *   - data/afl-fantasy/schefter-feed.json
 */

import type { SchefterFeed, SchefterPost } from '../types/schefter';

/** Get posts for a league, optionally filtered */
export function getFeedPosts(
  feed: SchefterFeed,
  options?: {
    limit?: number;
    franchiseId?: string;
    authorId?: string;
    type?: SchefterPost['type'];
    transactionSubType?: string;
  },
): SchefterPost[] {
  let posts = feed.posts;

  if (options?.authorId) {
    posts = posts.filter(p => (p.authorId ?? 'claude') === options.authorId);
  }

  if (options?.franchiseId) {
    posts = posts.filter(p => p.franchiseIds.includes(options.franchiseId!));
  }

  if (options?.type) {
    posts = posts.filter(p => p.type === options.type);
  }

  if (options?.transactionSubType) {
    posts = posts.filter(p => p.transactionSubType === options.transactionSubType);
  }

  if (options?.limit) {
    posts = posts.slice(0, options.limit);
  }

  return posts;
}

/** Group minor posts by date for collapsed display */
export function groupMinorPosts(posts: SchefterPost[]): {
  date: string;
  posts: SchefterPost[];
}[] {
  const groups = new Map<string, SchefterPost[]>();

  for (const post of posts) {
    if (post.tier !== 'minor') continue;
    const date = post.timestamp.slice(0, 10); // YYYY-MM-DD
    const group = groups.get(date) ?? [];
    group.push(post);
    groups.set(date, group);
  }

  return Array.from(groups.entries())
    .map(([date, posts]) => ({ date, posts }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Format a relative timestamp: "2h ago", "Yesterday", "Mar 15" */
export function formatRelativeTime(isoTimestamp: string, now?: Date): string {
  const date = new Date(isoTimestamp);
  const reference = now ?? new Date();
  const diffMs = reference.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Check if a sourceTimestamp already exists in the feed (dedup) */
export function isDuplicatePost(feed: SchefterFeed, sourceTimestamp: string): boolean {
  return feed.posts.some(p => p.sourceTimestamp === sourceTimestamp);
}

/**
 * Sub-types that get rumor-style card treatment: anonymous-namespace
 * reactions, impression tracking, and `sf-post--rumor` styling. Anything
 * narrower than rumor-style behavior (whisper-back, thread links) should
 * branch on `transactionSubType === 'rumor_mill'` directly — those are
 * tip-driven and tied to the anonymous tipster pipeline.
 */
const RUMOR_LIKE_SUB_TYPES = new Set(['rumor_mill', 'trade_speculation']);

export function isRumorLikePost(post: { type?: string; transactionSubType?: string }): boolean {
  if (post.type !== 'transaction') return false;
  if (!post.transactionSubType) return false;
  return RUMOR_LIKE_SUB_TYPES.has(post.transactionSubType);
}
