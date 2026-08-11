/**
 * "Is this AFL season finished?" — extracted so it can be unit-tested.
 *
 * Background (August 2026): scripts/compute-afl-awards.mjs credits a division
 * title to the first row of each division in MFL's official standings order.
 * Its only guard was "was any football played" (`divpct > 0 || pf > 0`), which
 * is true from week 1 onward. Because .github/workflows/afl-tier-rollover.yml
 * runs that script weekly and COMMITS data/afl-fantasy/awards-history.json,
 * an in-progress season would stamp four division titles onto the trophy wall,
 * the footer champion cards and getFranchiseTrophyRank — then churn them every
 * Monday as the standings moved.
 *
 * A mid-season standings table is a perfectly valid ORDER; it just isn't a
 * FINAL one. Two signals say a season is done, either sufficient:
 *
 *   1. The season is in a past calendar year. The AFL plays Sep-Dec, so any
 *      year before the current one is over, full stop. This covers every
 *      historical season.
 *   2. The year's playoff brackets resolved a champion. Bracket results only
 *      exist once the postseason is played, so the newest season's titles land
 *      in December instead of waiting for January. Brackets are only
 *      auto-derived for 2016+, which is fine — earlier years are all caught by
 *      signal 1.
 *
 * NOTE: the per-year schedule export is deliberately NOT used. Its shape is
 * wildly inconsistent across eras (2007-2011 carry playoff weeks only,
 * 2020-2023 fold the postseason into the count), so comparing games-played
 * against it would have dropped real titles from seven different seasons.
 *
 * DO NOT inline this again — tests/afl-season-complete.test.ts locks it in.
 *
 * @param {number} year Season being computed.
 * @param {Record<string, {franchiseId?: string|null}>|null|undefined} bracketAwards
 *   Bracket-derived awards for that year, as built by `bracketWinners()`.
 * @param {number} currentYear Calendar year to compare against (injectable so
 *   the tests don't depend on the wall clock).
 * @returns {boolean} true when division titles may be credited.
 */
export function isSeasonComplete(year, bracketAwards, currentYear = new Date().getFullYear()) {
  if (Number(year) < Number(currentYear)) return true;
  return Boolean(bracketAwards?.['afl-championship']?.franchiseId);
}
