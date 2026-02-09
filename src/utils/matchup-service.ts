/**
 * Matchup Service
 * Integrates MFL schedule data with matchup preview functionality
 * Provides unified interface for getting matchups with playoff bracket information
 */

import type { Matchup, FantasyTeam, NFLGame } from '../types/matchup-previews';
import { createMFLApiClient, type MFLApiConfig } from './mfl-matchup-api';
import { 
  createMFLScheduleIntegration, 
  getMatchupsWithFallback,
  type MFLScheduleMatchup 
} from './mfl-schedule-integration';
import { generateMockNFLGames, generateMockTeams } from './mock-matchup-data';

/**
 * Matchup service configuration
 */
export interface MatchupServiceConfig extends Partial<MFLApiConfig> {
  useMockData?: boolean;
  enablePlayoffBrackets?: boolean;
}

/**
 * Matchup Service
 */
export class MatchupService {
  private mflClient: ReturnType<typeof createMFLApiClient>;
  private scheduleIntegration: ReturnType<typeof createMFLScheduleIntegration>;
  private config: MatchupServiceConfig;

  constructor(config: MatchupServiceConfig = {}) {
    this.config = config;
    this.mflClient = createMFLApiClient(config);
    this.scheduleIntegration = createMFLScheduleIntegration(config);
  }

  /**
   * Get all matchups for a specific week
   */
  async getWeeklyMatchups(week: number): Promise<Matchup[]> {
    try {
      // Get fantasy teams
      const teams = await this.getFantasyTeams();
      
      // Get schedule matchups from MFL API with fallback
      const scheduleMatchups = await getMatchupsWithFallback(week, teams, this.config);
      
      // Get NFL games data (mock for now, could be enhanced with real NFL data)
      const nflGames = this.generateNFLGamesForWeek(week);
      
      // Convert MFL schedule matchups to full Matchup objects
      const matchups: Matchup[] = [];
      
      for (const scheduleMatchup of scheduleMatchups) {
        const homeTeam = teams.find(t => t.id === scheduleMatchup.homeTeamId);
        const awayTeam = teams.find(t => t.id === scheduleMatchup.awayTeamId);
        
        if (!homeTeam || !awayTeam) {
          console.warn(`Could not find teams for matchup: ${scheduleMatchup.homeTeamId} vs ${scheduleMatchup.awayTeamId}`);
          continue;
        }

        // Generate matchup analysis with bracket information
        const analysis = this.generateMatchupAnalysis(homeTeam, awayTeam, scheduleMatchup, week);
        
        // Create matchup ID
        const matchupId = `${scheduleMatchup.homeTeamId}-vs-${scheduleMatchup.awayTeamId}-week-${week}`;
        
        const matchup: Matchup = {
          id: matchupId,
          week,
          homeTeam,
          awayTeam,
          nflGames: nflGames.slice(0, 2), // Assign some NFL games (simplified)
          gameState: 'pre-game',
          projectedTotal: (homeTeam.projectedPoints || 0) + (awayTeam.projectedPoints || 0),
          analysis,
          lastUpdated: new Date(),
          // Add bracket information if available
          ...(scheduleMatchup.bracketInfo && {
            bracketInfo: {
              bracketId: scheduleMatchup.bracketInfo.bracketId,
              bracketName: scheduleMatchup.bracketInfo.bracketName,
              gameType: scheduleMatchup.bracketInfo.gameType,
              bracketLabel: this.scheduleIntegration.generateBracketLabel(scheduleMatchup),
            }
          }),
        };
        
        matchups.push(matchup);
      }

      // Sort matchups chronologically
      matchups.sort((a, b) => {
        const aEarliestGame = this.getEarliestGameTime(a.nflGames);
        const bEarliestGame = this.getEarliestGameTime(b.nflGames);
        
        if (!aEarliestGame && !bEarliestGame) return 0;
        if (!aEarliestGame) return 1;
        if (!bEarliestGame) return -1;
        
        return aEarliestGame.getTime() - bEarliestGame.getTime();
      });

      return matchups;
    } catch (error) {
      console.error(`Failed to get weekly matchups for week ${week}:`, error);
      
      // Fallback to mock data if configured
      if (this.config.useMockData) {
        console.log('Falling back to mock matchup data');
        return this.getMockMatchups(week);
      }
      
      throw error;
    }
  }

