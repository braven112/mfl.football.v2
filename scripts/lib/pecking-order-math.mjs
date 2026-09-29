/**
 * The Pecking Order — composite ranking math.
 *
 * Pure functions (no file I/O, no league literals) behind the Tuesday-morning
 * Pecking Order column. Extracted from the generator so the algorithm is
 * unit-testable and the weights live in exactly one place.
 *
 * Composite score per franchise (each component min-max normalized 0-100):
 *   50% — all-play %      (luck-adjusted season-long strength)
 *   50% — recent form     (rolling-3-week PPG)
 *
 * Both components are min-max normalized within the league so the 50/50 split
 * is true by spread. Leaving all-play on its absolute 0-100 scale would give it
 * roughly half the influence of the min-max'd form component, since a season's
 * all-play percentages bunch in the middle (~.300-.700) while a min-max scale
 * always runs the full 0-100.
 *
 * Season PPG, average margin and head-to-head record are still computed and
 * carried on each row — the column displays them as context — but they no
 * longer move the ranking.
 *
 * Data shapes (MFL feeds on disk):
 *   weeklyResults — { weeks: [{ week: 1, scores: { '0001': 111.5, ... } }] }
 *   standingsByFid — Map<franchiseId, MFL standings franchise row>
 *     (h2hpct, all_play_pct, avgpf, pf, pa, h2hw/h2hl/h2ht, strk as strings)
 */

import { num, int, rollingAvgPF, seasonAvgPF, minMax01 } from './team-strength.mjs';

/** Component weights — must sum to 1.0. Exposed for the page's methodology line. */
export const PECKING_ORDER_WEIGHTS = {
  allPlay: 0.5,
  form: 0.5,
};

/** Human-readable methodology string, derived from the weights so it can't drift. */
export function describeMethodology(weights = PECKING_ORDER_WEIGHTS) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  return (
    `${pct(weights.allPlay)} all-play record · ` +
    `${pct(weights.form)} last 3 weeks (rolling-3wk PPG)`
  );
}

/** Parse MFL streak string "W3" / "L4" / "" → { type: 'W'|'L'|null, length: number } */
export function parseStreak(strk) {
  if (!strk || typeof strk !== 'string') return { type: null, length: 0 };
  const m = strk.trim().match(/^([WL])(\d+)$/i);
  if (!m) return { type: null, length: 0 };
  return { type: m[1].toUpperCase(), length: parseInt(m[2], 10) };
}

/** Games played per MFL standings row (h2h wins + losses + ties). */
function gamesPlayed(s) {
  return int(s?.h2hw, 0) + int(s?.h2hl, 0) + int(s?.h2ht, 0);
}

/** Season average scoring margin (pf - pa per game) from a standings row. Null when no games. */
export function avgMargin(s) {
  // A derived per-game margin wins (enrichStandingsFromResults): with
  // doubleheaders MFL's `pf` counts each WEEK's score once while games count
  // twice, so pf - pa over games is not a margin there.
  const derived = num(s?.avg_margin, NaN);
  if (Number.isFinite(derived)) return derived;
  const games = gamesPlayed(s);
  if (games === 0) return null;
  return (num(s?.pf, 0) - num(s?.pa, 0)) / games;
}

/**
 * Compute the Pecking Order for one week.
 *
 * @param {object} args
 * @param {string[]} args.franchiseIds — every franchise in the league.
 * @param {Map<string, object>} args.standingsByFid — MFL standings rows.
 * @param {object} args.weeklyResults — weekly-results.json shape.
 * @param {number} args.week — rank through this completed week.
 * @returns {Array<{ rank, fid, composite, allPlayScore, formScore, allPlayPct,
 *   rolling3Ppg, seasonPpg, avgMargin }>} sorted best (rank 1) first.
 */
