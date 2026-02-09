/**
 * Franchise Tag Predictor
 * 
 * Predicts which players each team will franchise tag based on:
 * - Player value vs franchise tag cost
 * - Team's cap situation
 * - Position scarcity
 * - Historical patterns
 */

import type {
  PlayerValuation,
  FranchiseTagPrediction,
  TeamCapSituation,
} from '../types/auction-predictor';
import { calculateFranchiseTagSalary } from './cap-space-calculator';

const FRANCHISE_TAG_VALUE_THRESHOLD = 1.3; // Tag if player worth 130%+ of tag cost

/**
 * Calculate a player's franchise tag worthiness score
 */
export function calculateFranchiseTagScore(
  player: PlayerValuation,
  franchiseTagSalary: number,
  teamCapSituation: TeamCapSituation
): number {
  let score = 0;
  
  // Factor 1: Player value vs tag cost (40% weight)
  // Higher rank = more valuable (inverse relationship)
  if (player.compositeRank) {
    const rankScore = Math.max(0, 100 - player.compositeRank) / 100;
    const valueRatio = player.compositeRank <= 50 ? 1.5 : 1.0;
    score += (rankScore * valueRatio) * 40;
  }
  
  // Factor 2: Current salary vs tag salary (20% weight)
  // If player's current salary is much less than tag, they're undervalued
  const salaryRatio = player.currentSalary / franchiseTagSalary;
  if (salaryRatio < 0.7) {
    // Player is currently underpaid, worth tagging
    score += 20;
  } else if (salaryRatio > 1.2) {
    // Player is already overpaid, less attractive to tag
    score -= 10;
  } else {
    score += 10;
  }
  
  // Factor 3: Position scarcity (15% weight)
  if (player.positionalScarcity) {
    score += player.positionalScarcity * 15;
  }
  
  // Factor 4: Age considerations (10% weight)
  if (player.age <= 26) {
    score += 10; // Young players are prime tag candidates
  } else if (player.age >= 30) {
    score -= 5; // Older players less attractive
  }
  
  // Factor 5: Team's cap situation (15% weight)
  const capFlexibility = teamCapSituation.discretionarySpending / teamCapSituation.projectedCapSpace2026;
  if (capFlexibility > 0.5) {
    // Team has plenty of cap, can afford to tag
    score += 15;
  } else if (capFlexibility < 0.2) {
    // Team is tight on cap, less likely to tag
    score -= 10;
  }
  
  // Normalize score to 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate reasons why a player might be tagged
 */
function generateTagReasons(
  player: PlayerValuation,
  franchiseTagSalary: number,
  score: number
): string[] {
  const reasons: string[] = [];
  
  if (score >= 70) {
    reasons.push('⭐ Top franchise tag candidate');
  }
  
  if (player.compositeRank && player.compositeRank <= 20) {
    reasons.push(`🏆 Elite player (Rank #${player.compositeRank})`);
  }
  
  if (player.currentSalary < franchiseTagSalary * 0.7) {
    const savings = franchiseTagSalary - player.currentSalary;
    reasons.push(`💰 Currently underpaid by $${(savings / 1000000).toFixed(1)}M`);
  }
  
  if (player.age <= 26) {
    reasons.push(`📈 Young player (age ${player.age}) with upside`);
  }
  
  if (player.positionalScarcity && player.positionalScarcity > 0.7) {
    reasons.push('🔥 Position is scarce in market');
  }
  
  if (player.contractYearsRemaining === 1) {
    reasons.push('⏰ Contract expiring - tag prevents free agency');
  }
  
  return reasons;
}

/**
 * Predict franchise tags for all teams
 */
export function predictFranchiseTags(
  teamCapSituations: TeamCapSituation[],
  salaryAverages: any,
  playerRankings?: Map<string, { dynastyRank?: number; redraftRank?: number }>
): FranchiseTagPrediction[] {
  const predictions: FranchiseTagPrediction[] = [];
  
  for (const teamCap of teamCapSituations) {
    // Find all expiring contracts for this team
    const expiringPlayers = teamCap.expiringContracts;
    
    if (expiringPlayers.length === 0) {
      predictions.push({
        franchiseId: teamCap.franchiseId,
        teamName: teamCap.teamName,
        hasTag: false,
        taggedPlayer: null,
        tagCandidates: [],
        isManualOverride: false,
      });
      continue;
    }
    
    // Calculate franchise tag scores for each expiring player
    const candidates = expiringPlayers.map(player => {
      // Get franchise tag salary for this position
      const tagSalary = calculateFranchiseTagSalary(player.position, salaryAverages);
      
      // Enhance player with rankings if available
      const rankings = playerRankings?.get(player.id);
      const enhancedPlayer: PlayerValuation = {
        ...player,
        dynastyRank: rankings?.dynastyRank,
        redraftRank: rankings?.redraftRank,
        compositeRank: rankings?.dynastyRank || rankings?.redraftRank,
        franchiseTagSalary: tagSalary,
      };
      
      // Calculate score
      const score = calculateFranchiseTagScore(enhancedPlayer, tagSalary, teamCap);
      
      // Generate reasons
      const reasons = generateTagReasons(enhancedPlayer, tagSalary, score);
      
      return {
        player: enhancedPlayer,
        score,
        reasons,
      };
    });
    
    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);
    
    // Top candidate is predicted tag
    const topCandidate = candidates[0];
    const willTag = topCandidate.score >= 50; // Threshold for tagging
    
    predictions.push({
      franchiseId: teamCap.franchiseId,
      teamName: teamCap.teamName,
      hasTag: willTag,
      taggedPlayer: willTag ? topCandidate.player : null,
      tagCandidates: candidates.slice(0, 5), // Top 5 candidates
      isManualOverride: false,
    });
  }
  
  return predictions;
}

