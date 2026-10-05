/**
 * Schefter league DATA accessors — feed + team-config selection.
 *
 * Split from schefter-league.ts on purpose: these eager JSON globs pull
 * ~1.3MB of feed data into the importing module's graph. Routes that only
 * need league RESOLUTION (tips-remaining, cooker-status, hot-topics, …)
 * import schefter-league.ts and never touch this file; only the routes that
 * actually read a feed/config (tip submit, thread, rumor-impression,
 * most-named, admin stats) pay for the JSON.
 *
 * Selection goes through the registry (`schefterFeedPath`, `configPath`) and
 * THROWS for a league without the `schefterFeed` feature — matching the
 * repo's fail-loudly convention, so a league is never silently served
 * TheLeague's data. A new league is wired by its registry entry alone.
 */

import type { LeagueDefinition } from '../config/leagues';
import { getLeagueConfig } from './league-config';
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

/** Every league's feed, keyed by the registry's `schefterFeedPath`. */
const FEED_FILES = import.meta.glob<SchefterFeed>(
  ['../../data/*/schefter-feed.json', '../data/*/schefter-feed.json'],
  { eager: true, import: 'default' },
);
const FEEDS_BY_PATH = new Map(
  Object.entries(FEED_FILES).map(([k, v]) => [
    k.startsWith('../../') ? k.slice('../../'.length) : `src/${k.slice('../'.length)}`,
    v,
  ]),
);

/** A league is wired here exactly when it runs the Schefter feed. */
function assertSchefterLeague(league: LeagueDefinition, fn: string): void {
  if (!league.features?.schefterFeed) {
    throw new Error(`${fn}: league "${league.slug}" does not run the Schefter feed`);
  }
}

/** The league's Schefter feed. Throws for a league without the schefterFeed feature. */
export function getSchefterFeed(league: LeagueDefinition): SchefterFeed {
  assertSchefterLeague(league, 'getSchefterFeed');
  const feed = FEEDS_BY_PATH.get((league as { schefterFeedPath?: string }).schefterFeedPath ?? '');
  if (!feed) throw new Error(`getSchefterFeed: no feed file for league "${league.slug}"`);
  return feed;
}

/** The league's team config. Throws for a league without the schefterFeed feature. */
export function getSchefterLeagueConfig(league: LeagueDefinition): SchefterLeagueConfig {
  assertSchefterLeague(league, 'getSchefterLeagueConfig');
  return getLeagueConfig(league.slug) as unknown as SchefterLeagueConfig;
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
