---
/**
 * DEMO BUILD ONLY — copied over src/pages/afl-fantasy/index.astro by
 * scripts/demo/build-demo-data.mjs, where the AFL's slot serves the fictional
 * 96-team big league (demo.mfl.football/bigleague/). The AFL's own homepage is
 * built around its two conferences.
 */
import BigLeagueHomePage from '../../components/bigleague/BigLeagueHomePage.astro';
import aflConfig from '../../../data/afl-fantasy/afl.config.json';
import { feedsByYear } from '../../utils/afl-family-standings';
import { getTierMembership } from '../../utils/afl-tier';
import { getLeagueBySlug } from '../../config/leagues';
import { getAuthUser, franchiseIdForLeague } from '../../utils/auth';

export const prerender = false;

const league = getLeagueBySlug('afl-fantasy')!;
const standings = feedsByYear(import.meta.glob('../../../data/afl-fantasy/mfl-feeds/*/standings.json', { eager: true }));
const leagueFeeds = feedsByYear(import.meta.glob('../../../data/afl-fantasy/mfl-feeds/*/league.json', { eager: true }));
const year = Math.max(...standings.keys(), 0);
---

<BigLeagueHomePage
  league={league}
  config={aflConfig}
  year={year}
  standingsFeed={standings.get(year)}
  leagueFeed={leagueFeeds.get(year)}
  tierMembership={getTierMembership(year)}
  franchiseId={franchiseIdForLeague(getAuthUser(Astro.request), league.id)}
/>
