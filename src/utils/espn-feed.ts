/**
 * ESPN Feed Integration — Fetches Adam Schefter's posts from ESPN's public API.
 *
 * Endpoint: site.web.api.espn.com/apis/v2/flex?contributor=adam-schefter
 * No auth required. Returns JSON with headline, body, date, and link.
 *
 * Used by scripts/scheftner-scan.mjs to merge ESPN posts into the feed.
 */

import type { ScheftnerPost } from '../types/scheftner';

/** ESPN API base URL for contributor content */
const ESPN_CONTRIBUTOR_URL =
  'https://site.web.api.espn.com/apis/v2/flex';

/** Parsed ESPN article from the API response */
export interface EspnArticle {
  /** ESPN article ID (e.g., "60a6d72262013") */
  id: string;
  /** Article headline / title */
  headline: string;
  /** Full text body */
  body: string;
  /** ISO 8601 publish timestamp */
  published: string;
  /** Full ESPN article URL */
  link: string;
}

/**
 * Fetch latest Adam Schefter posts from ESPN.
 * Returns parsed articles sorted newest-first.
 */
export async function fetchSchefterPosts(limit = 25): Promise<EspnArticle[]> {
  const url = new URL(ESPN_CONTRIBUTOR_URL);
  url.searchParams.set('contributor', 'adam-schefter');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('pubkey', 'contributor-page');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`ESPN API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return parseEspnResponse(data);
}

/**
 * Parse the ESPN API response into our article format.
 * The response uses a columnar layout — articles are in the middle column.
 */
function parseEspnResponse(data: Record<string, unknown>): EspnArticle[] {
  const articles: EspnArticle[] = [];

  // Navigate: columns[middlecolumn].items[contributor-page].feed.{0,1,2,...}
  const columns = (data as { columns?: Array<{ name?: string; items?: unknown[] }> }).columns;
  if (!Array.isArray(columns)) return articles;

  const middle = columns.find(c => c.name === 'middlecolumn');
  const contribItem = middle?.items?.find(
    (i: unknown) => (i as { type?: string }).type === 'contributor-page',
  ) as { feed?: Record<string, unknown> } | undefined;

  const feed = contribItem?.feed;
  if (!feed) return articles;

  // Feed uses numeric string keys: "0", "1", "2", ...
  for (const key of Object.keys(feed)) {
    if (!/^\d+$/.test(key)) continue;
    const article = parseEspnItem(feed[key] as Record<string, unknown>);
    if (article) articles.push(article);
  }

  // Sort newest first
  articles.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());
  return articles;
}

/** Parse a single ESPN feed item into an EspnArticle (or null if invalid) */
function parseEspnItem(item: Record<string, unknown>): EspnArticle | null {
  const id = item.id as string | undefined;
  const descriptions = item.descriptions as { headline?: string; title?: string } | undefined;
  const payload = item.payload as string | undefined;
  const dates = item.dates as { created?: string } | undefined;
  const links = item.links as Array<{ rels?: string[]; href?: string }> | undefined;

  if (!id || !descriptions?.headline || !dates?.created) return null;

  const webLink = links?.find(l => l.rels?.includes('web'));

  return {
    id,
    headline: descriptions.headline,
    body: payload ?? descriptions.headline,
    published: dates.created,
    link: webLink?.href ?? `https://www.espn.com/contributor/adam-schefter/${id}`,
  };
}

/**
 * Convert an ESPN article to a ScheftnerPost.
 * These are type: 'external' with authorId: 'adam-schefter'.
 */
export function espnToScheftnerPost(article: EspnArticle, league: 'theleague' | 'afl' = 'theleague'): ScheftnerPost {
  // Truncate body for feed display (first ~200 chars at sentence boundary)
  const excerpt = truncateAtSentence(article.body, 200);

  return {
    id: `espn_${article.id}`,
    timestamp: article.published,
    type: 'external',
    tier: 'standard',
    headline: article.headline,
    body: excerpt,
    link: article.link,
    linkLabel: 'Read on ESPN →',
    authorId: 'adam-schefter',
    franchiseIds: [], // External posts don't relate to league franchises
    league,
  };
}

/** Truncate text at a sentence boundary, appending "..." if truncated */
function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  // Find last sentence-ending punctuation before maxLen
  const chunk = text.slice(0, maxLen);
  const lastPeriod = Math.max(
    chunk.lastIndexOf('. '),
    chunk.lastIndexOf('! '),
    chunk.lastIndexOf('? '),
  );

  if (lastPeriod > maxLen * 0.4) {
    return chunk.slice(0, lastPeriod + 1);
  }

  // Fall back to word boundary
  const lastSpace = chunk.lastIndexOf(' ');
  return chunk.slice(0, lastSpace > 0 ? lastSpace : maxLen) + '...';
}
