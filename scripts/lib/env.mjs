/**
 * Shared env-var helper for node scripts.
 *
 * `getNonEmpty` was byte-identical in scripts/update-salary-averages.mjs,
 * scripts/fetch-mfl-feeds.mjs, scripts/fetch-fantasy-points-allowed.mjs,
 * and scripts/fetch-trade-bait.mjs — lifted here once.
 */

/** Returns the trimmed value if non-empty, else undefined (treats '' and whitespace-only as absent). */
export function getNonEmpty(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
}