export function computePeckingOrder({ franchiseIds, standingsByFid, weeklyResults, week }) {
  const rows = franchiseIds.map((fid) => {
    const s = standingsByFid.get(fid);
    const seasonPpg = seasonAvgPF(weeklyResults, fid, week) ?? num(s?.avgpf, NaN);
    return {
      fid,
      rolling3Ppg: rollingAvgPF(weeklyResults, fid, week, 3) ?? seasonPpg,
      seasonPpg,
      avgMargin: avgMargin(s),
      // NaN, not a .500 stand-in: a missing all-play must not become a real
      // data point in the min-max range. A phantom .500 in a league whose real
      // spread is .600-.800 would redefine the minimum, flattening the gaps
      // between every team that HAS data. minMax01 skips non-finite values when
      // it computes the range, then places them at the midpoint — which is the
      // same treatment the form component already gets.
      allPlayPct: num(s?.all_play_pct, NaN),
    };
  });

  const allPlayScores = minMax01(rows.map((r) => r.allPlayPct));
  const formScores = minMax01(rows.map((r) => r.rolling3Ppg));

  const W = PECKING_ORDER_WEIGHTS;
  const indexed = rows.map((r, i) => ({
    fid: r.fid,
    composite: W.allPlay * allPlayScores[i] + W.form * formScores[i],
    allPlayScore: allPlayScores[i],
    formScore: formScores[i],
    allPlayPct: Number.isFinite(r.allPlayPct) ? r.allPlayPct : null,
    rolling3Ppg: Number.isFinite(r.rolling3Ppg) ? r.rolling3Ppg : null,
    seasonPpg: Number.isFinite(r.seasonPpg) ? r.seasonPpg : null,
    avgMargin: r.avgMargin,
  }));

  indexed.sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    // Tiebreak by season PPG to minimize churn between near-identical teams.
    return (b.seasonPpg ?? 0) - (a.seasonPpg ?? 0);
  });

  return indexed.map((row, idx) => ({ rank: idx + 1, ...row }));
}

/**
 * Attach previousRank/trend from the prior issue's rankings.
 *
 * @param {Array<{ rank, fid }>} rankings — current week, sorted.
 * @param {{ rankings: Array<{ franchiseId, rank }> } | null} previous — prior issue JSON (or null).
 */
export function attachTrend(rankings, previous) {
  if (!previous) {
    return rankings.map((r) => ({ ...r, previousRank: null, trend: 'flat' }));
  }
  const priorMap = new Map(previous.rankings.map((r) => [r.franchiseId, r.rank]));
  return rankings.map((r) => {
    const prev = priorMap.get(r.fid) ?? null;
    let trend = 'flat';
    if (prev != null) {
      if (prev > r.rank) trend = 'up';
      else if (prev < r.rank) trend = 'down';
    }
    return { ...r, previousRank: prev, trend };
  });
}

const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

/**
 * Every week's H2H pairings, keyed by week: Map<week, Array<{ id, isHome }[]>>.
 *
 * Two sources, because neither covers both jobs. schedule.json is the only
 * forward-looking one — it has next week's matchup, which is what Matchup of
 * the Week previews. weekly-results-raw.json only has weeks already played,
 * but it exists for every league-year on disk, including the AFL seasons that
 * predate schedule.json being fetched for that league. Schedule wins where
 * both have a week; raw fills the rest.
 */
export function buildPairings(schedule, rawWeekly) {
  const byWeek = new Map();
  const pairingsOf = (matchup) =>
    asArray(matchup)
      .map(m => asArray(m?.franchise).map(f => ({ id: f.id, isHome: f.isHome })))
      .filter(g => g.length === 2);

  for (const entry of asArray(rawWeekly)) {
    const wk = int(entry?.weeklyResults?.week);
    if (!wk) continue;
    const games = pairingsOf(entry.weeklyResults.matchup);
    if (games.length) byWeek.set(wk, games);
  }
  for (const w of asArray(schedule?.schedule?.weeklySchedule)) {
    const wk = int(w?.week);
    if (!wk) continue;
    const games = pairingsOf(w.matchup);
    if (games.length) byWeek.set(wk, games);
  }
  return byWeek;
}

