/**
 * The Owners' Poll — the season accountability view.
 *
 * Pure: takes the committed Pecking Order issues and returns the per-owner
 * season table. No I/O, no clock, no league literals — the route globs its own
 * league's issues and hands them in.
 *
 * Everything here reads the ARCHIVE, never Redis. A week's ballots become a
 * fact in the committed issue file the moment the close pass runs, which is
 * what lets this page be a static read and what makes the record permanent.
 */

import { pairwiseAccuracy } from './owners-poll-accuracy.mjs';

export interface VoterIssue {
  year: number;
  week: number;
  rankings?: Array<{ franchiseId: string; rank: number }>;
  ownersPoll?: {
    status?: string;
    hasQuorum?: boolean;
    slots?: number;
    ballotsIn?: number;
    eligibleVoters?: number;
    ballots?: Array<{
      franchiseId: string;
      ranking: string[];
      contrarianIndex: number | null;
      homerIndex: number | null;
    }>;
  } | null;
}

export interface VoterWeek {
  week: number;
  voted: boolean;
  /** Null until the following week exists to score against. */
  accuracyPct: number | null;
  contrarianIndex: number | null;
  homerIndex: number | null;
}

export interface VoterRow {
  franchiseId: string;
  ballotsCast: number;
  weeksAvailable: number;
  /** Season pairwise accuracy, pooled across weeks. Null before any is scorable. */
  accuracyPct: number | null;
  accuracyPairs: number;
  contrarianIndex: number | null;
  homerIndex: number | null;
  weeks: VoterWeek[];
}

export interface VoterSeason {
  /** Weeks that actually ran a poll, ascending. */
  weeks: number[];
  voters: VoterRow[];
  /** Weeks whose accuracy cannot be scored yet (no following issue). */
  unscoredWeeks: number[];
  totalBallots: number;
  /** Mean turnout across polled weeks, 0-1. */
  turnoutRate: number | null;
}

/**
 * Build the season table.
 *
 * `eligibleFranchiseIds` is passed in so owners who never voted still appear —
 * participation is the headline stat, and a leaderboard that silently omits
 * the people who didn't show up measures the wrong thing.
 */
export function computeVoterSeason(
  issues: VoterIssue[],
  eligibleFranchiseIds: string[],
): VoterSeason {
  const ordered = [...issues].sort((a, b) => a.year - b.year || a.week - b.week);

  // Only weeks that actually published a poll with a quorum count. A
  // no-quorum week has no consensus, so its contrarian/homer numbers were
  // never computed and its ballots cannot be scored against a consensus.
  const polled = ordered.filter(
    (i) => i.ownersPoll?.status === 'closed' && i.ownersPoll?.hasQuorum,
  );

  // Next issue that carries a ranking, for accuracy. Keyed by the ballot week.
  const laterRanks = new Map<number, Record<string, number>>();
  for (const issue of polled) {
    const next = ordered.find(
      (i) => (i.year > issue.year || (i.year === issue.year && i.week > issue.week)) && i.rankings?.length,
    );
    if (!next?.rankings) continue;
    laterRanks.set(
      issue.week,
      Object.fromEntries(next.rankings.map((r) => [r.franchiseId, r.rank])),
    );
  }

  const rows = new Map<string, VoterRow>();
  for (const fid of eligibleFranchiseIds) {
    rows.set(fid, {
      franchiseId: fid,
      ballotsCast: 0,
      weeksAvailable: polled.length,
      accuracyPct: null,
      accuracyPairs: 0,
      contrarianIndex: null,
      homerIndex: null,
      weeks: [],
    });
  }

  // Pooled rather than averaged: a week where a voter's pairs were mostly
  // unscorable should not weigh as much as a full one.
  const pooled = new Map<string, { pairs: number; correct: number }>();
  const sums = new Map<string, { contrarian: number[]; homer: number[] }>();

  for (const issue of polled) {
    const later = laterRanks.get(issue.week) ?? null;
    const voted = new Set<string>();

    for (const ballot of issue.ownersPoll?.ballots ?? []) {
      const row = rows.get(ballot.franchiseId);
      if (!row) continue; // no longer in the league
      voted.add(ballot.franchiseId);
      row.ballotsCast += 1;

      let accuracyPct: number | null = null;
      if (later) {
        const acc = pairwiseAccuracy(ballot.ranking, later);
        accuracyPct = acc.pct;
        const pool = pooled.get(ballot.franchiseId) ?? { pairs: 0, correct: 0 };
        pool.pairs += acc.pairs;
        pool.correct += acc.correct;
        pooled.set(ballot.franchiseId, pool);
      }

      const agg = sums.get(ballot.franchiseId) ?? { contrarian: [], homer: [] };
      if (ballot.contrarianIndex != null) agg.contrarian.push(ballot.contrarianIndex);
      if (ballot.homerIndex != null) agg.homer.push(ballot.homerIndex);
      sums.set(ballot.franchiseId, agg);

      row.weeks.push({
        week: issue.week,
        voted: true,
        accuracyPct,
        contrarianIndex: ballot.contrarianIndex,
        homerIndex: ballot.homerIndex,
      });
    }

    for (const [fid, row] of rows) {
      if (voted.has(fid)) continue;
      row.weeks.push({
        week: issue.week,
        voted: false,
        accuracyPct: null,
        contrarianIndex: null,
        homerIndex: null,
      });
    }
  }

  for (const [fid, row] of rows) {
    const pool = pooled.get(fid);
    if (pool && pool.pairs > 0) {
      row.accuracyPct = pool.correct / pool.pairs;
      row.accuracyPairs = pool.pairs;
    }
    const agg = sums.get(fid);
    if (agg?.contrarian.length) row.contrarianIndex = mean(agg.contrarian);
    if (agg?.homer.length) row.homerIndex = mean(agg.homer);
    row.weeks.sort((a, b) => a.week - b.week);
  }

  const totalBallots = polled.reduce((sum, i) => sum + (i.ownersPoll?.ballotsIn ?? 0), 0);
  const turnoutRate = polled.length
    ? polled.reduce(
        (sum, i) => sum + (i.ownersPoll!.ballotsIn ?? 0) / (i.ownersPoll!.eligibleVoters || 1),
        0,
      ) / polled.length
    : null;

  return {
    weeks: polled.map((i) => i.week),
    voters: Array.from(rows.values()),
    unscoredWeeks: polled.filter((i) => !laterRanks.has(i.week)).map((i) => i.week),
    totalBallots,
    turnoutRate,
  };
}

