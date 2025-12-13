/**
 * Utility functions for matchup previews
 * Helper functions for common operations
 */

import type { LeagueContext } from './league-context';
import { MFLMatchupApiClient, createMFLApiClient } from './mfl-matchup-api';
import type { FantasyPlayer, LineupOptimization, OptimizationSeverity } from '../types/matchup-previews';

/**
 * Create MFL API client from league context
 */
export function createMFLClientFromContext(
  leagueContext: LeagueContext,
  year?: string
): MFLMatchupApiClient {
  return createMFLApiClient({
    leagueId: leagueContext.leagueId,
    year: year || new Date().getFullYear().toString(),
  });
}

/**
 * Calculate lineup optimization severity based on point difference
 */
export function calculateOptimizationSeverity(pointsDifference: number): OptimizationSeverity {
  if (pointsDifference >= 10) {
    return 'high';
  } else if (pointsDifference >= 5) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * Generate lineup optimization message
 */
export function generateOptimizationMessage(
  startingPlayer: FantasyPlayer,
  suggestedPlayer: FantasyPlayer,
  pointsDifference: number
): string {
  const diff = pointsDifference.toFixed(1);
  return `Consider starting ${suggestedPlayer.name} (${suggestedPlayer.position}) over ${startingPlayer.name} (+${diff} projected points)`;
}

/**
 * Generate injury warning message
 */
export function generateInjuryWarningMessage(player: FantasyPlayer): string {
  const status = player.injuryStatus;
  const statusText = status === 'IR' ? 'on IR' : status.toLowerCase();
  return `${player.name} (${player.position}) is ${statusText} and currently starting`;
}

/**
 * Generate IR eligibility message
 */
export function generateIREligibilityMessage(player: FantasyPlayer): string {
  return `${player.name} (${player.position}) is Out and eligible for IR`;
}

/**
 * Check if a player should be included in analysis
 */
export function shouldIncludeInAnalysis(optimization: LineupOptimization): boolean {
  // Always include high severity issues
  if (optimization.severity === 'high') {
    return true;
  }

  // Include injury warnings for starting players
  if (optimization.type === 'injury_warning') {
    return true;
  }

  // Include IR eligible players
  if (optimization.type === 'ir_eligible') {
    return true;
  }

  // Include medium severity bench upgrades
  if (optimization.type === 'bench_upgrade' && optimization.severity === 'medium') {
    return true;
  }

  return false;
}

/**
 * Sort optimizations by priority for analysis
 */
export function sortOptimizationsByPriority(optimizations: LineupOptimization[]): LineupOptimization[] {
  const priorityOrder = {
    'injury_warning': 0,
    'ir_eligible': 1,
    'bench_upgrade': 2,
  };

  const severityOrder = {
    'high': 0,
    'medium': 1,
    'low': 2,
  };

  return optimizations.slice().sort((a, b) => {
    // First sort by type priority
    const typeDiff = priorityOrder[a.type] - priorityOrder[b.type];
    if (typeDiff !== 0) {
      return typeDiff;
    }

    // Then by severity
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }

    // Finally by points difference (if available)
    const aPoints = a.pointsDifference || 0;
    const bPoints = b.pointsDifference || 0;
    return bPoints - aPoints;
  });
}

/**
 * Get the most critical lineup issues for analysis
 */
export function getCriticalLineupIssues(optimizations: LineupOptimization[]): {
  injuredStarters: LineupOptimization[];
  significantUpgrades: LineupOptimization[];
} {
  const sorted = sortOptimizationsByPriority(optimizations);
  
  const injuredStarters = sorted.filter(opt => 
    opt.type === 'injury_warning' || opt.type === 'ir_eligible'
  );

  const significantUpgrades = sorted.filter(opt => 
    opt.type === 'bench_upgrade' && 
    (opt.severity === 'high' || (opt.severity === 'medium' && (opt.pointsDifference || 0) >= 7))
  );

  return {
    injuredStarters,
    significantUpgrades,
  };
}

/**
 * Format player name with position for display
 */
export function formatPlayerDisplay(player: FantasyPlayer): string {
  return `${player.name} (${player.position})`;
}

/**
 * Get time slot from game time
 */
export function getTimeSlotFromGameTime(gameTime: Date): 'early' | 'late' {
  const hour = gameTime.getUTCHours();
  
  // Convert UTC to Pacific Time for consistent slot determination
  // Early games typically start at 10 AM PT (18:00 UTC) / 1 PM ET (18:00 UTC)
  // Late games typically start at 1 PM PT (21:00 UTC) / 4 PM ET (21:00 UTC) or later
  
  // This is a simplified version - in production you'd want proper timezone handling
  if (hour < 20) { // Before 8 PM UTC (roughly 1 PM ET / 10 AM PT)
    return 'early';
  } else {
    return 'late';
  }
}

/**
 * Generate action URL for lineup corrections
 */
export function generateLineupActionUrl(
  leagueId: string,
  franchiseId: string,
  year: string = new Date().getFullYear().toString()
): string {
  return `https://www${leagueId.slice(-2)}.myfantasyleague.com/${year}/options?L=${leagueId}&F=${franchiseId}&O=07`;
}

/**
 * Check if it's currently a game day (Sunday or Monday)
 */
export function isGameDay(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 1; // Sunday or Monday
}

/**
 * Get next Sunday from a given date
 */
export function getNextSunday(date: Date = new Date()): Date {
  const nextSunday = new Date(date);
  const daysUntilSunday = (7 - date.getDay()) % 7;
  nextSunday.setDate(date.getDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday));
  return nextSunday;
}

/**
 * Get current NFL week (simplified calculation)
 */
export function getCurrentNFLWeek(date: Date = new Date()): number {
  // This is a simplified calculation - in production you'd want to use
  // actual NFL schedule data or a more sophisticated calculation
  const seasonStart = new Date(date.getFullYear(), 8, 1); // September 1st
  const diffTime = date.getTime() - seasonStart.getTime();
  const diffWeeks = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
  
  // Clamp to valid NFL weeks (1-18 for regular season)
  return Math.max(1, Math.min(18, diffWeeks));
}