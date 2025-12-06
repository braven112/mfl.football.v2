/**
 * Draft Pick Predictor Utilities
 * Handles draft order calculation, trade parsing, and pick ownership
 */

import type {
  DraftPrediction,
  StandingsFranchise,
  ToiletBowlResult,
} from '../types/standings';

interface TeamConfig {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
}

interface DraftResultPick {
  round?: string;
  pick?: string;
  comments?: string;
  franchise?: string;
  player?: string;
}

interface DraftResultsData {
  draftResults?: {
    draftUnit?: {
      draftPick?: DraftResultPick | DraftResultPick[];
    };
  };
}

/**
 * Calculate predicted draft order based on current standings
 * Uses reverse standings (worst record = pick 1) with same tiebreakers as playoff seeding
 * Picks 1-16 assigned by reverse W-L record
 * Toilet bowl winners get picks 1.17, 2.17, 2.18
 *
 * @param standings - Current season standings
 * @param teamConfigs - Team name and icon/banner info
 * @param leagueWinnerId - Franchise ID of league champion (optional, for future use)
 * @param toiletBowlWinners - Results from toilet bowl tournaments
 * @returns Array of draft predictions in draft order
 */
export function calculateDraftOrder(
  standings: StandingsFranchise[],
  teamConfigs: Map<string, TeamConfig>,
  leagueWinnerId: string,
  toiletBowlWinners: ToiletBowlResult[]
): DraftPrediction[] {
  // Sort all teams by reverse record (worst to best)
  // Worst record = lowest win percentage = best draft pick
  const sortedByRecord = sortByRecordReverse(standings);

  // Build draft predictions (picks 1-16 based on reverse standings)
  const draftPredictions: DraftPrediction[] = [];

  // Picks 1-16 go to all 16 teams in reverse record order
  // Once league winner is determined, pick 16 will be assigned to league winner
  sortedByRecord.forEach((standing, index) => {
    const pickNumber = index + 1; // 1-16
    const isLeagueWinner = leagueWinnerId && standing.id === leagueWinnerId;
    draftPredictions.push(
      buildDraftPrediction(standing, teamConfigs, pickNumber, isLeagueWinner, 1)
    );
  });

  // Picks 1.17, 2.17, 2.18 go to toilet bowl winners
  const specialPicks = [
    { round: 1, pickInRound: 17, level: 'winner' as const },
    { round: 2, pickInRound: 17, level: 'consolation' as const },
    { round: 2, pickInRound: 18, level: 'consolation2' as const },
  ];

  specialPicks.forEach((pick) => {
    const winner = toiletBowlWinners.find((w) => w.level === pick.level);
    if (winner) {
      const winnerStanding = standings.find((t) => t.id === winner.franchiseId);
      if (winnerStanding) {
        const overallNumber = pick.round === 1
          ? 16 + pick.pickInRound
          : 32 + pick.pickInRound;
        draftPredictions.push(
          buildDraftPrediction(
            winnerStanding,
            teamConfigs,
            overallNumber,
            false,
            pick.round,
            pick.pickInRound,
            true,
            pick.level
          )
        );
      }
    }
  });

  // Continue rounds 2-3 for non-special picks
  // Picks in rounds 2-3 follow same order as round 1 (picks 17-48, excluding 1.17, 2.17, 2.18)
  for (let round = 2; round <= 3; round++) {
    let picksInRound = 1;
    sortedByRecord.forEach((standing) => {
      if (picksInRound === 17 && round === 2) {
        // Skip pick 2.17 (special pick for consolation winner)
        picksInRound++;
      }
      if (picksInRound === 18 && round === 2) {
        // Skip pick 2.18 (special pick for consolation2 winner)
        picksInRound++;
      }

      const overallNumber = (round - 1) * 16 + picksInRound;
      draftPredictions.push(
        buildDraftPrediction(
          standing,
          teamConfigs,
          overallNumber,
          false,
          round,
          picksInRound
        )
      );
      picksInRound++;
    });
  }

  return draftPredictions;
}