/**
 * Apply manual override to franchise tag prediction
 */
export function applyFranchiseTagOverride(
  predictions: FranchiseTagPrediction[],
  franchiseId: string,
  playerId: string | null,
  allPlayers: PlayerValuation[],
  salaryAverages: any
): FranchiseTagPrediction[] {
  return predictions.map(pred => {
    if (pred.franchiseId !== franchiseId) {
      return pred;
    }
    
    if (playerId === null) {
      // Remove tag
      return {
        ...pred,
        hasTag: false,
        taggedPlayer: null,
        isManualOverride: true,
      };
    }
    
    // Find the player
    const player = allPlayers.find(p => p.id === playerId);
    if (!player) {
      return pred;
    }
    
    // Calculate franchise tag salary
    const tagSalary = calculateFranchiseTagSalary(player.position, salaryAverages);
    
    return {
      ...pred,
      hasTag: true,
      taggedPlayer: {
        ...player,
        franchiseTagSalary: tagSalary,
      },
      isManualOverride: true,
    };
  });
}

/**
 * Get list of players who will enter free agency (not tagged)
 */
export function getAvailableFreeAgents(
  allExpiringPlayers: PlayerValuation[],
  franchiseTagPredictions: FranchiseTagPrediction[]
): PlayerValuation[] {
  // Get set of tagged player IDs
  const taggedPlayerIds = new Set(
    franchiseTagPredictions
      .filter(pred => pred.taggedPlayer !== null)
      .map(pred => pred.taggedPlayer!.id)
  );
  
  // Return players not tagged
  return allExpiringPlayers.filter(player => !taggedPlayerIds.has(player.id));
}

/**
 * Calculate impact of tag override on market
 */
export function calculateTagOverrideImpact(
  baseline: FranchiseTagPrediction[],
  override: FranchiseTagPrediction[],
  allPlayers: PlayerValuation[]
): {
  playersAddedToMarket: PlayerValuation[];
  playersRemovedFromMarket: PlayerValuation[];
  capsSpaceChange: number;
  positionScarcityChanges: Map<string, number>;
} {
  const baselineFreeAgents = getAvailableFreeAgents(allPlayers, baseline);
  const overrideFreeAgents = getAvailableFreeAgents(allPlayers, override);
  
  const baselineIds = new Set(baselineFreeAgents.map(p => p.id));
  const overrideIds = new Set(overrideFreeAgents.map(p => p.id));
  
  const playersAddedToMarket = overrideFreeAgents.filter(p => !baselineIds.has(p.id));
  const playersRemovedFromMarket = baselineFreeAgents.filter(p => !overrideIds.has(p.id));
  
  // Calculate cap space changes (tagged players reduce team cap)
  let capsSpaceChange = 0;
  // This would need more detailed calculation
  
  // Calculate position scarcity changes
  const positionScarcityChanges = new Map<string, number>();
  
  return {
    playersAddedToMarket,
    playersRemovedFromMarket,
    capsSpaceChange,
    positionScarcityChanges,
  };
}
