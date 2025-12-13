/**
 * Game State Management Utilities
 * Handles dynamic content based on game completion status
 */

import type { GameState, Matchup, NFLGame, ScoreUpdate } from '../types/matchup-previews';

/**
 * Game state information
 */
export interface GameStateInfo {
  isPreGame: boolean;
  isInProgress: boolean;
  isCompleted: boolean;
  lastUpdated: Date;
}

/**
 * Game state manager class
 */
export class GameStateManager {
  private gameStates: Map<string, GameStateInfo> = new Map();
  private analysisGenerated: Map<string, { preGame: boolean; postGame: boolean }> = new Map();

  /**
   * Determine game state based on current time and game time
   */
  determineGameState(gameTime: Date, currentTime: Date = new Date()): GameState {
    const gameStart = gameTime.getTime();
    const now = currentTime.getTime();
    const gameEnd = gameStart + (3.5 * 60 * 60 * 1000); // Assume 3.5 hours for NFL game

    if (now < gameStart) {
      return 'pre-game';
    } else if (now >= gameStart && now < gameEnd) {
      return 'in-progress';
    } else {
      return 'completed';
    }
  }

  /**
   * Update game state for a specific game
   */
  updateGameState(gameId: string, gameTime: Date, currentTime: Date = new Date()): GameStateInfo {
    const state = this.determineGameState(gameTime, currentTime);
    
    const stateInfo: GameStateInfo = {
      isPreGame: state === 'pre-game',
      isInProgress: state === 'in-progress',
      isCompleted: state === 'completed',
      lastUpdated: currentTime,
    };

    this.gameStates.set(gameId, stateInfo);
    return stateInfo;
  }

  /**
   * Get game state for a specific game
   */
  getGameState(gameId: string): GameStateInfo | null {
    return this.gameStates.get(gameId) || null;
  }

  /**
   * Determine overall matchup state based on constituent games
   */
  getMatchupState(matchup: Matchup): GameState {
    const gameStates = matchup.nflGames.map(game => 
      this.determineGameState(game.gameTime)
    );

    // If any game is in progress, matchup is in progress
    if (gameStates.includes('in-progress')) {
      return 'in-progress';
    }

    // If all games are completed, matchup is completed
    if (gameStates.every(state => state === 'completed')) {
      return 'completed';
    }

    // Otherwise, matchup is pre-game
    return 'pre-game';
  }

  /**
   * Check if analysis should be generated for a game state
   */
  shouldGenerateAnalysis(gameId: string, state: GameState): boolean {
    const generated = this.analysisGenerated.get(gameId) || { preGame: false, postGame: false };

    switch (state) {
      case 'pre-game':
        return !generated.preGame;
      case 'completed':
        return !generated.postGame;
      case 'in-progress':
        return false; // Don't generate analysis during games
      default:
        return false;
    }
  }

  /**
   * Mark analysis as generated for a specific state
   */
  markAnalysisGenerated(gameId: string, state: GameState): void {
    const generated = this.analysisGenerated.get(gameId) || { preGame: false, postGame: false };

    switch (state) {
      case 'pre-game':
        generated.preGame = true;
        break;
      case 'completed':
        generated.postGame = true;
        break;
    }

    this.analysisGenerated.set(gameId, generated);
  }

  /**
   * Sort matchups by game state priority (upcoming first, completed last)
   */
  sortMatchupsByState(matchups: Matchup[]): Matchup[] {
    return matchups.slice().sort((a, b) => {
      const stateA = this.getMatchupState(a);
      const stateB = this.getMatchupState(b);

      // Priority order: pre-game, in-progress, completed
      const statePriority = {
        'pre-game': 0,
        'in-progress': 1,
        'completed': 2,
      };

      const priorityDiff = statePriority[stateA] - statePriority[stateB];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Within same state, sort by earliest game time
      const earliestGameA = Math.min(...a.nflGames.map(g => g.gameTime.getTime()));
      const earliestGameB = Math.min(...b.nflGames.map(g => g.gameTime.getTime()));

      return earliestGameA - earliestGameB;
    });
  }

