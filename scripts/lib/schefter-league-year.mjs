/**
 * Per-league MFL league year for the Schefter scanners.
 *
 * Two clocks, not one: TheLeague's MFL league rolls Feb 14, the AFL's June 1
 * (registry `leagueYearRollover` — the AFL league isn't created on MFL until
 * late spring). A scanner that derives the year from the calendar alone
 * targets an AFL league year that does not exist yet from Feb to June, and
 * MFL answers that with an error body, so the lane goes dark for four months.
 *
 * Lifted from scripts/schefter-lineup-check.mjs so the trade-bait lane can
 * share it. Do NOT re-derive base-year math here — that's the double-advance
 * bug class CLAUDE.md documents. The other transaction-scanner lanes still
 * carry an inline Feb-1 calendar heuristic; migrating them is a follow-up.
 *
 * @param {{ leagueYearRollover?: { month: number, day: number } }} league
 *   Registry entry or Schefter league object (buildSchefterLeague copies the
 *   rollover through). Month is 1-indexed. Defaults to TheLeague's Feb 14.
 * @param {Date} [now]
 * @returns {number}
 */
export function leagueYearFor(league, now = new Date()) {
  const rollover = league?.leagueYearRollover ?? { month: 2, day: 14 };
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const year = pt.getFullYear();
  const flipped =
    pt.getMonth() + 1 > rollover.month ||
    (pt.getMonth() + 1 === rollover.month && pt.getDate() >= rollover.day);
  return flipped ? year : year - 1;
}
