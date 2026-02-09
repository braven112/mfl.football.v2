/**
 * Mock matchup data generator
 * Provides sample data for testing the matchup navigation system
 * Based on the existing data structure from matchup-preview-example.astro
 */

import type { Matchup, FantasyTeam, NFLGame, FantasyPlayer } from '../types/matchup-previews';

/**
 * Generate mock fantasy teams
 */
export function generateMockTeams(): FantasyTeam[] {
  return [
    {
      id: '0001',
      name: 'Championship Chasers',
      ownerName: 'Alex Johnson',
      projectedPoints: 142.3,
    },
    {
      id: '0002',
      name: 'Dynasty Builders',
      ownerName: 'Sarah Chen',
      projectedPoints: 138.7,
    },
    {
      id: '0003',
      name: 'Playoff Pushers',
      ownerName: 'Mike Rodriguez',
      projectedPoints: 135.2,
    },
    {
      id: '0004',
      name: 'Fantasy Phenoms',
      ownerName: 'Emily Davis',
      projectedPoints: 141.8,
    },
    {
      id: '0005',
      name: 'Gridiron Gurus',
      ownerName: 'Chris Thompson',
      projectedPoints: 139.4,
    },
    {
      id: '0006',
      name: 'Victory Seekers',
      ownerName: 'Jessica Wilson',
      projectedPoints: 136.9,
    },
    {
      id: '0007',
      name: 'Title Contenders',
      ownerName: 'David Brown',
      projectedPoints: 144.1,
    },
    {
      id: '0008',
      name: 'League Legends',
      ownerName: 'Amanda Taylor',
      projectedPoints: 140.6,
    },
    {
      id: '0009',
      name: 'Fantasy Force',
      ownerName: 'Ryan Martinez',
      projectedPoints: 137.3,
    },
    {
      id: '0010',
      name: 'Championship Squad',
      ownerName: 'Lisa Anderson',
      projectedPoints: 143.5,
    },
    {
      id: '0011',
      name: 'Elite Eleven',
      ownerName: 'Kevin White',
      projectedPoints: 138.9,
    },
    {
      id: '0012',
      name: 'Victory Formation',
      ownerName: 'Nicole Garcia',
      projectedPoints: 141.2,
    },
    {
      id: '0013',
      name: 'Gridiron Geeks',
      ownerName: 'Tom Wilson',
      projectedPoints: 139.8,
    },
    {
      id: '0014',
      name: 'Fantasy Fanatics',
      ownerName: 'Rachel Johnson',
      projectedPoints: 142.7,
    },
    {
      id: '0015',
      name: 'Dark Magicians of Chaos',
      ownerName: 'Mark Davis',
      projectedPoints: 140.3,
    },
    {
      id: '0016',
      name: 'Playoff Predators',
      ownerName: 'Jennifer Lee',
      projectedPoints: 138.1,
    },
  ];
}

/**
 * Generate mock NFL games with fantasy players
 */
export function generateMockNFLGames(): NFLGame[] {
  const games: NFLGame[] = [
    {
      id: 'game-1',
      team1: 'KC',
      team2: 'BUF',
      players: [
        {
          id: 'player-1',
          name: 'Patrick Mahomes',
          position: 'QB',
          nflTeam: 'KC',
          fantasyTeamId: '0001',
          projectedPoints: 24.3,
          isStarting: true,
          injuryStatus: 'Healthy',
        },
        {
          id: 'player-2',
          name: 'Josh Allen',
          position: 'QB',
          nflTeam: 'BUF',
          fantasyTeamId: '0002',
          projectedPoints: 23.8,
          isStarting: true,
          injuryStatus: 'Healthy',
        },
      ],
      playerCount: 2,
      gameTime: new Date('2024-12-15T18:00:00Z'), // Sunday 1 PM ET
      timeSlot: 'early',
      isCompleted: false,
      projectedPoints: 48.1,
      isGameOfWeek: true,
    },
    {
      id: 'game-2',
      team1: 'SF',
      team2: 'LAR',
      players: [
        {
          id: 'player-3',
          name: 'Christian McCaffrey',
          position: 'RB',
          nflTeam: 'SF',
          fantasyTeamId: '0003',
          projectedPoints: 18.7,
          isStarting: true,
          injuryStatus: 'Questionable',
        },
        {
          id: 'player-4',
          name: 'Cooper Kupp',
          position: 'WR',
          nflTeam: 'LAR',
          fantasyTeamId: '0004',
          projectedPoints: 16.2,
          isStarting: true,
          injuryStatus: 'Healthy',
        },
      ],
      playerCount: 2,
      gameTime: new Date('2024-12-15T21:00:00Z'), // Sunday 4 PM ET
      timeSlot: 'late',
      isCompleted: false,
      projectedPoints: 34.9,
    },
  ];

  return games;
}

/**
 * Generate mock matchups for a week
 */
export function generateMockMatchups(week: number = 15): Matchup[] {
  const teams = generateMockTeams();
  const nflGames = generateMockNFLGames();
  const matchups: Matchup[] = [];

  // Create 8 regular matchups (or 16 for doubleheader weeks)
  const matchupCount = week === 17 ? 16 : 8; // Week 17 is often a doubleheader
  
  for (let i = 0; i < matchupCount; i++) {
    const homeTeamIndex = i * 2;
    const awayTeamIndex = i * 2 + 1;
    
    if (homeTeamIndex >= teams.length || awayTeamIndex >= teams.length) break;
    
    const homeTeam = teams[homeTeamIndex];
    const awayTeam = teams[awayTeamIndex];
    
    // Assign some NFL games to each matchup (simplified)
    const matchupGames = nflGames.slice(0, Math.min(2, nflGames.length));
    
    const matchup: Matchup = {
      id: `matchup-${i + 1}`,
      week,
      homeTeam,
      awayTeam,
      nflGames: matchupGames,
      gameState: 'pre-game',
      projectedTotal: homeTeam.projectedPoints! + awayTeam.projectedPoints!,
      analysis: `This ${week === 15 ? 'playoff' : 'regular season'} matchup features ${awayTeam.name} visiting ${homeTeam.name}. Both teams are looking to make a statement with key players in action across ${matchupGames.length} NFL games.`,
      lastUpdated: new Date(),
    };
    
    matchups.push(matchup);
  }

  return matchups;
}

/**
 * Generate mock matchup data for testing
 */
export function generateMockMatchupData(week: number = 15): {
  matchups: Matchup[];
  teams: FantasyTeam[];
  nflGames: NFLGame[];
} {
  const teams = generateMockTeams();
  const nflGames = generateMockNFLGames();
  const matchups = generateMockMatchups(week);

  return {
    matchups,
    teams,
    nflGames,
  };
}

/**
 * Get a specific mock matchup by ID
 */
export function getMockMatchupById(matchupId: string, week: number = 15): Matchup | undefined {
  const { matchups } = generateMockMatchupData(week);
  return matchups.find(m => m.id === matchupId);
}

/**
 * Get mock matchup by team ID
 */
export function getMockMatchupByTeamId(teamId: string, week: number = 15): Matchup | undefined {
  const { matchups } = generateMockMatchupData(week);
  return matchups.find(m => m.homeTeam.id === teamId || m.awayTeam.id === teamId);
}