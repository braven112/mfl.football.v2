/**
 * "Is this TheLeague season finished?" — extracted so it can be unit-tested.
 *
 * Background (August 2026): scripts/compute-franchise-history.mjs credits a
 * division title to the first row of each division in MFL's official standings
 * order. Its only guard was `seasonHasGames` ("did anybody play a game"), which
 * is true from week 1 onward. Because .github/workflows/schefter-trade-
 * speculation.yml runs that script nightly (cron "0 20 * * *") and COMMITS
 * data/theleague/derived/franchise-history.json to main, an in-progress season
 * would stamp four division titles onto the franchise pages (hero badge, awards
 * card, per-season shield, rivalry counts) — then churn them every night as the
 * standings moved. Corrected titles also emit Schefter milestone posts, so the
 * churn would have been audible, not just visual.
 *
 * This is the same failure mode already fixed on the AFL side; see
 * scripts/lib/afl-season-complete.mjs. TheLeague needs its own copy because the
 * two leagues resolve a champion through different shapes: the AFL reads a
 * bracket-derived awards map keyed 'afl-championship', while TheLeague resolves
 * a `champResult` object (MFL brackets, falling back to the hand-curated
 * championship-history.json for pre-2020 metadata-only brackets).
 *
 * A mid-season standings table is a perfectly valid ORDER; it just isn't a
 * FINAL one. Two signals say a season is done, either sufficient:
 *
 *   1. The season is in a past calendar year. TheLeague plays Sep-Dec, so any
 *      year before the current one is over, full stop. This covers every
 *      historical season.
 *   2. The year's playoff results resolved a champion. That only happens once
 *      the postseason is played, so the newest season's titles land in December
 *      instead of waiting for January.
 *
 * NOTE: the per-year schedule export is deliberately NOT used as a third
 * signal — same reason as the AFL. Its shape is inconsistent across eras, and
 * comparing games-played against it drops real titles from historical seasons.
 *
 * DO NOT inline this again — tests/theleague-season-complete.test.ts locks it in.
 *
 * @param {number} year Season being computed.
 * @param {{champion?: string|null, runnerUp?: string|null, thirdPlace?: string|null,
 *   championPoints?: number, runnerUpPoints?: number}|null|undefined} champResult
 *   Resolved championship result for that year, as built in computeYear() —
 *   which returns all five fields, not `champion` alone. Only `champion` is
 *   read here; the rest are listed so callers passing a real result type-check.
 * @param {number} currentYear Calendar year to compare against (injectable so
 *   the tests don't depend on the wall clock).
 * @returns {boolean} true when division titles may be credited.
 */
export function isSeasonComplete(year, champResult, currentYear = new Date().getFullYear()) {
  if (Number(year) < Number(currentYear)) return true;
  return Boolean(champResult?.champion);
}
