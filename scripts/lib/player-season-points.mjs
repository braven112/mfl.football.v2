/**
 * Per-player season points from MFL `weeklyResults`, counted ONCE per week.
 *
 * THE BUG THIS EXISTS TO STOP
 * ---------------------------
 * In a doubleheader week a franchise plays two games, so MFL lists it in two
 * matchups — and lists its whole lineup, with the same scores, in both. Adding
 * up `matchup[].franchise[].player[].score` therefore bills one performance
 * twice for every doubleheader week in the range.
 *
 * TheLeague is not light on those: 2024 had FOUR (weeks 1, 2, 3 and 13), which
 * put Saquon Barkley's frozen week-1-to-14 total at 373.35 when MFL's own
 * per-week scores sum to 278.25 — the difference is exactly those four weeks a
 * second time. 2026 opened with one, so every week-1 total came out at 2x.
 * Those points feed the MVP page, the Dead Money awards ($ per point) and the
 * franchise-history salary awards, so the inflation was on screen, not buried.
 *
 * THE RULE
 * --------
 * A player scores once per week. The total is keyed by (player, week) and a
 * repeat within a week OVERWRITES rather than adds — the same shape
 * `src/utils/afl-keeper-analysis.ts` already uses for its season points.
 *
 * WHAT IT DELIBERATELY KEEPS
 * --------------------------
 * These are points scored WHILE ROSTERED IN THIS LEAGUE: `weeklyResults` only
 * lists a player for the weeks he sat on somebody's roster. A player picked up
 * in week 9 is credited from week 9. That is the existing meaning of the field
 * — salary efficiency is "what did the team paying him get" — and it is not
 * changed here. Only the double count is.
 */

const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

/**
 * The weekly entries in either shape MFL returns:
 * `W=YTD` → `{ allWeeklyResults: { weeklyResults: [...] } }`, and the committed
 * per-week feed → an array of `{ weeklyResults: {...} }` payloads.
 *
 * @param {any} payload
 * @returns {any[]}
 */
export function weeklyEntries(payload) {
  if (Array.isArray(payload)) {
    return payload.map((wk) => wk?.weeklyResults ?? wk).filter(Boolean);
  }
  return asArray(payload?.allWeeklyResults?.weeklyResults ?? payload?.weeklyResults);
}

/**
 * @param {any} payload `weeklyResults` in either shape (see `weeklyEntries`).
 * @param {number | null} [maxWeek] include weeks <= this only (the freeze week).
 * @returns {Map<string, number>} playerId → season points, each week counted once.
 */
export function buildPlayerPoints(payload, maxWeek = null) {
  const perPlayerWeek = new Map();
  weeklyEntries(payload).forEach((entry, index) => {
    const weekNumber =
      Number.parseInt(entry?.week ?? entry?.weekNumber ?? entry?.W ?? 0, 10) || 0;
    if (maxWeek && weekNumber > maxWeek) return;
    // An entry with no readable week still has to stay distinct from every
    // other entry; keying them all as week 0 would collapse a season into one
    // week and undercount instead of overcount. Its position is unique.
    const weekKey = weekNumber > 0 ? `w${weekNumber}` : `i${index}`;

    // Matchup franchises only, exactly as before: top-level (idle) franchise
    // blocks were never counted, and changing that is a different decision
    // from removing the double count.
    const franchises = asArray(entry?.matchup).flatMap((matchup) => asArray(matchup?.franchise));
    for (const franchise of franchises) {
      for (const player of asArray(franchise?.player)) {
        const id = player?.id;
        const score = Number.parseFloat(player?.score ?? 0);
        if (!id || Number.isNaN(score)) continue;
        // Overwrite, never add: the second sighting in a week is the same
        // performance listed under the franchise's other game.
        perPlayerWeek.set(`${id}|${weekKey}`, score);
      }
    }
  });

  const totals = new Map();
  for (const [key, score] of perPlayerWeek) {
    const id = key.slice(0, key.indexOf('|'));
    totals.set(id, (totals.get(id) ?? 0) + score);
  }
  return totals;
}
