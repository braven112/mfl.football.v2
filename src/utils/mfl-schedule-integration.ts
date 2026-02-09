/**
 * MFL Schedule Integration for Playoff Brackets
 * Replaces algorithmic matchup generation with real MFL API schedule data
 */

import type { Matchup, FantasyTeam } from '../types/matchup-previews';
import { createMFLApiClient, type MFLApiConfig } from './mfl-matchup-api';

/**
 * MFL Schedule matchup data
 */
export interface MFLScheduleMatchup {
  homeTeamId: string;
  awayTeamId: string;
  week: number;
  bracketInfo?: {
    bracketId: string;
    bracketName: string;
    gameType: 'playoff' | 'regular' | 'consolation' | 'toilet-bowl';
  };
}

/**
 * Playoff bracket information from MFL API
 */
interface PlayoffBracketData {
  playoffBrackets: {
    playoffBracket: Array<{
      id: string;
      name: string;
      startWeek: string;
      bracketWinnerTitle: string;
    }>;
  };
  brackets: Record<string, {
    playoffBracket: {
      bracket_id: string;
      playoffRound: Array<{
        week: string;
        playoffGame: Array<{
          game_id: string;
          home: {
            franchise_id?: string;
            seed?: string;
            winner_of_game?: string;
            loser_of_game?: string;
            bracket?: string;
          };
          away: {
            franchise_id?: string;
            seed?: string;
            winner_of_game?: string;
            loser_of_game?: string;
            bracket?: string;
          };
        }>;
      }>;
    };
  }>;
}

/**
 * MFL Schedule Integration Client
 */
export class MFLScheduleIntegration {
  private mflClient: ReturnType<typeof createMFLApiClient>;
  private playoffBracketData: PlayoffBracketData | null = null;

  constructor(config?: Partial<MFLApiConfig>) {
    this.mflClient = createMFLApiClient(config);
  }

