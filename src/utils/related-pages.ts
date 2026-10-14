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
import { pageIcon } from './page-icon';

export interface RelatedPage {
  /** Unprefixed path of the promoted page. */
  path: string;
  title: string;
  /** One sentence: what it is and why you'd open it from here. */
  blurb: string;
  cta: string;
  /** Registry slugs that have this page; omit when every full-format league does. */
  only?: string[];
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
        cta: 'Plan my Sunday',
      },
      {
        path: '/broadcast',
        title: 'Live Scoring Broadcast',
        blurb: 'A hands-free scoreboard for the TV: every league you play in, with scores, projections and big plays as they happen.',
        cta: 'Open the TV board',
      },
    ],
  },
  '/standings': {
    heading: 'More on the race',
    pages: [
      { path: '/schedule', title: 'Schedule', blurb: "Who you've played, who's left, and every week's results across the league.", cta: 'See the schedule' },
      { path: '/playoffs', title: 'Playoffs', blurb: 'The bracket, the matchups and the road to the title.', cta: 'View the bracket' },
      { path: '/standings?view=all_play', title: 'Premier League', blurb: 'All-play standings: your record if you played every team every week.', cta: 'See all-play', only: ['afl-fantasy'] },
      { path: '/pecking-order', title: 'The Pecking Order', blurb: "Schefter's weekly power rankings, with trend arrows and awards.", cta: 'Read this week' },
      { path: '/division-strength', title: 'Division Strength', blurb: 'Which divisions have really been the gauntlet, season by season.', cta: 'Compare divisions' },
      { path: '/rivalries', title: 'Rivalries', blurb: 'Head-to-head records between every pair of teams, hottest rivalries first.', cta: 'See the rivalries' },
    ],
  },
  '/rosters': {
    heading: 'Plan ahead',
    pages: [
      { path: '/front-office', title: 'Front Office', blurb: "Next season's plan in one place: cap space, contracts and trades.", cta: 'Open the Front Office' },
      { path: '/keepers', title: 'Keepers', blurb: 'Declare the players you protect before the keeper deadline.', cta: 'Set my keepers', only: ['afl-fantasy'] },
      { path: '/keeper-analysis', title: 'Keeper Report Card', blurb: "Every keeper class graded in hindsight against this season's points.", cta: 'See the grades', only: ['afl-fantasy'] },
      { path: '/import-rankings', title: 'Import Rankings', blurb: 'Bring in rankings from the sites you trust to power your boards.', cta: 'Import rankings' },
    ],
  },
  '/players': {
    heading: 'More on the wire',
    pages: [
      { path: '/transactions', title: 'Transactions', blurb: "Every signing, waiver claim and drop around the league — see who's been grabbed before you bid.", cta: 'See the moves' },
      { path: '/import-rankings', title: 'Import Rankings', blurb: 'Bring in rankings from the sites you trust; they become a column on this page.', cta: 'Import rankings' },
    ],
  },
  '/franchises': {
    heading: 'League history',
    pages: [
      { path: '/records', title: 'Record Book', blurb: 'All-time records: biggest scores, blowouts, streaks and more.', cta: 'Open the record book', only: ['afl-fantasy'] },
      { path: '/rivalries', title: 'Rivalries', blurb: 'Head-to-head records between every pair of teams, hottest rivalries first.', cta: 'See the rivalries' },
      { path: '/activity', title: 'Owner Activity', blurb: 'Who visits the site, how often, and which pages get used.', cta: 'See the activity' },
    ],
  },
  '/rules': {
    heading: 'Questions about the rules?',
    pages: [
      { path: '/rules-chat', title: 'Ask Roger', blurb: 'Ask a rules question in plain English and get the answer with the section it comes from.', cta: 'Ask Roger' },
      { path: '/suggestions', title: 'The Board', blurb: 'Propose a rule change or a site idea, and see what everyone else has posted.', cta: 'Open the Board' },
      { path: '/about', title: 'About', blurb: 'How the league and this site came to be.', cta: 'Read more' },
    ],
  },
};

/**
 * Does this league have the page? Package leagues answer from their route
 * table (the deployed site has no src/pages to look in), best-ball leagues
 * are draft-only and carry none of these, and the full-format leagues
 * (TheLeague, the AFL) have every page listed above.
 */
export function leagueHasRelatedPage(slug: string, page: Pick<RelatedPage, 'path' | 'only'>): boolean {
  const league = getLeagueBySlug(slug);
  if (!league) return false;
  if (page.only && !page.only.includes(league.slug)) return false;
  const path = page.path;
  if (isPackageLeague(league)) return packageLeagueHasPath(league, path);
  return !league.bestBall;
}

/** The host page's related pages for one league, with hrefs resolved for the host. */
export function relatedPagesFor(
  hostPath: string,
  slug: string,
  hideLeaguePrefix: boolean,
): { heading: string; pages: (RelatedPage & { href: string; icon: string })[] } | null {
  const spot = RELATED_PAGES[hostPath];
  const league = getLeagueBySlug(slug);
  if (!spot || !league) return null;
  const pages = spot.pages
    .filter((p) => leagueHasRelatedPage(slug, p))
    .map((p) => ({
      ...p,
      href: resolveLeaguePath(ensureLeaguePrefix(league, p.path), hideLeaguePrefix),
      // The page's own icon, never one chosen here (src/utils/page-icon.ts).
      icon: pageIcon(p.path, league.slug),
    }));
  return pages.length ? { heading: spot.heading, pages } : null;
}
