/**
 * Pure record-book maths, shared by scripts/compute-record-book.mjs and its
 * tests. Kept as .mjs so the node script can import it directly, the same
 * arrangement afl-bracket-kind.mjs uses.
 *
 * Everything here operates on an already-flattened game list so the feed-walking
 * (which needs the filesystem) stays in the script and the reasoning that can be
 * wrong stays testable.
 */

import { isForfeit, weekGames } from './game-results.mjs';

/** A forfeit posts 0.00: a game (it counts in records), but not a performance to rank. */
export const isPlayed = (a, b) => !isForfeit(a, b);

/** Highest-first by default; `asc` for "closest"-style boards. */
export const rankBy = (rows, value, limit, asc = false) =>
  rows
    .slice()
    .sort((x, y) => (asc ? value(x) - value(y) : value(y) - value(x)))
    .slice(0, limit);

/**
 * One season's games, deduplicated. Both franchises appear in the same matchup
 * element here (unlike the owner-scoped ledger), so the only duplication risk is
 * a week listing a pairing twice — which the AFL's archives really do, e.g. a
 * `0023 vs 0023` bye row in 2012 week 14 and stray repeats in 2014/2015 NIT
 * weeks.
 */
export function gamesFromSchedule(schedule, { nameOf, year, firstPlayoffWeek = Infinity, toArray }) {
  // Which matchups are games, and who won them, is game-results.mjs's call.
  const out = [];
  const seen = new Set();
  for (const wk of toArray(schedule?.schedule?.weeklySchedule)) {
    for (const g of weekGames(wk)) {
      const key = `${g.week}:${[g.a, g.b].sort().join(':')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // MFL's recorded result decides the winner, so a tie it broke on its
      // tiebreaker stays a win and a loss.
      const aWon = g.ra === 'W' || (g.ra === 'T' && g.sa >= g.sb);
      const [hi, lo, shi, slo] = aWon ? [g.a, g.b, g.sa, g.sb] : [g.b, g.a, g.sb, g.sa];
      out.push({
        year,
        week: g.week,
        isPlayoff: g.week >= firstPlayoffWeek,
        winnerId: hi,
        winnerName: nameOf(hi),
        loserId: lo,
        loserName: nameOf(lo),
        winnerScore: shi,
        loserScore: slo,
        margin: Math.abs(g.sa - g.sb),
        combined: g.sa + g.sb,
        tie: g.ra === 'T',
        forfeit: isForfeit(g.sa, g.sb),
      });
    }
  }
  return out;
}

/**
 * Longest run of consecutive wins (or losses) per franchise SLOT, across
 * seasons. A slot's history spans owners, which is what a franchise record book
 * means; the label is the name the slot carried when the run ended.
 *
 * A tie ends both runs. Doubleheader weeks contribute two games, so a run is
 * counted in games rather than weeks.
 */
export function longestStreaks(games, kind, limit) {
  const byFranchise = new Map();
  for (const g of games) {
    for (const id of [g.winnerId, g.loserId]) {
      if (!byFranchise.has(id)) byFranchise.set(id, []);
      byFranchise.get(id).push({
        year: g.year,
        week: g.week,
        won: !g.tie && id === g.winnerId,
        lost: !g.tie && id === g.loserId,
        name: id === g.winnerId ? g.winnerName : g.loserName,
      });
    }
  }

  const out = [];
  for (const [id, list] of byFranchise) {
    list.sort((a, b) => a.year - b.year || a.week - b.week);
    let run = 0;
    let start = null;
    let best = null;
    for (const g of list) {
      const counts = kind === 'win' ? g.won : g.lost;
      if (counts) {
        if (run === 0) start = g;
        run += 1;
        if (!best || run > best.length) {
          best = {
            franchiseId: id,
            name: g.name,
            length: run,
            from: { year: start.year, week: start.week },
            to: { year: g.year, week: g.week },
          };
        }
      } else {
        run = 0;
        start = null;
      }
    }
    if (best) out.push(best);
  }
  return rankBy(out, (s) => s.length, limit);
}

/** Series totals per franchise-slot pairing, across every season. */
export function rivalryTotals(games) {
  const pairs = new Map();
  for (const g of games) {
    const [a, b] = [g.winnerId, g.loserId].sort();
    let row = pairs.get(`${a}:${b}`);
    if (!row) {
      row = {
        a,
        b,
        aName: null,
        bName: null,
        meetings: 0,
        aWins: 0,
        bWins: 0,
        ties: 0,
        playoffMeetings: 0,
      };
      pairs.set(`${a}:${b}`, row);
    }
    // Games arrive oldest-first, so the last write leaves each slot under the
    // most recent name it carried — right for a series that is still running.
    row.aName = a === g.winnerId ? g.winnerName : g.loserName;
    row.bName = b === g.winnerId ? g.winnerName : g.loserName;
    row.meetings += 1;
    if (g.isPlayoff) row.playoffMeetings += 1;
    if (g.tie) row.ties += 1;
    else if (g.winnerId === a) row.aWins += 1;
    else row.bWins += 1;
  }
  return [...pairs.values()];
}

/** Minimum series length before "most lopsided" means anything. */
export const MIN_LOPSIDED_MEETINGS = 20;

/**
 * A franchise's official W-L-T from a standings row.
 *
 * MFL supplies this two ways and switches between them by season: a combined
 * `h2hwlt` ("14-3-0"), or separate `h2hw`/`h2hl`/`h2ht` with no combined field
 * at all — the AFL's 2019 and 2021 feeds are the latter.
 *
 * The trap is that a per-field fallback silently loses. `String(undefined ?? '')
 * .split('-').map(Number)` yields `[0]`, and `Number.isFinite(0)` is true, so a
 * naive check accepts zero wins rather than falling through. That rendered
 * "Dicks out for Harambe, 2021 · 0-4" next to 2,512 points. Require the parsed
 * triple to carry an actual result before trusting it.
 */
export function officialRecord(franchise) {
  const parts = String(franchise?.h2hwlt ?? '').split('-').map(Number);
  const [w, l, t] = parts;
  if (parts.length >= 2 && Number.isFinite(w) && Number.isFinite(l) && (w || l || t)) {
    return { wins: w || 0, losses: l || 0, ties: t || 0 };
  }
  return {
    wins: Number(franchise?.h2hw) || 0,
    losses: Number(franchise?.h2hl) || 0,
    ties: Number(franchise?.h2ht) || 0,
  };
}