  /**
   * Load playoff bracket data from MFL API or local cache
   */
  private async loadPlayoffBracketData(): Promise<PlayoffBracketData | null> {
    if (this.playoffBracketData) {
      return this.playoffBracketData;
    }

    try {
      // Try to load from local MFL feeds first (Node.js environment)
      if (typeof window === 'undefined') {
        // Node.js environment - use fs to read file
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'data/theleague/mfl-feeds/2025/playoff-brackets.json');
        
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          this.playoffBracketData = JSON.parse(fileContent);
          return this.playoffBracketData;
        }
      } else {
        // Browser environment - use fetch
        const response = await fetch('/data/theleague/mfl-feeds/2025/playoff-brackets.json');
        if (response.ok) {
          this.playoffBracketData = await response.json();
          return this.playoffBracketData;
        }
      }
    } catch (error) {
      console.warn('Failed to load playoff bracket data from local cache:', error);
    }

    // Fallback: could fetch from MFL API directly if needed
    // For now, return null to trigger fallback to algorithmic generation
    return null;
  }

  /**
   * Get bracket information for a specific matchup
   */
  private getBracketInfo(homeTeamId: string, awayTeamId: string, week: number): MFLScheduleMatchup['bracketInfo'] | undefined {
    if (!this.playoffBracketData || week < 15) {
      return undefined; // Regular season games don't have bracket info
    }

    // Search through all brackets for this matchup
    for (const [bracketId, bracketData] of Object.entries(this.playoffBracketData.brackets)) {
      const bracket = bracketData.playoffBracket;
      
      // Handle both array and single object cases for playoffRound
      const rounds = Array.isArray(bracket.playoffRound) ? bracket.playoffRound : [bracket.playoffRound];
      
      for (const round of rounds) {
        if (round.week !== week.toString()) continue;
        
        const games = Array.isArray(round.playoffGame) ? round.playoffGame : [round.playoffGame];
        
        for (const game of games) {
          const homeMatch = game.home.franchise_id === homeTeamId;
          const awayMatch = game.away.franchise_id === awayTeamId;
          
          if (homeMatch && awayMatch) {
            // Find bracket name
            const bracketInfo = this.playoffBracketData!.playoffBrackets.playoffBracket.find(
              b => b.id === bracketId
            );
            
            if (bracketInfo) {
              let gameType: 'playoff' | 'regular' | 'consolation' | 'toilet-bowl' = 'playoff';
              
              // Determine game type based on bracket name
              const bracketName = bracketInfo.name.toLowerCase();
              if (bracketName.includes('toilet bowl')) {
                gameType = 'toilet-bowl';
              } else if (bracketName.includes('consolation')) {
                gameType = 'consolation';
              } else if (bracketName.includes('championship') || bracketName.includes('loser')) {
                gameType = 'playoff';
              }
              
              return {
                bracketId,
                bracketName: bracketInfo.name,
                gameType,
              };
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Get matchups for a specific week from MFL schedule
   */
  async getWeeklyMatchups(week: number): Promise<MFLScheduleMatchup[]> {
    try {
      // Load playoff bracket data for bracket detection
      await this.loadPlayoffBracketData();

      // For playoff weeks (15+), extract matchups from playoff bracket data
      if (week >= 15 && this.playoffBracketData) {
        return this.extractPlayoffMatchups(week);
      }

      // For regular season, try to get from MFL schedule API
      try {
        const scheduleResponse = await this.mflClient.getFantasySchedule(week);
        
        if (scheduleResponse.schedule?.weeklySchedule) {
          const weeklySchedule = Array.isArray(scheduleResponse.schedule.weeklySchedule) 
            ? scheduleResponse.schedule.weeklySchedule 
            : [scheduleResponse.schedule.weeklySchedule];

          const weekData = weeklySchedule.find(
            w => w.week === week.toString()
          );

          if (weekData?.matchup) {
            const matchups: MFLScheduleMatchup[] = [];
            const matchupArray = Array.isArray(weekData.matchup) ? weekData.matchup : [weekData.matchup];

            for (const matchup of matchupArray) {
              if (matchup.franchise && matchup.franchise.length === 2) {
                const homeTeam = matchup.franchise.find(f => f.isHome === '1');
                const awayTeam = matchup.franchise.find(f => f.isHome !== '1');

                if (homeTeam && awayTeam) {
                  const bracketInfo = this.getBracketInfo(homeTeam.id, awayTeam.id, week);
                  
                  matchups.push({
                    homeTeamId: homeTeam.id,
                    awayTeamId: awayTeam.id,
                    week,
                    bracketInfo,
                  });
                }
              }
            }

            if (matchups.length > 0) {
              return matchups;
            }
          }
        }
      } catch (scheduleError) {
        console.warn(`MFL schedule API failed for week ${week}:`, scheduleError);
      }

      // If MFL schedule API fails, throw error to trigger fallback
      throw new Error('No schedule data available');
    } catch (error) {
      console.error(`Failed to get weekly matchups for week ${week}:`, error);
      throw error;
    }
  }

  /**
   * Extract playoff matchups from bracket data
   */
  private extractPlayoffMatchups(week: number): MFLScheduleMatchup[] {
    if (!this.playoffBracketData) {
      return [];
    }

    const matchups: MFLScheduleMatchup[] = [];

    // Search through all brackets for games in this week
    for (const [bracketId, bracketData] of Object.entries(this.playoffBracketData.brackets)) {
      const bracket = bracketData.playoffBracket;
      
      // Handle both array and single object cases for playoffRound
      const rounds = Array.isArray(bracket.playoffRound) ? bracket.playoffRound : [bracket.playoffRound];
      
      for (const round of rounds) {
        if (round.week !== week.toString()) continue;
        
        // Handle both array and single object cases for playoffGame
        const games = Array.isArray(round.playoffGame) ? round.playoffGame : [round.playoffGame];
        
        for (const game of games) {
          // Only include games with actual franchise IDs (not winner_of_game references)
          if (game.home.franchise_id && game.away.franchise_id) {
            const bracketInfo = this.getBracketInfo(game.home.franchise_id, game.away.franchise_id, week);
            
            matchups.push({
              homeTeamId: game.home.franchise_id,
              awayTeamId: game.away.franchise_id,
              week,
              bracketInfo,
            });
          }
        }
      }
    }

    return matchups;
  }

  /**
   * Validate that expected playoff matchups exist
   */
  async validatePlayoffMatchups(week: number, expectedMatchups: Array<{ homeTeamId: string; awayTeamId: string }>): Promise<{
    isValid: boolean;
    foundMatchups: MFLScheduleMatchup[];
    missingMatchups: Array<{ homeTeamId: string; awayTeamId: string }>;
  }> {
    try {
      const actualMatchups = await this.getWeeklyMatchups(week);
      const foundMatchups: MFLScheduleMatchup[] = [];
      const missingMatchups: Array<{ homeTeamId: string; awayTeamId: string }> = [];

      for (const expected of expectedMatchups) {
        const found = actualMatchups.find(
          m => (m.homeTeamId === expected.homeTeamId && m.awayTeamId === expected.awayTeamId) ||
               (m.homeTeamId === expected.awayTeamId && m.awayTeamId === expected.homeTeamId)
        );

        if (found) {
          foundMatchups.push(found);
        } else {
          missingMatchups.push(expected);
        }
      }

      return {
        isValid: missingMatchups.length === 0,
        foundMatchups,
        missingMatchups,
      };
    } catch (error) {
      console.error('Failed to validate playoff matchups:', error);
      return {
        isValid: false,
        foundMatchups: [],
        missingMatchups: expectedMatchups,
      };
    }
  }

  /**
   * Generate bracket label for a matchup
   */
  generateBracketLabel(matchup: MFLScheduleMatchup): string {
    if (!matchup.bracketInfo) {
      return `Week ${matchup.week} Matchup`;
    }

    const { bracketId, bracketName, gameType } = matchup.bracketInfo;

    // For playoff games, use "Bracket X Playoff Game" format as specified in requirements
    if (gameType === 'playoff') {
      return `Bracket ${bracketId} Playoff Game`;
    }

    // For other game types, use the bracket name
    switch (gameType) {
      case 'consolation':
        return `${bracketName} Game`;
      
      case 'toilet-bowl':
        return `${bracketName} Game`;
      
      default:
        return `${bracketName} Game`;
    }
  }
}

/**
 * Create MFL schedule integration client
 */
export function createMFLScheduleIntegration(config?: Partial<MFLApiConfig>): MFLScheduleIntegration {
  return new MFLScheduleIntegration(config);
}

/**
 * Fallback matchup generation (existing algorithmic approach)
 */
export function generateFallbackMatchups(teams: FantasyTeam[], week: number): MFLScheduleMatchup[] {
  const matchups: MFLScheduleMatchup[] = [];
  
  // Simple pairing algorithm - pair teams sequentially
  for (let i = 0; i < teams.length; i += 2) {
    if (i + 1 < teams.length) {
      matchups.push({
        homeTeamId: teams[i].id,
        awayTeamId: teams[i + 1].id,
        week,
        // No bracket info for fallback generation
      });
    }
  }

  return matchups;
}

/**
 * Get matchups with fallback to algorithmic generation
 */
export async function getMatchupsWithFallback(
  week: number,
  teams: FantasyTeam[],
  config?: Partial<MFLApiConfig>
): Promise<MFLScheduleMatchup[]> {
  try {
    const scheduleIntegration = createMFLScheduleIntegration(config);
    const matchups = await scheduleIntegration.getWeeklyMatchups(week);
    
    if (matchups.length > 0) {
      console.log(`Successfully loaded ${matchups.length} matchups from MFL API for week ${week}`);
      return matchups;
    }
  } catch (error) {
    console.warn(`Failed to load matchups from MFL API for week ${week}, falling back to algorithmic generation:`, error);
  }

  // Fallback to algorithmic generation
  console.log(`Using fallback matchup generation for week ${week}`);
  return generateFallbackMatchups(teams, week);
}