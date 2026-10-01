/**
 * Which leagues the weekly article runner writes for, and which article types
 * each one gets.
 *
 * A league absent from `TYPES_BY_LEAGUE` gets every type; a package league
 * lists the few it has bought. Archie's (archies) gets The Gauntlet only —
 * its chat is Slack and that column is the one thing posted there.
 *
 * Read by scripts/schefter-weekly-articles.mjs (rejects anything else) and by
 * tests/article-links.test.ts (checks only the combinations that can run).
 */

export const VALID_LEAGUES = ['theleague', 'afl-fantasy', 'archies'];

export const TYPES_BY_LEAGUE = {
  archies: ['schedule-strength'],
};

/** Whether `type` is written for `league`. */
export function leagueWritesType(league, type) {
  const only = TYPES_BY_LEAGUE[league];
  return !only || only.includes(type);
}
