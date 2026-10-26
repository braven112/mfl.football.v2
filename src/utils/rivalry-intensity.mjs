/**
 * Rivalry math — the pure part, in plain .mjs so node scripts share it.
 *
 * `rivalries.ts` re-exports every symbol here with types, and is still the
 * file app code imports. The split exists because the schedule-release lock
 * script needs the SAME intensity ranking the rivalry pages show, and a node
 * script cannot import a .ts module — so the alternative was a second copy of
 * the formula, which is precisely how two surfaces end up disagreeing about
 * who a franchise's biggest rival is (the bug this module was extracted to
 * prevent in the first place).
 *
 * Nothing here reads a file, knows about a league, or decides which games
 * count: that is the head-to-head definition in league-history/rivalry.mjs
 * (`rivalryPairs`, `rivalEntries`, `rivalrySeries`), which every surface
 * reads. The tallies that used to live here walked franchise-history.json's
 * `matchupHistory`, which counted consolation games and stored each game twice,
 * and disagreed with the rivalry pages on most pairings (Oct 2026).
 */

/**
 * Meetings below this are one-off scheduling artifacts rather than a shared
 * history, and in a 24-team league they are the majority of pairings.
 */
export const MIN_RIVALRY_MEETINGS = 4;

/**
 * How charged a pairing is: an even record counts for more than a lopsided
 * one, volume and postseason meetings raise it, and the log keeps a franchise
 * that simply plays one division rival often from crowding out a genuinely
 * close series. Playoff meetings count triple.
 *
 * Every playoff meeting weighs the same here regardless of round. That is
 * deliberate for now — the AFL runs 9-15 brackets a season and MFL's archived
 * bracket metadata does not label which is the title game before 2024, so a
 * championship-vs-consolation tier would be guesswork for most of its history.
 */
export function rivalryIntensity(meetings, wins, losses, ties, playoffGames) {
  const totalDecided = wins + losses + ties;
  const closeness = totalDecided > 0 ? 1 - Math.abs(wins - losses) / totalDecided : 0;
  return closeness * Math.log2(1 + meetings + playoffGames * 3);
}

/** Order-free key for a pairing, so `a-b` and `b-a` are the same series. */
export const rivalryPairKey = (a, b) => [a, b].sort().join('-');

/**
 * One series as a phrase — "25 meetings, Pigskins up 14-11".
 *
 * `series` is one entry of `rivalrySeries` (league-history/rivalry.mjs).
 * Returns null for a series marked `disputed`: no record to state. The
 * League History dataset has one game list and never marks one, but a caller
 * handing in a series from anywhere else must not get a record printed for a
 * pairing whose sources disagree.
 *
 * Needs both franchise ids because the stored record belongs to
 * `perspective`, which is whichever id sorts first and has nothing to do with
 * who is ahead. Formatting `wins`-`losses` at a call site without resolving
 * that ships a rivalry with the wrong team winning it — the single most
 * embarrassing thing this feature could get wrong in front of the chat.
 *
 * @param {object} series      one entry from `rivalrySeries`
 * @param {string} a           one franchise id in the pairing
 * @param {string} b           the other
 * @param {(id: string) => string} nameOf
 */
export function describeSeries(series, a, b, nameOf) {
  if (!series || series.disputed) return null;
  const { wins, losses, ties = 0, games, perspective } = series;
  const tail = ties > 0 ? `-${ties}` : '';
  const hi = Math.max(wins, losses);
  const lo = Math.min(wins, losses);
  if (wins === losses) return `${games} meetings, dead even at ${wins}-${losses}${tail}`;
  // `perspective` must be one of the two ids or the record cannot be
  // attributed at all. Falling through to a bare score beats naming
  // "undefined" as the team that leads the series.
  if (perspective !== a && perspective !== b) return `${games} meetings, ${hi}-${lo}${tail}`;
  const leader = wins > losses ? perspective : perspective === a ? b : a;
  const name = nameOf(leader);
  return name
    ? `${games} meetings, ${name} up ${hi}-${lo}${tail}`
    : `${games} meetings, ${hi}-${lo}${tail}`;
}
