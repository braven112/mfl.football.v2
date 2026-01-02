/**
 * Future Draft Picks Utilities
 * Parses MFL futureDraftPicks API data to determine which picks each team owns
 */

import type { DraftPrediction } from '../types/standings';

export interface FutureDraftPick {
  round: string;
  year: string;
  originalPickFor: string;
}

export interface FutureDraftPicksFranchise {
  id: string;
  futureDraftPick?: FutureDraftPick | FutureDraftPick[];
}

export interface FutureDraftPicksData {
  futureDraftPicks?: {
    franchise?: FutureDraftPicksFranchise[] | FutureDraftPicksFranchise;
  };
  error?: any;
}

/**
 * Checks if the futureDraftPicks API data is valid and contains picks
 */
export function isValidFutureDraftPicksData(data: any): data is FutureDraftPicksData {
  if (!data || typeof data !== 'object') return false;
  if (data.error) return false;
  if (!data.futureDraftPicks?.franchise) return false;
  return true;
}

/**
 * Converts futureDraftPicks API data to DraftPrediction format for the draft predictor
 * @param data - Raw futureDraftPicks API response
 * @param teamConfigMap - Map of franchise IDs to team config (name, icon, banner)
 * @param targetYear - The draft year to filter for (e.g., 2026)
 * @returns Array of DraftPrediction objects showing current pick ownership
 */
export function convertFutureDraftPicksToPredictions(
  data: FutureDraftPicksData,
  teamConfigMap: Map<string, { id: string; name: string; icon: string; banner: string }>,
  targetYear: number
): DraftPrediction[] {
  if (!isValidFutureDraftPicksData(data)) {
    return [];
  }

  const predictions: DraftPrediction[] = [];
  const franchiseList = data.futureDraftPicks?.franchise;
  const franchises = Array.isArray(franchiseList) ? franchiseList : franchiseList ? [franchiseList] : [];

  for (const franchise of franchises) {
    const franchiseId = franchise.id;
    const teamConfig = teamConfigMap.get(franchiseId);

    if (!teamConfig) continue;

    // Handle both single pick and array of picks
    const pickList = franchise.futureDraftPick;
    const picks = Array.isArray(pickList) ? pickList : pickList ? [pickList] : [];

    for (const pick of picks) {
      // Only include picks for the target year
      if (parseInt(pick.year, 10) !== targetYear) continue;

      const round = parseInt(pick.round, 10);
      const originalFranchiseId = pick.originalPickFor;
      const originalTeamConfig = teamConfigMap.get(originalFranchiseId);

      // We don't know the exact pick number yet (depends on standings)
      // So we'll use round * 100 as a placeholder for sorting
      // The draft-predictor page will need to merge this with standings-based order
      predictions.push({
        franchiseId,
        teamName: teamConfig.name,
        teamIcon: teamConfig.icon,
        teamBanner: teamConfig.banner,
        round,
        pickInRound: 0, // Will be determined by standings
        overallPickNumber: round * 100, // Placeholder for sorting by round
        isToiletBowlPick: false,
        isLeagueWinner: false,
        originalTeamName: originalFranchiseId !== franchiseId ? originalTeamConfig?.name : undefined,
        currentRecord: { wins: 0, losses: 0, ties: 0 }, // Not applicable for future picks
        currentStanding: { allPlayPct: 0, pointsFor: 0, pointsAgainst: 0, powerRating: 0, victoryPoints: 0 }, // Not applicable for future picks
      });
    }
  }

  return predictions;
}

/**
 * Gets a summary of draft capital for each team
 * Useful for showing which teams have extra picks or missing picks
 */
export function getDraftCapitalSummary(
  data: FutureDraftPicksData,
  targetYear: number
): Map<string, { total: number; byRound: Map<number, number> }> {
  const summary = new Map<string, { total: number; byRound: Map<number, number> }>();

  if (!isValidFutureDraftPicksData(data)) {
    return summary;
  }

  const franchiseList = data.futureDraftPicks?.franchise;
  const franchises = Array.isArray(franchiseList) ? franchiseList : franchiseList ? [franchiseList] : [];

  for (const franchise of franchises) {
    const franchiseId = franchise.id;
    const pickList = franchise.futureDraftPick;
    const picks = Array.isArray(pickList) ? pickList : pickList ? [pickList] : [];

    const byRound = new Map<number, number>();
    let total = 0;

    for (const pick of picks) {
      if (parseInt(pick.year, 10) !== targetYear) continue;

      const round = parseInt(pick.round, 10);
      byRound.set(round, (byRound.get(round) || 0) + 1);
      total++;
    }

    summary.set(franchiseId, { total, byRound });
  }

  return summary;
}

