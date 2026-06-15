/**
 * AFL Fantasy Draft Pick Predictor Utilities
 * Handles two-conference draft order calculation with NIT points system
 */

import type {
  DraftPrediction,
  StandingsFranchise,
} from '../types/standings';

interface TeamConfig {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
  conference?: string;
}

interface NITResult {
  franchiseId: string;
  finishPosition: number; // 1-5 (top 5 get bonus points)
}

interface ConferenceDraftOrder {
  conference: string;
  picks: DraftPrediction[];
}

/**
 * Calculate predicted draft order for AFL Fantasy (two conferences)
 * Each conference has its own 12-team draft order
 *
 * @param standings - Current season standings
 * @param teamConfigs - Team config with conference info
 * @param conferenceChampions - Map of conference code to champion franchise ID
 * @param nitResults - Top 5 NIT finishers per conference (get +1.5 bonus points)
 * @returns Draft orders for both conferences
 */
export function calculateAFLDraftOrder(
  standings: StandingsFranchise[],
  teamConfigs: Map<string, TeamConfig>,
  conferenceChampions: Map<string, string>, // conference code -> franchise ID
  nitResults: Map<string, NITResult[]> // conference code -> top 5 NIT finishers
): ConferenceDraftOrder[] {
  // Group teams by conference
  const conferenceA = standings.filter(team => teamConfigs.get(team.id)?.conference === '00');
  const conferenceB = standings.filter(team => teamConfigs.get(team.id)?.conference === '01');

  const conferences = [
    { code: '00', name: 'American League', teams: conferenceA },
    { code: '01', name: 'National League', teams: conferenceB }
  ];

  return conferences.map(({ code, name, teams }) => {
    const championId = conferenceChampions.get(code);
    const nitTop5 = nitResults.get(code) || [];

    const picks = calculateConferenceDraftOrder(
      teams,
      teamConfigs,
      championId || '',
      nitTop5,
      code
    );

    return {
      conference: name,
      picks
    };
  });
}

/**
 * Calculate draft order for a single conference (12 teams, 9 rounds)
 * Applies NIT points system to reorder Round 1 only
 */
