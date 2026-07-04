/**
 * Normalize raw MFL weeklyResults payloads into the shape the site consumes:
 *   { weeks: [{ week: number, scores: { franchiseId: points } }] }
 *
 * MFL varies the weeklyResults shape in ways the old per-script normalizers
 * only partly handled:
 *   - modern seasons and playoff weeks: `weeklyResults.matchup[]`, each
 *     matchup carrying a `franchise[]` pair with per-franchise `score`;
 *   - older archive years (regular-season weeks, AFL pre-2020): a FLAT
 *     `weeklyResults.franchise[]` with per-franchise `score` and NO matchup
 *     wrapper;
 *   - some modern weeks carry BOTH at once: paired teams under `matchup[]`
 *     plus a separate flat `franchise[]` for teams with no pairing that week
 *     (e.g. a playoff bye) — seen in TheLeague 2025+.
 *
 * The old normalizers only read `matchup`, which silently produced empty (or
 * partial) score maps for 2016-2019 AFL regular seasons and for any
 * mixed-shape week's unpaired teams. Shared by scripts/fetch-mfl-feeds.mjs and
 * scripts/backfill-historical-feeds.mjs so the two can't drift again.
 *
 * As everywhere with MFL: single-element collections may arrive as a bare
 * object instead of an array.
 */

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * @param {Array<object>} rawWeeks - array of raw per-week MFL payloads
 *   (each `{ weeklyResults: { week, matchup? , franchise? } }`)
 * @returns {{ weeks: Array<{ week: number|undefined, scores: Record<string, number> }> }}
 */
export function normalizeWeeklyResults(rawWeeks) {
  return {
    weeks: toArray(rawWeeks).map((payload) => {
      const wr = payload?.weeklyResults ?? {};
      const week = Number(wr.week) || undefined;
      const scores = {};

      const addFranchise = (team) => {
        if (team?.id == null || team.score == null || String(team.score).trim() === '') return;
        const score = Number(team.score);
        // A present-but-unparseable score is exactly the "fake zero" failure
        // mode this normalizer exists to eliminate — skip rather than mask it.
        if (Number.isNaN(score)) return;
        scores[String(team.id)] = score;
      };

      for (const matchup of toArray(wr.matchup)) {
        for (const team of toArray(matchup?.franchise)) addFranchise(team);
      }
      // Flat shape — either the whole payload for archive-year regular
      // seasons, or (2025+) the unpaired teams alongside a matchup[] above.
      // Every year observed so far never overlaps franchise ids with
      // conflicting scores across the two structures for the same week —
      // but if a future payload ever does, this second pass wins (last-write)
      // since franchise ids key the scores map.
      for (const team of toArray(wr.franchise)) addFranchise(team);

      return { week, scores };
    }),
  };
}
