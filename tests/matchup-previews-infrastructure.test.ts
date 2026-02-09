import { describe, it, expect, beforeEach } from 'vitest';
import { GameStateManager, GameStateUtils } from '../src/utils/game-state-manager';
import { MFLMatchupApiClient } from '../src/utils/mfl-matchup-api';
import type { 
  Matchup, 
  NFLGame, 
  FantasyPlayer, 
  GameState,
  StartingLineup,
  LineupOptimization 
} from '../src/types/matchup-previews';

describe('Matchup Previews Infrastructure', () => {
  describe('Data Models', () => {
    it('should create valid FantasyPlayer objects', () => {
      const player: FantasyPlayer = {
        id: '12345',
        name: 'Test Player',
        position: 'QB',
        nflTeam: 'SF',
        fantasyTeamId: '0001',
        isStarting: true,
        injuryStatus: 'Healthy',
        projectedPoints: 25.5,
      };

      expect(player.id).toBe('12345');
      expect(player.name).toBe('Test Player');
      expect(player.position).toBe('QB');
      expect(player.isStarting).toBe(true);
      expect(player.injuryStatus).toBe('Healthy');
    });

    it('should create valid NFLGame objects', () => {
      const game: NFLGame = {
        id: 'game-1',
        team1: 'SF',
        team2: 'DAL',
        players: [],
        playerCount: 0,
        gameTime: new Date('2025-01-01T21:00:00Z'),
        timeSlot: 'late',
        isCompleted: false,
        projectedPoints: 45.5,
      };

      expect(game.id).toBe('game-1');
      expect(game.team1).toBe('SF');
      expect(game.team2).toBe('DAL');
      expect(game.timeSlot).toBe('late');
      expect(game.isCompleted).toBe(false);
    });

    it('should create valid Matchup objects', () => {
      const matchup: Matchup = {
        id: 'matchup-1',
        week: 15,
        homeTeam: {
          id: '0001',
          name: 'Team A',
          ownerName: 'Owner A',
        },
        awayTeam: {
          id: '0002',
          name: 'Team B',
          ownerName: 'Owner B',
        },
        nflGames: [],
        gameState: 'pre-game',
        analysis: 'Test analysis',
        lastUpdated: new Date(),
      };

      expect(matchup.id).toBe('matchup-1');
      expect(matchup.week).toBe(15);
      expect(matchup.gameState).toBe('pre-game');
      expect(matchup.homeTeam.name).toBe('Team A');
      expect(matchup.awayTeam.name).toBe('Team B');
    });
  });

  describe('GameStateManager', () => {
    let gameStateManager: GameStateManager;

    beforeEach(() => {
      gameStateManager = new GameStateManager();
    });

    it('should determine pre-game state correctly', () => {
      const futureTime = new Date(Date.now() + 3600000); // 1 hour from now
      const currentTime = new Date();
      
      const state = gameStateManager.determineGameState(futureTime, currentTime);
      expect(state).toBe('pre-game');
    });

    it('should determine completed state correctly', () => {
      const pastTime = new Date(Date.now() - 4 * 3600000); // 4 hours ago
      const currentTime = new Date();
      
      const state = gameStateManager.determineGameState(pastTime, currentTime);
      expect(state).toBe('completed');
    });

    it('should determine in-progress state correctly', () => {
      const recentTime = new Date(Date.now() - 1800000); // 30 minutes ago
      const currentTime = new Date();
      
      const state = gameStateManager.determineGameState(recentTime, currentTime);
      expect(state).toBe('in-progress');
    });

    it('should update and retrieve game state', () => {
      const gameTime = new Date(Date.now() + 3600000);
      const gameId = 'test-game';
      
      const stateInfo = gameStateManager.updateGameState(gameId, gameTime);
      
      expect(stateInfo.isPreGame).toBe(true);
      expect(stateInfo.isInProgress).toBe(false);
      expect(stateInfo.isCompleted).toBe(false);
      
      const retrieved = gameStateManager.getGameState(gameId);
      expect(retrieved).toEqual(stateInfo);
    });

    it('should sort matchups by state priority', () => {
      const completedGame: NFLGame = {
        id: 'completed',
        team1: 'SF',
        team2: 'DAL',
        players: [],
        playerCount: 0,
        gameTime: new Date(Date.now() - 4 * 3600000), // 4 hours ago
        timeSlot: 'early',
        isCompleted: true,
      };

      const upcomingGame: NFLGame = {
        id: 'upcoming',
        team1: 'KC',
        team2: 'BUF',
        players: [],
        playerCount: 0,
        gameTime: new Date(Date.now() + 3600000), // 1 hour from now
        timeSlot: 'late',
        isCompleted: false,
      };

      const matchups: Matchup[] = [
        {
          id: 'completed-matchup',
          week: 15,
          homeTeam: { id: '0001', name: 'Team A', ownerName: 'Owner A' },
          awayTeam: { id: '0002', name: 'Team B', ownerName: 'Owner B' },
          nflGames: [completedGame],
          gameState: 'completed',
          analysis: '',
          lastUpdated: new Date(),
        },
        {
          id: 'upcoming-matchup',
          week: 15,
          homeTeam: { id: '0003', name: 'Team C', ownerName: 'Owner C' },
          awayTeam: { id: '0004', name: 'Team D', ownerName: 'Owner D' },
          nflGames: [upcomingGame],
          gameState: 'pre-game',
          analysis: '',
          lastUpdated: new Date(),
        },
      ];

      const sorted = gameStateManager.sortMatchupsByState(matchups);
      
      // Pre-game should come first, completed last
      expect(sorted[0].gameState).toBe('pre-game');
      expect(sorted[1].gameState).toBe('completed');
    });
  });

  describe('GameStateUtils', () => {
    it('should correctly identify live games', () => {
      const liveGameTime = new Date(Date.now() - 1800000); // 30 minutes ago
      const currentTime = new Date();
      
      expect(GameStateUtils.isGameLive(liveGameTime, currentTime)).toBe(true);
    });

    it('should correctly identify completed games', () => {
      const completedGameTime = new Date(Date.now() - 4 * 3600000); // 4 hours ago
      const currentTime = new Date();
      
      expect(GameStateUtils.isGameCompleted(completedGameTime, currentTime)).toBe(true);
    });

    it('should calculate time until game correctly', () => {
      const futureGameTime = new Date(Date.now() + 3600000); // 1 hour from now
      const currentTime = new Date();
      
      const timeUntil = GameStateUtils.getTimeUntilGame(futureGameTime, currentTime);
      expect(timeUntil).toBeGreaterThan(3500000); // Should be close to 1 hour
      expect(timeUntil).toBeLessThan(3700000);
    });

    it('should format game states correctly', () => {
      expect(GameStateUtils.formatGameState('pre-game')).toBe('Upcoming');
      expect(GameStateUtils.formatGameState('in-progress')).toBe('Live');
      expect(GameStateUtils.formatGameState('completed')).toBe('Final');
    });

    it('should provide correct CSS classes for game states', () => {
      expect(GameStateUtils.getGameStateClass('pre-game')).toBe('game-state-upcoming');
      expect(GameStateUtils.getGameStateClass('in-progress')).toBe('game-state-live');
      expect(GameStateUtils.getGameStateClass('completed')).toBe('game-state-completed');
    });
  });

  describe('MFLMatchupApiClient', () => {
    it('should create client with default config', () => {
      const client = new MFLMatchupApiClient({
        leagueId: '13522',
        year: '2025',
      });

      expect(client).toBeInstanceOf(MFLMatchupApiClient);
    });

    it('should normalize injury status correctly', () => {
      const client = new MFLMatchupApiClient({
        leagueId: '13522',
        year: '2025',
      });

      // Access private method through type assertion for testing
      const normalizeMethod = (client as any).normalizeInjuryStatus.bind(client);
      
      expect(normalizeMethod('out')).toBe('Out');
      expect(normalizeMethod('O')).toBe('Out');
      expect(normalizeMethod('doubtful')).toBe('Doubtful');
      expect(normalizeMethod('D')).toBe('Doubtful');
      expect(normalizeMethod('questionable')).toBe('Questionable');
      expect(normalizeMethod('Q')).toBe('Questionable');
      expect(normalizeMethod('ir')).toBe('IR');
      expect(normalizeMethod('')).toBe('Healthy');
      expect(normalizeMethod(undefined)).toBe('Healthy');
    });

    it('should identify IR eligible players correctly', () => {
      const client = new MFLMatchupApiClient({
        leagueId: '13522',
        year: '2025',
      });

      const outPlayerBench: FantasyPlayer = {
        id: '1',
        name: 'Injured Player',
        position: 'RB',
        nflTeam: 'SF',
        fantasyTeamId: '0001',
        isStarting: false,
        injuryStatus: 'Out',
      };

      const outPlayerStarting: FantasyPlayer = {
        id: '2',
        name: 'Starting Injured Player',
        position: 'QB',
        nflTeam: 'KC',
        fantasyTeamId: '0001',
        isStarting: true,
        injuryStatus: 'Out',
      };

      const healthyPlayer: FantasyPlayer = {
        id: '3',
        name: 'Healthy Player',
        position: 'WR',
        nflTeam: 'DAL',
        fantasyTeamId: '0001',
        isStarting: false,
        injuryStatus: 'Healthy',
      };

      expect(client.isPlayerIReligible(outPlayerBench)).toBe(true);
      expect(client.isPlayerIReligible(outPlayerStarting)).toBe(false); // Starting players not IR eligible
      expect(client.isPlayerIReligible(healthyPlayer)).toBe(false);
    });
  });
});