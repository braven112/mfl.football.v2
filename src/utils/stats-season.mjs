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
 *    — NFL week 1 kickoff, `nflWeekOneKickoff` — the same gate the Pecking
 *    Order, Schefter and the release blackout already use. Before kickoff the
 *    answer is last season's finished total; from kickoff on it is this
 *    season's running total.
 *
 *    Note this is NOT `isSeasonWindowOpen`: that window CLOSES 20 weeks after
 *    kickoff, and from February to Labor Day we still want the season that
 *    just finished rather than the one before it. Only the opening edge moves
 *    the answer here.
 *
 * 2. THE SOURCE COULD NOT SEE FREE AGENTS.
 *    Totals were summed from `weekly-results-raw.json`, which records a score
 *    only for the weeks a player sat on somebody's roster — so the free-agent
 *    pool, the entire subject of the page, was structurally invisible and
 *    rendered as a column of dashes. `TYPE=playerScores&W=YTD` is the only
 *    full-pool source (see docs/claude/insights/domains/mfl-api.md, 2026-08-10);
 *    it is committed per league-year as `playerScores-ytd.json`.
 */

import { nflWeekOneKickoff } from './pecking-order-season-window.mjs';

/**
 * The season whose point totals belong on screen right now.
 *
 * @param {number} currentSeasonYear `getCurrentSeasonYear()` — the Labor Day
 *   clock's answer. Passed in rather than imported because the one
 *   implementation lives in TypeScript (`src/utils/league-year.ts`) and node
 *   build scripts cannot import it; they carry a documented port.
 * @param {Date} [now]
 * @returns {number}
 */
export function resolveStatsSeasonYear(currentSeasonYear, now = new Date()) {
  return now >= nflWeekOneKickoff(currentSeasonYear) ? currentSeasonYear : currentSeasonYear - 1;
}

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
    if (!row?.id) continue;
    const score = parseFloat(row.score);
    // Exact zero is dropped, anything else kept. MFL lists every player it has
    // ever scored, so the pool is mostly 0.00 rows for people who have not
    // played — those read better as "no data" than as a column of zeroes.
    // NEGATIVES are kept on purpose: a defense can finish a season below zero,
    // and that is a real total, not a missing one.
    if (Number.isFinite(score) && score !== 0) map.set(String(row.id), score);
  }
  return map;
}
