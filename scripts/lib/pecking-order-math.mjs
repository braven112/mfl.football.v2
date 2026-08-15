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
      allPlayPct: num(s?.all_play_pct, 0.5),
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
