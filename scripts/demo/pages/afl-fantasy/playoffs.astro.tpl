---
/**
 * DEMO BUILD ONLY — copied over src/pages/afl-fantasy/playoffs.astro by
 * scripts/demo/build-demo-data.mjs, where the AFL's slot serves the fictional
 * 96-team big league (demo.mfl.football/bigleague/playoffs). The AFL's own
 * playoffs page is built around its two conferences and its NIT.
 */
import BigLeaguePlayoffsPage from '../../components/bigleague/BigLeaguePlayoffsPage.astro';
import aflConfig from '../../../data/afl-fantasy/afl.config.json';
import { feedsByYear } from '../../utils/afl-family-standings';
import { getLeagueBySlug } from '../../config/leagues';
import { getAuthUser, franchiseIdForLeague } from '../../utils/auth';

export const prerender = false;

const league = getLeagueBySlug('afl-fantasy')!;
const brackets = feedsByYear(import.meta.glob('../../../data/afl-fantasy/mfl-feeds/*/playoff-brackets.json', { eager: true }));
const standings = feedsByYear(import.meta.glob('../../../data/afl-fantasy/mfl-feeds/*/standings.json', { eager: true }));
const leagueFeeds = feedsByYear(import.meta.glob('../../../data/afl-fantasy/mfl-feeds/*/league.json', { eager: true }));
const years = [...standings.keys()].sort((a, b) => b - a);
const requested = Number(Astro.url.searchParams.get('year'));
const year = years.includes(requested) ? requested : years[0];
---

<BigLeaguePlayoffsPage
  league={league}
  config={aflConfig}
  year={year}
  years={years}
  bracketsFeed={brackets.get(year)}
  standingsFeed={standings.get(year)}
  leagueFeed={leagueFeeds.get(year)}
  franchiseId={franchiseIdForLeague(getAuthUser(Astro.request), league.id)}
/>
