/**
 * Multi-Contract Pricer
 * 
 * Generates contract options for 1-5 year lengths with:
 * - Year-by-year salary schedules with 10% annual escalation
 * - Smart recommendations based on player age and value
 * - Strategic explanations for each contract length
 * 
 * Helps users make informed decisions about contract lengths in auctions.
 */

import { calculateEscalatedSalary, generateContractSchedule } from './cap-space-calculator';
import type { ContractEscalation } from '../types/auction-predictor';

/**
 * Contract recommendation level
 */
export type RecommendationLevel = 
  | 'highly-recommended'   // 🟢 Best option
  | 'recommended'          // 🟡 Good option
  | 'neutral'              // ⚪ Viable option
  | 'not-recommended'      // 🔴 Risky option
  | 'avoid';               // ⛔ Bad option

/**
 * Contract option with pricing and recommendation
 */
export interface ContractOption {
  length: number; // 1-5 years
  baseYear: number; // Starting year (2026)
  baseSalary: number; // Year 1 salary
  
  // Escalation schedule
  schedule: ContractEscalation;
  
  // Pricing summary
  totalContractValue: number;
  averageAnnualValue: number;
  finalYearSalary: number;
  
  // Recommendation
  recommendationLevel: RecommendationLevel;
  recommendationReason: string;
  pros: string[];
  cons: string[];
  
  // Strategic context
  riskLevel: 'low' | 'medium' | 'high';
  flexibilityScore: number; // 0-100 (shorter = more flexible)
  valueScore: number; // 0-100 (how good is this deal)
}

/**
 * All contract options for a player
 */
export interface PlayerContractOptions {
  playerId: string;
  playerName: string;
  position: string;
  age: number;
  
  // Pricing context
  estimatedFairValue: number; // What player is actually worth
  auctionPrice: number; // What you expect to pay
  valueGap: number; // Difference (positive = underpay, negative = overpay)
  valueGapPercent: number; // As percentage
  
  // All contract lengths
  options: ContractOption[];
  
  // Overall recommendation
  recommendedLength: number;
  alternativeLength?: number; // Second-best option
  
  // Strategic summary
  strategy: string;
}

/**
 * Calculate value gap between auction price and fair value
 */
function calculateValueGap(
  auctionPrice: number,
  estimatedFairValue: number
): {
  valueGap: number;
  valueGapPercent: number;
  isGoodValue: boolean;
  isOverpay: boolean;
} {
  const valueGap = estimatedFairValue - auctionPrice;
  const valueGapPercent = auctionPrice > 0
    ? (valueGap / auctionPrice) * 100
    : 0;
  
  return {
    valueGap,
    valueGapPercent,
    isGoodValue: valueGapPercent >= 15, // 15%+ discount = good value
    isOverpay: valueGapPercent <= -15, // 15%+ premium = overpay
  };
}

/**
 * Calculate flexibility score (shorter = more flexible)
 */
function calculateFlexibilityScore(length: number): number {
  // 1 year = 100 flexibility
  // 5 years = 20 flexibility
  return 100 - ((length - 1) * 20);
}

/**
 * Get recommendation level based on multiple factors
 */