  /**
   * Sort NFL games within a matchup by completion status
   */
  sortGamesByState(games: NFLGame[]): NFLGame[] {
    return games.slice().sort((a, b) => {
      const stateA = this.determineGameState(a.gameTime);
      const stateB = this.determineGameState(b.gameTime);

      // Priority order: pre-game, in-progress, completed
      const statePriority = {
        'pre-game': 0,
        'in-progress': 1,
        'completed': 2,
      };

      const priorityDiff = statePriority[stateA] - statePriority[stateB];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Within same state, sort chronologically
      return a.gameTime.getTime() - b.gameTime.getTime();
    });
  }

  /**
   * Check if content should switch from projections to results
   */
  shouldShowResults(gameState: GameState): boolean {
    return gameState === 'completed';
  }

  /**
   * Check if content should show live updates
   */
  shouldShowLiveUpdates(gameState: GameState): boolean {
    return gameState === 'in-progress';
  }

  /**
   * Get appropriate content mode based on game state
   */
  getContentMode(gameState: GameState): 'projection' | 'live' | 'results' {
    switch (gameState) {
      case 'pre-game':
        return 'projection';
      case 'in-progress':
        return 'live';
      case 'completed':
        return 'results';
      default:
        return 'projection';
    }
  }

  /**
   * Create score update object
   */
  createScoreUpdate(matchup: Matchup, homeScore: number, awayScore: number): ScoreUpdate {
    const gameStates: Record<string, GameState> = {};
    
    matchup.nflGames.forEach(game => {
      gameStates[game.id] = this.determineGameState(game.gameTime);
    });

    const matchupState = this.getMatchupState(matchup);
    const generated = this.analysisGenerated.get(matchup.id) || { preGame: false, postGame: false };

    return {
      matchupId: matchup.id,
      homeScore,
      awayScore,
      lastUpdated: new Date(),
      gameStates,
      analysisGenerated: generated,
    };
  }

  /**
   * Check if it's currently Sunday (game day)
   */
  isSunday(date: Date = new Date()): boolean {
    return date.getDay() === 0; // Sunday is 0
  }

  /**
   * Check if real-time updates should be active
   */
  shouldUpdateRealTime(date: Date = new Date()): boolean {
    // Update on Sundays and Mondays (for Monday Night Football)
    const day = date.getDay();
    return day === 0 || day === 1;
  }

  /**
   * Get next update interval based on current time and game states
   */
  getUpdateInterval(matchups: Matchup[]): number {
    const hasActiveGames = matchups.some(matchup => 
      this.getMatchupState(matchup) === 'in-progress'
    );

    if (hasActiveGames && this.shouldUpdateRealTime()) {
      return 30000; // 30 seconds during active games
    } else if (this.shouldUpdateRealTime()) {
      return 300000; // 5 minutes on game days
    } else {
      return 3600000; // 1 hour on non-game days
    }
  }

  /**
   * Clear all cached state (useful for testing or reset)
   */
  clearState(): void {
    this.gameStates.clear();
    this.analysisGenerated.clear();
  }
}

/**
 * Global game state manager instance
 */
export const gameStateManager = new GameStateManager();

/**
 * Utility functions for common game state operations
 */
export const GameStateUtils = {
  /**
   * Check if a game is currently live
   */
  isGameLive(gameTime: Date, currentTime: Date = new Date()): boolean {
    const state = gameStateManager.determineGameState(gameTime, currentTime);
    return state === 'in-progress';
  },

  /**
   * Check if a game is completed
   */
  isGameCompleted(gameTime: Date, currentTime: Date = new Date()): boolean {
    const state = gameStateManager.determineGameState(gameTime, currentTime);
    return state === 'completed';
  },

  /**
   * Get time until game starts (in milliseconds)
   */
  getTimeUntilGame(gameTime: Date, currentTime: Date = new Date()): number {
    return Math.max(0, gameTime.getTime() - currentTime.getTime());
  },

  /**
   * Format game state for display
   */
  formatGameState(state: GameState): string {
    switch (state) {
      case 'pre-game':
        return 'Upcoming';
      case 'in-progress':
        return 'Live';
      case 'completed':
        return 'Final';
      default:
        return 'Unknown';
    }
  },

  /**
   * Get CSS class for game state styling
   */
  getGameStateClass(state: GameState): string {
    switch (state) {
      case 'pre-game':
        return 'game-state-upcoming';
      case 'in-progress':
        return 'game-state-live';
      case 'completed':
        return 'game-state-completed';
      default:
        return 'game-state-unknown';
    }
  },
};