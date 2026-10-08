/**
 * Related pages — "depth" for the pages owners actually use.
 *
 * The owner's model (Oct 2026): the nav carries the handful of pages owners
 * open every week (see `nav-config.json#pinnedLinks`), and a less-used page is
 * promoted ON the popular page it belongs with, not given a nav link of its
 * own. Sunday Ticket and the broadcast board are game-day companions, so they
 * live at the bottom of Live Scoring. When a link comes out of the nav, its
 * page gets an entry here first, on the page where it is most relevant.
 *
 * Keyed by the HOST page's unprefixed path. Each entry is resolved per league:
 * a page the league does not have is dropped, so a card never links a 404.
 */
import { ensureLeaguePrefix, getLeagueBySlug } from '../config/leagues';
import { isPackageLeague, packageLeagueHasPath } from '../config/package-league-routes.mjs';
import { resolveLeaguePath } from './nav-utils';

export interface RelatedPage {
  /** Unprefixed path of the promoted page. */
  path: string;
  title: string;
  /** One sentence: what it is and why you'd open it from here. */
  blurb: string;
  /** Sprite icon id. */
  icon: string;
  cta: string;
}

export interface RelatedPagesSpot {
  heading: string;
  pages: RelatedPage[];
}

export const RELATED_PAGES: Record<string, RelatedPagesSpot> = {
  '/live-scoring': {
    heading: 'More for game day',
    pages: [
      {
        path: '/sunday-ticket',
        title: 'Sunday Ticket',
        blurb: 'The four NFL games to put on your multiview each window, ranked by how many of your starters are playing.',
        icon: 'nfl',
        cta: 'Plan my Sunday',
      },
      {
        path: '/broadcast',
        title: 'Live Scoring Broadcast',
        blurb: 'A hands-free scoreboard for the TV: every league you play in, with scores, projections and big plays as they happen.',
        icon: 'scoreboard',
        cta: 'Open the TV board',
      },
    ],
  },
};

/**
 * Does this league have the page? Package leagues answer from their route
 * table (the deployed site has no src/pages to look in), best-ball leagues
 * are draft-only and carry none of these, and the full-format leagues
 * (TheLeague, the AFL) have every page listed above.
 */
export function leagueHasRelatedPage(slug: string, path: string): boolean {
  const league = getLeagueBySlug(slug);
  if (!league) return false;
  if (isPackageLeague(league)) return packageLeagueHasPath(league, path);
  return !league.bestBall;
}

/** The host page's related pages for one league, with hrefs resolved for the host. */
export function relatedPagesFor(
  hostPath: string,
  slug: string,
  hideLeaguePrefix: boolean,
): { heading: string; pages: (RelatedPage & { href: string })[] } | null {
  const spot = RELATED_PAGES[hostPath];
  const league = getLeagueBySlug(slug);
  if (!spot || !league) return null;
  const pages = spot.pages
    .filter((p) => leagueHasRelatedPage(slug, p.path))
    .map((p) => ({ ...p, href: resolveLeaguePath(ensureLeaguePrefix(league, p.path), hideLeaguePrefix) }));
  return pages.length ? { heading: spot.heading, pages } : null;
}