function getRecommendationLevel(
  length: number,
  age: number,
  isGoodValue: boolean,
  isOverpay: boolean,
  championshipWindow: 'contending' | 'neutral' | 'rebuilding' = 'neutral'
): {
  level: RecommendationLevel;
  reason: string;
  pros: string[];
  cons: string[];
  riskLevel: 'low' | 'medium' | 'high';
} {
  const pros: string[] = [];
  const cons: string[] = [];
  let level: RecommendationLevel = 'neutral';
  let reason = '';
  let riskLevel: 'low' | 'medium' | 'high' = 'medium';
  
  // Age-based assessment
  const isYoung = age < 26;
  const isPrime = age >= 26 && age < 30;
  const isAging = age >= 30;
  
  // Contract length categories
  const isShort = length <= 2;
  const isMedium = length === 3;
  const isLong = length >= 4;
  
  // Young player logic (< 26)
  if (isYoung) {
    if (isLong && isGoodValue) {
      level = 'highly-recommended';
      reason = 'Lock in ascending value on young star';
      pros.push('Player should improve each year');
      pros.push('Value will increase over time');
      pros.push('Minimal injury/decline risk');
      riskLevel = 'low';
    } else if (isLong) {
      level = 'recommended';
      reason = 'Young player with long-term upside';
      pros.push('Age 26-30 are peak years');
      pros.push('Long runway before decline');
      cons.push('Paying full price for potential');
      riskLevel = 'low';
    } else if (isMedium) {
      level = 'neutral';
      reason = 'Safe middle ground for young player';
      pros.push('Good balance of value and flexibility');
      cons.push('Miss out on prime years 4-5');
      riskLevel = 'low';
    } else {
      level = 'not-recommended';
      reason = 'Too short for young player';
      pros.push('Easy exit if player busts');
      cons.push('Will hit FA during prime years');
      cons.push('Lose ascending value');
      riskLevel = 'medium';
    }
  }
  
  // Prime player logic (26-29)
  else if (isPrime) {
    if (isMedium && !isOverpay) {
      level = 'recommended';
      reason = 'Ideal length for prime-age player';
      pros.push('Covers peak performance years');
      pros.push('Exit before major decline');
      riskLevel = 'low';
    } else if (isShort) {
      level = 'neutral';
      reason = 'Short-term play for win-now mode';
      pros.push('Low commitment if performance drops');
      cons.push('Higher annual cost');
      riskLevel = 'medium';
    } else if (isLong && isGoodValue) {
      level = 'neutral';
      reason = 'Good value but aging risk in years 4-5';
      pros.push('Lock in discount pricing');
      cons.push('Age 30+ decline risk');
      cons.push('Will be 31+ by end of contract');
      riskLevel = 'medium';
    } else {
      level = 'not-recommended';
      reason = 'Too long for aging curve';
      cons.push('Performance likely declines');
      cons.push('Dead cap risk in final years');
      riskLevel = 'high';
    }
  }
  
  // Aging player logic (30+)
  else if (isAging) {
    if (isShort) {
      level = 'recommended';
      reason = 'Short commitment appropriate for age';
      pros.push('Extract remaining value');
      pros.push('Easy exit when done');
      riskLevel = 'medium';
    } else if (isMedium && !isOverpay) {
      level = 'neutral';
      reason = 'Moderate risk for aging veteran';
      pros.push('May have 2-3 good years left');
      cons.push('Decline likely in final years');
      riskLevel = 'high';
    } else {
      level = 'avoid';
      reason = 'Major decline risk for aging player';
      cons.push('Age 33+ by contract end');
      cons.push('High injury risk');
      cons.push('Dead cap likely');
      riskLevel = 'high';
    }
  }
  
  // Value-based adjustments
  if (isGoodValue && level === 'neutral') {
    level = 'recommended';
    reason = `Great value - ${reason.toLowerCase()}`;
  } else if (isOverpay && level === 'recommended') {
    level = 'neutral';
    reason = `Overpaying but ${reason.toLowerCase()}`;
  } else if (isOverpay && level === 'highly-recommended') {
    level = 'recommended';
    reason = `Slight overpay but ${reason.toLowerCase()}`;
  }
  
  // Championship window adjustments
  if (championshipWindow === 'contending') {
    if (isShort && isPrime) {
      level = 'highly-recommended';
      reason = 'Win-now mode: maximize immediate impact';
      pros.push('Aligns with championship window');
    }
  } else if (championshipWindow === 'rebuilding') {
    if (isLong && isYoung && !isOverpay) {
      level = 'highly-recommended';
      reason = 'Rebuild mode: secure young core long-term';
      pros.push('Foundation piece for future');
    } else if (isAging) {
      level = 'avoid';
      reason = 'Rebuilding teams should avoid aging players';
      cons.push('Does not fit timeline');
    }
  }
  
  return { level, reason, pros, cons, riskLevel };
}

