/**
 * The Live / Projected / Final views of a SECTIONED Standings tab — one table
 * per division or tier rather than one for the whole league.
 *
 * Two kinds of table, and they rank on different things:
 *
 *  - **`record`** (divisions): the head-to-head record. This is the single
 *    table's maths (`projectStandings`) run over the section's own rows, so a
 *    division can never disagree with the league table about a result.
 *  - **`all-play`** (the AFL's Premier League and D-League): every team's
 *    weekly score against every OTHER team's that week, league-wide, then the
 *    section's teams ranked on that record. The week's comparisons are
 *    `allPlayWeek` from `game-results.mjs` — the same function the committed
 *    tier tables accumulate with — so a live all-play week is scored exactly
 *    the way it will be once it is final.
 *
 * Same rules as the single table (`standings-projection.ts`): Final is the
 * official order, Live and Projected are a labelled what-if that re-ranks by
 * win percentage then points for, and every moved row says where it
 * officially sits. A week is never counted twice: an all-play base that
 * already holds the board's week (`weekCounted`) is shown as it is.
 */

import type {
  LiveAllPlayBase,
  LiveMatchup,
  LiveStandingsRow,
  LiveStandingsSection,
  LiveStandingsZone,
} from '../../types/live';
import { allPlayWeek } from '../game-results.mjs';
import {
  hasStarted,
  projectStandings,
  type ProjectedStandingsRow,
  type StandingsMode,
} from './standings-projection';

export interface SectionRow extends ProjectedStandingsRow {
  /** The marker on the position this row holds in THIS view. */
  zone: LiveStandingsZone | null;
}

export interface SectionView {
  rows: SectionRow[];
  /** True when any row in the table carries this week. */
  addsWeek: boolean;
}

function winPct(row: { wins: number; losses: number; ties: number }): number {
  const games = row.wins + row.losses + row.ties;
  return games === 0 ? 0 : (row.wins + row.ties / 2) / games;
}

function withZones(rows: ProjectedStandingsRow[], section: LiveStandingsSection): SectionRow[] {
  return rows.map((row, i) => ({ ...row, zone: section.zones?.[i] ?? null }));
}

/**
 * Each franchise's score this week, once — or null when the view has nothing
 * to add.
 *
 * ONCE, not per matchup: an AFL doubleheader puts a franchise in two matchups
 * with the same score, and all-play compares weekly scores, not games.
 *
 * Live adds nothing until a game has started anywhere (an unplayed week is a
 * board of zeros). Once one has, every franchise takes its score as it
 * stands, zero included — "if every game ended right now" — and
 * `allPlayWeek` already treats a week where nobody has scored as unplayed.
 */
export function weekScores(
  matchups: readonly LiveMatchup[],
  mode: Exclude<StandingsMode, 'final'>,
): Map<string, number> | null {
  if (matchups.length === 0) return null;
  if (mode === 'live' && !matchups.some(hasStarted)) return null;
  const scores = new Map<string, number>();
  for (const matchup of matchups) {
    const asLive = mode === 'live' || matchup.noProjections === true;
    for (const side of matchup.sides) {
      if (scores.has(side.franchiseId)) continue;
      scores.set(side.franchiseId, asLive ? side.live : side.projectedFinal);
    }
  }
  return scores.size > 0 ? scores : null;
}

/** A division (or any head-to-head section): the single table's maths over its rows. */
export function projectRecordSection(
  rowsById: ReadonlyMap<string, LiveStandingsRow>,
  section: LiveStandingsSection,
  matchups: readonly LiveMatchup[],
  mode: StandingsMode,
): SectionView {
  // The section's position, not the league's: 1st in the division is 1st,
  // whatever the league table says. Order is the section's official order.
  const own = section.franchiseIds
    .map((id) => rowsById.get(id))
    .filter((row): row is LiveStandingsRow => row !== undefined)
    .map((row, i) => ({ ...row, rank: i + 1 }));
  const rows = projectStandings(own, matchups, mode);
  return { rows: withZones(rows, section), addsWeek: rows.some((r) => r.includesWeek) };
}

/** A tier (or any all-play section). */
export function projectAllPlaySection(
  rowsById: ReadonlyMap<string, LiveStandingsRow>,
  section: LiveStandingsSection,
  base: LiveAllPlayBase,
  matchups: readonly LiveMatchup[],
  mode: StandingsMode,
): SectionView {
  const official: ProjectedStandingsRow[] = [];
  for (const id of section.franchiseIds) {
    const row = rowsById.get(id);
    const record = base.records[id];
    if (!row || !record) continue;
    official.push({
      ...row,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      pointsFor: record.pointsFor,
      rank: official.length + 1,
      officialRank: official.length + 1,
      move: 0,
      includesWeek: false,
    });
  }

  const asOfficial = (): SectionView => ({ rows: withZones(official, section), addsWeek: false });
  if (mode === 'final' || base.weekCounted || !base.weekInCompetition) return asOfficial();

  const scores = weekScores(matchups, mode);
  if (!scores) return asOfficial();
  // League-wide: a Premier League team's week is scored against all the
  // D-League's teams too. Only the RANKING is per tier.
  const week = allPlayWeek(scores) as Map<string, { wins: number; losses: number; ties: number }>;
  if (week.size === 0) return asOfficial();

  const adjusted = official.map((row) => {
    const add = week.get(row.franchiseId);
    if (!add) return row;
    return {
      ...row,
      wins: row.wins + add.wins,
      losses: row.losses + add.losses,
      ties: row.ties + add.ties,
      pointsFor: row.pointsFor + (scores.get(row.franchiseId) ?? 0),
      includesWeek: true,
    };
  });
  if (!adjusted.some((r) => r.includesWeek)) return asOfficial();

  const ranked = adjusted
    .slice()
    .sort(
      (a, b) =>
        winPct(b) - winPct(a) || b.pointsFor - a.pointsFor || a.officialRank - b.officialRank,
    )
    .map((row, i) => ({ ...row, rank: i + 1, move: row.officialRank - (i + 1) }));
  return { rows: withZones(ranked, section), addsWeek: true };
}
