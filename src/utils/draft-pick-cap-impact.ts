/**
 * Draft Pick Cap Impact Calculator
 * 
 * Calculates the cap space impact of draft picks by:
 * - Predicting which position each team will draft
 * - Applying slotted rookie salaries by position and round
 * - Summing total draft commitments per team
 * 
 * This helps project 2026 cap space by accounting for incoming rookies.
 */

import type { PlayerValuation } from '../types/auction-predictor';

/**
 * Draft pick information
 */
export interface DraftPick {
  round: number;
  pick: number; // Pick number within round (1-16)
  overallPick: number; // Overall pick number (1-48)
  franchiseId: string;
  originalOwner?: string; // If traded
  isTraded: boolean;
}

/**
 * Predicted draft selection
 */
export interface DraftPickPrediction {
  pick: DraftPick;
  predictedPosition: 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF';
  estimatedSalary: number;
  confidence: number; // 0-1
  reasoning: string;
}

/**
 * Team's draft impact analysis
 */
export interface TeamDraftImpact {
  franchiseId: string;
  teamName: string;
  totalPicks: number;
  picksByRound: {
    round1: number;
    round2: number;
    round3: number;
  };
  predictions: DraftPickPrediction[];
  totalCapCommitment: number;
  averageSalaryPerPick: number;
}

/**
 * Positional need assessment
 */
export interface PositionalNeed {
  position: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  currentStarters: number; // Quality starters on roster
  targetStarters: number; // Desired for position
  gap: number; // How many needed
}

/**
 * Rookie salary slotting by position and round
 * Based on league-specific salary structure
 */
const ROOKIE_SALARIES = {
  QB: {
    round1: {
      early: 900_000, // Picks 1-5
      mid: 850_000, // Picks 6-11
      late: 800_000, // Picks 12-16
    },
    round2: {
      early: 700_000,
      mid: 650_000,
      late: 600_000,
    },
    round3: {
      early: 550_000,
      mid: 500_000,
      late: 450_000,
    },
  },
  RB: {
    round1: {
      early: 800_000,
      mid: 750_000,
      late: 700_000,
    },
    round2: {
      early: 600_000,
      mid: 550_000,
      late: 500_000,
    },
    round3: {
      early: 450_000,
      mid: 425_000,
      late: 425_000, // League minimum
    },
  },
  WR: {
    round1: {
      early: 850_000,
      mid: 800_000,
      late: 750_000,
    },
    round2: {
      early: 650_000,
      mid: 600_000,
      late: 550_000,
    },
    round3: {
      early: 500_000,
      mid: 450_000,
      late: 425_000,
    },
  },
  TE: {
    round1: {
      early: 750_000,
      mid: 700_000,
      late: 650_000,
    },
    round2: {
      early: 550_000,
      mid: 500_000,
      late: 475_000,
    },
    round3: {
      early: 450_000,
      mid: 425_000,
      late: 425_000,
    },
  },
  PK: {
    round1: {
      early: 450_000,
      mid: 450_000,
      late: 425_000,
    },
    round2: {
      early: 425_000,
      mid: 425_000,
      late: 425_000,
    },
    round3: {
      early: 425_000,
      mid: 425_000,
      late: 425_000,
    },
  },
  DEF: {
    round1: {
      early: 500_000,
      mid: 475_000,
      late: 450_000,
    },
    round2: {
      early: 450_000,
      mid: 425_000,
      late: 425_000,
    },
    round3: {
      early: 425_000,
      mid: 425_000,
      late: 425_000,
    },
  },
};

const LEAGUE_MINIMUM = 425_000;

/**
 * Get salary tier based on pick number within round
 */
function getPickTier(pickInRound: number): 'early' | 'mid' | 'late' {
  if (pickInRound <= 5) return 'early';
  if (pickInRound <= 11) return 'mid';
  return 'late';
}

/**
 * Calculate rookie salary for a position and pick
 */
export function calculateDraftPickSalary(
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF',
  round: number,
  pickInRound: number
): number {
  // Validate round
  if (round < 1 || round > 3) {
    return LEAGUE_MINIMUM;
  }
  
  const roundKey = `round${round}` as 'round1' | 'round2' | 'round3';
  const tier = getPickTier(pickInRound);
  
  const positionSalaries = ROOKIE_SALARIES[position];
  if (!positionSalaries || !positionSalaries[roundKey]) {
    return LEAGUE_MINIMUM;
  }
  
  return positionSalaries[roundKey][tier];
}

/**
 * Analyze team's positional needs based on current roster
 */
