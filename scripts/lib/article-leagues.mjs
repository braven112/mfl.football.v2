/**
 * Which leagues the weekly article runner writes for, and which article types
 * each one gets — both read off the registry (src/config/leagues-data.mjs):
 *
 *   - every league with `features.schefterFeed` gets articles;
 *   - `articleTypes` on a registry entry limits it to those types; absent,
 *     the league gets every type. A package league lists the few it has
 *     bought (Archie's: The Gauntlet only — its chat is Slack and that column
 *     is the one thing posted there).
 *
 * Read by scripts/schefter-weekly-articles.mjs (rejects anything else) and by
 * tests/article-links.test.ts (checks only the combinations that can run).
 */
import { ALL_LEAGUES } from '../../src/config/leagues-data.mjs';

export const VALID_LEAGUES = ALL_LEAGUES.filter((l) => l.features?.schefterFeed).map((l) => l.slug);

export const TYPES_BY_LEAGUE = Object.fromEntries(
  ALL_LEAGUES.filter((l) => Array.isArray(l.articleTypes)).map((l) => [l.slug, l.articleTypes]),
);

/** Whether `type` is written for `league`. */
export function leagueWritesType(league, type) {
  const only = TYPES_BY_LEAGUE[league];
  return !only || only.includes(type);
}
