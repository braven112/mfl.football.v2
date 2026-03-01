/**
 * Surplus Value Calculator Types
 *
 * Types for converting projected fantasy points into dollar values
 * and comparing against estimated auction costs.
 */

export interface PositionSalaryBenchmark {
  top3Average: number;
  top5Average: number;
  medianSalary?: number;
  starterMedian?: number;
  averageSalary?: number;
}

export interface SurplusValueInput {
  leagueYear?: number;
  projectedScores: Array<{ id: string; score: string }>;
  players: Array<{
    id: string;
    name: string;
    position: string;
    team: string;
    birthdate?: string;
    draftYear?: number;
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
    positions: Record<string, PositionSalaryBenchmark>;
  };
  customRankings?: Map<string, number>;
  adpDynasty?: Map<string, number>;
}

export interface SurplusValueResult {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  age: number | null;
  projectedPoints: number;
  dollarValue: number;
  estimatedCost: number;
  surplusValue: number;
  surplusPercent: number;
  isRostered: boolean;
  currentSalary: number | null;
  contractYears: number | null;
  rank: number | null;
}
