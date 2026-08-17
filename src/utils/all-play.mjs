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
 * Per-season, and the per-season values are RECORDED FACTS, not derived from
 * anything. 2017 — the AFL Cup, the competition the Premier League grew out
 * of — ended at week 16; every other season uses the default 17.
 *
 * **Do not "generalize" this to the week of the season's title game.** That
 * rule looks right and is wrong: bracket 1 resolves in week 16 in 2018, 2019
 * AND 2020 too, yet those seasons demonstrably ran their all-play through
 * week 17 — recompute 2020 at week 16 and the D-League champion comes out
 * 0013 where tier-history.json records 0015. Applying the title-game rule
 * across the board flips a recorded champion, and
 * compute-afl-tier-movement.mjs writes champions back, so the flip would be
 * committed. Only add a year here with evidence for that specific year.
 *
 * 2017's evidence: the commissioner checked the season's payout records and
 * the Cup money went to Smokane FC, which is the week-16 answer. The week
 * matters because it decides the Cup — through 16, Smokane FC leads at
 * 259-109; add week 17 and Fullybaked passes them. The promotion cutoff is
 * unaffected either way (same top 12, an exact match for the 2018 Premier
 * League roster), which is why the original set-match verification passed
 * while the order was wrong.
 *
 * @param {{cutoffWeek?: number, cutoffWeekByYear?: Record<string, number>}|undefined} tierCompetition
 *   The league config's `tierCompetition` block.
 * @param {number|string} year
 * @returns {number} inclusive cutoff week
 */
export function resolveTierCutoffWeek(tierCompetition, year) {
  // A malformed entry must fall back, never pass through: Number(null) and
  // Number('') are both 0, which is "finite" but yields an EMPTY all-play
  // table — champions computed from zero games, silently.
  const usable = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
  const perYear = tierCompetition?.cutoffWeekByYear?.[String(year)];
  if (usable(perYear)) return Number(perYear);
  const fallback = tierCompetition?.cutoffWeek;
  return usable(fallback) ? Number(fallback) : DEFAULT_TIER_CUTOFF_WEEK;
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
