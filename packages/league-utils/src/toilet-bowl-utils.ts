/**
 * Toilet Bowl Tournament Utilities
 * Parses playoff bracket data to extract toilet bowl tournament winners
 */

import type { ToiletBowlResult } from '../types/standings';

interface PlayoffBracketData {
  playoffBracket?: {
    playoffTierItem?: Array<{
      tier?: string;
      bracketId?: string;
      bracket_id?: string;
      franchiseId?: string;
      franchise_id?: string;
      franchiseName?: string;
      franchise_name?: string;
    }>;
  };
}

/**
 * Extract toilet bowl tournament winners from playoff bracket data
 * Maps bracket IDs: #4 = pick 1.17 (Toilet Bowl winner)
 *                   #5 = pick 2.17 (Consolation winner)
 *                   #6 = pick 2.18 (Consolation 2 winner)
 * @param bracketData - Raw playoffBracket API response
 * @returns Array of toilet bowl results with franchise IDs
 */
export function extractToiletBowlWinners(bracketData: PlayoffBracketData): ToiletBowlResult[] {
  const results: ToiletBowlResult[] = [];

  if (!bracketData?.playoffBracket?.playoffTierItem) {
    return results;
  }

  const items = Array.isArray(bracketData.playoffBracket.playoffTierItem)
    ? bracketData.playoffBracket.playoffTierItem
    : [bracketData.playoffBracket.playoffTierItem];

  // Map bracket IDs to toilet bowl levels (primary method)
  const bracketIdMap: Record<string | number, 'winner' | 'consolation' | 'consolation2'> = {
    4: 'winner',      // Toilet Bowl winner -> pick 1.17
    5: 'consolation', // Consolation winner -> pick 2.17
    6: 'consolation2', // Consolation 2 winner -> pick 2.18
  };

  // Map tier names to toilet bowl levels (fallback for consistency)
  const tierMap: Record<string, 'winner' | 'consolation' | 'consolation2'> = {
    'The Toilet Bowl': 'winner',
    'Toilet Bowl': 'winner',
    'The Toilet Bowl Consolation': 'consolation',
    'Toilet Bowl Consolation': 'consolation',
    'The Toilet Bowl Consolation 2': 'consolation2',
    'Toilet Bowl Consolation 2': 'consolation2',
  };

  items.forEach((item) => {
    // Prefer bracket ID mapping over tier name mapping
    const bracketId = item.bracketId || item.bracket_id;
    let level: 'winner' | 'consolation' | 'consolation2' | undefined;

    if (bracketId !== undefined) {
      level = bracketIdMap[bracketId];
    } else if (item.tier) {
      level = tierMap[item.tier];
    }

    if (!level) return;

    // Get franchise ID (normalize naming inconsistencies)
    const franchiseId = item.franchiseId || item.franchise_id;
    const franchiseName = item.franchiseName || item.franchise_name || '';

    if (franchiseId) {
      results.push({
        level,
        franchiseId: String(franchiseId).padStart(4, '0'),
        franchiseName,
      });
    }
  });

  return results;
}

/**
 * Get the three special draft picks awarded to toilet bowl winners
 * @param toiletBowlWinners - Array of toilet bowl results
 * @returns Array with 3 special draft picks (pick 1.17, 2.17, 2.18)
 */
export function getToiletBowlDraftPicks(toiletBowlWinners: ToiletBowlResult[]) {
  const specialPicks = [
    {
      round: 1,
      pickInRound: 17,
      level: 'winner',
    },
    {
      round: 2,
      pickInRound: 17,
      level: 'consolation',
    },
    {
      round: 2,
      pickInRound: 18,
      level: 'consolation2',
    },
  ];

  return specialPicks.map((pick) => {
    const winner = toiletBowlWinners.find((w) => w.level === pick.level);
    return {
      ...pick,
      franchiseId: winner?.franchiseId || '',
    };
  });
}

/**
 * Check if a given level has a winner in the results
 * @param toiletBowlWinners - Array of toilet bowl results
 * @param level - Level to check
 * @returns The winner at that level, or undefined
 */
export function getToiletBowlWinner(
  toiletBowlWinners: ToiletBowlResult[],
  level: 'winner' | 'consolation' | 'consolation2'
): ToiletBowlResult | undefined {
  return toiletBowlWinners.find((w) => w.level === level);
}
