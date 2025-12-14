/**
 * LineupOptimizer
 * Detects bench upgrades and lineup optimization opportunities
 */

import type { 
  FantasyPlayer, 
  StartingLineup, 
  LineupOptimization, 
  OptimizationType,
  OptimizationSeverity 
} from '../types/matchup-previews';
import { 
  calculateOptimizationSeverity,
  generateOptimizationMessage,
  generateInjuryWarningMessage,
  generateIREligibilityMessage,
  generateLineupActionUrl
} from './matchup-preview-utils';

/**
 * Position groups for FLEX eligibility
 */
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];

/**
 * Position requirements for standard lineup
 */
const POSITION_REQUIREMENTS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DEF: 1,
};

/**
 * LineupOptimizer class for detecting optimization opportunities
 */
export class LineupOptimizer {
  private leagueId: string;
  private year: string;

  constructor(leagueId: string = '13522', year: string = new Date().getFullYear().toString()) {
    this.leagueId = leagueId;
    this.year = year;
  }

  /**
   * Analyze a complete roster for optimization opportunities
   */
  analyzeRoster(
    roster: FantasyPlayer[], 
    startingLineup: StartingLineup
  ): LineupOptimization[] {
    const optimizations: LineupOptimization[] = [];

    // Get starting players and bench players
    const starters = roster.filter(p => p.isStarting);
    const bench = roster.filter(p => !p.isStarting);

    // Check for injury warnings
    optimizations.push(...this.detectInjuryWarnings(starters));

    // Check for IR eligible players
    optimizations.push(...this.detectIREligiblePlayers(roster));

    // Check for bench upgrades
    optimizations.push(...this.detectBenchUpgrades(starters, bench));

    return optimizations;
  }

  /**
   * Detect injured starters that should be benched
   */
  private detectInjuryWarnings(starters: FantasyPlayer[]): LineupOptimization[] {
    const warnings: LineupOptimization[] = [];

    starters.forEach(player => {
      if (this.isProblematicInjuryStatus(player.injuryStatus)) {
        const severity = this.getInjurySeverity(player.injuryStatus);
        
        warnings.push({
          type: 'injury_warning',
          severity,
          startingPlayer: player,
          message: generateInjuryWarningMessage(player),
          actionUrl: generateLineupActionUrl(this.leagueId, player.fantasyTeamId, this.year),
          includeInAnalysis: true,
          analysisText: `${player.name} is ${player.injuryStatus.toLowerCase()} and currently starting`,
        });
      }
    });

    return warnings;
  }

  /**
   * Detect players eligible for IR
   * Note: In The League, players must be on NFL IR to be fantasy IR eligible
   */
  private detectIREligiblePlayers(roster: FantasyPlayer[]): LineupOptimization[] {
    const eligible: LineupOptimization[] = [];

    roster.forEach(player => {
      // Only players with 'IR' status are eligible for fantasy IR in The League
      // This follows the league rule that players must be on NFL IR to be fantasy IR eligible
      if (this.isPlayerIReligible(player) && !this.isPlayerOnFantasyIR(player)) {
        const severity = player.isStarting ? 'high' : 'medium';
        
        eligible.push({
          type: 'ir_eligible',
          severity,
          startingPlayer: player,
          message: generateIREligibilityMessage(player),
          actionUrl: generateLineupActionUrl(this.leagueId, player.fantasyTeamId, this.year),
          includeInAnalysis: player.isStarting, // Only include in analysis if they're starting
          analysisText: `${player.name} is on NFL IR and eligible for fantasy IR`,
        });
      }
    });

    return eligible;
  }

  /**
   * Enhanced IR eligibility check
   * Checks both injury status and additional league-specific rules
   */
  private isPlayerIReligible(player: FantasyPlayer): boolean {
    // Primary check: Player must be on NFL IR
    if (player.injuryStatus === 'IR') {
      return true;
    }

    // Additional check: Long-term injuries that may qualify
    // In some leagues, players with season-ending injuries may be IR eligible
    // even if not officially on NFL IR yet
    if (player.injuryStatus === 'Out' && player.isIReligible === true) {
      return true;
    }

    return false;
  }

  /**
   * Check if player is already on fantasy IR
   * This would be determined by roster status in a real implementation
   */
  private isPlayerOnFantasyIR(player: FantasyPlayer): boolean {
    // In a real implementation, this would check the player's roster status
    // For now, we assume if they have IR status but are still in the roster, they're not on fantasy IR
    return false;
  }

  /**
   * Detect bench players that should be starting
   */
  private detectBenchUpgrades(
    starters: FantasyPlayer[], 
    bench: FantasyPlayer[]
  ): LineupOptimization[] {
    const upgrades: LineupOptimization[] = [];

    // Group starters by position
    const startersByPosition = this.groupPlayersByPosition(starters);

    // Check each bench player against starters in their position(s)
    bench.forEach(benchPlayer => {
      if (!benchPlayer.projectedPoints) return;

      const upgradePossibilities = this.findUpgradeOpportunities(
        benchPlayer, 
        startersByPosition
      );

      upgradePossibilities.forEach(upgrade => {
        const pointsDifference = (benchPlayer.projectedPoints || 0) - (upgrade.projectedPoints || 0);
        
        if (pointsDifference > 0.5) { // Only consider meaningful upgrades
          const severity = calculateOptimizationSeverity(pointsDifference);
          
          upgrades.push({
            type: 'bench_upgrade',
            severity,
            startingPlayer: upgrade,
            suggestedPlayer: benchPlayer,
            pointsDifference,
            message: generateOptimizationMessage(upgrade, benchPlayer, pointsDifference),
            actionUrl: generateLineupActionUrl(this.leagueId, benchPlayer.fantasyTeamId, this.year),
            includeInAnalysis: severity === 'high' || pointsDifference >= 7,
            analysisText: `Consider starting ${benchPlayer.name} over ${upgrade.name} (+${pointsDifference.toFixed(1)} pts)`,
          });
        }
      });
    });

    return upgrades.sort((a, b) => (b.pointsDifference || 0) - (a.pointsDifference || 0));
  }

