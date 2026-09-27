/**
 * The Standings tab's three views: Projected, Live and Final.
 *
 * ── FINAL IS MFL'S, AND ONLY FINAL IS OFFICIAL ────────────────────────────
 * `final` returns MFL's rows untouched, in MFL's order — the league's official
 * standing with its constitution tiebreakers (Power Rank, Victory Points,
 * head-to-head) already applied. Nothing here may change that view.
 * `docs/claude/rules/standings-brackets-draft-order.md`.
 *
 * ── LIVE AND PROJECTED ARE A WHAT-IF, AND SAY SO ──────────────────────────
 * `live` adds this week's matchups to each record as they stand right now;
 * `projected` adds them as each side's projected final. Both re-rank by win
 * percentage, then points for, then MFL's own position — a deliberately plain
 * order, because the real tiebreakers are not ours to reproduce. That re-rank
 * is the ONE place the "never re-sort MFL's rows" rule is set aside, on the
 * owner's explicit call (Sep 2026), and it is only allowed because the view is
 * labelled as a projection and every row carries its official position beside
 * it. Nothing downstream may treat a projected rank as a standing.
 *
 * ── NEVER COUNT A WEEK TWICE ──────────────────────────────────────────────
 * The board stays on a week from its kickoff until the next one, and MFL folds
 * a finished week into its standings somewhere in between. Adding the board's
 * scores to a record that already contains them would double the week, so the
 * overlay reads `weekGamesCounted` per row — how many of the week's games
 * MFL already holds, set server-side from the league's schedule
 * (`readLeaguePriorGameCounts`) — and adds only the rest, per MATCHUP, so a
 * half-counted doubleheader is half-added. When that read failed (`null`), the
 * only safe inference left is the one that needs no schedule: a matchup still
 * being played cannot have been counted yet, so only unfinished matchups are
 * added and every finished one is left as MFL has it.
 */

import type { LiveMatchup, LiveStandingsRow } from '../../types/live';

export type StandingsMode = 'projected' | 'live' | 'final';

export const STANDINGS_MODES: readonly StandingsMode[] = ['projected', 'live', 'final'];

export const DEFAULT_STANDINGS_MODE: StandingsMode = 'live';

export interface ProjectedStandingsRow extends LiveStandingsRow {
  /** MFL's own position — `rank` becomes the position in THIS view. */
  officialRank: number;
  /** Official minus view rank: positive climbed, negative fell. 0 in `final`. */
  move: number;
  /** True when this week's result was added to the record in this view. */
  includesWeek: boolean;
}

/**
 * Every starter on both sides has no game-time left.
 *
 * Derived from the ROWS rather than from a flag, so it cannot disagree with
 * the numbers beside it — and `yetToPlay` alone is not enough, since a player
 * whose game is in progress has already started but has not finished.
 */
export function isMatchupFinal(matchup: LiveMatchup): boolean {
  const rows = [...matchup.sides[0].players, ...matchup.sides[1].players];
  return rows.length > 0 && rows.every((r) => r.secondsRemaining <= 0);
}

/**
 * Someone in this matchup has played. An unplayed week is a payload of zeros
 * (see `LiveLeagueStatus`), and a 0-0 "tie" from it is not a result.
 */
function hasStarted(matchup: LiveMatchup): boolean {
  return matchup.sides.some((s) => s.live !== 0 || s.yetToPlay < s.players.length);
}

function winPct(row: { wins: number; losses: number; ties: number }): number {
  const games = row.wins + row.losses + row.ties;
  return games === 0 ? 0 : (row.wins + row.ties / 2) / games;
}

function asFinal(rows: readonly LiveStandingsRow[]): ProjectedStandingsRow[] {
  return rows.map((row) => ({ ...row, officialRank: row.rank, move: 0, includesWeek: false }));
}

/**
 * Build one view of the standings. `rows` must be MFL's rows in MFL's order.
 */
export function projectStandings(
  rows: readonly LiveStandingsRow[],
  matchups: readonly LiveMatchup[],
  mode: StandingsMode,
): ProjectedStandingsRow[] {
  if (mode === 'final') return asFinal(rows);

  // This week's games per franchise, one entry per MATCHUP. A franchise can
  // appear in more than one — the AFL plays doubleheaders — and MFL may have
  // counted some of them already, so they are kept apart rather than summed.
  const week = new Map<string, { result: 'W' | 'L' | 'T'; points: number; final: boolean }[]>();
  for (const matchup of matchups) {
    const final = isMatchupFinal(matchup);
    // A live result needs a game that has started; a projected one does not —
    // "if every game ends as projected" covers the ones not yet kicked off.
    if (mode === 'live' && !hasStarted(matchup)) continue;
    const score = (i: 0 | 1) =>
      mode === 'live' ? matchup.sides[i].live : matchup.sides[i].projectedFinal;
    ([0, 1] as const).forEach((i) => {
      const me = score(i);
      const them = score(i === 0 ? 1 : 0);
      const id = matchup.sides[i].franchiseId;
      const games = week.get(id) ?? [];
      games.push({ result: me > them ? 'W' : me < them ? 'L' : 'T', points: me, final });
      week.set(id, games);
    });
  }

  const adjusted = rows.map((row) => {
    const games = week.get(row.franchiseId) ?? [];
    const counted = row.weekGamesCounted;
    // Which of this week's games are NOT yet in MFL's record:
    //  - count unknown → only unfinished ones (MFL cannot have counted those);
    //  - count known   → drop that many, finished games first, since only a
    //    finished game can have been counted.
    const toAdd =
      counted === null || counted === undefined
        ? games.filter((g) => !g.final)
        : [...games].sort((x, y) => Number(y.final) - Number(x.final)).slice(counted);
    if (toAdd.length === 0) {
      return { ...row, officialRank: row.rank, move: 0, includesWeek: false };
    }
    const tally = (r: 'W' | 'L' | 'T') => toAdd.filter((g) => g.result === r).length;
    return {
      ...row,
      wins: row.wins + tally('W'),
      losses: row.losses + tally('L'),
      ties: row.ties + tally('T'),
      pointsFor: row.pointsFor + toAdd.reduce((sum, g) => sum + g.points, 0),
      officialRank: row.rank,
      move: 0,
      includesWeek: true,
    };
  });

  // Nothing to add — no game started, the week already counted, or the live
  // read failed. Re-ranking unchanged records would only swap MFL's tiebreaks
  // for ours, so the answer is MFL's own table.
  if (!adjusted.some((row) => row.includesWeek)) return asFinal(rows);

  return adjusted
    .slice()
    .sort(
      (a, b) =>
        winPct(b) - winPct(a) || b.pointsFor - a.pointsFor || a.officialRank - b.officialRank,
    )
    .map((row, i) => ({ ...row, rank: i + 1, move: row.officialRank - (i + 1) }));
}
