import { normalizeTeamCode } from './nfl';

export interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
}

export interface PlayerScore {
  id: string;
  score: string;
}

export interface TopPlayer {
  player: string;
  projectedPoints: number;
  injury: string | null;
}

export interface HighTotalGame {
  gameId: string;
  team1: string;
  team2: string;
  team1Total: number;
  team2Total: number;
  combinedTotal: number;
  topPlayersTeam1: TopPlayer[];
  topPlayersTeam2: TopPlayer[];
  day: string;
  time: string;
  channel: string;
  weather: string;
}

export interface NflGameAnalysis {
  week: number;
  highTotalGames: HighTotalGame[];
}

/**
 * Processes NFL schedule and projection data to find high-scoring games.
 * 
 * @param scheduleData - JSON object from nfl-cache (e.g. week15-2024.json)
 * @param playersData - JSON object from players.json
 * @param projectionsData - JSON object from projectedScores.json
 */
export function getHighTotalGames(
  scheduleData: any,
  playersData: { players: { player: Player[] | Player } },
  projectionsData: { projectedScores: { playerScore: PlayerScore[] | PlayerScore } }
): NflGameAnalysis {
  const week = scheduleData.week;
  const schedule = scheduleData.schedule || {};
  const gameDetails = scheduleData.gameDetails || {};

  // 1. Map players and scores
  const playerMap = new Map<string, Player>();
  const playersList = Array.isArray(playersData.players?.player) 
    ? playersData.players.player 
    : (playersData.players?.player ? [playersData.players.player] : []);
    
  playersList.forEach((p: Player) => playerMap.set(p.id, p));

  const teamPlayers = new Map<string, Array<{ name: string; score: number }>>();
  const teamTotals = new Map<string, number>();

  const scoresList = Array.isArray(projectionsData.projectedScores?.playerScore)
    ? projectionsData.projectedScores.playerScore
    : (projectionsData.projectedScores?.playerScore ? [projectionsData.projectedScores.playerScore] : []);

  scoresList.forEach((ps: PlayerScore) => {
    const player = playerMap.get(ps.id);
    if (player) {
      const team = normalizeTeamCode(player.team);
      const score = parseFloat(ps.score) || 0;

      // Update Team Total
      const currentTotal = teamTotals.get(team) || 0;
      teamTotals.set(team, currentTotal + score);

      // Add to team players list for sorting later
      if (!teamPlayers.has(team)) {
        teamPlayers.set(team, []);
      }
      teamPlayers.get(team)?.push({ name: player.name, score });
    }
  });

  // 2. Build Games
  const processedGames = new Set<string>();
  const highTotalGames: HighTotalGame[] = [];

  Object.entries(schedule).forEach(([teamCode, opponentCode]) => {
    const team1 = normalizeTeamCode(teamCode);
    const team2 = normalizeTeamCode(opponentCode as string);

    // Create a unique key for the matchup to avoid duplicates (e.g. A-B vs B-A)
    const gameKey = [team1, team2].sort().join('-');
    if (processedGames.has(gameKey)) return;
    processedGames.add(gameKey);

    const team1Total = parseFloat((teamTotals.get(team1) || 0).toFixed(1));
    const team2Total = parseFloat((teamTotals.get(team2) || 0).toFixed(1));
    const combinedTotal = parseFloat((team1Total + team2Total).toFixed(1));

    // 3. Filter: Combined >= 50 OR either team >= 30
    if (combinedTotal >= 50 || team1Total >= 30 || team2Total >= 30) {
      // 4. Enrich
      const getTopPlayers = (t: string): TopPlayer[] => {
        const players = teamPlayers.get(t) || [];
        return players
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((p) => ({
            player: p.name,
            projectedPoints: p.score,
            injury: null,
          }));
      };

      // Find game details using normalized keys (e.g. LAR_vs_SF)
      const detailKey1 = `${team1}_vs_${team2}`;
      const detailKey2 = `${team2}_vs_${team1}`;
      const details = gameDetails[detailKey1] || gameDetails[detailKey2] || {};

      highTotalGames.push({
        gameId: `${team1}@${team2}`,
        team1,
        team2,
        team1Total,
        team2Total,
        combinedTotal,
        topPlayersTeam1: getTopPlayers(team1),
        topPlayersTeam2: getTopPlayers(team2),
        day: details.day || 'Sun',
        time: details.time || '10:00 AM PST',
        channel: details.channel || '',
        weather: details.weather || '',
      });
    }
  });

  // Sort by combined total descending
  highTotalGames.sort((a, b) => b.combinedTotal - a.combinedTotal);

  return {
    week,
    highTotalGames,
  };
}
