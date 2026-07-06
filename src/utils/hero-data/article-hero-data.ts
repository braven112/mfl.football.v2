/**
 * Article Hero Data — pure selection for the waiver-pickup article hero.
 *
 * Mirrors how ArticleHero.astro picks its article (findArticle(posts,
 * 'waiver-pickup')): among article-type posts, prefer those from the last 7
 * days (else the newest 5), then the first whose headline matches
 * waiver/pickup/claim — falling back to the pool's first article. Exported as
 * a pure, fixture-testable function so the ArticleCompositeHero can select the
 * SAME article and cast that article's own player.
 *
 * The on-disk schefter-feed.json is cron-regenerated, so the live feed may not
 * carry a fresh waiver-pickup article with playerIds — this selector returns
 * the same article ArticleHero would show (or null), and the composite hero
 * decides whether it can cast from it.
 */

/** The minimal shape this selector needs off a Schefter post. */
export interface WaiverArticlePost {
  id?: string;
  type?: string;
  timestamp?: string;
  headline?: string;
  body?: string;
  link?: string;
  playerIds?: string[];
}

/** The selected article, normalized for the composite hero. */
export interface WaiverPickupArticle {
  id: string;
  headline: string;
  body: string;
  link?: string;
  playerIds: string[];
  /** ISO timestamp string, straight off the post. */
  timestamp: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const WAIVER_RE = /waiver|pickup|claim/i;

/**
 * Select the waiver-pickup article the homepage hero should feature.
 *
 * Same shape as ArticleHero's `findArticle(posts, 'waiver-pickup')`:
 *   1. Keep only `type === 'article'` posts.
 *   2. Prefer articles within 7 days of `referenceDate`; if none, use the
 *      first 5 articles (feed is newest-first).
 *   3. Return the first whose headline matches waiver/pickup/claim; else the
 *      pool's first article.
 *
 * @param posts - The Schefter feed's posts array (any/unknown-safe).
 * @param referenceDate - The effective "now" (drives the 7-day recency window).
 * @returns The normalized article, or null when no article exists.
 */
export function selectWaiverPickupArticle(
  posts: unknown,
  referenceDate: Date,
): WaiverPickupArticle | null {
  if (!Array.isArray(posts)) return null;

  const articles = posts.filter(
    (p): p is WaiverArticlePost => !!p && (p as WaiverArticlePost).type === 'article',
  );
  if (articles.length === 0) return null;

  const cutoff = referenceDate.getTime() - SEVEN_DAYS_MS;
  const recent = articles.filter((p) => {
    const ts = p.timestamp ? Date.parse(p.timestamp) : NaN;
    return Number.isFinite(ts) && ts > cutoff;
  });
  const pool = recent.length > 0 ? recent : articles.slice(0, 5);
  if (pool.length === 0) return null;

  const match = pool.find((p) => WAIVER_RE.test(p.headline ?? '')) ?? pool[0];
  if (!match) return null;

  return {
    id: match.id ?? '',
    headline: match.headline ?? 'Waiver report',
    body: match.body ?? '',
    link: match.link,
    playerIds: Array.isArray(match.playerIds) ? match.playerIds.map(String) : [],
    timestamp: match.timestamp ?? '',
  };
}