export function analyzePositionalNeeds(
  roster: PlayerValuation[],
  positionRequirements: Record<string, number> = {
    QB: 2, // Want 2 quality QBs
    RB: 4, // Want 4 RBs (2 starters + depth)
    WR: 6, // Want 6 WRs (3 starters + depth)
    TE: 2, // Want 2 TEs
    PK: 1, // Want 1 kicker
    DEF: 1, // Want 1 defense
  }
): PositionalNeed[] {
  const needs: PositionalNeed[] = [];
  
  // Count quality starters by position (top 100 overall or position-specific threshold)
  const positionCounts: Record<string, number> = {};
  
  roster.forEach(player => {
    const isQualityStarter = (player.compositeRank || 999) <= 150;
    
    if (isQualityStarter) {
      positionCounts[player.position] = (positionCounts[player.position] || 0) + 1;
    }
  });
  
  // Determine needs for each position
  Object.entries(positionRequirements).forEach(([position, target]) => {
    const current = positionCounts[position] || 0;
    const gap = Math.max(0, target - current);
    
    let priority: 'critical' | 'high' | 'medium' | 'low';
    
    if (gap >= 2) {
      priority = 'critical';
    } else if (gap === 1) {
      priority = 'high';
    } else if (current === target) {
      priority = 'low';
    } else {
      priority = 'medium';
    }
    
    needs.push({
      position,
      priority,
      currentStarters: current,
      targetStarters: target,
      gap,
    });
  });
  
  // Sort by priority (critical first)
  return needs.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Predict which position a team will draft with a specific pick
 */
export function predictDraftPickPosition(
  pick: DraftPick,
  positionalNeeds: PositionalNeed[],
  championshipWindow: 'contending' | 'neutral' | 'rebuilding' = 'neutral'
): DraftPickPrediction {
  const pickInRound = pick.pick;
  
  // Filter to positions with needs
  const positionsWithNeeds = positionalNeeds.filter(n => n.gap > 0);
  
  if (positionsWithNeeds.length === 0) {
    // No clear need - default to best player available (WR as default)
    return {
      pick,
      predictedPosition: 'WR',
      estimatedSalary: calculateDraftPickSalary('WR', pick.round, pickInRound),
      confidence: 0.3,
      reasoning: 'No critical needs - best player available',
    };
  }
  
  // Different draft strategies based on championship window
  let predictedPosition: 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF';
  let confidence = 0.6;
  let reasoning = '';
  
  // Find most critical need
  const criticalNeed = positionsWithNeeds[0];
  
  // Round 1 strategy
  if (pick.round === 1) {
    if (championshipWindow === 'contending') {
      // Contenders prioritize RB/WR for immediate impact
      if (criticalNeed.position === 'QB' && criticalNeed.priority === 'critical') {
        predictedPosition = 'QB';
        reasoning = 'Critical QB need for contender';
        confidence = 0.8;
      } else if (['RB', 'WR'].includes(criticalNeed.position)) {
        predictedPosition = criticalNeed.position as 'RB' | 'WR';
        reasoning = `${criticalNeed.position} need for win-now roster`;
        confidence = 0.7;
      } else {
        predictedPosition = 'WR';
        reasoning = 'Adding WR depth for contender';
        confidence = 0.5;
      }
    } else if (championshipWindow === 'rebuilding') {
      // Rebuilders prioritize QB/WR for future
      if (criticalNeed.position === 'QB') {
        predictedPosition = 'QB';
        reasoning = 'QB is foundation of rebuild';
        confidence = 0.9;
      } else if (criticalNeed.position === 'WR') {
        predictedPosition = 'WR';
        reasoning = 'Young WR for long-term value';
        confidence = 0.8;
      } else {
        predictedPosition = 'WR';
        reasoning = 'Best available young WR';
        confidence = 0.6;
      }
    } else {
      // Neutral teams take best available at need position
      predictedPosition = criticalNeed.position as any;
      reasoning = `${criticalNeed.position} is highest priority need`;
      confidence = 0.7;
    }
  } 
  // Round 2 strategy
  else if (pick.round === 2) {
    // Take next highest need or RB/WR depth
    if (criticalNeed.priority === 'critical') {
      predictedPosition = criticalNeed.position as any;
      reasoning = `Address critical ${criticalNeed.position} need`;
      confidence = 0.6;
    } else {
      // Default to RB/WR depth
      const rbNeed = positionsWithNeeds.find(n => n.position === 'RB');
      const wrNeed = positionsWithNeeds.find(n => n.position === 'WR');
      
      if (rbNeed && rbNeed.gap > 0) {
        predictedPosition = 'RB';
        reasoning = 'RB depth in round 2';
        confidence = 0.5;
      } else if (wrNeed && wrNeed.gap > 0) {
        predictedPosition = 'WR';
        reasoning = 'WR depth in round 2';
        confidence = 0.5;
      } else {
        predictedPosition = criticalNeed.position as any;
        reasoning = 'Best available at need position';
        confidence = 0.4;
      }
    }
  } 
  // Round 3 strategy
  else {
    // Round 3 is more speculative - fill remaining needs or dart throws
    if (positionsWithNeeds.length > 0) {
      predictedPosition = criticalNeed.position as any;
      reasoning = `Fill remaining ${criticalNeed.position} depth`;
      confidence = 0.4;
    } else {
      // No needs - speculative pick
      predictedPosition = 'RB';
      reasoning = 'Speculative RB upside pick';
      confidence = 0.3;
    }
  }
  
  const estimatedSalary = calculateDraftPickSalary(predictedPosition, pick.round, pickInRound);
  
  return {
    pick,
    predictedPosition,
    estimatedSalary,
    confidence,
    reasoning,
  };
}

/**
 * Calculate total draft impact for a team
 */
export function calculateTotalDraftImpact(
  franchiseId: string,
  teamName: string,
  draftPicks: DraftPick[],
  roster: PlayerValuation[],
  championshipWindow: 'contending' | 'neutral' | 'rebuilding' = 'neutral'
): TeamDraftImpact {
  // Handle edge case: no picks
  if (draftPicks.length === 0) {
    return {
      franchiseId,
      teamName,
      totalPicks: 0,
      picksByRound: { round1: 0, round2: 0, round3: 0 },
      predictions: [],
      totalCapCommitment: 0,
      averageSalaryPerPick: 0,
    };
  }
  
  // Handle edge case: 10+ picks (cap at roster spots available)
  const maxPicks = 22; // Max roster size
  const currentRosterSize = roster.length;
  const spotsAvailable = Math.max(0, maxPicks - currentRosterSize);
  const picksToUse = draftPicks.slice(0, Math.min(draftPicks.length, spotsAvailable + 3)); // Allow some extras for cuts
  
  // Analyze positional needs
  const positionalNeeds = analyzePositionalNeeds(roster);
  
  // Predict each pick
  const predictions: DraftPickPrediction[] = [];
  const usedPositions: Record<string, number> = {}; // Track how many times we've predicted each position
  
  picksToUse.forEach(pick => {
    // Adjust positional needs based on picks already predicted
    const adjustedNeeds = positionalNeeds.map(need => ({
      ...need,
      gap: Math.max(0, need.gap - (usedPositions[need.position] || 0)),
    })).sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    const prediction = predictDraftPickPosition(pick, adjustedNeeds, championshipWindow);
    predictions.push(prediction);
    
    // Track position usage
    usedPositions[prediction.predictedPosition] = (usedPositions[prediction.predictedPosition] || 0) + 1;
  });
  
  // Count picks by round
  const picksByRound = {
    round1: picksToUse.filter(p => p.round === 1).length,
    round2: picksToUse.filter(p => p.round === 2).length,
    round3: picksToUse.filter(p => p.round === 3).length,
  };
  
  // Calculate total cap commitment
  const totalCapCommitment = predictions.reduce((sum, pred) => sum + pred.estimatedSalary, 0);
  const averageSalaryPerPick = predictions.length > 0 ? totalCapCommitment / predictions.length : 0;
  
  return {
    franchiseId,
    teamName,
    totalPicks: picksToUse.length,
    picksByRound,
    predictions,
    totalCapCommitment,
    averageSalaryPerPick,
  };
}

/**
 * Calculate draft impact for all teams
 */
export function calculateAllTeamsDraftImpact(
  teams: Array<{
    franchiseId: string;
    teamName: string;
    draftPicks: DraftPick[];
    roster: PlayerValuation[];
    championshipWindow?: 'contending' | 'neutral' | 'rebuilding';
  }>
): TeamDraftImpact[] {
  return teams.map(team => 
    calculateTotalDraftImpact(
      team.franchiseId,
      team.teamName,
      team.draftPicks,
      team.roster,
      team.championshipWindow || 'neutral'
    )
  );
}

/**
 * Get summary statistics across all teams
 */
export function getDraftImpactSummary(impacts: TeamDraftImpact[]): {
  totalPicks: number;
  totalCapCommitment: number;
  averageCapPerTeam: number;
  highestCommitment: { teamName: string; amount: number };
  lowestCommitment: { teamName: string; amount: number };
} {
  const totalPicks = impacts.reduce((sum, impact) => sum + impact.totalPicks, 0);
  const totalCapCommitment = impacts.reduce((sum, impact) => sum + impact.totalCapCommitment, 0);
  const averageCapPerTeam = impacts.length > 0 ? totalCapCommitment / impacts.length : 0;
  
  const sorted = [...impacts].sort((a, b) => b.totalCapCommitment - a.totalCapCommitment);
  
  return {
    totalPicks,
    totalCapCommitment,
    averageCapPerTeam,
    highestCommitment: {
      teamName: sorted[0]?.teamName || 'N/A',
      amount: sorted[0]?.totalCapCommitment || 0,
    },
    lowestCommitment: {
      teamName: sorted[sorted.length - 1]?.teamName || 'N/A',
      amount: sorted[sorted.length - 1]?.totalCapCommitment || 0,
    },
  };
}
