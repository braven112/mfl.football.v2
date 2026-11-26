/**
 * Games each NFL team has finished, counted from MFL's `nflSchedule` export
 * (the committed `nflSchedule-full.json`).
 *
 * Points allowed are season TOTALS, so a per-game average must divide by the
 * games a defense actually played. Dividing by completed weeks instead counts
 * a bye as a 0-point game and makes every team that has had its bye look
 * tougher than it is. A game counts once it is final: no seconds left and a
 * score posted for both sides (the same rule the Matchup Planner uses).
 *
 * Keys are MFL team codes (KCC, GBP, …), as both MFL exports carry them.
 */

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** @returns {Record<string, number>} MFL team code → final games played. */
export function gamesPlayedByTeam(schedulePayload) {
  const weeks = asArray(schedulePayload?.fullNflSchedule?.nflSchedule ?? schedulePayload?.nflSchedule);
  const games = {};
  for (const w of weeks) {
    for (const m of asArray(w?.matchup)) {
      const teams = asArray(m?.team);
      if (teams.length !== 2) continue;
      const final =
        String(m?.gameSecondsRemaining ?? '') === '0' && teams.every((t) => String(t?.score ?? '') !== '');
      if (!final) continue;
      for (const t of teams) {
        const id = String(t?.id ?? '');
        if (id) games[id] = (games[id] ?? 0) + 1;
      }
    }
  }
  return games;
}

/**
 * The divisor for one team: its own final games, or `fallbackWeeks` when the
 * schedule does not know the team (or no schedule was readable at all).
 */
export function gamesDivisor(games, mflCode, fallbackWeeks) {
  const n = games?.[mflCode];
  return Math.max(Number.isFinite(n) && n > 0 ? n : fallbackWeeks, 1);
}
