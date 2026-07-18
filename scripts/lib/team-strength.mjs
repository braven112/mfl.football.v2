/**
 * Shared team-strength math for weekly analytics.
 *
 * Extracted from scripts/generate-power-rankings.mjs so the power rankings
 * and the schedule-strength ("Gauntlet") pipelines compute opponent/team
 * strength from one implementation. Pure functions — no file I/O.
 *
 * Data shapes (MFL feeds on disk):
 *   weeklyResults — data/<league>/mfl-feeds/<year>/weekly-results.json
 *     { weeks: [{ week: 1, scores: { '0001': 111.5, ... } }] }
 *   standings — standings.json → leagueStandings.franchise[]
 *     (avgpf, all_play_pct, h2hpct as MFL strings)
 */

/** Coerce MFL string numerics; shared so the analytics pipelines can't drift. */
export function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function int(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse MFL "W-L-T" strings ("11-7-0") → { wins, losses, ties } or null. */
export function parseH2hRecord(wlt) {
  if (typeof wlt !== 'string') return null;
  const m = wlt.trim().match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  return { wins: int(m[1]), losses: int(m[2]), ties: int(m[3] ?? 0) };
}

/** Average team's last N completed weeks of points. Returns null if no weeks available. */
export function rollingAvgPF(weeklyResults, franchiseId, throughWeek, n = 3) {
  const weeks = (weeklyResults?.weeks || [])
    .filter(w => int(w.week) <= throughWeek && Number.isFinite(num(w.scores?.[franchiseId], NaN)))
    .sort((a, b) => int(a.week) - int(b.week));
  if (weeks.length === 0) return null;
  const slice = weeks.slice(-n);
  const sum = slice.reduce((acc, w) => acc + num(w.scores?.[franchiseId]), 0);
  return sum / slice.length;
}

/** Season points-per-game from completed weekly results (fallback when standings avgpf is 0). */
export function seasonAvgPF(weeklyResults, franchiseId, throughWeek) {
  const weeks = (weeklyResults?.weeks || [])
    .filter(w => int(w.week) <= throughWeek && Number.isFinite(num(w.scores?.[franchiseId], NaN)));
  if (weeks.length === 0) return null;
  const sum = weeks.reduce((acc, w) => acc + num(w.scores?.[franchiseId]), 0);
  return sum / weeks.length;
}

/** Normalize array of values to 0-100 by min-max. Non-finite values map to 50. */
export function minMax01(values) {
  const finite = values.filter(v => Number.isFinite(v));
  if (finite.length === 0) return values.map(() => 50);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return values.map(() => 50);
  return values.map(v => Number.isFinite(v) ? ((v - min) / (max - min)) * 100 : 50);
}

// Opponent-strength composite (schedule-strength / Gauntlet):
//   50% — season points-per-game
//   25% — all-play % (luck-adjusted strength)
//   25% — rolling-3wk PPG (recent form)
export const STRENGTH_WEIGHTS = { seasonPpg: 0.5, allPlay: 0.25, form: 0.25 };

/**
 * Compute a 0–100 strength score for every franchise, normalized within the
 * league for the given week. Returns Map<franchiseId, {
 *   strength, seasonPpg, rolling3Ppg, allPlayPct
 * }>.
 *
 * `standingsByFid` is a Map<franchiseId, MFL standings franchise row>.
 * All-play % comes from standings (season-to-date); ppg components come from
 * weekly results so the math also works for historical backfills where a
 * final standings snapshot may be missing fields.
 */
export function computeTeamStrengths({ franchiseIds, standingsByFid, weeklyResults, throughWeek }) {
  const rows = franchiseIds.map(fid => {
    const s = standingsByFid?.get(fid);
    const season = seasonAvgPF(weeklyResults, fid, throughWeek) ?? num(s?.avgpf, NaN);
    return {
      fid,
      seasonPpg: season,
      rolling3Ppg: rollingAvgPF(weeklyResults, fid, throughWeek, 3) ?? season,
      allPlayPct: num(s?.all_play_pct, NaN),
    };
  });

  const seasonScores = minMax01(rows.map(r => r.seasonPpg));
  const formScores = minMax01(rows.map(r => r.rolling3Ppg));
  const allPlayScores = rows.map(r => Number.isFinite(r.allPlayPct) ? r.allPlayPct * 100 : 50);

  const out = new Map();
  rows.forEach((r, i) => {
    const strength =
      STRENGTH_WEIGHTS.seasonPpg * seasonScores[i] +
      STRENGTH_WEIGHTS.allPlay * allPlayScores[i] +
      STRENGTH_WEIGHTS.form * formScores[i];
    out.set(r.fid, {
      strength: Math.round(strength),
      seasonPpg: Number.isFinite(r.seasonPpg) ? r.seasonPpg : null,
      rolling3Ppg: Number.isFinite(r.rolling3Ppg) ? r.rolling3Ppg : null,
      allPlayPct: Number.isFinite(r.allPlayPct) ? r.allPlayPct : null,
    });
  });
  return out;
}

/** Map a 0–100 difficulty score to its 5-step color bucket (1 easiest … 5 hardest). */
export function difficultyStep(score) {
  if (!Number.isFinite(score)) return 0;
  if (score >= 80) return 5;
  if (score >= 60) return 4;
  if (score >= 40) return 3;
  if (score >= 20) return 2;
  return 1;
}

/**
 * Walk schedule.json H2H pairings → Map<franchiseId, Map<week, opponentId[]>>.
 * Weeks with no matchup for a franchise (bye) are simply absent.
 *
 * The per-week value is an ARRAY: AFL plays two games per franchise per week
 * (24 pairings for 24 teams), so a scalar per week silently drops half the
 * season — records and difficulty averages come out halved.
 */
export function buildOpponentGrid(schedule) {
  const grid = new Map();
  for (const w of (schedule?.schedule?.weeklySchedule || [])) {
    const wk = int(w.week);
    for (const m of (w.matchup || [])) {
      const fs = m.franchise || [];
      if (fs.length !== 2) continue;
      const [a, b] = fs;
      for (const [me, opp] of [[a, b], [b, a]]) {
        if (!grid.has(me.id)) grid.set(me.id, new Map());
        const weekMap = grid.get(me.id);
        if (!weekMap.has(wk)) weekMap.set(wk, []);
        weekMap.get(wk).push(opp.id);
      }
    }
  }
  return grid;
}

