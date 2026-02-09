/**
 * Lineup Data Builder
 * Utility functions to build StartingLineup data from MFL roster data
 */

import type { FantasyPlayer, StartingLineup } from '../types/matchup-previews';

/**
 * Build starting lineup data from MFL roster and projection data
 */
export function buildStartingLineupFromMFL(
  teamId: string,
  week: number,
  rostersData: any,
  projectedScoresData: any,
  playersData: any,
  startingLineupMap?: Map<string, any>
): StartingLineup {
  // Find the team's roster
  const teamRoster = rostersData.rosters.franchise.find((f: any) => f.id === teamId);
  if (!teamRoster) {
    throw new Error(`No roster found for team ${teamId}`);
  }

  // Build player maps
  const playerMap = new Map();
  const playersList = Array.isArray(playersData.players.player)
    ? playersData.players.player
    : [playersData.players.player];
  playersList.forEach((p: any) => playerMap.set(p.id, p));

  const projMap = new Map();
  const projList = Array.isArray(projectedScoresData.projectedScores.playerScore)
    ? projectedScoresData.projectedScores.playerScore
    : [projectedScoresData.projectedScores.playerScore];
  projList.forEach((p: any) => projMap.set(p.id, parseFloat(p.score) || 0));

  // Get roster players
  const rosterPlayers = Array.isArray(teamRoster.player) ? teamRoster.player : [teamRoster.player];

  // Build fantasy players
  const fantasyPlayers: FantasyPlayer[] = rosterPlayers.map((rosterPlayer: any) => {
    const playerData = playerMap.get(rosterPlayer.id);
    const projection = projMap.get(rosterPlayer.id) || 0;
    const lineupData = startingLineupMap?.get(rosterPlayer.id);
    
    // Determine if player is starting (use real data if available, otherwise mock)
    const isStarting = lineupData?.isStarting ?? mockStartingStatus(playerData?.position, projection);
    
    return {
      id: rosterPlayer.id,
      name: playerData?.name || 'Unknown Player',
      position: playerData?.position || 'UNKNOWN',
      nflTeam: playerData?.team || 'FA',
      fantasyTeamId: teamId,
      projectedPoints: projection,
      isStarting,
      injuryStatus: mockInjuryStatus(),
      isIReligible: false,
    };
  });

  // Sort players into positions and bench
  const positions = {
    QB: [] as FantasyPlayer[],
    RB: [] as FantasyPlayer[],
    WR: [] as FantasyPlayer[],
    TE: [] as FantasyPlayer[],
    FLEX: [] as FantasyPlayer[],
    K: [] as FantasyPlayer[],
    DEF: [] as FantasyPlayer[],
  };

  const bench: FantasyPlayer[] = [];

  fantasyPlayers.forEach(player => {
    if (player.isStarting) {
      // Assign to appropriate position (simplified logic)
      if (positions[player.position as keyof typeof positions]) {
        positions[player.position as keyof typeof positions].push(player);
      } else {
        // If position doesn't match standard positions, put in FLEX or appropriate fallback
        if (['RB', 'WR', 'TE'].includes(player.position)) {
          positions.FLEX.push(player);
        } else {
          bench.push(player); // Fallback to bench if position is unclear
        }
      }
    } else {
      bench.push(player);
    }
  });

  // Calculate total projected points for starters
  const totalProjected = Object.values(positions)
    .flat()
    .reduce((sum, player) => sum + (player.projectedPoints || 0), 0);

  return {
    teamId,
    week,
    positions,
    bench,
    totalProjected,
    optimizationOpportunities: [], // Will be populated by LineupOptimizer if needed
  };
}

/**
 * Mock starting status based on position and projection
 * This is a simplified heuristic for demo purposes
 */
function mockStartingStatus(position: string, projection: number): boolean {
  if (!position) return false;
  
  // Position-based starting probability (higher projection = more likely to start)
  const positionLimits = {
    QB: { max: 1, threshold: 15 },
    RB: { max: 3, threshold: 8 },
    WR: { max: 3, threshold: 8 },
    TE: { max: 2, threshold: 6 },
    K: { max: 1, threshold: 5 },
    DEF: { max: 1, threshold: 5 },
  };

  const limits = positionLimits[position as keyof typeof positionLimits];
  if (!limits) return false;

  // Simple heuristic: higher projections are more likely to start
  return projection >= limits.threshold && Math.random() > 0.3;
}

/**
 * Mock injury status for demo purposes
 */
function mockInjuryStatus(): 'Healthy' | 'Questionable' | 'Doubtful' | 'Out' | 'IR' {
  const rand = Math.random();
  
  if (rand < 0.8) return 'Healthy';
  if (rand < 0.9) return 'Questionable';
  if (rand < 0.95) return 'Doubtful';
  if (rand < 0.98) return 'Out';
  return 'IR';
}

/**
 * Build lineup data for both teams in a matchup
 */
export function buildMatchupLineups(
  homeTeamId: string,
  awayTeamId: string,
  week: number,
  rostersData: any,
  projectedScoresData: any,
  playersData: any,
  startingLineupMap?: Map<string, any>
): { homeLineup: StartingLineup; awayLineup: StartingLineup } {
  const homeLineup = buildStartingLineupFromMFL(
    homeTeamId,
    week,
    rostersData,
    projectedScoresData,
    playersData,
    startingLineupMap
  );

  const awayLineup = buildStartingLineupFromMFL(
    awayTeamId,
    week,
    rostersData,
    projectedScoresData,
    playersData,
    startingLineupMap
  );

  return { homeLineup, awayLineup };
}