/**
 * Types for the Surplus Value Calculator utility.
 *
 * Surplus value = the gap between what a player's production is worth in dollars
 * and what they will likely cost at auction. Positive = bargain, negative = overpay.
 */

export interface SurplusValueInput {
  projectedScores: Array<{ id: string; score: string }>;
  players: Array<{
    id: string;
    name: string;
    position: string;
    team: string;
    birthdate?: string;
  }>;
  rosters: Array<{
    id: string;
    player: Array<{
      id: string;
      salary: string;
      contractYear: string;
      status: string;
    }>;
  }>;
  salaryAverages: {
    positions: Record<
      string,
      { top3Average: number; top5Average: number }
    >;
  };
  customRankings?: Map<string, number>; // playerId → rank
  adpDynasty?: Map<string, number>; // playerId → averagePick
}

export interface SurplusValueResult {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  age: number | null;
  projectedPoints: number;
  dollarValue: number; // What their production is worth
  estimatedCost: number; // What they'll likely cost at auction
  surplusValue: number; // dollarValue - estimatedCost
  surplusPercent: number; // surplusValue / estimatedCost as %
  isRostered: boolean;
  currentSalary: number | null;
  contractYears: number | null;
  rank: number | null; // Custom rank or ADP
}
