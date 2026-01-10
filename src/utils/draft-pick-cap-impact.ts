import type { TeamCapSituation } from '../types/auction-predictor';

// 2026 Rookie Slot Salaries (from rules.astro)
// Note: These values escalate by 10% annually after the rookie year
export const ROOKIE_SALARIES_2026: Record<number, Record<number, Record<string, number>>> = {
  // Round 1
  1: {
    1: { QB: 3000000, RB: 3400000, WR: 3500000, TE: 2500000, PK: 575000, DEF: 575000 },
    2: { QB: 2650000, RB: 3100000, WR: 3200000, TE: 2100000, PK: 525000, DEF: 525000 },
    3: { QB: 2300000, RB: 2600000, WR: 2900000, TE: 1800000, PK: 500000, DEF: 500000 },
    4: { QB: 1900000, RB: 2200000, WR: 2600000, TE: 1500000, PK: 450000, DEF: 450000 },
    5: { QB: 1600000, RB: 1800000, WR: 2300000, TE: 1250000, PK: 450000, DEF: 450000 },
    6: { QB: 1300000, RB: 1600000, WR: 2000000, TE: 1100000, PK: 450000, DEF: 450000 },
    7: { QB: 1100000, RB: 1400000, WR: 1850000, TE: 950000, PK: 450000, DEF: 450000 },
    8: { QB: 1000000, RB: 1200000, WR: 1675000, TE: 850000, PK: 450000, DEF: 450000 },
    9: { QB: 925000, RB: 1100000, WR: 1550000, TE: 775000, PK: 450000, DEF: 450000 },
    10: { QB: 875000, RB: 1000000, WR: 1400000, TE: 775000, PK: 450000, DEF: 450000 },
    11: { QB: 825000, RB: 900000, WR: 1350000, TE: 700000, PK: 450000, DEF: 450000 },
    12: { QB: 800000, RB: 850000, WR: 1225000, TE: 675000, PK: 450000, DEF: 450000 },
    13: { QB: 750000, RB: 800000, WR: 1150000, TE: 650000, PK: 450000, DEF: 450000 },
    14: { QB: 700000, RB: 750000, WR: 1075000, TE: 650000, PK: 450000, DEF: 450000 },
    15: { QB: 675000, RB: 725000, WR: 1000000, TE: 625000, PK: 450000, DEF: 450000 },
    16: { QB: 650000, RB: 700000, WR: 900000, TE: 625000, PK: 450000, DEF: 450000 },
    // Toilet Bowl Pick (Round 1, Pick 17)
    17: { QB: 625000, RB: 650000, WR: 800000, TE: 600000, PK: 450000, DEF: 450000 },
  },
  // Round 2
  2: {
    18: { QB: 575000, RB: 600000, WR: 700000, TE: 600000, PK: 425000, DEF: 425000 },
    19: { QB: 525000, RB: 575000, WR: 650000, TE: 550000, PK: 425000, DEF: 425000 },
    20: { QB: 525000, RB: 550000, WR: 625000, TE: 550000, PK: 425000, DEF: 425000 },
    21: { QB: 500000, RB: 525000, WR: 600000, TE: 525000, PK: 425000, DEF: 425000 },
    22: { QB: 475000, RB: 500000, WR: 575000, TE: 525000, PK: 425000, DEF: 425000 },
    23: { QB: 475000, RB: 500000, WR: 575000, TE: 500000, PK: 425000, DEF: 425000 },
    24: { QB: 475000, RB: 475000, WR: 550000, TE: 475000, PK: 425000, DEF: 425000 },
    25: { QB: 475000, RB: 475000, WR: 550000, TE: 475000, PK: 425000, DEF: 425000 },
    26: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    27: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    28: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    29: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    30: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    31: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    32: { QB: 475000, RB: 475000, WR: 525000, TE: 475000, PK: 425000, DEF: 425000 },
    33: { QB: 475000, RB: 475000, WR: 500000, TE: 475000, PK: 425000, DEF: 425000 },
    // Toilet Bowl Picks (Round 2, Pick 17 & 18)
    34: { QB: 475000, RB: 475000, WR: 500000, TE: 475000, PK: 425000, DEF: 425000 },
    35: { QB: 475000, RB: 475000, WR: 500000, TE: 475000, PK: 425000, DEF: 425000 },
  }
};

const ROUND_3_FLAT_RATE = {
  QB: 450000, RB: 450000, WR: 475000, TE: 450000, PK: 425000, DEF: 425000
};

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
