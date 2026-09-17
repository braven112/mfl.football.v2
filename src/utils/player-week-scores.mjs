/**
 * Per-week, FULL-POOL fantasy scores — the source that can see a player nobody
 * rostered.
 *
 * WHY THIS EXISTS. Every weekly-score reader in this repo ultimately walks
 * `weekly-results-raw.json`, which is MFL's `TYPE=weeklyResults` export. That
 * export lists a franchise's ACTIVE lineup for the week and nothing else, so
 * three populations are structurally invisible in it:
 *
 *   - free agents (never on a roster at all),
 *   - practice-squad / taxi-squad players (rostered, not in the lineup),
 *   - injured-reserve players (same).
 *
 * In TheLeague's 2026 feeds that is 44 of 45 TAXI_SQUAD players and 11 of 15
 * INJURED_RESERVE players missing outright, plus the entire free-agent pool —
 * which is why `PlayerDetailsModal`'s Season Results table simply did not
 * render for them. The section hid itself and the modal looked like the player
 * had never played.
 *
 * `TYPE=playerScores&W=<n>` is the per-week twin of the `W=YTD` export that
 * `parseYtdPlayerScores` (src/utils/stats-season.mjs) already uses for the same
 * reason on the Free Agents pages: it scores EVERY player the league's rules
 * can score, roster status irrelevant. `scripts/fetch-mfl-feeds.mjs` commits it
 * per league-year as `playerScores-by-week.json`.
 *
 * WHAT IT CANNOT TELL YOU. These rows carry a player id and a number. There is
 * no franchise, no starter/non-starter status and no games-played field, so a
 * week filled in from here renders its points with an EMPTY status cell rather
 * than inventing an owner. `weekly-results-raw` stays the authority wherever it
 * has an answer; this is strictly the fallback for the weeks it cannot see.
 *
 * A NOTE ON ZERO. Every finite score is kept, 0 and negatives included — the
 * same rule `parseYtdPlayerScores` follows and for the same reason: a total MFL
 * reports as 0.00 is a total we know, and a defense can genuinely finish below
 * zero. The absence of a row is what means "no data".
 */

/** Weeks an NFL regular season can carry. Matches the fetch loop's range. */
export const MAX_SCORED_WEEK = 18;

/**
 * Reduce ONE raw MFL `playerScores` payload to `{ playerId: score }`.
 *
 * MFL answers a season with no games yet with a single blank placeholder row
 * (`{ id: '', score: '' }`), and serves a lone row unwrapped rather than as a
 * one-element array — both are handled here so callers never see either shape.
 *
 * @param {any} payload Parsed `TYPE=playerScores` response.
 * @returns {Record<string, number>} Empty when the payload carries no real rows.
 */
export function reduceWeekScores(payload) {
  const rows = payload?.playerScores?.playerScore;
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  /** @type {Record<string, number>} */
  const out = {};
  for (const row of list) {
    if (!row?.id) continue; // blank id === the placeholder row, never a player
    const score = parseFloat(row.score);
    if (Number.isFinite(score)) out[String(row.id)] = score;
  }
  return out;
}

/**
 * The week number a raw MFL `playerScores` payload is describing.
 *
 * Read from the payload, never derived from the calendar. A W-less request is
 * precisely a request for MFL to name its own current week, and the repo's rule
 * on week boundaries (docs/claude/rules/schedule-optimization.md, "The NFL
 * kickoff is not a derivation") applies to this one too.
 *
 * @param {any} payload
 * @returns {number | null} null when MFL did not name a usable week (e.g. YTD).
 */
export function weekOfScores(payload) {
  const raw = payload?.playerScores?.week;
  const week = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(week) && week >= 1 && week <= MAX_SCORED_WEEK ? week : null;
}

/**
 * playerId → { week: score }, from a committed `playerScores-by-week.json`.
 *
 * The file's shape is `{ weeks: { "<week>": { "<playerId>": score } } }` —
 * keyed by week first because that is the unit the fetch loop writes and
 * refreshes, and because it keeps the committed file small (a player id is
 * stored once per week it scored, not once per week of the season).
 *
 * @param {any} file Parsed `playerScores-by-week.json`, or null/undefined.
 * @returns {Map<string, Record<number, number>>} Empty when the file is absent.
 */
export function parsePlayerWeekScores(file) {
  /** @type {Map<string, Record<number, number>>} */
  const byPlayer = new Map();
  const weeks = file?.weeks;
  if (!weeks || typeof weeks !== 'object') return byPlayer;

  for (const [weekKey, scores] of Object.entries(weeks)) {
    const week = Number.parseInt(weekKey, 10);
    if (!Number.isInteger(week) || week < 1 || week > MAX_SCORED_WEEK) continue;
    if (!scores || typeof scores !== 'object') continue;

    for (const [playerId, raw] of Object.entries(scores)) {
      const score = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(score)) continue;
      let weekMap = byPlayer.get(playerId);
      if (!weekMap) {
        weekMap = {};
        byPlayer.set(playerId, weekMap);
      }
      weekMap[week] = score;
    }
  }

  return byPlayer;
}
