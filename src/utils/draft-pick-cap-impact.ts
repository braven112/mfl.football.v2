import type { TeamCapSituation } from '../types/auction-predictor';
import {
  ROOKIE_SALARIES_2026 as SHARED_ROOKIE_SALARIES_2026,
  ROUND_3_FLAT_RATE as SHARED_ROUND_3_FLAT_RATE,
} from '../../scripts/lib/rookie-salary-slots.mjs';

// 2026 Rookie Slot Salaries — single source of truth lives in
// scripts/lib/rookie-salary-slots.mjs so it can be imported by both TS
// and .mjs scripts. Re-exported here for existing callers.
// Note: These values escalate by 10% annually after the rookie year.
export const ROOKIE_SALARIES_2026: Record<number, Record<number, Record<string, number>>> =
  SHARED_ROOKIE_SALARIES_2026;

const ROUND_3_FLAT_RATE = SHARED_ROUND_3_FLAT_RATE;

export interface DraftPick {
  round: number;
  pick: number; // Overall pick number
  originalOwner?: string;
}

export interface PositionalNeed {
  position: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  currentDepth: number;
  targetAcquisitions: number;
}

// Positions to include in average salary calculations (exclude PK/DEF — rarely drafted)
const DRAFTABLE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

/**
 * Calculates the average rookie salary across draftable positions (QB/RB/WR/TE) for a given slot.
 * Excludes PK and DEF since they are almost never drafted.
 */
