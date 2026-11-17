/**
 * Every league gets every feature: the version of each computed per-league
 * dataset that the CURRENT code expects.
 *
 * A dataset's generator stamps `version` into its output from this table.
 * When a feature changes what a dataset holds (Ask the History's NFL teams,
 * Nov 2026), bump its number here. `tests/derived-versions.test.ts` then fails
 * until every league the dataset's job runs for — including leagues launched
 * before the feature, and any launched after — has been rebuilt on the new
 * version, so an idea can never land in one league and quietly skip the rest.
 *
 * `job` is the league-jobs predicate (scripts/lib/league-jobs.mjs) that
 * decides which leagues need the file; `rebuild` is the command the test
 * prints for a stale or missing league.
 *
 * Datasets in the derived chain (league-history.json and its inputs) are not
 * stamped: they are recomputed whole through scripts/recompute-derived-chain.mjs,
 * and their own data tests already demand row-for-row agreement. They are
 * listed with `version: null`, which checks only that every league has one.
 */
export const DERIVED_DATASETS = {
  "league-history.json": {
    job: "league-history",
    version: null,
    rebuild: "node scripts/recompute-derived-chain.mjs",
  },
  "league-history-players.json": {
    job: "league-history",
    // 2: per-season NFL team (`nflTeams`).
    version: 2,
    rebuild: "node scripts/compute-league-history-players.mjs --league=<slug>",
  },
  "league-history-moves.json": {
    job: "league-history",
    version: 1,
    rebuild: "node scripts/compute-league-history-moves.mjs --league=<slug>",
  },
};

/** The version a generator stamps into `file`. Throws for an unlisted file. */
export function derivedVersion(file) {
  const entry = DERIVED_DATASETS[file];
  if (!entry || entry.version == null)
    throw new Error(`derived-versions: "${file}" has no version`);
  return entry.version;
}
