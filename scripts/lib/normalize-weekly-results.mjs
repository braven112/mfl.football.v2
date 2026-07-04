/**
 * Normalize raw MFL weeklyResults payloads into the shape the site consumes:
 *   { weeks: [{ week: number, scores: { franchiseId: points } }] }
 *
 * MFL has shipped TWO payload shapes over its history:
 *   - modern seasons and playoff weeks: `weeklyResults.matchup[]`, each
 *     matchup carrying a `franchise[]` pair with per-franchise `score`;
 *   - older archive years (regular-season weeks, AFL pre-2020):
 *     a FLAT `weeklyResults.franchise[]` with per-franchise `score` and NO
 *     matchup wrapper.
 *
 * The old normalizers only understood the matchup shape, which silently
 * produced empty score maps for 2016-2019 AFL regular seasons (the raw feeds
 * had all the data; only weeks 14-17 — playoff weeks, matchup-shaped — came
 * through). Shared by scripts/fetch-mfl-feeds.mjs and
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
        if (team?.id != null && team.score != null) {
          scores[String(team.id)] = Number(team.score) || 0;
        }
      };

      for (const matchup of toArray(wr.matchup)) {
        for (const team of toArray(matchup?.franchise)) addFranchise(team);
      }
      // Older flat shape — regular-season weeks in MFL's archive years.
      // (A payload carries either matchups or the flat list, never both with
      // different data; adding by franchise id makes a hypothetical overlap
      // idempotent anyway.)
      for (const team of toArray(wr.franchise)) addFranchise(team);

      return { week, scores };
    }),
  };
}
