/**
 * Schefter player-mention matching — pure helper behind
 * /api/schefter/player-mentions (player modal "Schefter Report" section).
 *
 * A post mentions a player when its `playerIds` array carries the MFL id
 * (transactions, rumor-mill posts) OR the player's full name appears in the
 * headline/body (wire posts and articles, which don't tag playerIds).
 * Matching is by FULL name only — last-name matching is too noisy across a
 * 2000-player pool.
 */

import type { SchefterPost } from '../types/schefter';

export interface PlayerMentionQuery {
  /** MFL player id (matches SchefterPost.playerIds) */
  playerId?: string | null;
  /** Display name — accepts "First Last" or MFL's "Last, First" */
  playerName?: string | null;
}

export interface PlayerMention {
  id: string;
  timestamp: string;
  type: string;
  tier: string;
  headline: string;
  /** Body excerpt; empty when the body just repeats the headline */
  excerpt: string;
  /** External link (wire posts) — internal posts permalink client-side */
  link: string | null;
}

const EXCERPT_MAX = 180;

/** "Mahomes, Patrick" → "Patrick Mahomes"; passthrough otherwise. */
export function normalizePlayerName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  const commaMatch = trimmed.match(/^([^,]+),\s*(.+)$/);
  if (commaMatch) return `${commaMatch[2]} ${commaMatch[1]}`.trim();
  return trimmed;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary matcher for the full name. Tokens are joined with \s+ so
 * "Ja'Marr  Chase" (double space) still matches, but "Joshua Allende" never
 * matches "Josh Allen".
 */
export function buildNameMatcher(name: string): RegExp | null {
  const normalized = normalizePlayerName(name);
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 2) return null; // single token = last-name-only; too noisy
  const pattern = tokens.map(escapeRegExp).join('\\s+');
  return new RegExp(`(?:^|[^A-Za-z])${pattern}(?:[^A-Za-z]|$)`, 'i');
}

function toExcerpt(post: SchefterPost): string {
  const body = (post.body ?? '').replace(/\s+/g, ' ').trim();
  const headline = (post.headline ?? '').replace(/\s+/g, ' ').trim();
  if (!body || body === headline) return '';
  if (body.length <= EXCERPT_MAX) return body;
  return body.slice(0, EXCERPT_MAX - 1).trimEnd() + '…';
}

/**
 * Posts mentioning the player, capped at `limit`. League-origin posts
 * (transactions, rumor mill, articles) rank ahead of external wire posts —
 * wire items are ESPN stories that largely duplicate the modal's "Latest
 * News" section, while league mentions are the content only this feed has.
 * Within each group, feed order (newest first) is preserved.
 */
export function findPlayerMentions(
  posts: SchefterPost[],
  query: PlayerMentionQuery,
  limit: number,
): PlayerMention[] {
  const playerId = query.playerId?.trim() || null;
  const matcher = query.playerName ? buildNameMatcher(query.playerName) : null;
  if (!playerId && !matcher) return [];

  const leagueMentions: PlayerMention[] = [];
  const wireMentions: PlayerMention[] = [];
  for (const post of posts) {
    if (leagueMentions.length >= limit) break;

    const byId = !!playerId && Array.isArray(post.playerIds) && post.playerIds.includes(playerId);
    const byName =
      !byId && !!matcher && matcher.test(`${post.headline ?? ''} ${post.body ?? ''}`);
    if (!byId && !byName) continue;

    const mention: PlayerMention = {
      id: post.id,
      timestamp: post.timestamp,
      type: post.type,
      tier: post.tier,
      headline: post.headline,
      excerpt: toExcerpt(post),
      link: post.link ?? null,
    };
    if (post.type === 'external') wireMentions.push(mention);
    else leagueMentions.push(mention);
  }
  return leagueMentions.concat(wireMentions).slice(0, limit);
}
