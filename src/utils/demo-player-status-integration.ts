/**
 * Demo Player Status Integration
 * Example of how to integrate the new player status components with existing matchup data
 */

import type { FantasyPlayer, LineupOptimization } from '../types/matchup-previews';
import { createLineupOptimizer } from './lineup-optimizer';

/**
 * Enhance existing player data with status indicators and optimization info
 */
export function enhancePlayersWithStatus(
  players: any[], // Existing player data from matchup preview
  leagueId: string = '13522',
  year: string = '2025'
): FantasyPlayer[] {
  const optimizer = createLineupOptimizer(leagueId, year);
  
  return players.map(player => {
    // Convert existing player data to FantasyPlayer format
    const fantasyPlayer: FantasyPlayer = {
      id: player.id || player.espnId || '',
      name: player.name || '',
      position: player.position || '',
      nflTeam: player.nflTeam || '',
      fantasyTeamId: player.fantasyTeamId || '',
      projectedPoints: player.projectedPoints || 0,
      actualPoints: player.actualPoints,
      isStarting: player.isStarting || false,
      injuryStatus: player.injuryStatus || 'Healthy',
      isIReligible: player.isIReligible || false,
    };

    // Calculate bench upgrade if this is a starting player
    if (fantasyPlayer.isStarting) {
      const benchUpgrade = optimizer.calculateBenchUpgrade(fantasyPlayer, [fantasyPlayer]);
      fantasyPlayer.benchUpgrade = benchUpgrade;
    }

    return fantasyPlayer;
  });
}

/**
 * Generate lineup optimization summary for a team
 */
export function generateTeamOptimizationSummary(
  roster: FantasyPlayer[],
  teamId: string,
  week: number = 15
): {
  optimizations: LineupOptimization[];
  summary: string;
  hasCriticalIssues: boolean;
} {
  const optimizer = createLineupOptimizer();
  
  // Create mock starting lineup from roster data
  const starters = roster.filter(p => p.isStarting);
  const bench = roster.filter(p => !p.isStarting);
  
  const startingLineup = {
    teamId,
    week,
    positions: {
      QB: starters.filter(p => p.position === 'QB'),
      RB: starters.filter(p => p.position === 'RB'),
      WR: starters.filter(p => p.position === 'WR'),
      TE: starters.filter(p => p.position === 'TE'),
      FLEX: starters.filter(p => ['RB', 'WR', 'TE'].includes(p.position)),
      K: starters.filter(p => p.position === 'K'),
      DEF: starters.filter(p => p.position === 'Def'),
    },
    bench,
    totalProjected: starters.reduce((sum, p) => sum + (p.projectedPoints || 0), 0),
    optimizationOpportunities: [],
  };

  const optimizations = optimizer.analyzeRoster(roster, startingLineup);
  const summary = optimizer.getOptimizationSummary(optimizations);
  const hasCriticalIssues = optimizer.hasCriticalIssues(optimizations);

  // Generate summary text
  const summaryParts = [];
  if (summary.injuryWarnings > 0) {
    summaryParts.push(`${summary.injuryWarnings} injury warning${summary.injuryWarnings === 1 ? '' : 's'}`);
  }
  if (summary.benchUpgrades > 0) {
    summaryParts.push(`${summary.benchUpgrades} bench upgrade${summary.benchUpgrades === 1 ? '' : 's'}`);
  }
  if (summary.irEligible > 0) {
    summaryParts.push(`${summary.irEligible} IR eligible player${summary.irEligible === 1 ? '' : 's'}`);
  }

  const summaryText = summaryParts.length > 0 
    ? summaryParts.join(', ')
    : 'Lineup looks good';

  return {
    optimizations,
    summary: summaryText,
    hasCriticalIssues,
  };
}

/**
 * Get analysis text for critical lineup issues
 */
export function getAnalysisText(optimizations: LineupOptimization[]): string {
  const optimizer = createLineupOptimizer();
  const analysisOptimizations = optimizer.getAnalysisOptimizations(optimizations);
  
  if (analysisOptimizations.length === 0) {
    return '';
  }

  // Take top 2-3 most critical issues for analysis
  const topIssues = analysisOptimizations.slice(0, 3);
  const analysisTexts = topIssues
    .filter(opt => opt.analysisText)
    .map(opt => opt.analysisText!);

  return analysisTexts.join('. ') + '.';
}

/**
 * Example usage in matchup preview context
 */
export function integrateWithMatchupPreview(gameData: any) {
  // Enhance players with status indicators
  const enhancedPlayers = enhancePlayersWithStatus(gameData.players || []);
  
  // Group players by fantasy team
  const playersByTeam = enhancedPlayers.reduce((acc, player) => {
    if (!acc[player.fantasyTeamId]) {
      acc[player.fantasyTeamId] = [];
    }
    acc[player.fantasyTeamId].push(player);
    return acc;
  }, {} as Record<string, FantasyPlayer[]>);

  // Generate optimization summaries for each team
  const teamOptimizations = Object.entries(playersByTeam).map(([teamId, roster]) => {
    const optimization = generateTeamOptimizationSummary(roster, teamId);
    return {
      teamId,
      ...optimization,
    };
  });

  // Generate analysis text for the matchup
  const allOptimizations = teamOptimizations.flatMap(t => t.optimizations);
  const analysisText = getAnalysisText(allOptimizations);

  return {
    enhancedPlayers,
    teamOptimizations,
    analysisText,
    hasCriticalIssues: teamOptimizations.some(t => t.hasCriticalIssues),
  };
}