  /**
   * Find upgrade opportunities for a bench player
   */
  private findUpgradeOpportunities(
    benchPlayer: FantasyPlayer,
    startersByPosition: Record<string, FantasyPlayer[]>
  ): FantasyPlayer[] {
    const opportunities: FantasyPlayer[] = [];

    // Check direct position match
    const directPositionStarters = startersByPosition[benchPlayer.position] || [];
    opportunities.push(...directPositionStarters);

    // Check FLEX eligibility
    if (FLEX_POSITIONS.includes(benchPlayer.position)) {
      const flexStarters = startersByPosition['FLEX'] || [];
      opportunities.push(...flexStarters.filter(p => FLEX_POSITIONS.includes(p.position)));
    }

    return opportunities;
  }

  /**
   * Group players by their fantasy position
   */
  private groupPlayersByPosition(players: FantasyPlayer[]): Record<string, FantasyPlayer[]> {
    const grouped: Record<string, FantasyPlayer[]> = {};

    players.forEach(player => {
      if (!grouped[player.position]) {
        grouped[player.position] = [];
      }
      grouped[player.position].push(player);
    });

    return grouped;
  }

  /**
   * Check if injury status is problematic for starting players
   */
  private isProblematicInjuryStatus(status: string): boolean {
    return ['Out', 'Doubtful', 'IR'].includes(status);
  }

  /**
   * Get severity level for injury status
   */
  private getInjurySeverity(status: string): OptimizationSeverity {
    switch (status) {
      case 'Out':
      case 'IR':
        return 'high';
      case 'Doubtful':
        return 'medium';
      case 'Questionable':
        return 'low';
      default:
        return 'low';
    }
  }

  /**
   * Calculate bench upgrade for a specific player
   */
  calculateBenchUpgrade(
    player: FantasyPlayer,
    roster: FantasyPlayer[]
  ): { hasUpgrade: boolean; upgradePlayer?: FantasyPlayer; pointsDifference?: number } {
    if (!player.isStarting || !player.projectedPoints) {
      return { hasUpgrade: false };
    }

    const bench = roster.filter(p => !p.isStarting && p.projectedPoints);
    const eligibleUpgrades = bench.filter(benchPlayer => {
      // Same position or FLEX eligible
      return benchPlayer.position === player.position ||
        (FLEX_POSITIONS.includes(benchPlayer.position) && FLEX_POSITIONS.includes(player.position));
    });

    let bestUpgrade: FantasyPlayer | undefined;
    let maxDifference = 0;

    eligibleUpgrades.forEach(benchPlayer => {
      const difference = (benchPlayer.projectedPoints || 0) - (player.projectedPoints || 0);
      if (difference > maxDifference) {
        maxDifference = difference;
        bestUpgrade = benchPlayer;
      }
    });

    return {
      hasUpgrade: maxDifference > 0.5,
      upgradePlayer: bestUpgrade,
      pointsDifference: maxDifference > 0.5 ? maxDifference : undefined,
    };
  }

  /**
   * Get optimization opportunities for analysis inclusion
   */
  getAnalysisOptimizations(optimizations: LineupOptimization[]): LineupOptimization[] {
    return optimizations
      .filter(opt => opt.includeInAnalysis)
      .sort((a, b) => {
        // Sort by type priority, then severity, then points difference
        const typePriority = { 'injury_warning': 0, 'ir_eligible': 1, 'bench_upgrade': 2 };
        const severityPriority = { 'high': 0, 'medium': 1, 'low': 2 };
        
        const typeCompare = typePriority[a.type] - typePriority[b.type];
        if (typeCompare !== 0) return typeCompare;
        
        const severityCompare = severityPriority[a.severity] - severityPriority[b.severity];
        if (severityCompare !== 0) return severityCompare;
        
        return (b.pointsDifference || 0) - (a.pointsDifference || 0);
      });
  }

  /**
   * Check if a lineup has any critical issues
   */
  hasCriticalIssues(optimizations: LineupOptimization[]): boolean {
    return optimizations.some(opt => 
      opt.severity === 'high' || 
      (opt.type === 'injury_warning' && opt.severity === 'medium')
    );
  }

  /**
   * Get summary of optimization opportunities
   */
  getOptimizationSummary(optimizations: LineupOptimization[]): {
    totalIssues: number;
    criticalIssues: number;
    benchUpgrades: number;
    injuryWarnings: number;
    irEligible: number;
  } {
    return {
      totalIssues: optimizations.length,
      criticalIssues: optimizations.filter(opt => opt.severity === 'high').length,
      benchUpgrades: optimizations.filter(opt => opt.type === 'bench_upgrade').length,
      injuryWarnings: optimizations.filter(opt => opt.type === 'injury_warning').length,
      irEligible: optimizations.filter(opt => opt.type === 'ir_eligible').length,
    };
  }
}

/**
 * Create a LineupOptimizer instance
 */
export function createLineupOptimizer(
  leagueId?: string, 
  year?: string
): LineupOptimizer {
  return new LineupOptimizer(leagueId, year);
}

/**
 * Quick analysis function for a single roster
 */
export function analyzeLineupOptimization(
  roster: FantasyPlayer[],
  startingLineup: StartingLineup,
  leagueId?: string,
  year?: string
): LineupOptimization[] {
  const optimizer = createLineupOptimizer(leagueId, year);
  return optimizer.analyzeRoster(roster, startingLineup);
}