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
 * Nothing here reads a file or knows about a league; callers pass in
 * `matchupHistory` from `data/<league>/derived/franchise-history.json`.
 */

/**
 * Meetings below this are one-off scheduling artifacts rather than a shared
 * history, and in a 24-team league they are the majority of pairings.
 */
export const MIN_RIVALRY_MEETINGS = 4;

/** Meetings between two franchises under the current owners, oldest-first. */
export function currentOwnerMeetings(matchupHistory, opponentId) {
  return (matchupHistory?.[opponentId] ?? []).filter((m) => m.bothAttributed);
}

/** Win/loss/tie/playoff tallies for a list of meetings, from OUR perspective. */
export function tallyMeetings(meetings) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let playoffGames = 0;
  for (const m of meetings) {
    if (m.score > m.opponentScore) wins++;
    else if (m.score < m.opponentScore) losses++;
    else ties++;
    if (m.isPlayoff) playoffGames++;
  }
  return { wins, losses, ties, playoffGames };
}

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

/**
 * Rank every opponent a franchise shares enough history with, most intense
 * first. `selfId` is skipped: ownerHistory cross-attribution can leave a
 * franchise facing its own id when an owner changed slots mid-career.
 */
export function computeRivalEntries(matchupHistory, selfId, { minMeetings = MIN_RIVALRY_MEETINGS } = {}) {
  const entries = [];
  for (const opponentId of Object.keys(matchupHistory ?? {})) {
    if (opponentId === selfId) continue;
    const meetings = currentOwnerMeetings(matchupHistory, opponentId);
    if (meetings.length < minMeetings) continue;
    const { wins, losses, ties, playoffGames } = tallyMeetings(meetings);
    entries.push({
      opponentId,
      wins,
      losses,
      ties,
      games: meetings.length,
      playoffGames,
      intensity: rivalryIntensity(meetings.length, wins, losses, ties, playoffGames),
    });
  }
  entries.sort((a, b) => b.intensity - a.intensity);
  return entries;
}

/** Order-free key for a pairing, so `a-b` and `b-a` are the same series. */
export const rivalryPairKey = (a, b) => [a, b].sort().join('-');

/**
 * Every pairing's career series, keyed by `rivalryPairKey` — the shape the
 * schedule-release tease and Schefter's column both read.
 *
 * `describeSeries` below turns one of these into a sentence; use it rather
 * than formatting `wins`/`losses` at a call site, which is how a record ends
 * up printed from the wrong side.
 *
 * Built from `derived/franchise-history.json#franchises[].matchupHistory`,
 * which stores each meeting TWICE (once from each side). The record is
 * normalised to the alphabetically-first franchise's perspective so a pairing
 * reads the same whichever side is asked, and `games` counts each meeting once.
 *
 * @param {Record<string, {matchupHistory?: Record<string, any[]>}>} franchises
 */
export function rivalrySeriesByPair(franchises, { minMeetings = MIN_RIVALRY_MEETINGS } = {}) {
  const byPair = {};
  for (const [selfId, franchise] of Object.entries(franchises ?? {})) {
    for (const entry of computeRivalEntries(franchise?.matchupHistory, selfId, { minMeetings })) {
      const key = rivalryPairKey(selfId, entry.opponentId);
      // Keep the perspective of whichever id sorts first, so wins/losses are
      // not silently inverted depending on which side happened to be read last.
      if (byPair[key] && selfId !== key.split('-')[0]) continue;
      byPair[key] = {
        games: entry.games,
        playoffGames: entry.playoffGames,
        intensity: entry.intensity,
        /**
         * Whose wins/losses these are — the franchise whose id sorts first,
         * NOT whoever is ahead. Callers that print a record must name this
         * side, or flip it; "14-11" with no owner attached is a coin toss.
         */
        perspective: selfId,
        wins: entry.wins,
        losses: entry.losses,
        ties: entry.ties,
      };
    }
  }
  return byPair;
}

/**
 * One series as a phrase — "25 meetings, Pigskins up 14-11".
 *
 * Needs both franchise ids because the stored record belongs to
 * `perspective`, which is whichever id sorts first and has nothing to do with
 * who is ahead. Formatting `wins`-`losses` at a call site without resolving
 * that ships a rivalry with the wrong team winning it — the single most
 * embarrassing thing this feature could get wrong in front of the chat.
 *
 * @param {object} series      one entry from `rivalrySeriesByPair`
 * @param {string} a           one franchise id in the pairing
 * @param {string} b           the other
 * @param {(id: string) => string} nameOf
 */
export function describeSeries(series, a, b, nameOf) {
  if (!series) return null;
  const { wins, losses, ties = 0, games, perspective } = series;
  const tail = ties > 0 ? `-${ties}` : '';
  if (wins === losses) return `${games} meetings, dead even at ${wins}-${losses}${tail}`;
  const other = perspective === a ? b : a;
  const leader = wins > losses ? perspective : other;
  const hi = Math.max(wins, losses);
  const lo = Math.min(wins, losses);
  return `${games} meetings, ${nameOf(leader) || leader} up ${hi}-${lo}${tail}`;
}
