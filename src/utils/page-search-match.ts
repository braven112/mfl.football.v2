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
