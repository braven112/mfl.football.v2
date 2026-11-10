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
  LiveVictoryPointRules,
} from '../../types/live';
import { allPlayWeek, resultOf } from '../game-results.mjs';
import { madSeeds } from '../mad-standings';
import { NFL_GAME_SECONDS } from '../live-win-probability';
import {
  hasStarted,
  isMatchupFinal,
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

/** One side has played: points scored, or a starter's game in progress. */
function sideHasStarted(side: LiveMatchup['sides'][number]): boolean {
  return (
    side.live !== 0 ||
    side.players.some((p) => p.secondsRemaining > 0 && p.secondsRemaining < NFL_GAME_SECONDS)
  );
}

/**
 * Each franchise's score this week, once — or null when the view has nothing
 * to add.
 *
 * ONCE, not per matchup: an AFL doubleheader puts a franchise in two matchups
 * with the same score, and all-play compares weekly scores, not games.
 *
 * Live counts only a franchise that has started: points on the board, or a
 * starter whose game is in progress — the per-side form of `hasStarted`.
 * Taking every score "as it stands, zero included" read Thursday night's
 * board as eleven AFL teams tied 0-0 with each other and losing to the few
 * who had played, so a 168-28 all-play record showed as 168-28-11. A team
 * yet to play has no result this week, exactly as an unstarted head-to-head
 * matchup has none. Projected counts everyone: it is the week as projected.
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
      if (asLive && !sideHasStarted(side)) continue;
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

/**
 * Each franchise's Victory Points for this week, as the view sees it — or
 * null when the view adds nothing.
 *
 * MFL's rule, reproduced exactly (Archie's 2026 weeks 1-8: 99 of 99 teams'
 * `vp` match): `win`/`tie`/`loss` per GAME, so both halves of a doubleheader
 * pay, plus ONE bucket per week by where the weekly score ranks league-wide —
 * "3 2 1" pays the top third 3, the middle third 2, the bottom third 1.
 *
 * The same never-twice rule as the head-to-head views: a game MFL has
 * counted (`weekGamesCounted`) is not added again, and the bucket and points
 * are added only while none of the week is counted.
 */
export function weekVictoryPoints(
  rowsById: ReadonlyMap<string, LiveStandingsRow>,
  rules: LiveVictoryPointRules,
  matchups: readonly LiveMatchup[],
  mode: Exclude<StandingsMode, 'final'>,
): Map<string, { vp: number; points: number }> | null {
  const scores = weekScores(matchups, mode);
  if (!scores) return null;

  const games = new Map<string, { vp: number; final: boolean }[]>();
  for (const matchup of matchups) {
    const asLive = mode === 'live' || matchup.noProjections === true;
    if (asLive && !hasStarted(matchup)) continue;
    const final = isMatchupFinal(matchup);
    const score = (i: 0 | 1) => (asLive ? matchup.sides[i].live : matchup.sides[i].projectedFinal);
    ([0, 1] as const).forEach((i) => {
      const result = resultOf(score(i), score(i === 0 ? 1 : 0));
      const vp = result === 'W' ? rules.win : result === 'T' ? rules.tie : rules.loss;
      const id = matchup.sides[i].franchiseId;
      games.set(id, [...(games.get(id) ?? []), { vp, final }]);
    });
  }

  // The week's buckets, league-wide, best score first.
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const bucketOf = new Map<string, number>();
  if (rules.buckets.length > 0 && ranked.some(([, s]) => s > 0)) {
    ranked.forEach(([id], i) => {
      bucketOf.set(id, rules.buckets[Math.floor((i * rules.buckets.length) / ranked.length)] ?? 0);
    });
  }

  const out = new Map<string, { vp: number; points: number }>();
  for (const [id, row] of rowsById) {
    const own = games.get(id) ?? [];
    const counted = row.weekGamesCounted;
    const toAdd =
      counted === null || counted === undefined
        ? own.filter((g) => !g.final)
        : [...own].sort((x, y) => Number(y.final) - Number(x.final)).slice(counted);
    if (toAdd.length === 0) continue;
    const weekOpen = !counted;
    out.set(id, {
      vp: toAdd.reduce((sum, g) => sum + g.vp, 0) + (weekOpen ? bucketOf.get(id) ?? 0 : 0),
      points: weekOpen ? scores.get(id) ?? 0 : 0,
    });
  }
  return out.size > 0 ? out : null;
}

const MAD_ZONES: Record<'leader' | 'runnerUp' | 'wildCard', LiveStandingsZone> = {
  leader: { tone: 'up', label: 'Division leader' },
  runnerUp: { tone: 'up', label: 'Runner-up' },
  wildCard: { tone: 'danger', label: 'Wild card' },
};

/**
 * A MAD POWER 99 table (Archie's playoff seeding): every franchise in seed
 * order — each division's leader, then each runner-up, then the wild cards,
 * then the field — ranked on Victory Points, then points.
 *
 * Final seeds MFL's own order, which the league sorts on Victory Points then
 * points (`utils/mad-standings.ts`). Live and Projected add the week's Victory
 * Points and re-seed with the same function, so a team that takes its
 * division live moves into the leaders' block with its label.
 */
export function projectMadSection(
  rowsById: ReadonlyMap<string, LiveStandingsRow>,
  section: LiveStandingsSection,
  rules: LiveVictoryPointRules | undefined,
  matchups: readonly LiveMatchup[],
  mode: StandingsMode,
): SectionView {
  const seeding = { kind: 'mad' as const, ...(section.seeding ?? { divisionLeaders: 0, runnersUp: 0, wildCards: 0 }) };
  const divisionOf = (id: string) => section.divisionOf?.[id];
  const feed = section.franchiseIds
    .map((id) => rowsById.get(id))
    .filter((row): row is LiveStandingsRow => row !== undefined);
  const feedIndex = new Map(feed.map((row, i) => [row.franchiseId, i]));

  const officialSeed = new Map(
    madSeeds(feed.map((r) => ({ id: r.franchiseId })), divisionOf, seeding).map((s) => [s.id, s]),
  );

  const draw = (rows: LiveStandingsRow[], includes: Set<string>): SectionView => {
    const seeds = madSeeds(rows.map((r) => ({ id: r.franchiseId })), divisionOf, seeding);
    const byId = new Map(rows.map((r) => [r.franchiseId, r]));
    const out: SectionRow[] = seeds.map((s) => {
      const row = byId.get(s.id)!;
      const official = officialSeed.get(s.id)?.seed ?? s.seed;
      return {
        ...row,
        rank: s.seed,
        officialRank: official,
        move: official - s.seed,
        includesWeek: includes.has(s.id),
        zone: s.tier === 'field' ? null : MAD_ZONES[s.tier],
      };
    });
    return { rows: out, addsWeek: includes.size > 0 };
  };

  const asOfficial = () => draw(feed, new Set());
  if (mode === 'final' || !rules) return asOfficial();
  const week = weekVictoryPoints(rowsById, rules, matchups, mode);
  if (!week) return asOfficial();

  const includes = new Set<string>();
  const adjusted = feed.map((row) => {
    const add = week.get(row.franchiseId);
    if (!add) return row;
    includes.add(row.franchiseId);
    return {
      ...row,
      victoryPoints: (row.victoryPoints ?? 0) + add.vp,
      pointsFor: row.pointsFor + add.points,
    };
  });
  if (includes.size === 0) return asOfficial();
  const order = adjusted
    .slice()
    .sort(
      (a, b) =>
        (b.victoryPoints ?? 0) - (a.victoryPoints ?? 0) ||
        b.pointsFor - a.pointsFor ||
        feedIndex.get(a.franchiseId)! - feedIndex.get(b.franchiseId)!,
    );
  return draw(order, includes);
}