function calculateConferenceDraftOrder(
  standings: StandingsFranchise[],
  teamConfigs: Map<string, TeamConfig>,
  championId: string,
  nitTop5: NITResult[],
  conferenceCode: string
): DraftPrediction[] {
  // Step 1: Sort by reverse record (worst to best)
  const sortedByRecord = sortByRecordReverse(standings);

  // Step 2: Assign base draft positions.
  //
  // Per the AFL constitution, the conference champion is pulled out of the
  // standings-based order and forced to the LAST base position (worst pick,
  // 1 point). The remaining teams fill positions 1..(N-1) by reverse record
  // (worst record = position 1 = most points). Pulling the champion out first
  // is what keeps the positions contiguous: assigning the champion position N
  // while still numbering everyone else by raw index would collide at N (and
  // skip a position) whenever the champion is not the best-record team.
  const teamCount = sortedByRecord.length;
  const championTeam = championId
    ? sortedByRecord.find(team => team.id === championId)
    : undefined;
  const nonChampions = championTeam
    ? sortedByRecord.filter(team => team.id !== championId)
    : sortedByRecord;

  const teamsWithPoints = nonChampions.map((team, index) => {
    const basePosition = index + 1; // 1 = worst record (best pick)
    const basePoints = teamCount + 1 - basePosition; // N points for position 1 ... 2 for position N-1

    // Check if team is in top 5 NIT finishers (+1.5 bonus)
    const isNITTop5 = nitTop5.some(nit => nit.franchiseId === team.id);
    const bonusPoints = isNITTop5 ? 1.5 : 0;
    const totalPoints = basePoints + bonusPoints;

    return {
      team,
      basePosition,
      totalPoints,
      isChampion: false
    };
  });

  // Champion always lands at the last base position (1 point, no NIT bonus —
  // the conference champion plays in the championship bracket, not the NIT).
  if (championTeam) {
    teamsWithPoints.push({
      team: championTeam,
      basePosition: teamCount,
      totalPoints: 1,
      isChampion: true
    });
  }

  // Step 3: Reorder Round 1 by total points (highest points = pick 1 / best pick)
  const round1Order = [...teamsWithPoints].sort((a, b) => {
    // Higher points = better pick (lower pick number)
    if (a.totalPoints !== b.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    // Tiebreaker: Higher original draft position (worse record) wins
    return a.basePosition - b.basePosition;
  });

  // Rounds 2-9 follow the BASE order (reverse standings, champion last) — the
  // NIT bonus is a Round 1 ONLY adjustment per the constitution ("The first
  // round will be reordered by total points earned"). Verified against the
  // live MFL draft board: a team bumped up in Round 1 by its NIT bonus reverts
  // to its base slot in Round 2 onward.
  const baseOrder = [...teamsWithPoints].sort((a, b) => a.basePosition - b.basePosition);

  const teamCountPerRound = teamsWithPoints.length;

  // Build all draft predictions
  const draftPredictions: DraftPrediction[] = [];

  // Round 1: Use NIT-adjusted order
  round1Order.forEach((item, index) => {
    const pickNumber = index + 1; // 1-12
    draftPredictions.push(
      buildAFLDraftPrediction(
        item.team,
        teamConfigs,
        pickNumber,
        item.isChampion,
        1,
        pickNumber,
        conferenceCode
      )
    );
  });

  // Rounds 2-9: Follow the base (reverse-standings) order, NOT Round 1
  for (let round = 2; round <= 9; round++) {
    baseOrder.forEach((item, index) => {
      const pickInRound = index + 1; // 1-12
      const overallNumber = (round - 1) * teamCountPerRound + pickInRound;

      draftPredictions.push(
        buildAFLDraftPrediction(
          item.team,
          teamConfigs,
          overallNumber,
          item.isChampion,
          round,
          pickInRound,
          conferenceCode
        )
      );
    });
  }

  return draftPredictions;
}

/**
 * Sort teams by overall record in reverse order (worst to best)
 * Uses same tiebreakers as standings
 */
function sortByRecordReverse(standings: StandingsFranchise[]): StandingsFranchise[] {
  return [...standings].sort((a, b) => {
    // Calculate overall win-loss records
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

    // Tiebreaker 1: Power Rank (lower is worse for draft purposes)
    const aPWR = parseFloat(a.pwr || '0');
    const bPWR = parseFloat(b.pwr || '0');
    if (aPWR !== bPWR) {
      return aPWR - bPWR;
    }

    // Tiebreaker 2: Points For (lower is worse)
    const aPF = parseFloat(a.pf || '0');
    const bPF = parseFloat(b.pf || '0');
    if (aPF !== bPF) {
      return aPF - bPF;
    }

    // Tiebreaker 3: All-play percentage (lower is worse)
    const aAllPlay = parseFloat(a.all_play_pct || '0');
    const bAllPlay = parseFloat(b.all_play_pct || '0');
    if (aAllPlay !== bAllPlay) {
      return aAllPlay - bAllPlay;
    }

    // Tiebreaker 4: Victory Points (lower is worse)
    const aVP = parseInt(a.vp || '0');
    const bVP = parseInt(b.vp || '0');
    if (aVP !== bVP) {
      return aVP - bVP;
    }

    // Tiebreaker 5: Points Against (higher is worse)
    const aPA = parseFloat(a.pa || '0');
    const bPA = parseFloat(b.pa || '0');
    return bPA - aPA;
  });
}

/**
 * Build a single draft prediction object for AFL Fantasy
 */
function buildAFLDraftPrediction(
  standing: StandingsFranchise,
  teamConfigs: Map<string, TeamConfig>,
  overallPickNumber: number,
  isConferenceChampion: boolean,
  round: number,
  pickInRound: number,
  conferenceCode: string
): DraftPrediction {
  const teamConfig = teamConfigs.get(standing.id);

  // Parse overall record
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
    pickInRound,
    franchiseId: standing.id,
    teamName: teamConfig?.name || standing.fname,
    teamIcon: teamConfig?.icon || '',
    teamBanner: teamConfig?.banner || '',
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
    isToiletBowlPick: false,
    isLeagueWinner: isConferenceChampion,
    conference: conferenceCode
  };
}