/**
 * Calculate value score for a contract option
 */
function calculateValueScore(
  length: number,
  age: number,
  valueGapPercent: number,
  recommendationLevel: RecommendationLevel
): number {
  let score = 50; // Base score
  
  // Value gap impact (most important)
  if (valueGapPercent >= 30) {
    score += 40; // Huge discount
  } else if (valueGapPercent >= 20) {
    score += 30;
  } else if (valueGapPercent >= 10) {
    score += 20;
  } else if (valueGapPercent >= 0) {
    score += 10;
  } else if (valueGapPercent >= -10) {
    score -= 10;
  } else if (valueGapPercent >= -20) {
    score -= 20;
  } else {
    score -= 30; // Huge overpay
  }
  
  // Recommendation level impact
  const recBonus = {
    'highly-recommended': 20,
    'recommended': 10,
    'neutral': 0,
    'not-recommended': -10,
    'avoid': -20,
  };
  score += recBonus[recommendationLevel];
  
  // Age-length fit
  if (age < 26 && length >= 4) {
    score += 10; // Young + long = great
  } else if (age >= 30 && length <= 2) {
    score += 10; // Old + short = smart
  } else if (age >= 30 && length >= 4) {
    score -= 20; // Old + long = bad
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate contract options for a player
 */
export function generateContractOptions(
  playerId: string,
  playerName: string,
  position: string,
  age: number,
  auctionPrice: number,
  estimatedFairValue: number,
  championshipWindow: 'contending' | 'neutral' | 'rebuilding' = 'neutral',
  startYear: number = 2026
): PlayerContractOptions {
  const { valueGap, valueGapPercent, isGoodValue, isOverpay } = 
    calculateValueGap(auctionPrice, estimatedFairValue);
  
  const options: ContractOption[] = [];
  
  // Generate options for 1-5 years
  for (let length = 1; length <= 5; length++) {
    // Generate escalation schedule
    const schedule = generateContractSchedule(
      playerId,
      auctionPrice,
      length,
      startYear
    );
    
    // Get recommendation
    const recommendation = getRecommendationLevel(
      length,
      age,
      isGoodValue,
      isOverpay,
      championshipWindow
    );
    
    // Calculate scores
    const flexibilityScore = calculateFlexibilityScore(length);
    const valueScore = calculateValueScore(
      length,
      age,
      valueGapPercent,
      recommendation.level
    );
    
    // Get final year salary
    const finalYearSalary = schedule.yearlySchedule[schedule.yearlySchedule.length - 1].salary;
    
    options.push({
      length,
      baseYear: startYear,
      baseSalary: auctionPrice,
      schedule,
      totalContractValue: schedule.totalContractValue,
      averageAnnualValue: schedule.averageAnnualValue,
      finalYearSalary,
      recommendationLevel: recommendation.level,
      recommendationReason: recommendation.reason,
      pros: recommendation.pros,
      cons: recommendation.cons,
      riskLevel: recommendation.riskLevel,
      flexibilityScore,
      valueScore,
    });
  }
  
  // Find best recommendation
  const highlyRecommended = options.filter(o => o.recommendationLevel === 'highly-recommended');
  const recommended = options.filter(o => o.recommendationLevel === 'recommended');
  
  let recommendedLength = 3; // Default to middle
  let alternativeLength: number | undefined;
  
  if (highlyRecommended.length > 0) {
    // Pick the highly recommended with highest value score
    const best = highlyRecommended.sort((a, b) => b.valueScore - a.valueScore)[0];
    recommendedLength = best.length;
    
    // Alternative is next best highly/recommended
    const alternatives = [...highlyRecommended, ...recommended]
      .filter(o => o.length !== recommendedLength)
      .sort((a, b) => b.valueScore - a.valueScore);
    
    if (alternatives.length > 0) {
      alternativeLength = alternatives[0].length;
    }
  } else if (recommended.length > 0) {
    const best = recommended.sort((a, b) => b.valueScore - a.valueScore)[0];
    recommendedLength = best.length;
    
    const alternatives = recommended
      .filter(o => o.length !== recommendedLength)
      .sort((a, b) => b.valueScore - a.valueScore);
    
    if (alternatives.length > 0) {
      alternativeLength = alternatives[0].length;
    }
  } else {
    // Pick highest value score among neutrals
    const best = options
      .filter(o => o.recommendationLevel === 'neutral')
      .sort((a, b) => b.valueScore - a.valueScore)[0];
    
    if (best) {
      recommendedLength = best.length;
    }
  }
  
  // Generate strategic summary
  let strategy = '';
  
  if (age < 26 && isGoodValue) {
    strategy = `🎯 PRIORITY TARGET: Young player at discount. Lock in ${recommendedLength}-year deal to maximize value as they improve.`;
  } else if (age < 26) {
    strategy = `Young player with upside. Consider ${recommendedLength}-year commitment to secure prime years.`;
  } else if (age >= 30 && isOverpay) {
    strategy = `⚠️ OVERPAY ALERT: Aging player at premium. ${recommendedLength}-year max to limit risk.`;
  } else if (age >= 30) {
    strategy = `Veteran player. Keep it short (${recommendedLength} years) to avoid decline years.`;
  } else if (isGoodValue) {
    strategy = `Good value on prime-age player. ${recommendedLength} years balances commitment and flexibility.`;
  } else if (isOverpay) {
    strategy = `Paying premium. ${recommendedLength}-year deal limits downside if performance drops.`;
  } else {
    strategy = `Fair market value. ${recommendedLength} years is optimal length.`;
  }
  
  return {
    playerId,
    playerName,
    position,
    age,
    estimatedFairValue,
    auctionPrice,
    valueGap,
    valueGapPercent,
    options,
    recommendedLength,
    alternativeLength,
    strategy,
  };
}

/**
 * Generate contract options for multiple players
 */
export function generateBulkContractOptions(
  players: Array<{
    playerId: string;
    playerName: string;
    position: string;
    age: number;
    auctionPrice: number;
    estimatedFairValue: number;
  }>,
  championshipWindow: 'contending' | 'neutral' | 'rebuilding' = 'neutral',
  startYear: number = 2026
): PlayerContractOptions[] {
  return players.map(player =>
    generateContractOptions(
      player.playerId,
      player.playerName,
      player.position,
      player.age,
      player.auctionPrice,
      player.estimatedFairValue,
      championshipWindow,
      startYear
    )
  );
}

/**
 * Get quick recommendation text for display
 */
export function getQuickRecommendation(option: ContractOption): string {
  const icons = {
    'highly-recommended': '🟢',
    'recommended': '🟡',
    'neutral': '⚪',
    'not-recommended': '🔴',
    'avoid': '⛔',
  };
  
  return `${icons[option.recommendationLevel]} ${option.recommendationReason}`;
}

/**
 * Format contract value for display
 */
export function formatContractValue(value: number): string {
  const millions = value / 1_000_000;
  return `$${millions.toFixed(1)}M`;
}

/**
 * Get emoji for value gap
 */
export function getValueGapEmoji(valueGapPercent: number): string {
  if (valueGapPercent >= 30) return '🔥'; // Hot deal
  if (valueGapPercent >= 20) return '✅'; // Great value
  if (valueGapPercent >= 10) return '👍'; // Good value
  if (valueGapPercent >= -10) return '➖'; // Fair
  if (valueGapPercent >= -20) return '⚠️'; // Slight overpay
  return '🚫'; // Major overpay
}