  /**
   * Validate specific playoff matchup exists
   */
  async validatePlayoffMatchup(
    week: number, 
    homeTeamId: string, 
    awayTeamId: string
  ): Promise<{
    exists: boolean;
    matchup?: Matchup;
    bracketInfo?: any;
  }> {
    try {
      const matchups = await this.getWeeklyMatchups(week);
      
      const foundMatchup = matchups.find(m => 
        (m.homeTeam.id === homeTeamId && m.awayTeam.id === awayTeamId) ||
        (m.homeTeam.id === awayTeamId && m.awayTeam.id === homeTeamId)
      );

      return {
        exists: !!foundMatchup,
        matchup: foundMatchup,
        bracketInfo: foundMatchup?.bracketInfo,
      };
    } catch (error) {
      console.error('Failed to validate playoff matchup:', error);
      return { exists: false };
    }
  }

  /**
   * Get fantasy teams from MFL API or mock data
   */
  private async getFantasyTeams(): Promise<FantasyTeam[]> {
    if (this.config.useMockData) {
      return generateMockTeams();
    }

    try {
      const teamsData = await this.mflClient.getFantasyTeams();
      return Object.values(teamsData).map(team => ({
        ...team,
        projectedPoints: Math.random() * 50 + 120, // Mock projected points for now
      }));
    } catch (error) {
      console.warn('Failed to load fantasy teams from MFL API, using mock data:', error);
      return generateMockTeams();
    }
  }

  /**
   * Generate NFL games for a week (simplified)
   */
  private generateNFLGamesForWeek(week: number): NFLGame[] {
    // For now, use mock NFL games
    // This could be enhanced to use real NFL schedule data
    return generateMockNFLGames();
  }

  /**
   * Generate matchup analysis with bracket information
   */
  private generateMatchupAnalysis(
    homeTeam: FantasyTeam, 
    awayTeam: FantasyTeam, 
    scheduleMatchup: MFLScheduleMatchup,
    week: number
  ): string {
    const bracketInfo = scheduleMatchup.bracketInfo;
    
    if (bracketInfo && week >= 15) {
      // Playoff analysis
      const bracketLabel = this.scheduleIntegration.generateBracketLabel(scheduleMatchup);
      
      switch (bracketInfo.gameType) {
        case 'playoff':
          return `This ${bracketLabel} features ${awayTeam.name} visiting ${homeTeam.name} in a crucial playoff matchup. Both teams have fought hard to reach this stage and will be looking to advance further in the tournament.`;
        
        case 'consolation':
          return `In this ${bracketLabel}, ${awayTeam.name} takes on ${homeTeam.name} as both teams compete for playoff positioning and pride in the consolation bracket.`;
        
        case 'toilet-bowl':
          return `The ${bracketLabel} brings together ${awayTeam.name} and ${homeTeam.name} in a battle to avoid the bottom of the standings and secure better draft positioning for next season.`;
        
        default:
          return `This ${bracketLabel} matchup between ${awayTeam.name} and ${homeTeam.name} carries significant implications for the playoff bracket structure.`;
      }
    }

    // Regular season analysis
    return `This week ${week} matchup features ${awayTeam.name} visiting ${homeTeam.name}. Both teams are looking to make a statement with key players in action across multiple NFL games.`;
  }

  /**
   * Get earliest game time from NFL games
   */
  private getEarliestGameTime(nflGames: NFLGame[]): Date | null {
    if (nflGames.length === 0) return null;
    
    return nflGames.reduce((earliest, game) => 
      !earliest || game.gameTime < earliest ? game.gameTime : earliest, 
      null as Date | null
    );
  }

  /**
   * Get mock matchups as fallback
   */
  private getMockMatchups(week: number): Matchup[] {
    // Import and use existing mock data generation
    const { generateMockMatchups } = require('./mock-matchup-data');
    return generateMockMatchups(week);
  }
}

/**
 * Create matchup service instance
 */
export function createMatchupService(config: MatchupServiceConfig = {}): MatchupService {
  return new MatchupService(config);
}

/**
 * Get matchups for a specific week with MFL integration
 */
export async function getWeeklyMatchupsWithMFL(
  week: number, 
  config: MatchupServiceConfig = {}
): Promise<Matchup[]> {
  const service = createMatchupService(config);
  return service.getWeeklyMatchups(week);
}

/**
 * Validate that Pacific Pigskins vs Midwestside Connection appears in week 15
 */
export async function validatePacificPigskinsMatchup(
  config: MatchupServiceConfig = {}
): Promise<{
  exists: boolean;
  matchup?: Matchup;
  bracketInfo?: any;
}> {
  const service = createMatchupService(config);
  return service.validatePlayoffMatchup(15, '0001', '0011');
}