export function calculateAveragePickSalary(round: number, pickInRound: number): number {
  if (round >= 3) {
    const vals = DRAFTABLE_POSITIONS.map((p) => ROUND_3_FLAT_RATE[p]);
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  // Convert pick-in-round to overall pick number for salary table lookup
  const overallPick = round === 2 ? 17 + pickInRound : pickInRound;

  const roundSalaries = ROOKIE_SALARIES_2026[round];
  if (!roundSalaries) {
    const vals = DRAFTABLE_POSITIONS.map((p) => ROUND_3_FLAT_RATE[p]);
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  const salaryRow = roundSalaries[overallPick];
  if (!salaryRow) {
    const vals = DRAFTABLE_POSITIONS.map((p) => ROUND_3_FLAT_RATE[p]);
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  const vals = DRAFTABLE_POSITIONS.map((p) => salaryRow[p]);
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * Calculates the total estimated rookie reserve for a team based on their actual draft picks,
 * using position-averaged slotted salaries.
 */
export function calculateTeamRookieReserve(
  picks: { round: number; pickInRound: number }[]
): number {
  return picks.reduce((total, pick) => {
    return total + calculateAveragePickSalary(pick.round, pick.pickInRound);
  }, 0);
}

/**
 * Calculates the salary for a specific draft pick slot and position
 */
export function calculateDraftPickSalary(round: number, pick: number, position: string): number {
  const pos = position.toUpperCase();
  
  if (round === 3 || pick >= 36) {
    return ROUND_3_FLAT_RATE[pos as keyof typeof ROUND_3_FLAT_RATE] || 425000;
  }
  
  const roundSalaries = ROOKIE_SALARIES_2026[round];
  if (!roundSalaries) return 425000;
  
  // Find the specific pick
  // Note: rules.astro defines pick 17, 34, 35 explicitly, which we mapped above
  const salaryRow = roundSalaries[pick];
  if (salaryRow) {
    return salaryRow[pos as keyof typeof ROUND_3_FLAT_RATE] || 425000;
  }
  
  return 425000;
}

/**
 * Predicts which position a team might draft at a specific slot based on needs
 * This is a heuristic prediction for cap calculation purposes
 */
export function predictDraftPickPosition(
  teamNeeds: PositionalNeed[],
  availableRookies?: any[] // Optional: if we have rookie rankings
): string {
  // Sort needs by priority
  const sortedNeeds = [...teamNeeds].sort((a, b) => {
    const priorityScore = { critical: 4, high: 3, medium: 2, low: 1 };
    return priorityScore[b.priority] - priorityScore[a.priority];
  });
  
  if (sortedNeeds.length > 0) {
    return sortedNeeds[0].position;
  }
  
  // Fallback: Best Athlete Available strategy usually favors WR/RB
  return 'WR'; 
}

/**
 * Calculates the total estimated cap impact of a team's draft picks
 */
export function calculateTotalDraftImpact(
  draftPicks: DraftPick[],
  teamNeeds: PositionalNeed[]
): number {
  let totalImpact = 0;
  
  // Clone needs so we can "satisfy" them as we simulate picks
  const simulatedNeeds = JSON.parse(JSON.stringify(teamNeeds));
  
  for (const pick of draftPicks) {
    const position = predictDraftPickPosition(simulatedNeeds);
    const salary = calculateDraftPickSalary(pick.round, pick.pick, position);
    totalImpact += salary;
    
    // "Satisfy" the need so next pick might address different position
    const needIndex = simulatedNeeds.findIndex((n: PositionalNeed) => n.position === position);
    if (needIndex >= 0) {
      // Lower priority after drafting one
      const currentPriority = simulatedNeeds[needIndex].priority;
      if (currentPriority === 'critical') simulatedNeeds[needIndex].priority = 'high';
      else if (currentPriority === 'high') simulatedNeeds[needIndex].priority = 'medium';
      else if (currentPriority === 'medium') simulatedNeeds[needIndex].priority = 'low';
    }
  }
  
  return totalImpact;
}

/**
 * Analyze team positional needs based on roster depth
 */
export function analyzePositionalNeeds(roster: any[]): PositionalNeed[] {
  const needs: PositionalNeed[] = [];
  const depth: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, PK: 0, DEF: 0 };
  
  // Count depth
  roster.forEach(player => {
    if (depth[player.position] !== undefined) {
      depth[player.position]++;
    }
  });
  
  // Define requirements (Starter + Depth)
  // QB: 1 starter, 1 backup preferred
  if (depth.QB < 1) needs.push({ position: 'QB', priority: 'critical', currentDepth: depth.QB, targetAcquisitions: 1 });
  else if (depth.QB < 2) needs.push({ position: 'QB', priority: 'medium', currentDepth: depth.QB, targetAcquisitions: 1 });
  
  // RB: 2-3 starters (flex), backups needed
  if (depth.RB < 2) needs.push({ position: 'RB', priority: 'critical', currentDepth: depth.RB, targetAcquisitions: 2 });
  else if (depth.RB < 4) needs.push({ position: 'RB', priority: 'high', currentDepth: depth.RB, targetAcquisitions: 1 });
  else needs.push({ position: 'RB', priority: 'low', currentDepth: depth.RB, targetAcquisitions: 0 });
  
  // WR: 3-4 starters, backups needed
  if (depth.WR < 3) needs.push({ position: 'WR', priority: 'critical', currentDepth: depth.WR, targetAcquisitions: 2 });
  else if (depth.WR < 5) needs.push({ position: 'WR', priority: 'high', currentDepth: depth.WR, targetAcquisitions: 1 });
  else needs.push({ position: 'WR', priority: 'low', currentDepth: depth.WR, targetAcquisitions: 0 });
  
  // TE: 1 starter
  if (depth.TE < 1) needs.push({ position: 'TE', priority: 'critical', currentDepth: depth.TE, targetAcquisitions: 1 });
  else if (depth.TE < 2) needs.push({ position: 'TE', priority: 'medium', currentDepth: depth.TE, targetAcquisitions: 1 });
  
  // PK/DEF
  if (depth.PK < 1) needs.push({ position: 'PK', priority: 'medium', currentDepth: depth.PK, targetAcquisitions: 1 });
  if (depth.DEF < 1) needs.push({ position: 'DEF', priority: 'medium', currentDepth: depth.DEF, targetAcquisitions: 1 });
  
  return needs;
}
