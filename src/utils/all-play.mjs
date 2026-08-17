/**
 * All-play accumulation — the ONE implementation of the AFL/TheLeague all-play
 * record calc, shared by the live standings page (via src/utils/standings.ts,
 * which wraps this with the app's types) and the node tier-movement scripts
 * (scripts/lib/afl-tier-standings.mjs). Plain ESM with JSDoc types so both a
 * Vite-bundled TS module and a plain-`node` .mjs script can import it — the
 * same cross-boundary pattern scripts/schefter-scan.mjs already uses for
 * src/config/leagues-data.mjs.
 *
 * All-play: each week, every team is scored win/loss/tie against ALL other
 * teams that week. Gated to a cutoff week so the AFL tier "side competition"
 * uses regular-season results only (afl.config.json#tierCompetition.cutoffWeek).
 *
 * The cutoff is per-season, not a constant — see resolveTierCutoffWeek below.
 *
 * @typedef {Object} AllPlayRecord
 * @property {number} wins
 * @property {number} losses
 * @property {number} ties
 * @property {number} pf    Total points scored across counted weeks (tiebreak).
 * @property {number} pct   (wins + 0.5*ties) / games.
 */

/** Fallback cutoff for any season without its own entry. */
export const DEFAULT_TIER_CUTOFF_WEEK = 17;

/**
 * The week a season's all-play competition ENDED, inclusive.
 *
 * The all-play side competition ends the same week the season's championship
 * game is played, and that week is not the same in every era: the modern
 * Premier League / D-League seasons run through week 17, but 2017 — the AFL
 * Cup, the competition the Premier League grew out of — finished in week 16,
 * the week of that season's title game (Thundering Herd def. Smokane FC;
 * week 17 held only consolation and 5th-place games).
 *
 * Getting this wrong does not merely shift a row: the 2017 Cup is decided
 * between week 16 and week 17. Through 16, Smokane FC leads at 259-109; add
 * week 17 and Fullybaked passes them. The promotion cutoff is unaffected —
 * the top 12 is the same set of franchises either way, and matches the 2018
 * Premier League roster exactly.
 *
 * @param {{cutoffWeek?: number, cutoffWeekByYear?: Record<string, number>}|undefined} tierCompetition
 *   The league config's `tierCompetition` block.
 * @param {number|string} year
 * @returns {number} inclusive cutoff week
 */
export function resolveTierCutoffWeek(tierCompetition, year) {
  const perYear = tierCompetition?.cutoffWeekByYear?.[String(year)];
  if (Number.isFinite(Number(perYear))) return Number(perYear);
  const fallback = Number(tierCompetition?.cutoffWeek);
  return Number.isFinite(fallback) ? fallback : DEFAULT_TIER_CUTOFF_WEEK;
}

/**
 * @param {{weeks: Array<{week:number, scores:Record<string,number>}>}} weeklyResults
 * @param {number} cutoffWeek inclusive
 * @returns {Map<string, AllPlayRecord>}
 */
export function accumulateAllPlay(weeklyResults, cutoffWeek) {
  const records = new Map();

  // Filter weeks up to and including the cutoff.
  const weeksToProcess = (weeklyResults?.weeks ?? []).filter((w) => Number(w?.week) <= cutoffWeek);

  const ensure = (id) => {
    let r = records.get(id);
    if (!r) {
      r = { wins: 0, losses: 0, ties: 0, pf: 0, pct: 0 };
      records.set(id, r);
    }
    return r;
  };

  for (const week of weeksToProcess) {
    const scores = Object.entries(week?.scores ?? {});

    // For each team, compare against all other teams this week.
    for (const [teamId, teamScoreRaw] of scores) {
      const teamScore = Number(teamScoreRaw);
      const record = ensure(teamId);
      record.pf += Number.isFinite(teamScore) ? teamScore : 0;

      for (const [opponentId, opponentScoreRaw] of scores) {
        if (teamId === opponentId) continue; // Don't compare to self.
        const opponentScore = Number(opponentScoreRaw);
        if (teamScore > opponentScore) record.wins++;
        else if (teamScore < opponentScore) record.losses++;
        else record.ties++;
      }
    }
  }

  // Calculate percentages.
  for (const record of records.values()) {
    const total = record.wins + record.losses + record.ties;
    record.pct = total > 0 ? (record.wins + record.ties * 0.5) / total : 0;
  }

  return records;
}
