/**
 * Query matching for site search, shared by the /search page and the header's
 * inline search. Kept apart from page-search-index.ts on purpose: that module
 * imports the whole page directory, and this one ships in client bundles.
 */

/**
 * The matches for a query. Every whitespace-separated word must appear
 * somewhere in the entry, so "draft order" finds Draft Order even when the
 * words are not adjacent in its tags. Pages whose TITLE holds every word come
 * first ("draft" should open on the Draft pages, not on the most-visited page
 * that mentions a draft in its description), then by usage rank.
 */
export function matchPages<T extends { search: string; rank: number; title?: string }>(
  entries: readonly T[],
  query: string,
): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const inTitle = (e: T) => (e.title ? words.every((w) => e.title!.toLowerCase().includes(w)) : false);
  return entries
    .filter((e) => words.every((w) => e.search.includes(w)))
    .map((e) => ({ e, title: inTitle(e) }))
    .sort((a, b) => Number(b.title) - Number(a.title) || a.e.rank - b.e.rank)
    .map(({ e }) => e);
}

/**
 * "Ask the History" for what is typed: the league's ask page with the query
 * as `?q=`, which that page asks on arrival. The ask page is found in the
 * league's own index (its page-directory entry), so a league without Ask the
 * History gets no row, and neither does a one- or two-word page search. `first`
 * puts the row on top, where Enter takes it: when the query reads as a
 * question, or nothing else matched.
 */
const QUESTION = /\?\s*$|^(who|what|when|where|which|why|how|has|have|had|did|does|do|is|was|were|are|can|most|fewest|least|best|worst|biggest|highest|lowest)\b/i;

export function askHistoryRow<T extends { href: string }>(
  entries: readonly T[] | null,
  query: string,
  otherHits: number,
): { href: string; first: boolean } | null {
  const q = query.trim();
  if (!q || !entries) return null;
  const ask = entries.find((e) => /\/history\/ask\/?$/.test(e.href.split('?')[0]));
  if (!ask) return null;
  // One or two words ("history", "rosters") are a page search, not a question.
  const question = q.split(/\s+/).length >= 3;
  if (!question) return null;
  return {
    href: `${ask.href.replace(/\/$/, '')}?q=${encodeURIComponent(q.slice(0, 300))}`,
    first: otherHits === 0 || QUESTION.test(q),
  };
}