/**
 * Mock NIT results for testing/preview before NIT is complete
 * Returns empty array - no bonus points awarded yet
 */
export function getMockNITResults(): Map<string, NITResult[]> {
  return new Map([
    ['00', []],
    ['01', []]
  ]);
}

/**
 * Parse conference champions from playoff bracket data.
 *
 * Per the AFL constitution each conference draft is independent, and EACH
 * conference champion automatically receives the 12th (last) pick in their own
 * conference draft — not just the overall Super Bowl winner. The conference
 * championships are separate brackets from the Super Bowl:
 *   - Bracket 1 = AFL Championship (Super Bowl, AL champ vs NL champ)
 *   - Bracket 2 = AL Championship  -> American League champion (conference '00')
 *   - Bracket 3 = NL Championship  -> National League champion (conference '01')
 *
 * We read brackets 2 and 3 and slot each winner into its actual conference
 * (looked up from the team config, so a misnumbered bracket can't mis-slot a
 * champion). Returns a map of conference code ('00' | '01') -> franchise ID.
 */
export function parseConferenceChampions(
  playoffBracketsData: any,
  teamConfigs: Map<string, TeamConfig>
): Map<string, string> {
  const champions = new Map<string, string>();

  if (!playoffBracketsData?.brackets) {
    return champions;
  }

  // Bracket 2 = AL Championship, Bracket 3 = NL Championship.
  for (const bracketId of ['2', '3']) {
    const champion = getWinnerOfBracket(playoffBracketsData.brackets[bracketId]);
    if (!champion) continue;

    const conference = teamConfigs.get(champion)?.conference;
    if (conference === '00' || conference === '01') {
      champions.set(conference, champion);
    }
  }

  return champions;
}

/**
 * Get the winner of a playoff bracket by following the bracket rounds
 * Returns franchise ID of winner, or undefined if bracket not complete
 */
function getWinnerOfBracket(bracket: any): string | undefined {
  if (!bracket?.playoffBracket?.playoffRound) {
    return undefined;
  }

  // Get the last round (championship game)
  const rounds = Array.isArray(bracket.playoffBracket.playoffRound)
    ? bracket.playoffBracket.playoffRound
    : [bracket.playoffBracket.playoffRound];

  const finalRound = rounds[rounds.length - 1];
  const finalGame = finalRound?.playoffGame;

  if (!finalGame) {
    return undefined;
  }

  // Check if game has been played (points are filled in)
  const homePoints = parseFloat(finalGame.home?.points || '');
  const awayPoints = parseFloat(finalGame.away?.points || '');

  if (isNaN(homePoints) || isNaN(awayPoints)) {
    return undefined; // Game not played yet
  }

  // Determine winner based on points
  if (homePoints > awayPoints) {
    return resolveTeamId(finalGame.home);
  } else if (awayPoints > homePoints) {
    return resolveTeamId(finalGame.away);
  }

  return undefined;
}

/**
 * Resolve a team reference to an actual franchise ID
 * Handles direct franchise_id or references to winner/loser of other games
 */
function resolveTeamId(team: any): string | undefined {
  if (team?.franchise_id) {
    return team.franchise_id;
  }

  // TODO: Implement recursive resolution of winner_of_game/loser_of_game references
  // For now, return undefined if not a direct franchise_id
  return undefined;
}

