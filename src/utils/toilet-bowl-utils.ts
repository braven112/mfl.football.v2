/**
 * Toilet Bowl Tournament Utilities
 * Parses playoff bracket data to extract toilet bowl tournament winners
 */

import type { ToiletBowlResult } from '../types/standings';

/**
 * Extract winner from a playoff bracket by examining the final game
 * @param bracket - Individual bracket data
 * @returns Franchise ID of winner, or empty string if not determined
 */
function getBracketWinner(bracket: any): string {
  if (!bracket?.playoffBracket?.playoffRound) {
    return '';
  }

  const rounds = bracket.playoffBracket.playoffRound;
  const roundsArray = Array.isArray(rounds) ? rounds : [rounds];

  // Get the last round (championship game)
  const finalRound = roundsArray[roundsArray.length - 1];
  if (!finalRound?.playoffGame) {
    return '';
  }

  // Final game can be a single object or array
  const finalGame = Array.isArray(finalRound.playoffGame)
    ? finalRound.playoffGame[0]
    : finalRound.playoffGame;

  if (!finalGame) {
    return '';
  }

  // Determine winner by comparing points
  const homePoints = parseFloat(finalGame.home?.points || '0');
  const awayPoints = parseFloat(finalGame.away?.points || '0');

  // If no points yet, game hasn't been decided
  if (homePoints === 0 && awayPoints === 0) {
    return '';
  }

  // Return franchise ID of winner
  const winnerId = homePoints > awayPoints
    ? finalGame.home?.franchise_id
    : finalGame.away?.franchise_id;

  return winnerId ? String(winnerId).padStart(4, '0') : '';
}

/**
 * Extract toilet bowl tournament winners from playoff bracket data
 * Maps bracket IDs: #5 = pick 1.17 (Toilet Bowl winner)
 *                   #6 = pick 2.17 (Consolation winner)
 *                   #7 = pick 2.18 (Consolation 2 winner)
 * @param bracketData - Raw playoff bracket data with individual bracket results
 * @returns Array of toilet bowl results with franchise IDs
 */
export function extractToiletBowlWinners(bracketData: any): ToiletBowlResult[] {
  const results: ToiletBowlResult[] = [];

  if (!bracketData?.brackets) {
    return results;
  }

  // Map bracket IDs to toilet bowl levels and pick assignments
  const bracketMapping: Array<{
    bracketId: string;
    level: 'winner' | 'consolation' | 'consolation2';
  }> = [
    { bracketId: '5', level: 'winner' },      // Toilet Bowl winner -> pick 1.17
    { bracketId: '6', level: 'consolation' }, // Consolation winner -> pick 2.17
    { bracketId: '7', level: 'consolation2' }, // Consolation 2 winner -> pick 2.18
  ];

  bracketMapping.forEach(({ bracketId, level }) => {
    const bracket = bracketData.brackets[bracketId];
    if (!bracket) {
      return;
    }

    const winnerId = getBracketWinner(bracket);
    if (winnerId) {
      results.push({
        level,
        franchiseId: winnerId,
        franchiseName: '', // Name will be resolved from team config
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

/**
 * Extract league champion from playoff bracket data
 * The champion is determined by finding bracket #1 (The League Championship)
 * and getting the winner of the final game (last round, highest points)
 *
 * @param bracketData - Raw playoff bracket data with individual bracket results
 * @returns Franchise ID of league champion, or empty string if not determined
 */
export function extractLeagueChampion(bracketData: any): string {
  // Championship bracket is always bracket ID "1"
  const championshipBracket = bracketData?.brackets?.['1']?.playoffBracket;

  if (!championshipBracket) {
    return '';
  }

  // Get all rounds
  const rounds = championshipBracket.playoffRound;
  if (!rounds) {
    return '';
  }

  // Rounds can be an array or single object
  const roundsArray = Array.isArray(rounds) ? rounds : [rounds];

  // Get the last round (championship game)
  const finalRound = roundsArray[roundsArray.length - 1];
  if (!finalRound) {
    return '';
  }

  // Get the game(s) in the final round
  const games = finalRound.playoffGame;
  if (!games) {
    return '';
  }

  // Final round should have exactly one game
  const finalGame = Array.isArray(games) ? games[0] : games;
  if (!finalGame) {
    return '';
  }

  // Determine winner by comparing points
  const homePoints = parseFloat(finalGame.home?.points || '0');
  const awayPoints = parseFloat(finalGame.away?.points || '0');

  // If no points yet, championship hasn't been decided
  if (homePoints === 0 && awayPoints === 0) {
    return '';
  }

  // Return franchise ID of winner
  const winnerId = homePoints > awayPoints
    ? finalGame.home?.franchise_id
    : finalGame.away?.franchise_id;

  return winnerId ? String(winnerId).padStart(4, '0') : '';
}
