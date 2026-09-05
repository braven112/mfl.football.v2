/**
 * The Owners' Poll — how well a ballot predicted what came next.
 *
 * Lives in src/utils rather than scripts/lib because the ACCOUNTABILITY PAGE
 * computes it at render time and a page cannot import from scripts/. It has to
 * be computed late: accuracy needs the week AFTER the ballot, which does not
 * exist when the poll closes. scripts/lib/owners-poll-math.mjs re-exports it so
 * there is still exactly one implementation.
 *
 * The other two voter metrics (contrarian, homer) are computed AT CLOSE and
 * stored on each ballot, because they only need that week's own consensus.
 */

import { normalizeFranchiseId } from './franchise-id.mjs';

/**
 * Pairwise accuracy of one ballot against a later ranking.
 *
 * For every pair of teams on the ballot, did the one ranked higher end up
 * higher? Pairs rather than raw rank error, so a ballot is not punished for
 * the whole field shifting underneath it.
 *
 * WHAT IT IS SCORED AGAINST, and why: the FOLLOWING week's Pecking Order
 * composite (50% all-play, 50% rolling-3-week form). Not that week's raw
 * fantasy result — a single matchup is mostly luck and would make this
 * leaderboard noise. Not the same week's composite either, which the voter
 * could simply copy. Scoring against next week's composite means every voter
 * starts from the same freely available baseline (this week's ranking, printed
 * directly above the ballot), and beating it requires actually seeing a change
 * coming. That is the thing worth measuring.
 *
 * A pair whose teams are not both present in `laterRankByFid` is SKIPPED
 * rather than counted wrong — a franchise that left the league should not
 * retroactively damage a ballot that was reasonable when it was cast.
 */
export function pairwiseAccuracy(ranking, laterRankByFid) {
  const later = toRankMap(laterRankByFid);
  const list = Array.from(ranking ?? [], (id) => normalizeFranchiseId(id));
  let pairs = 0;
  let correct = 0;

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = later.get(list[i]);
      const b = later.get(list[j]);
      if (a == null || b == null || a === b) continue;
      pairs += 1;
      if (a < b) correct += 1;
    }
  }

  return { pairs, correct, pct: pairs > 0 ? correct / pairs : null };
}

/** Accept either a Map or a plain object for rank lookups. */
export function toRankMap(input) {
  if (input instanceof Map) {
    return new Map(Array.from(input, ([k, v]) => [normalizeFranchiseId(k), v]));
  }
  return new Map(
    Object.entries(input ?? {}).map(([k, v]) => [normalizeFranchiseId(k), v]),
  );
}