/**
 * Parse NIT results from playoff bracket data
 * Identifies top 5 finishers who get +1.5 bonus points
 *
 * Top 5 NIT positions (each gets +1.5 draft points):
 * 1. Winner of bracket 6 (NIT Championship)
 * 2. Loser of bracket 6 final (NIT Runner-up)
 * 3. Winner of bracket 7 (NIT 3rd Place)
 * 4. Winner of bracket 8 (NIT 4th Place)
 * 5. Winner of bracket 9 (NIT 5th Place)
 *
 * NIT is a single 16-team tournament with teams from both conferences,
 * so we need to filter results by conference after determining the top 5
 */
export function parseNITResults(
  playoffBracketsData: any,
  teamConfigs: Map<string, TeamConfig>
): Map<string, NITResult[]> {
  const results = new Map<string, NITResult[]>([
    ['00', []],
    ['01', []]
  ]);

  if (!playoffBracketsData?.brackets) {
    return results;
  }

  const allNITFinishers: Array<{ franchiseId: string; position: number }> = [];

  // Position 1: NIT Champion (winner of bracket 6)
  const nitChampion = getWinnerOfBracket(playoffBracketsData.brackets['6']);
  if (nitChampion) {
    allNITFinishers.push({ franchiseId: nitChampion, position: 1 });
  }

  // Position 2: NIT Runner-up (loser of bracket 6 final)
  const nitRunnerUp = getLoserOfBracketFinal(playoffBracketsData.brackets['6']);
  if (nitRunnerUp) {
    allNITFinishers.push({ franchiseId: nitRunnerUp, position: 2 });
  }

  // Position 3: NIT 3rd Place (winner of bracket 7)
  const nit3rdPlace = getWinnerOfBracket(playoffBracketsData.brackets['7']);
  if (nit3rdPlace) {
    allNITFinishers.push({ franchiseId: nit3rdPlace, position: 3 });
  }

  // Position 4: NIT 4th Place (winner of bracket 8)
  const nit4thPlace = getWinnerOfBracket(playoffBracketsData.brackets['8']);
  if (nit4thPlace) {
    allNITFinishers.push({ franchiseId: nit4thPlace, position: 4 });
  }

  // Position 5: NIT 5th Place (winner of bracket 9)
  const nit5thPlace = getWinnerOfBracket(playoffBracketsData.brackets['9']);
  if (nit5thPlace) {
    allNITFinishers.push({ franchiseId: nit5thPlace, position: 5 });
  }

  // Distribute finishers to their respective conferences
  allNITFinishers.forEach(finisher => {
    const teamConfig = teamConfigs.get(finisher.franchiseId);
    const conference = teamConfig?.conference;

    if (conference === '00' || conference === '01') {
      const conferenceResults = results.get(conference) || [];
      conferenceResults.push({
        franchiseId: finisher.franchiseId,
        finishPosition: finisher.position
      });
      results.set(conference, conferenceResults);
    }
  });

  return results;
}

/**
 * Get the loser of a bracket's final game
 */
function getLoserOfBracketFinal(bracket: any): string | undefined {
  if (!bracket?.playoffBracket?.playoffRound) {
    return undefined;
  }

  const rounds = Array.isArray(bracket.playoffBracket.playoffRound)
    ? bracket.playoffBracket.playoffRound
    : [bracket.playoffBracket.playoffRound];

  const finalRound = rounds[rounds.length - 1];
  const finalGame = finalRound?.playoffGame;

  if (!finalGame) {
    return undefined;
  }

  const homePoints = parseFloat(finalGame.home?.points || '');
  const awayPoints = parseFloat(finalGame.away?.points || '');

  if (isNaN(homePoints) || isNaN(awayPoints)) {
    return undefined;
  }

  // Return loser (opposite of winner)
  if (homePoints > awayPoints) {
    return resolveTeamId(finalGame.away);
  } else if (awayPoints > homePoints) {
    return resolveTeamId(finalGame.home);
  }

  return undefined;
}