/**
 * Sort teams by overall record in reverse order (worst to best)
 * Uses overall standings (not division-specific) with wild card tiebreakers
 */
function sortByRecordReverse(standings: StandingsFranchise[]): StandingsFranchise[] {
  return [...standings].sort((a, b) => {
    // Calculate overall win-loss records (division + non-division)
    const aWins = (parseInt(a.divw || '0') + parseInt(a.nondivw || '0'));
    const aLosses = (parseInt(a.divl || '0') + parseInt(a.nondivl || '0'));
    const bWins = (parseInt(b.divw || '0') + parseInt(b.nondivw || '0'));
    const bLosses = (parseInt(b.divl || '0') + parseInt(b.nondivl || '0'));

    // Calculate win percentages
    const aGames = aWins + aLosses;
    const bGames = bWins + bLosses;
    const aWinPct = aGames > 0 ? aWins / aGames : 0;
    const bWinPct = bGames > 0 ? bWins / bGames : 0;

    // REVERSE: Worst record (lowest win%) comes first
    if (aWinPct !== bWinPct) {
      return aWinPct - bWinPct;
    }

    // Tiebreaker 1: All-play percentage (lower is worse)
    const aAllPlay = parseFloat(a.all_play_pct || '0');
    const bAllPlay = parseFloat(b.all_play_pct || '0');
    if (aAllPlay !== bAllPlay) {
      return aAllPlay - bAllPlay;
    }

    // Tiebreaker 2: Points For (lower is worse)
    const aPF = parseFloat(a.pf || '0');
    const bPF = parseFloat(b.pf || '0');
    if (aPF !== bPF) {
      return aPF - bPF;
    }

    // Tiebreaker 3: Power Rating (lower is worse)
    const aPWR = parseFloat(a.pwr || '0');
    const bPWR = parseFloat(b.pwr || '0');
    if (aPWR !== bPWR) {
      return aPWR - bPWR;
    }

    // Tiebreaker 4: Victory Points (lower is worse)
    const aVP = parseInt(a.vp || '0');
    const bVP = parseInt(b.vp || '0');
    if (aVP !== bVP) {
      return aVP - bVP;
    }

    // Tiebreaker 5: Points Against (lower is better, so reverse)
    const aPA = parseFloat(a.pa || '0');
    const bPA = parseFloat(b.pa || '0');
    return aPA - bPA;
  });
}

/**
 * Build a single draft prediction object
 */
function buildDraftPrediction(
  standing: StandingsFranchise,
  teamConfigs: Map<string, TeamConfig>,
  overallPickNumber: number,
  isLeagueWinner: boolean,
  round: number,
  pickInRound?: number,
  isToiletBowlPick?: boolean,
  toiletBowlType?: 'winner' | 'consolation' | 'consolation2'
): DraftPrediction {
  const teamConfig = teamConfigs.get(standing.id) || {};
  const actualPickInRound = pickInRound || ((overallPickNumber - 1) % 16) + 1;

  // Parse overall record (division + non-division)
  const wins = (parseInt(standing.divw || '0') + parseInt(standing.nondivw || '0'));
  const losses = (parseInt(standing.divl || '0') + parseInt(standing.nondivl || '0'));
  const ties = (parseInt(standing.divt || '0') + parseInt(standing.nondivt || '0'));

  // Parse standings metrics
  const allPlayPct = parseFloat(standing.all_play_pct || '0');
  const pointsFor = parseFloat(standing.pf || '0');
  const pointsAgainst = parseFloat(standing.pa || '0');
  const powerRating = parseFloat(standing.pwr || '0');
  const victoryPoints = parseInt(standing.vp || '0');

  return {
    overallPickNumber,
    round,
    pickInRound: actualPickInRound,
    franchiseId: standing.id,
    teamName: teamConfig.name || standing.fname,
    teamIcon: teamConfig.icon || '',
    teamBanner: teamConfig.banner || '',
    currentRecord: {
      wins,
      losses,
      ties,
    },
    currentStanding: {
      allPlayPct,
      pointsFor,
      pointsAgainst,
      powerRating,
      victoryPoints,
    },
    isToiletBowlPick: isToiletBowlPick || false,
    toiletBowlType,
    isLeagueWinner,
  };
}