/**
 * Fill the standings fields the column reads but a league's MFL export may
 * not carry — `all_play_pct`, `all_play_wlt`, `strk`, `pa` — from the weekly
 * scores and pairings. Archie's standings export has none of them, and
 * without all-play the composite collapses to form alone (minMax01 puts every
 * team at the midpoint), with no Heater/Cooler and no margin.
 *
 * Only MISSING fields are filled: a league whose export has them (TheLeague,
 * the AFL) keeps MFL's own values untouched. Returns a new Map; the input is
 * not mutated.
 *
 * All-play is per WEEK, one score each: a doubleheader team's week score is
 * the same in both games (archies plays two a week), so counting it once is
 * what "your score against everyone's" means. PA is per week too (the mean
 * opponent that week), on the same basis as MFL's `pf`; the streak and the
 * derived `avg_margin` are per GAME.
 *
 * @param {Map<string, object>} standingsByFid
 * @param {object} weeklyResults — weekly-results.json shape.
 * @param {Map<number, Array<Array<{id: string}>>>} pairings — week → games.
 * @param {number} throughWeek
 */
export function enrichStandingsFromResults(standingsByFid, weeklyResults, pairings, throughWeek) {
  const weeks = (Array.isArray(weeklyResults?.weeks) ? weeklyResults.weeks : [])
    .map((w) => ({ week: int(w?.week, 0), scores: w?.scores || {} }))
    .filter((w) => w.week >= 1 && w.week <= throughWeek)
    .sort((a, b) => a.week - b.week);

  const ap = new Map();
  const pa = new Map(); // per-WEEK basis, like MFL's pf: the mean opponent each week
  const margin = new Map(); // fid → { sum, games }: per-GAME
  const results = new Map(); // fid → ['W'|'L'|'T', …] in game order
  for (const { week, scores } of weeks) {
    const played = Object.entries(scores)
      .map(([fid, v]) => [fid, num(v, NaN)])
      .filter(([, v]) => Number.isFinite(v) && v > 0);
    for (const [fid, mine] of played) {
      const rec = ap.get(fid) ?? { w: 0, l: 0, t: 0 };
      for (const [other, theirs] of played) {
        if (other === fid) continue;
        if (mine > theirs) rec.w++;
        else if (mine < theirs) rec.l++;
        else rec.t++;
      }
      ap.set(fid, rec);
    }
    const byFid = new Map(played);
    const oppsThisWeek = new Map();
    for (const game of pairings.get(week) ?? []) {
      if (!Array.isArray(game) || game.length !== 2) continue;
      const [a, b] = game;
      const sa = byFid.get(a.id);
      const sb = byFid.get(b.id);
      if (sa == null || sb == null) continue;
      for (const [me, mine, theirs] of [[a.id, sa, sb], [b.id, sb, sa]]) {
        const opps = oppsThisWeek.get(me) ?? [];
        opps.push(theirs);
        oppsThisWeek.set(me, opps);
        const m = margin.get(me) ?? { sum: 0, games: 0 };
        m.sum += mine - theirs;
        m.games += 1;
        margin.set(me, m);
        const list = results.get(me) ?? [];
        list.push(mine > theirs ? 'W' : mine < theirs ? 'L' : 'T');
        results.set(me, list);
      }
    }
    for (const [me, opps] of oppsThisWeek) {
      pa.set(me, (pa.get(me) ?? 0) + opps.reduce((x, y) => x + y, 0) / opps.length);
    }
  }

  const streakOf = (list) => {
    if (!list?.length) return '';
    const last = list[list.length - 1];
    if (last === 'T') return '';
    let n = 0;
    for (let i = list.length - 1; i >= 0 && list[i] === last; i--) n++;
    return `${last}${n}`;
  };
  const blank = (v) => v == null || v === '';

  const out = new Map();
  for (const [fid, row] of standingsByFid.entries()) {
    const next = { ...row };
    const rec = ap.get(fid);
    if (rec && blank(row.all_play_pct)) {
      const games = rec.w + rec.l + rec.t;
      next.all_play_pct = games ? ((rec.w + rec.t / 2) / games).toFixed(3) : '';
    }
    if (rec && blank(row.all_play_wlt)) next.all_play_wlt = `${rec.w}-${rec.l}-${rec.t}`;
    if (blank(row.strk)) next.strk = streakOf(results.get(fid));
    if (blank(row.pa) && pa.has(fid)) {
      next.pa = pa.get(fid).toFixed(2);
      const m = margin.get(fid);
      if (m?.games) next.avg_margin = m.sum / m.games;
    }
    out.set(fid, next);
  }
  return out;
}
