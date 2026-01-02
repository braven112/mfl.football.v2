/**
 * Championship Window Detector
 * 
 * Automatically detects whether each team is in a championship window
 * (contending), rebuilding, or neutral based on:
 * - Roster strength (player rankings)
 * - Draft capital (1st/2nd round picks)
 * - Cap flexibility
 * - Age curve of roster
 * 
 * This helps inform auction strategy and contract length recommendations.
 */

import type { PlayerValuation, TeamCapSituation } from '../types/auction-predictor';

/**
 * Championship window classification
 */
export type ChampionshipWindow = 'contending' | 'neutral' | 'rebuilding';

/**
 * Championship window analysis for a team
 */
export interface ChampionshipWindowAnalysis {
  franchiseId: string;
  teamName: string;
  window: ChampionshipWindow;
  score: number; // 0-100 (higher = more likely contending)
  confidence: number; // 0-1 (how certain we are)
  
  // Component Scores
  rosterStrengthScore: number; // 0-100
  draftCapitalScore: number; // 0-100
  capFlexibilityScore: number; // 0-100
  ageCurveScore: number; // 0-100
  
  // Reasoning
  reasoning: string[];
  strengths: string[];
  weaknesses: string[];
  
  // Manual Override
  isManualOverride: boolean;
  originalWindow?: ChampionshipWindow;
}

/**
 * Draft pick information
 */
interface DraftPick {
  round: number;
  pick: number;
  originalOwner?: string;
}

/**
 * Team roster with player valuations
 */
interface TeamRoster {
  franchiseId: string;
  teamName: string;
  players: PlayerValuation[];
  draftPicks: DraftPick[];
}

// Scoring thresholds
const CONTENDING_THRESHOLD = 70;
const REBUILDING_THRESHOLD = 40;

// Position starter requirements
const STARTING_LINEUP = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 1,
  PK: 1,
  DEF: 1,
};

// Weight factors for overall score
const WEIGHTS = {
  rosterStrength: 0.45,  // Most important
  draftCapital: 0.20,
  capFlexibility: 0.20,
  ageCurve: 0.15,
};

/**
 * Calculate roster strength score based on player rankings
 */
