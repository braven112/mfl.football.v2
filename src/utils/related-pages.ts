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
  '/standings': {
    heading: 'More on the race',
    pages: [
      { path: '/schedule', title: 'Schedule', blurb: "Who you've played, who's left, and every week's results across the league.", icon: 'scoreboard-2', cta: 'See the schedule' },
      { path: '/playoffs', title: 'Playoffs', blurb: 'The bracket, the matchups and the road to the title.', icon: 'champ', cta: 'View the bracket' },
      { path: '/standings?view=all_play', title: 'Premier League', blurb: 'All-play standings: your record if you played every team every week.', icon: 'premier-league', cta: 'See all-play', only: ['afl-fantasy'] },
      { path: '/pecking-order', title: 'The Pecking Order', blurb: "Schefter's weekly power rankings, with trend arrows and awards.", icon: 'rank', cta: 'Read this week' },
      { path: '/division-strength', title: 'Division Strength', blurb: 'Which divisions have really been the gauntlet, season by season.', icon: 'rank', cta: 'Compare divisions' },
      { path: '/rivalries', title: 'Rivalries', blurb: 'Head-to-head records between every pair of teams, hottest rivalries first.', icon: 'scoreboard-2', cta: 'See the rivalries' },
    ],
  },
  '/rosters': {
    heading: 'Plan ahead',
    pages: [
      { path: '/front-office', title: 'Front Office', blurb: "Next season's plan in one place: cap space, contracts and trades.", icon: 'wallet', cta: 'Open the Front Office' },
      { path: '/keepers', title: 'Keepers', blurb: 'Declare the players you protect before the keeper deadline.', icon: 'bookmark', cta: 'Set my keepers', only: ['afl-fantasy'] },
      { path: '/keeper-analysis', title: 'Keeper Report Card', blurb: "Every keeper class graded in hindsight against this season's points.", icon: 'history', cta: 'See the grades', only: ['afl-fantasy'] },
      { path: '/import-rankings', title: 'Import Rankings', blurb: 'Bring in rankings from the sites you trust to power your boards.', icon: 'clipboard', cta: 'Import rankings' },
    ],
  },
  '/players': {
    heading: 'Sharpen your board',
    pages: [
      { path: '/import-rankings', title: 'Import Rankings', blurb: 'Bring in rankings from the sites you trust; they become a column on this page.', icon: 'clipboard', cta: 'Import rankings' },
    ],
  },
  '/': {
    heading: 'Around the league',
    pages: [
      { path: '/top-players', title: 'Top Players', blurb: "Every player's weekly scores, season total and rank at his position, free agents included.", icon: 'bar-chart', cta: 'See the leaders' },
      { path: '/pecking-order', title: 'The Pecking Order', blurb: "Schefter's weekly power rankings, with trend arrows and awards.", icon: 'rank', cta: 'Read this week' },
      { path: '/calendar', title: 'League Calendar', blurb: 'Deadlines, drafts and every date that matters this season.', icon: 'calendar', cta: 'See the dates' },
    ],
  },
  '/franchises': {
    heading: 'League history',
    pages: [
      { path: '/records', title: 'Record Book', blurb: 'All-time records: biggest scores, blowouts, streaks and more.', icon: 'trophy', cta: 'Open the record book', only: ['afl-fantasy'] },
      { path: '/rivalries', title: 'Rivalries', blurb: 'Head-to-head records between every pair of teams, hottest rivalries first.', icon: 'scoreboard-2', cta: 'See the rivalries' },
      { path: '/activity', title: 'Owner Activity', blurb: 'Who visits the site, how often, and which pages get used.', icon: 'activity', cta: 'See the activity' },
    ],
  },
  '/rules': {
    heading: 'Questions about the rules?',
    pages: [
      { path: '/rules-chat', title: 'Ask Roger', blurb: 'Ask a rules question in plain English and get the answer with the section it comes from.', icon: 'gavel', cta: 'Ask Roger' },
      { path: '/suggestions', title: 'The Board', blurb: 'Propose a rule change or a site idea, and see what everyone else has posted.', icon: 'commenting', cta: 'Open the Board' },
      { path: '/about', title: 'About', blurb: 'How the league and this site came to be.', icon: 'info', cta: 'Read more' },
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
): { heading: string; pages: (RelatedPage & { href: string })[] } | null {
  const spot = RELATED_PAGES[hostPath];
  const league = getLeagueBySlug(slug);
  if (!spot || !league) return null;
  const pages = spot.pages
    .filter((p) => leagueHasRelatedPage(slug, p))
    .map((p) => ({ ...p, href: resolveLeaguePath(ensureLeaguePrefix(league, p.path), hideLeaguePrefix) }));
  return pages.length ? { heading: spot.heading, pages } : null;
}
