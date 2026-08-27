/**
 * Shape of `data/theleague/derived/playoff-performance.json`, written by
 * scripts/compute-playoff-performance.mjs.
 *
 * `topSeed` is the team that took the first-round bye in that season's
 * championship bracket — read off the games, not off standings row order,
 * which is not seed order when teams tie on record. `allPlayLeader` is cut at
 * the regular season; MFL's own all_play_pct spans the playoff weeks too.
 */

export interface PlayoffPerformanceTeam {
  franchiseId: string;
  name: string;
  record: string | null;
}

export interface PlayoffPerformanceSeason {
  year: number;
  lastRegularSeasonWeek: number;
  topSeed: PlayoffPerformanceTeam & { allPlayPct: number | null };
  champion: PlayoffPerformanceTeam;
  runnerUp: PlayoffPerformanceTeam;
  allPlayLeader: PlayoffPerformanceTeam & { allPlayWlt: string; allPlayPct: number };
  topSeedWonTitle: boolean;
  topSeedReachedFinal: boolean;
  allPlayLeaderWonTitle: boolean;
  allPlayLeaderReachedFinal: boolean;
  topSeedIsAllPlayLeader: boolean;
}

export interface PlayoffPerformanceTotals {
  seasons: number;
  topSeedTitles: number;
  topSeedFinals: number;
  allPlayLeaderTitles: number;
  allPlayLeaderFinals: number;
  topSeedIsAllPlayLeader: number;
}

export interface PlayoffPerformanceFile {
  generatedAt: string;
  league: string;
  yearsCovered: number[];
  skipped: { year: number; reason: string }[];
  totals: PlayoffPerformanceTotals;
  seasons: PlayoffPerformanceSeason[];
}
