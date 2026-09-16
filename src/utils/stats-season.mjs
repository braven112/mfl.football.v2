/**
 * Which season's points a player-stats column should be showing, and how to
 * read them out of MFL's full-pool scoring feed.
 *
 * TWO PROBLEMS, ONE MODULE — both were live on the Free Agents pages.
 *
 * 1. THE SEASON WAS PICKED ON THE WRONG CLOCK.
 *    The column read `getCurrentSeasonYear()`, which rolls at LABOR DAY. From
 *    Labor Day until kickoff that names a season with no games played, so the
 *    column emptied for the week owners care about it most (waiver season).
 *    The season that should be on screen turns over at the league's start day
 *    — NFL week 1 kickoff — which is exactly the rule the snap-count columns
 *    beside this one already resolved through `kickedOffSeason`
 *    (src/utils/snap-count-season.mjs). This module re-exports that rather than
 *    re-deriving it: GP / Snaps / Snap% and Pts sit next to each other, and two
 *    implementations of one season boundary is how they end up naming
 *    different years.
 *
 * 2. THE SOURCE COULD NOT SEE FREE AGENTS.
 *    Totals were summed from `weekly-results-raw.json`, which records a score
 *    only for the weeks a player sat on somebody's roster — so the free-agent
 *    pool, the entire subject of the page, was structurally invisible and
 *    rendered as a column of dashes. `TYPE=playerScores&W=YTD` is the only
 *    full-pool source (see docs/claude/insights/domains/mfl-api.md, 2026-08-10);
 *    it is committed per league-year as `playerScores-ytd.json`.
 */

import { kickedOffSeason } from './snap-count-season.mjs';

/**
 * The season whose point totals belong on screen right now.
 *
 * A re-export of `kickedOffSeason`, which the snap-count columns on these same
 * pages already use — one implementation, so the two columns can never answer
 * the boundary differently. Exported under this name so a points caller reads
 * as a points caller; it is the same function, not a wrapper.
 *
 * That guarantees the RULE is shared, not that two columns always print the
 * same year: the AFL's points are baked at build time while its snap columns
 * resolve per request, so between kickoff and the next deploy they can differ.
 * Which is why every one of these columns names its own season on screen.
 */
export const resolveStatsSeasonYear = kickedOffSeason;

/**
 * playerId → season-to-date fantasy points, from a `playerScores&W=YTD` payload.
 *
 * MFL answers a season with no games yet with a single blank placeholder row
 * (`{ id: '', score: '' }`), so "the file exists" is not "the file has data" —
 * every caller must treat an empty map as "no YTD data" and fall back.
 *
 * The payload carries totals with NO games-played field, so these cannot be
 * turned into a per-game rate. Anything rate-shaped needs its own denominator.
 *
 * @param {any} payload Parsed playerScores-ytd.json.
 * @returns {Map<string, number>}
 */
export function parseYtdPlayerScores(payload) {
  const rows = payload?.playerScores?.playerScore;
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const map = new Map();
  for (const row of list) {
    // A blank id is the placeholder row, never a player.
    if (!row?.id) continue;
    const score = parseFloat(row.score);
    // EVERY finite score is kept, including 0 and negatives. A total MFL
    // reports as 0.00 is a total we know; rendering it as "-" would claim we
    // have no data on a player we do. Dropping zeroes also made the rule
    // indefensible next to the negatives, which are kept because a defense can
    // genuinely finish a season below zero — if -4.4 is a real total, so is 0.
    if (Number.isFinite(score)) map.set(String(row.id), score);
  }
  return map;
}
