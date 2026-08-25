/**
 * Division strength — the shared vocabulary for "how good has a division been".
 *
 * `.mjs` on purpose, same reason as `division-aliases.mjs`:
 * `scripts/compute-division-strength.mjs` and the `.astro` pages both need
 * these exact functions, and a node script cannot import a `.ts`. Types live
 * in `src/types/division-strength.ts`.
 *
 * ── The one thing to understand before reading a number off this page ──────
 *
 * A division's OVERALL record is not a measure of its strength. Every
 * intra-division game hands one of its own teams a win and another one a loss,
 * so those games cancel to exactly .500 no matter how good the teams are. A
 * division that plays 40% of its schedule against itself has 40% of its record
 * pinned to .500 by arithmetic alone, and both leagues schedule a heavier
 * in-division slate than an out-of-division one.
 *
 * So the strength metric here is the INTERDIVISIONAL record — games against
 * teams outside the division, which is the only slice where a division can
 * actually separate from the field. The overall record is still reported
 * (it's what an owner remembers), but it never drives a ranking.
 *
 * Where game-level results don't exist (the AFL's 2003 feed carries pairings
 * with no scores), there is no interdivisional record to compute. Those
 * seasons report their standings totals and are explicitly marked
 * `gamesResolved: false` rather than being silently ranked on a metric that
 * isn't there.
 */

/** URL/anchor-safe slug for a division name. */
export const divisionSlug = (name) =>
  String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'division';

/** A W-L-T record plus the points on both sides of it. */
export const emptyRecord = () => ({
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  pointsAgainst: 0,
});

/** Games in a record. Points are carried alongside and never counted here. */
export const recordGames = (rec) => (rec ? rec.wins + rec.losses + rec.ties : 0);

/** Fold one game's outcome into a record, from the record-holder's side. */
export const addGame = (rec, scoreFor, scoreAgainst) => {
  if (scoreFor > scoreAgainst) rec.wins += 1;
  else if (scoreFor < scoreAgainst) rec.losses += 1;
  else rec.ties += 1;
  rec.pointsFor += scoreFor;
  rec.pointsAgainst += scoreAgainst;
  return rec;
};

/** Fold `b` into `a` in place. */
export const mergeRecord = (a, b) => {
  if (!b) return a;
  a.wins += b.wins;
  a.losses += b.losses;
  a.ties += b.ties;
  a.pointsFor += b.pointsFor;
  a.pointsAgainst += b.pointsAgainst;
  return a;
};

/**
 * Win percentage with ties as half a win — MFL's own convention, and the one
 * the standings pages already display. Null (not 0) when no games were played,
 * so "hasn't played" never sorts as "lost everything".
 */
export const winPct = (rec) => {
  const games = recordGames(rec);
  if (!games) return null;
  return (rec.wins + rec.ties / 2) / games;
};

/** "10-8" / "10-8-1" / "—". */
export const formatRecord = (rec) => {
  if (!rec || recordGames(rec) === 0) return '—';
  return rec.ties > 0 ? `${rec.wins}-${rec.losses}-${rec.ties}` : `${rec.wins}-${rec.losses}`;
};

/** ".611" — leading zero dropped, the way a standings table shows it. */
export const formatWinPct = (rec) => {
  const pct = winPct(rec);
  if (pct === null) return '—';
  return pct.toFixed(3).replace(/^0/, '');
};

/** Average points scored per game, or null when no games were played. */
export const pointsPerGame = (rec) => {
  const games = recordGames(rec);
  if (!games || !rec.pointsFor) return null;
  return rec.pointsFor / games;
};

/**
 * Rank divisions strongest-first for one season.
 *
 * `entries` are `{ key, interDivision, totals }`. The sort is:
 *   1. interdivisional win % (the strength metric — see the header)
 *   2. interdivisional point differential per game (a decisive tiebreak that
 *      doesn't reach outside the same slice of games)
 *   3. overall win %, then key, so the order is total and stable
 *
 * A division with no interdivisional games sorts last regardless of its
 * overall record — it has no evidence, and inventing a rank for it from
 * intra-division games would rank it on a .500 constant.
 *
 * Returns `[{ key, rank }]`; ties share the lower rank number (1, 2, 2, 4).
 */
export const rankDivisionsByStrength = (entries) => {
  const scored = entries.map((entry) => {
    const inter = entry.interDivision;
    const games = recordGames(inter);
    return {
      key: entry.key,
      hasEvidence: games > 0,
      pct: winPct(inter) ?? -1,
      diffPerGame: games ? (inter.pointsFor - inter.pointsAgainst) / games : 0,
      overall: winPct(entry.totals) ?? -1,
    };
  });

  scored.sort(
    (a, b) =>
      Number(b.hasEvidence) - Number(a.hasEvidence) ||
      b.pct - a.pct ||
      b.diffPerGame - a.diffPerGame ||
      b.overall - a.overall ||
      String(a.key).localeCompare(String(b.key))
  );

  const ranked = [];
  for (let i = 0; i < scored.length; i++) {
    const prev = scored[i - 1];
    const cur = scored[i];
    const tied =
      prev &&
      prev.hasEvidence === cur.hasEvidence &&
      prev.pct === cur.pct &&
      prev.diffPerGame === cur.diffPerGame &&
      prev.overall === cur.overall;
    ranked.push({ key: cur.key, rank: tied ? ranked[i - 1].rank : i + 1 });
  }
  return ranked;
};

/**
 * A season's finish expressed on a 0..1 scale where 1 is first and 0 is last.
 *
 * Raw rank is NOT comparable across this league's history: the AFL ran six
 * divisions through 2012 and four since, so finishing 4th of 6 (a middling
 * year) and 4th of 4 (dead last) are the same number. Normalizing to the
 * position within the field is what lets one average span both eras.
 *
 * A one-division season has no field to place in and returns 0.5 rather than
 * dividing by zero — neither leagues has one, but the AFL's alignment has
 * already changed twice.
 */
export const finishPercentile = (rank, of) => {
  if (!rank || !of || of < 2) return 0.5;
  return (of - rank) / (of - 1);
};

/**
 * Collapse a list of years into contiguous runs: `[2011,2012,2013,2016]` →
 * `[{ yearStart: 2011, yearEnd: 2013 }, { yearStart: 2016, yearEnd: 2016 }]`.
 *
 * Realignment moves teams between divisions and sometimes moves them back, so
 * an owner's time in a division is genuinely a list of stints, not a range.
 * Rendering `2011–2016` for the example above would claim two seasons that
 * belong to a different division.
 */
export const contiguousRuns = (years) => {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const runs = [];
  for (const year of sorted) {
    const last = runs[runs.length - 1];
    if (last && year === last.yearEnd + 1) last.yearEnd = year;
    else runs.push({ yearStart: year, yearEnd: year });
  }
  return runs;
};

/** "2011–2015" / "2016" / "2011–2013, 2016". */
export const formatRuns = (runs) =>
  runs
    .map((run) => (run.yearStart === run.yearEnd ? `${run.yearStart}` : `${run.yearStart}–${run.yearEnd}`))
    .join(', ');
