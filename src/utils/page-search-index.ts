/**
 * The searchable page index for one league — ONE builder behind both search
 * surfaces: the /search page (SearchPage.astro, rendered server-side) and the
 * header's inline search (HeaderSearch.astro, fetched from /api/page-search
 * the first time the box opens, so no page pays for the index until asked).
 *
 * page-directory.json is ONE global list shared by every league, so it is
 * scoped with pathBelongsToLeague() first — without that, the AFL's search
 * lists TheLeague's contracts pages, every one of which 404s there. Hrefs go
 * through resolveDirectoryHref() for the same reason: directory paths are
 * inconsistently prefixed by design (tests/stats-hub-links.test.ts).
 *
 * Ranking is by REAL use (src/utils/page-usage.ts); the hand-set `popularity`
 * only breaks ties.
 */
import allPages from '../data/page-directory.json';
import { pathBelongsToLeague } from '../config/footer-config';
import { resolveDirectoryHref, resolveLeaguePath } from './nav-utils';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import { getPageUsage } from './page-usage';
import { canonicalPath } from './site-analytics';

export interface PageSearchEntry {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: string;
  category: string;
  tags: string[];
  admin: boolean;
  /** title + description + tags + category, lowercased — what a query matches. */
  search: string;
  /** 0 = most used. */
  rank: number;
}

/** Entries in DIRECTORY order, each carrying its usage rank. */
export async function buildPageSearchIndex(
  leagueSlug: CanonicalLeagueSlug,
  { isAdmin, hideLeaguePrefix }: { isAdmin: boolean; hideLeaguePrefix: boolean },
): Promise<PageSearchEntry[]> {
  const navSlug = getLeagueBySlug(leagueSlug)?.navSlug ?? 'theleague';
  const thisLeaguePages = allPages.filter((p) => pathBelongsToLeague(p.path, leagueSlug));
  // Pages tagged "hidden" are for admins only.
  const pages = isAdmin ? thisLeaguePages : thisLeaguePages.filter((p) => !p.tags.includes('hidden'));

  const usage = await getPageUsage(leagueSlug);
  const views = (path: string) => usage.get(canonicalPath(path, leagueSlug)) ?? 0;
  const rank = new Map(
    [...pages]
      .sort((a, b) => views(b.path) - views(a.path) || b.popularity - a.popularity)
      .map((page, index) => [page.id, index]),
  );

  return pages.map((page) => ({
    id: page.id,
    title: page.title,
    description: page.description,
    href: resolveLeaguePath(resolveDirectoryHref(page.path, navSlug), hideLeaguePrefix),
    icon: page.icon,
    category: page.category,
    tags: page.tags,
    admin: page.visibility === 'admin',
    search: [page.title, page.description, ...page.tags, page.category].join(' ').toLowerCase(),
    rank: rank.get(page.id) ?? pages.length,
  }));
}