/**
 * Merges standings-based draft predictions with futureDraftPicks ownership
 * The standings tell us the pick order, futureDraftPicks tells us who owns each pick
 *
 * @param standingsPredictions - Draft order based on standings (has correct pick numbers)
 * @param futureDraftPicksData - Shows current pick ownership after trades
 * @param teamConfigMap - Map of franchise IDs to team config
 * @param targetYear - The draft year to process
 * @returns Updated predictions with correct ownership
 */
export function mergeStandingsWithFuturePicks(
  standingsPredictions: DraftPrediction[],
  futureDraftPicksData: FutureDraftPicksData,
  teamConfigMap: Map<string, { id: string; name: string; icon: string; banner: string }>,
  targetYear: number
): DraftPrediction[] {
  if (!isValidFutureDraftPicksData(futureDraftPicksData)) {
    return standingsPredictions;
  }

  // Build a map: originalTeam's pick -> pick details from standings
  const standingsPickMap = new Map<string, DraftPrediction>();
  for (const prediction of standingsPredictions) {
    // Skip toilet bowl picks - they don't trade
    // NOTE: Champion picks (isLeagueWinner) CAN be traded, so don't skip them!
    if (prediction.isToiletBowlPick) {
      continue;
    }
    const key = `${prediction.round}-${prediction.franchiseId}`;
    standingsPickMap.set(key, prediction);
  }

  // Build new predictions based on actual ownership from futureDraftPicks
  const mergedPredictions: DraftPrediction[] = [];

  const franchiseList = futureDraftPicksData.futureDraftPicks?.franchise;
  const franchises = Array.isArray(franchiseList) ? franchiseList : franchiseList ? [franchiseList] : [];

  for (const franchise of franchises) {
    const currentOwner = teamConfigMap.get(franchise.id);
    if (!currentOwner) continue;

    const pickList = franchise.futureDraftPick;
    const picks = Array.isArray(pickList) ? pickList : pickList ? [pickList] : [];

    for (const pick of picks) {
      if (parseInt(pick.year, 10) !== targetYear) continue;

      const round = parseInt(pick.round, 10);
      const originalPickFor = pick.originalPickFor;

      // Find the pick details from standings (based on original owner's position)
      const standingsKey = `${round}-${originalPickFor}`;
      const standingsPick = standingsPickMap.get(standingsKey);

      if (!standingsPick) {
        // This shouldn't happen, but skip if we can't find the standings pick
        continue;
      }

      // Check if pick was traded
      const isTraded = franchise.id !== originalPickFor;

      if (isTraded) {
        const originalOwner = teamConfigMap.get(originalPickFor);
        if (originalOwner) {
          mergedPredictions.push({
            ...standingsPick,
            franchiseId: franchise.id,
            teamName: currentOwner.name,
            teamIcon: currentOwner.icon,
            teamBanner: currentOwner.banner,
            originalTeamName: originalOwner.name,
            originalTeamIcon: originalOwner.icon,
            isTraded: true,
            tradeHistory: {
              originalTeam: originalOwner.name,
              originalFranchiseId: originalPickFor,
              chain: [
                { team: originalOwner.name, franchiseId: originalPickFor },
                { team: currentOwner.name, franchiseId: franchise.id },
              ],
            },
          });
        }
      } else {
        // Pick not traded - keep original ownership
        mergedPredictions.push({
          ...standingsPick,
          franchiseId: franchise.id,
          teamName: currentOwner.name,
          teamIcon: currentOwner.icon,
          teamBanner: currentOwner.banner,
        });
      }
    }
  }

  // Add back toilet bowl picks (they don't trade)
  // Champion picks are handled in the merge above
  const specialPicks = standingsPredictions.filter(p => p.isToiletBowlPick);
  mergedPredictions.push(...specialPicks);

  // Sort by overall pick number
  return mergedPredictions.sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}
