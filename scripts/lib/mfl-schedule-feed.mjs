/**
 * MFL's schedule export carries a projected `spread` on every franchise of
 * every unplayed matchup, recomputed from live projections. It moves on
 * nearly every run, so keeping it made schedule.json a real change on most
 * roster syncs — and every commit to `main` is a production build. Nothing
 * reads it (the spreads the site shows are NFL odds, from live-odds.json),
 * so it is dropped before the write rather than ignored in the comparison,
 * which would leave a stale value on disk for a future reader to trust.
 */
export const stripScheduleSpreads = (data) => {
  const weeks = data?.schedule?.weeklySchedule;
  for (const week of Array.isArray(weeks) ? weeks : weeks ? [weeks] : []) {
    const matchups = week?.matchup;
    for (const matchup of Array.isArray(matchups) ? matchups : matchups ? [matchups] : []) {
      const franchises = matchup?.franchise;
      for (const f of Array.isArray(franchises) ? franchises : franchises ? [franchises] : []) {
        if (f && typeof f === 'object') delete f.spread;
      }
    }
  }
  return data;
};
