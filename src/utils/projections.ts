/**
 * Utility functions for calculating team projections from MFL player projections
 */

export interface PlayerProjection {
  id: string;
  score: string;
}

export interface ProjectedScoresData {
  projectedScores?: {
    playerScore?: PlayerProjection[];
    week?: string;
  };
}

export interface RosterPlayer {
  id: string;
  status: string;
  salary?: string;
  contractYear?: string;
  contractInfo?: string;
}

export interface Franchise {
  id: string;
  player?: RosterPlayer[];
}

export interface RostersData {
  rosters?: {
    franchise?: Franchise[];
  };
}

/**
 * Calculate projected scores for each team based on their roster
 * @param rostersData - MFL rosters data
 * @param projectedScoresData - MFL projected scores data
 * @returns Map of franchise_id -> projected total score
 */
export function calculateTeamProjections(
  rostersData: RostersData,
  projectedScoresData: ProjectedScoresData
): Map<string, number> {
  const projections = new Map<string, number>();

  // Build a map of player_id -> projected score for quick lookup
  const playerProjectionMap = new Map<string, number>();
  const playerScores = projectedScoresData?.projectedScores?.playerScore || [];

  for (const player of playerScores) {
    if (player.id && player.score) {
      const score = parseFloat(player.score);
      if (!isNaN(score)) {
        playerProjectionMap.set(player.id, score);
      }
    }
  }

  // Calculate total projection for each franchise
  const franchises = rostersData?.rosters?.franchise || [];

  for (const franchise of franchises) {
    if (!franchise.id) continue;

    let totalProjection = 0;
    const players = franchise.player || [];

    for (const player of players) {
      // Only count ROSTER players (not TAXI_SQUAD, INJURED_RESERVE, etc.)
      if (player.status === 'ROSTER' && player.id) {
        const projection = playerProjectionMap.get(player.id) || 0;
        totalProjection += projection;
      }
    }

    projections.set(franchise.id, totalProjection);
  }

  return projections;
}

/**
 * Get projected score for a specific team
 * @param franchiseId - Team franchise ID (e.g., "0001")
 * @param rostersData - MFL rosters data
 * @param projectedScoresData - MFL projected scores data
 * @returns Projected total score for the team, or 0 if not found
 */
export function getTeamProjection(
  franchiseId: string,
  rostersData: RostersData,
  projectedScoresData: ProjectedScoresData
): number {
  const projections = calculateTeamProjections(rostersData, projectedScoresData);
  return projections.get(franchiseId) || 0;
}

/**
 * Get projected scores for multiple teams
 * @param franchiseIds - Array of team franchise IDs
 * @param rostersData - MFL rosters data
 * @param projectedScoresData - MFL projected scores data
 * @returns Array of { franchiseId, projection } objects
 */
export function getMultipleTeamProjections(
  franchiseIds: string[],
  rostersData: RostersData,
  projectedScoresData: ProjectedScoresData
): Array<{ franchiseId: string; projection: number }> {
  const projections = calculateTeamProjections(rostersData, projectedScoresData);

  return franchiseIds.map(franchiseId => ({
    franchiseId,
    projection: projections.get(franchiseId) || 0,
  }));
}