/**
 * Parse draft pick comments to extract trade information
 * Format: "[Pick traded from Team Name.]" or no comment for original pick
 *
 * @param comment - Draft pick comment from draftResults
 * @returns Parsed team name if traded, undefined if original
 */
export function parseTradeFromComment(comment: string): string | undefined {
  if (!comment) return undefined;

  const tradeMatch = comment.match(/\[Pick (?:traded|traded from) (.+?)\.\]/);
  if (tradeMatch) {
    return tradeMatch[1];
  }

  return undefined;
}

/**
 * Build trade chain from draft results
 * Combines trade comments with MFL assets data to create full trade history
 *
 * @param draftResults - Draft results data with comments
 * @param teamConfigs - Map of franchise IDs to team names
 * @returns Map of pick ID to trade chain
 */
export function buildTradeChains(
  draftResults: DraftResultsData,
  teamConfigs: Map<string, TeamConfig>
): Map<string, { original: string; chain: string[] }> {
  const chains = new Map<string, { original: string; chain: string[] }>();

  const picks = draftResults?.draftResults?.draftUnit?.draftPick;
  if (!picks) return chains;

  const pickArray = Array.isArray(picks) ? picks : [picks];

  pickArray.forEach((pick) => {
    if (!pick.round || !pick.pick || !pick.franchise) return;

    const pickId = `${pick.round}.${pick.pick}`;
    const comment = pick.comments || '';
    const currentFranchise = pick.franchise;

    const tradedFromTeam = parseTradeFromComment(comment);
    if (tradedFromTeam) {
      // Find franchise ID of original team by name
      let originalFranchiseId = '';
      for (const [fId, config] of teamConfigs.entries()) {
        if (config.name === tradedFromTeam) {
          originalFranchiseId = fId;
          break;
        }
      }

      chains.set(pickId, {
        original: tradedFromTeam,
        chain: [tradedFromTeam], // Will be enhanced with intermediate trades
      });
    }
  });

  return chains;
}

/**
 * Format trade chain for display
 * @param chain - Array of team names in trade chain
 * @returns Formatted string like "from Team A" or "from Team A via Team B"
 */
export function formatTradeChain(chain: string[]): string {
  if (chain.length === 0) return '';
  if (chain.length === 1) return `from ${chain[0]}`;
  return `from ${chain[0]} via ${chain.slice(1).join(' via ')}`;
}

/**
 * Extract actual draft assets (picks each team owns) from draft results
 * Compares current owner vs original owner to identify trades
 *
 * @param draftResults - Draft results data from MFL
 * @param teamConfigs - Map of franchise IDs to team config
 * @returns Map of pick ID (round.pick) to actual asset info
 */
export function extractActualAssets(
  draftResults: DraftResultsData,
  teamConfigs: Map<string, TeamConfig>
): Map<string, { round: string; pick: string; currentFranchiseId: string; currentTeamName: string; originalTeamName?: string; isTraded: boolean }> {
  const assets = new Map<string, { round: string; pick: string; currentFranchiseId: string; currentTeamName: string; originalTeamName?: string; isTraded: boolean }>();

  const picks = draftResults?.draftResults?.draftUnit?.draftPick;
  if (!picks) return assets;

  const pickArray = Array.isArray(picks) ? picks : [picks];

  pickArray.forEach((pick) => {
    if (!pick.round || !pick.pick || !pick.franchise) return;

    const pickId = `${pick.round}.${pick.pick}`;
    const currentFranchiseId = pick.franchise;
    const currentTeamName = teamConfigs.get(currentFranchiseId)?.name || 'Unknown Team';

    // Check if pick was traded by looking at comments
    const tradedFromTeam = parseTradeFromComment(pick.comments || '');
    const isTraded = !!tradedFromTeam;

    assets.set(pickId, {
      round: pick.round,
      pick: pick.pick,
      currentFranchiseId,
      currentTeamName,
      originalTeamName: tradedFromTeam,
      isTraded,
    });
  });

  return assets;
}