function calculateRosterStrengthScore(players: PlayerValuation[]): {
  score: number;
  reasoning: string[];
  topPlayers: PlayerValuation[];
} {
  const reasoning: string[] = [];
  
  // Filter to players with composite ranks
  const rankedPlayers = players
    .filter(p => p.compositeRank !== undefined)
    .sort((a, b) => (a.compositeRank || 999) - (b.compositeRank || 999));
  
  if (rankedPlayers.length === 0) {
    return { score: 50, reasoning: ['No ranked players on roster'], topPlayers: [] };
  }
  
  // Get best players to fill starting lineup (QB, 2RB, 3WR, TE, PK, DEF = 9 starters)
  // Plus depth (top 12 total)
  const topPlayers = rankedPlayers.slice(0, 12);
  
  // Calculate average rank of top 12
  const avgRank = topPlayers.reduce((sum, p) => sum + (p.compositeRank || 300), 0) / topPlayers.length;
  
  // Score based on average rank (lower rank = better)
  // Rank 1-50 = elite (90-100 score)
  // Rank 51-100 = strong (70-89 score)
  // Rank 101-150 = average (50-69 score)
  // Rank 151-200 = weak (30-49 score)
  // Rank 200+ = rebuilding (0-29 score)
  let score = 100;
  if (avgRank <= 50) {
    score = 90 + (50 - avgRank) / 5; // 90-100
    reasoning.push(`Elite roster strength (avg rank: ${Math.round(avgRank)})`);
  } else if (avgRank <= 100) {
    score = 70 + (100 - avgRank) / 2.5; // 70-89
    reasoning.push(`Strong roster (avg rank: ${Math.round(avgRank)})`);
  } else if (avgRank <= 150) {
    score = 50 + (150 - avgRank) / 2.5; // 50-69
    reasoning.push(`Average roster (avg rank: ${Math.round(avgRank)})`);
  } else if (avgRank <= 200) {
    score = 30 + (200 - avgRank) / 2.5; // 30-49
    reasoning.push(`Below average roster (avg rank: ${Math.round(avgRank)})`);
  } else {
    score = Math.max(0, 30 - (avgRank - 200) / 10); // 0-29
    reasoning.push(`Weak roster (avg rank: ${Math.round(avgRank)})`);
  }
  
  // Check for elite top-end talent (top 20 overall players)
  const elitePlayers = topPlayers.filter(p => (p.compositeRank || 999) <= 20);
  if (elitePlayers.length >= 2) {
    score = Math.min(100, score + 5);
    reasoning.push(`${elitePlayers.length} elite players (top 20 overall)`);
  }
  
  // Check for positional balance
  const positionCounts = topPlayers.reduce((acc, p) => {
    acc[p.position] = (acc[p.position] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const hasBalancedRoster = 
    (positionCounts.QB || 0) >= 1 &&
    (positionCounts.RB || 0) >= 2 &&
    (positionCounts.WR || 0) >= 3 &&
    (positionCounts.TE || 0) >= 1;
  
  if (!hasBalancedRoster) {
    score = Math.max(0, score - 10);
    reasoning.push('Positional imbalance in starting lineup');
  }
  
  return { score: Math.round(score), reasoning, topPlayers };
}

/**
 * Calculate draft capital score based on picks owned
 */
function calculateDraftCapitalScore(draftPicks: DraftPick[]): {
  score: number;
  reasoning: string[];
} {
  const reasoning: string[] = [];
  
  if (draftPicks.length === 0) {
    return { score: 0, reasoning: ['No draft picks'] };
  }
  
  // Count premium picks (1st and 2nd round)
  const firstRoundPicks = draftPicks.filter(p => p.round === 1);
  const secondRoundPicks = draftPicks.filter(p => p.round === 2);
  const premiumPicks = firstRoundPicks.length + secondRoundPicks.length;
  
  // Score based on number of premium picks
  // 0-1 picks = poor (0-40)
  // 2-3 picks = average (41-70)
  // 4-5 picks = strong (71-90)
  // 6+ picks = elite (91-100)
  let score = 0;
  
  if (premiumPicks === 0) {
    score = 0;
    reasoning.push('No 1st or 2nd round picks');
  } else if (premiumPicks === 1) {
    score = 40;
    reasoning.push('Limited draft capital (1 early pick)');
  } else if (premiumPicks === 2) {
    score = 55;
    reasoning.push('Average draft capital (2 early picks)');
  } else if (premiumPicks === 3) {
    score = 70;
    reasoning.push('Good draft capital (3 early picks)');
  } else if (premiumPicks === 4) {
    score = 80;
    reasoning.push('Strong draft capital (4 early picks)');
  } else if (premiumPicks === 5) {
    score = 90;
    reasoning.push('Excellent draft capital (5 early picks)');
  } else {
    score = 100;
    reasoning.push(`Elite draft capital (${premiumPicks} early picks)`);
  }
  
  // Bonus for early 1st round picks (top 5)
  const topPicks = firstRoundPicks.filter(p => p.pick <= 5);
  if (topPicks.length > 0) {
    score = Math.min(100, score + (topPicks.length * 5));
    reasoning.push(`${topPicks.length} top-5 pick(s)`);
  }
  
  // Penalty for no 1st round picks
  if (firstRoundPicks.length === 0 && premiumPicks > 0) {
    score = Math.max(0, score - 15);
    reasoning.push('Missing 1st round picks');
  }
  
  return { score: Math.round(score), reasoning };
}

/**
 * Calculate cap flexibility score
 */
function calculateCapFlexibilityScore(capSpace: number, totalCap: number = 45_000_000): {
  score: number;
  reasoning: string[];
} {
  const reasoning: string[] = [];
  const capPercentage = (capSpace / totalCap) * 100;
  
  // Score based on available cap space percentage
  // 40%+ = elite flexibility (90-100)
  // 30-40% = strong (75-89)
  // 20-30% = average (55-74)
  // 10-20% = tight (35-54)
  // 0-10% = very tight (15-34)
  // Negative = over cap (0-14)
  let score = 0;
  
  if (capPercentage >= 40) {
    score = 90 + Math.min(10, (capPercentage - 40) / 2);
    reasoning.push(`Excellent cap flexibility ($${(capSpace / 1_000_000).toFixed(1)}M, ${Math.round(capPercentage)}%)`);
  } else if (capPercentage >= 30) {
    score = 75 + (capPercentage - 30) * 1.5;
    reasoning.push(`Strong cap flexibility ($${(capSpace / 1_000_000).toFixed(1)}M)`);
  } else if (capPercentage >= 20) {
    score = 55 + (capPercentage - 20) * 2;
    reasoning.push(`Average cap flexibility ($${(capSpace / 1_000_000).toFixed(1)}M)`);
  } else if (capPercentage >= 10) {
    score = 35 + (capPercentage - 10) * 2;
    reasoning.push(`Tight cap situation ($${(capSpace / 1_000_000).toFixed(1)}M)`);
  } else if (capPercentage >= 0) {
    score = 15 + capPercentage * 2;
    reasoning.push(`Very tight cap ($${(capSpace / 1_000_000).toFixed(1)}M)`);
  } else {
    score = Math.max(0, 15 + capPercentage); // Penalty for over cap
    reasoning.push(`Over cap limit ($${(capSpace / 1_000_000).toFixed(1)}M)`);
  }
  
  return { score: Math.round(score), reasoning };
}

/**
 * Calculate age curve score (younger = better for dynasty)
 */
function calculateAgeCurveScore(players: PlayerValuation[]): {
  score: number;
  reasoning: string[];
} {
  const reasoning: string[] = [];
  
  // Filter to players with ages
  const playersWithAge = players.filter(p => p.age !== undefined);
  
  if (playersWithAge.length === 0) {
    return { score: 50, reasoning: ['Age data unavailable'] };
  }
  
  // Get top 12 players for age analysis
  const topPlayers = players
    .filter(p => p.compositeRank !== undefined && p.age !== undefined)
    .sort((a, b) => (a.compositeRank || 999) - (b.compositeRank || 999))
    .slice(0, 12);
  
  if (topPlayers.length === 0) {
    return { score: 50, reasoning: ['Insufficient data for age analysis'] };
  }
  
  const avgAge = topPlayers.reduce((sum, p) => sum + (p.age || 28), 0) / topPlayers.length;
  
  // Score based on average age
  // < 24 = very young (90-100)
  // 24-26 = young (75-89)
  // 26-28 = prime (60-74)
  // 28-30 = aging (40-59)
  // 30+ = old (0-39)
  let score = 0;
  
  if (avgAge < 24) {
    score = 90 + Math.min(10, (24 - avgAge) * 5);
    reasoning.push(`Very young core (avg age: ${avgAge.toFixed(1)})`);
  } else if (avgAge < 26) {
    score = 75 + (26 - avgAge) * 7.5;
    reasoning.push(`Young core (avg age: ${avgAge.toFixed(1)})`);
  } else if (avgAge < 28) {
    score = 60 + (28 - avgAge) * 7.5;
    reasoning.push(`Prime age core (avg age: ${avgAge.toFixed(1)})`);
  } else if (avgAge < 30) {
    score = 40 + (30 - avgAge) * 10;
    reasoning.push(`Aging core (avg age: ${avgAge.toFixed(1)})`);
  } else {
    score = Math.max(0, 40 - (avgAge - 30) * 8);
    reasoning.push(`Old core (avg age: ${avgAge.toFixed(1)})`);
  }
  
  // Bonus for having multiple young stars (under 25, top 50 overall)
  const youngStars = topPlayers.filter(p => (p.age || 30) < 25 && (p.compositeRank || 999) <= 50);
  if (youngStars.length >= 2) {
    score = Math.min(100, score + (youngStars.length * 5));
    reasoning.push(`${youngStars.length} young star(s) under 25`);
  }
  
  // Penalty for having multiple aging stars (over 30, in top 12)
  const agingStars = topPlayers.filter(p => (p.age || 25) >= 30);
  if (agingStars.length >= 3) {
    score = Math.max(0, score - (agingStars.length * 3));
    reasoning.push(`${agingStars.length} aging player(s) over 30`);
  }
  
  return { score: Math.round(score), reasoning };
}

/**
 * Detect championship window for a team
 */
export function detectChampionshipWindow(
  teamRoster: TeamRoster,
  capSituation: TeamCapSituation
): ChampionshipWindowAnalysis {
  // Calculate component scores
  const rosterStrength = calculateRosterStrengthScore(teamRoster.players);
  const draftCapital = calculateDraftCapitalScore(teamRoster.draftPicks);
  const capFlexibility = calculateCapFlexibilityScore(capSituation.projectedCapSpace2026);
  const ageCurve = calculateAgeCurveScore(teamRoster.players);
  
  // Calculate weighted overall score
  const overallScore = Math.round(
    rosterStrength.score * WEIGHTS.rosterStrength +
    draftCapital.score * WEIGHTS.draftCapital +
    capFlexibility.score * WEIGHTS.capFlexibility +
    ageCurve.score * WEIGHTS.ageCurve
  );
  
  // Determine window
  let window: ChampionshipWindow;
  if (overallScore >= CONTENDING_THRESHOLD) {
    window = 'contending';
  } else if (overallScore <= REBUILDING_THRESHOLD) {
    window = 'rebuilding';
  } else {
    window = 'neutral';
  }
  
  // Calculate confidence (how close to thresholds)
  let confidence = 0;
  if (window === 'contending') {
    // More confident the further above 70
    confidence = Math.min(1, 0.7 + (overallScore - CONTENDING_THRESHOLD) / 100);
  } else if (window === 'rebuilding') {
    // More confident the further below 40
    confidence = Math.min(1, 0.7 + (REBUILDING_THRESHOLD - overallScore) / 100);
  } else {
    // Neutral is less confident (closer to thresholds = less certain)
    const distanceFromContending = Math.abs(overallScore - CONTENDING_THRESHOLD);
    const distanceFromRebuilding = Math.abs(overallScore - REBUILDING_THRESHOLD);
    const minDistance = Math.min(distanceFromContending, distanceFromRebuilding);
    confidence = Math.max(0.4, 0.7 - minDistance / 50);
  }
  
  // Compile reasoning
  const reasoning: string[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  
  // Add component reasoning
  reasoning.push(...rosterStrength.reasoning);
  reasoning.push(...draftCapital.reasoning);
  reasoning.push(...capFlexibility.reasoning);
  reasoning.push(...ageCurve.reasoning);
  
  // Identify strengths and weaknesses
  if (rosterStrength.score >= 70) {
    strengths.push('Strong roster talent');
  } else if (rosterStrength.score <= 40) {
    weaknesses.push('Weak roster talent');
  }
  
  if (draftCapital.score >= 70) {
    strengths.push('Excellent draft capital');
  } else if (draftCapital.score <= 40) {
    weaknesses.push('Limited draft capital');
  }
  
  if (capFlexibility.score >= 70) {
    strengths.push('Good cap flexibility');
  } else if (capFlexibility.score <= 40) {
    weaknesses.push('Cap constraints');
  }
  
  if (ageCurve.score >= 70) {
    strengths.push('Young core for future');
  } else if (ageCurve.score <= 40) {
    weaknesses.push('Aging roster');
  }
  
  return {
    franchiseId: teamRoster.franchiseId,
    teamName: teamRoster.teamName,
    window,
    score: overallScore,
    confidence,
    rosterStrengthScore: rosterStrength.score,
    draftCapitalScore: draftCapital.score,
    capFlexibilityScore: capFlexibility.score,
    ageCurveScore: ageCurve.score,
    reasoning,
    strengths,
    weaknesses,
    isManualOverride: false,
  };
}

/**
 * Detect championship windows for all teams
 */
export function detectAllChampionshipWindows(
  teamRosters: TeamRoster[],
  capSituations: TeamCapSituation[]
): ChampionshipWindowAnalysis[] {
  const capMap = new Map(capSituations.map(c => [c.franchiseId, c]));
  
  return teamRosters.map(roster => {
    const capSituation = capMap.get(roster.franchiseId);
    
    if (!capSituation) {
      // Create a default cap situation if missing
      const defaultCap: TeamCapSituation = {
        franchiseId: roster.franchiseId,
        teamName: roster.teamName,
        currentCapSpace: 0,
        projectedCapSpace2026: 0,
        committedSalaries: 45_000_000,
        deadMoney: 0,
        expiringContracts: [],
        totalExpiringValue: 0,
        franchiseTagCommitment: 0,
        availableAfterTag: 0,
        estimatedMinimumRosterSpend: 0,
        discretionarySpending: 0,
        positionalNeeds: [],
      };
      
      return detectChampionshipWindow(roster, defaultCap);
    }
    
    return detectChampionshipWindow(roster, capSituation);
  });
}

/**
 * Apply manual override to championship window
 */
export function applyChampionshipWindowOverride(
  analysis: ChampionshipWindowAnalysis,
  newWindow: ChampionshipWindow
): ChampionshipWindowAnalysis {
  return {
    ...analysis,
    originalWindow: analysis.isManualOverride ? analysis.originalWindow : analysis.window,
    window: newWindow,
    isManualOverride: true,
    reasoning: [
      ...analysis.reasoning,
      `Manually overridden to ${newWindow}`,
    ],
  };
}

/**
 * Get recommended contract strategy based on championship window
 */
export function getContractStrategy(window: ChampionshipWindow): {
  preferredLength: number;
  targetAge: string;
  strategy: string;
} {
  switch (window) {
    case 'contending':
      return {
        preferredLength: 2,
        targetAge: '26-30',
        strategy: 'Win-now mode: Target proven veterans on short contracts. Trade away future picks for immediate impact.',
      };
    
    case 'rebuilding':
      return {
        preferredLength: 4,
        targetAge: '22-25',
        strategy: 'Rebuild mode: Target young players on long contracts. Stockpile draft picks. Avoid aging veterans.',
      };
    
    case 'neutral':
      return {
        preferredLength: 3,
        targetAge: '24-28',
        strategy: 'Flexible mode: Balance youth and experience. Keep options open with medium-length contracts.',
      };
  }
}
