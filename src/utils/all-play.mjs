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
 * @typedef {Object} AllPlayRecord
 * @property {number} wins
 * @property {number} losses
 * @property {number} ties
 * @property {number} pf    Total points scored across counted weeks (tiebreak).
 * @property {number} pct   (wins + 0.5*ties) / games.
 */

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
