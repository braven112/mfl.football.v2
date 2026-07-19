/**
 * Schefter league DATA accessors — feed + team-config selection.
 *
 * Split from schefter-league.ts on purpose: these static JSON imports pull
 * ~1.3MB of feed data into the importing module's graph. Routes that only
 * need league RESOLUTION (tips-remaining, cooker-status, hot-topics, …)
 * import schefter-league.ts and never touch this file; only the routes that
 * actually read a feed/config (tip submit, thread, rumor-impression,
 * most-named, admin stats) pay for the JSON.
 *
 * Selection is a slug-keyed map that THROWS on an unknown league — matching
 * the repo's fail-loudly convention (schefter-leagues.mjs, per-league lore).
 * A third league added to the registry must be added here explicitly, not
 * silently served TheLeague's data.
 */

import type { LeagueDefinition } from '../config/leagues';
import theLeagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import theLeagueFeed from '../data/theleague/schefter-feed.json';
import aflFeed from '../../data/afl-fantasy/schefter-feed.json';
import type { SchefterFeed } from '../types/schefter';

export interface LeagueTeamConfig {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  division?: string;
  conference?: string;
  tier?: string;
}

export interface SchefterLeagueConfig {
  teams: LeagueTeamConfig[];
}

const FEEDS: Record<string, SchefterFeed> = {
  theleague: theLeagueFeed as unknown as SchefterFeed,
  'afl-fantasy': aflFeed as unknown as SchefterFeed,
};

const CONFIGS: Record<string, SchefterLeagueConfig> = {
  theleague: theLeagueConfig as unknown as SchefterLeagueConfig,
  'afl-fantasy': aflConfig as unknown as SchefterLeagueConfig,
};

/** The league's Schefter feed. Throws on a league this module doesn't know. */
export function getSchefterFeed(league: LeagueDefinition): SchefterFeed {
  const feed = FEEDS[league.slug];
  if (!feed) throw new Error(`getSchefterFeed: no feed wired for league "${league.slug}"`);
  return feed;
}

/** The league's team config. Throws on a league this module doesn't know. */
export function getSchefterLeagueConfig(league: LeagueDefinition): SchefterLeagueConfig {
  const config = CONFIGS[league.slug];
  if (!config) throw new Error(`getSchefterLeagueConfig: no config wired for league "${league.slug}"`);
  return config;
}

/** Find a team by 4-digit franchise id in the league's config. */
export function findLeagueTeam(
  league: LeagueDefinition,
  franchiseId: string,
): LeagueTeamConfig | undefined {
  return getSchefterLeagueConfig(league).teams.find(
    (t) => t.franchiseId === franchiseId,
  );
}