/**
 * Order for the leaderboard: most accurate first.
 *
 * Voters with NO scorable accuracy sort last regardless of participation —
 * they have not been measured, and floating an unmeasured owner above a
 * measured one would misrepresent the table's whole claim. Ties break on
 * ballots cast, so showing up is the tiebreaker.
 */
export function sortByAccuracy(voters: VoterRow[]): VoterRow[] {
  return [...voters].sort((a, b) => {
    if (a.accuracyPct == null && b.accuracyPct == null) return b.ballotsCast - a.ballotsCast;
    if (a.accuracyPct == null) return 1;
    if (b.accuracyPct == null) return -1;
    return b.accuracyPct - a.accuracyPct || b.ballotsCast - a.ballotsCast;
  });
}

/**
 * The season's most accurate voter — the leaderboard's actual champion.
 *
 * Requires a real sample: with 7 slots a week is only 21 pairs, so crowning
 * anyone off one or two ballots would be noise dressed as an award. Null until
 * the season has enough behind it, and the page says so rather than showing an
 * empty podium.
 */
export function topAccurate(voters: VoterRow[], minPairs = 100): VoterRow | null {
  const ranked = voters
    .filter((v) => v.accuracyPct != null && v.accuracyPairs >= minPairs)
    .sort((a, b) => b.accuracyPct! - a.accuracyPct! || b.ballotsCast - a.ballotsCast);
  return ranked[0] ?? null;
}

/** The owner who simply showed up most. Ties break on accuracy. */
export function topParticipant(voters: VoterRow[]): VoterRow | null {
  const ranked = [...voters]
    .filter((v) => v.ballotsCast > 0)
    .sort((a, b) => b.ballotsCast - a.ballotsCast || (b.accuracyPct ?? 0) - (a.accuracyPct ?? 0));
  return ranked[0] ?? null;
}

/** The season's biggest homer — highest average self-rank premium. */
export function topHomer(voters: VoterRow[]): VoterRow | null {
  const ranked = voters
    .filter((v) => v.homerIndex != null && v.homerIndex > 0)
    .sort((a, b) => b.homerIndex! - a.homerIndex!);
  return ranked[0] ?? null;
}

/** The season's biggest contrarian — furthest from consensus, on average. */
export function topContrarian(voters: VoterRow[]): VoterRow | null {
  const ranked = voters
    .filter((v) => v.contrarianIndex != null)
    .sort((a, b) => b.contrarianIndex! - a.contrarianIndex!);
  return ranked[0] ?? null;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
