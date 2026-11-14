/**
 * The beat reporter's public feed: the posts it is safe to show OFF this site.
 *
 * Read by `/api/schefter/public-feed`, which an outside page (the owner's
 * portfolio) embeds to show what the AI beat reporter is filing. It shows only
 * the league's own NEWS — reported transactions and trades, milestones and the
 * weekly articles — and never anything a tipster sent in:
 *
 *   - `tier: 'rumor'` is the rumor mill and the trade-speculation lane, both
 *     built from tips or trade-block chatter. Out, whatever its type.
 *   - Any post carrying a tip field is out too, so a future lane that forgets
 *     to mark itself `rumor` still cannot leak a tip.
 *   - Only `transaction` and `article` posts pass. The ESPN wire, odds, Ask
 *     Roger and assistant replies are someone else's words, or not news.
 *
 * Only display fields leave: headline, a plain-text excerpt, time, kind and a
 * link back to the post on the league's own site. No franchise ids, player
 * ids, author ids or raw HTML.
 */

export interface PublicFeedPost {
  id: string;
  timestamp: string;
  kind: 'article' | 'move';
  headline: string;
  excerpt: string;
  /** League-local path to the post, e.g. `/theleague/news/<id>`. */
  path: string;
}

interface FeedPostLike {
  id?: unknown;
  timestamp?: unknown;
  type?: unknown;
  tier?: unknown;
  headline?: unknown;
  body?: unknown;
  [key: string]: unknown;
}

export const PUBLIC_FEED_MAX = 12;
const EXCERPT_CHARS = 240;

/** A key that names a tip, a tipster or a rumor source. */
const TIP_KEY_RE = /tip|rumou?r|speculat|anonymous/i;

export function isPublicNewsPost(post: FeedPostLike): boolean {
  if (!post || typeof post !== 'object') return false;
  if (post.type !== 'transaction' && post.type !== 'article') return false;
  if (post.tier === 'rumor') return false;
  if (Object.keys(post).some((k) => TIP_KEY_RE.test(k))) return false;
  return typeof post.id === 'string' && typeof post.headline === 'string' && typeof post.timestamp === 'string';
}

/** Plain text, entities decoded for the few the writers emit, whitespace folded. */
export function toPlainExcerpt(html: unknown, max = EXCERPT_CHARS): string {
  const text = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * Newest first, filtered and trimmed. `slug` is the league's registry slug,
 * used for the league-local path; the route turns it into an absolute URL.
 */
export function selectPublicFeed(
  posts: readonly FeedPostLike[] | undefined,
  slug: string,
  limit = 6,
): PublicFeedPost[] {
  const n = Math.max(1, Math.min(PUBLIC_FEED_MAX, Math.floor(limit) || 6));
  return (posts ?? [])
    .filter(isPublicNewsPost)
    .sort((a, b) => Date.parse(String(b.timestamp)) - Date.parse(String(a.timestamp)))
    .slice(0, n)
    .map((p) => {
      const id = String(p.id);
      const kind = p.type === 'article' ? 'article' : 'move';
      return {
        id,
        timestamp: String(p.timestamp),
        kind,
        headline: toPlainExcerpt(p.headline, 140),
        excerpt: toPlainExcerpt(p.body),
        path:
          kind === 'article'
            ? `/${slug}/news/${encodeURIComponent(id)}`
            : `/${slug}/news?post=${encodeURIComponent(id)}#post-${encodeURIComponent(id)}`,
      };
    });
}