/**
 * Build a list of actual draft picks from results with current ownership
 * Used to show which team actually owns each pick after trades
 *
 * @param draftResults - Draft results from MFL
 * @param teamConfigs - Team name and metadata
 * @returns Array of picks sorted by pick number with ownership info
 */
export function buildActualDraftPicks(
  draftResults: DraftResultsData,
  teamConfigs: Map<string, TeamConfig>
): Array<{
  round: string;
  pick: string;
  overallPickNumber: number;
  currentFranchiseId: string;
  currentTeamName: string;
  originalTeamName?: string;
  originalTeamIcon?: string;
  isTraded: boolean;
}> {
  const assets = extractActualAssets(draftResults, teamConfigs);
  const picks: Array<{
    round: string;
    pick: string;
    overallPickNumber: number;
    currentFranchiseId: string;
    currentTeamName: string;
    originalTeamName?: string;
    originalTeamIcon?: string;
    isTraded: boolean;
  }> = [];

  assets.forEach((asset) => {
    const roundNum = parseInt(asset.round);
    const pickNum = parseInt(asset.pick);
    const overallPickNumber = (roundNum - 1) * 16 + pickNum;

    // Find original team's icon if this pick was traded
    let originalTeamIcon: string | undefined;
    if (asset.isTraded && asset.originalTeamName) {
      // Find the team by name to get its icon
      for (const [_, config] of teamConfigs.entries()) {
        if (config.name === asset.originalTeamName) {
          originalTeamIcon = config.icon;
          break;
        }
      }
    }

    picks.push({
      round: asset.round,
      pick: asset.pick,
      overallPickNumber,
      currentFranchiseId: asset.currentFranchiseId,
      currentTeamName: asset.currentTeamName,
      originalTeamName: asset.originalTeamName,
      originalTeamIcon,
      isTraded: asset.isTraded,
    });
  });

  return picks.sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}

/**
 * Convert actual draft picks to DraftPrediction format for grid display
 * Maps pick ownership data to the format expected by DraftPredictorGrid
 *
 * @param actualPicks - Actual draft picks from buildActualDraftPicks
 * @param teamConfigs - Map of franchise IDs to team config
 * @returns Array of DraftPrediction objects
 */
export function convertActualPicksToPredictions(
  actualPicks: Array<{
    round: string;
    pick: string;
    overallPickNumber: number;
    currentFranchiseId: string;
    currentTeamName: string;
    originalTeamName?: string;
    originalTeamIcon?: string;
    isTraded: boolean;
  }>,
  teamConfigs: Map<string, TeamConfig>
): DraftPrediction[] {
  return actualPicks.map((pick) => {
    const teamConfig = teamConfigs.get(pick.currentFranchiseId);

    return {
      overallPickNumber: pick.overallPickNumber,
      round: parseInt(pick.round),
      pickInRound: parseInt(pick.pick),
      franchiseId: pick.currentFranchiseId,
      teamName: pick.currentTeamName,
      teamIcon: teamConfig?.icon || '',
      teamBanner: teamConfig?.banner || '',
      currentRecord: {
        wins: 0,
        losses: 0,
        ties: 0,
      },
      currentStanding: {
        allPlayPct: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        powerRating: 0,
        victoryPoints: 0,
      },
      isToiletBowlPick: false,
      isLeagueWinner: false,
      originalTeamName: pick.originalTeamName,
      originalTeamIcon: pick.originalTeamIcon || '',
      isTraded: pick.isTraded,
    };
  });
}
