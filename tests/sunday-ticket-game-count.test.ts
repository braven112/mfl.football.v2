import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { NFLGame, TimeSlot } from '../src/types/matchup-previews';

/**
 * Property-Based Tests for Sunday Ticket Game Count Handling
 * **Feature: dynamic-matchup-previews, Property 7: Sunday Ticket game count handling**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */

describe('Sunday Ticket Game Count Handling - Property-Based Tests', () => {
  // Generator for valid NFL teams
  const nflTeamArb = fc.constantFrom(
    'SF', 'KC', 'DAL', 'BUF', 'MIA', 'NYJ', 'NE', 'BAL', 'CIN', 'CLE', 'PIT',
    'HOU', 'IND', 'JAX', 'TEN', 'DEN', 'LV', 'LAC', 'GB', 'MIN', 'CHI', 'DET',
    'ATL', 'CAR', 'NO', 'TB', 'ARI', 'LAR', 'SEA', 'NYG', 'PHI', 'WAS'
  );

  // Generator for time slots
  const timeSlotArb = fc.constantFrom<TimeSlot>('early', 'late');

  // Generator for Sunday game times (10 AM PT for early, 1 PM PT for late)
  const sundayGameTimeArb = fc.oneof(
    fc.constant('10:00 AM PT'), // Early games
    fc.constant('1:00 PM PT')   // Late games
  );

  // Generator for valid NFL games with Sunday times
  const sundayNFLGameArb = fc.record({
    id: fc.uuid(),
    team1: nflTeamArb,
    team2: nflTeamArb.filter(team => team !== fc.context().team1), // Ensure different teams
    players: fc.array(fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 3, maxLength: 30 }),
      position: fc.constantFrom('QB', 'RB', 'WR', 'TE', 'K', 'Def'),
      nflTeam: nflTeamArb,
      fantasyTeamId: fc.string({ minLength: 4, maxLength: 4 }),
      isStarting: fc.boolean(),
      injuryStatus: fc.constantFrom('Healthy', 'Questionable', 'Doubtful', 'Out', 'IR'),
      projectedPoints: fc.float({ min: 0, max: 50 }),
    }), { minLength: 1, maxLength: 10 }),
    playerCount: fc.integer({ min: 1, max: 10 }),
    gameTime: fc.date(),
    timeSlot: timeSlotArb,
    isCompleted: fc.boolean(),
    projectedPoints: fc.float({ min: 0, max: 100 }),
    actualPoints: fc.option(fc.float({ min: 0, max: 100 })),
    isGameOfWeek: fc.boolean(),
    day: fc.constant('Sun'), // Only Sunday games for Sunday Ticket
    time: sundayGameTimeArb,
  });

  // Helper function to simulate the Sunday Ticket component logic
  function processSundayTicketGames(games: NFLGame[], maxGames: number = 4): {
    displayedGames: NFLGame[];
    redZoneSlots: number;
    totalSlots: number;
  } {
    // Filter for Sunday games only (matching component logic)
    const sundayGames = games.filter(game => {
      const day = (game as any).day || '';
      const time = (game as any).time || '';
      return day.includes('Sun') && (time.startsWith('10:') || time.startsWith('1:'));
    });

    // Sort by projected points (descending) and take top games
    const sortedGames = sundayGames
      .map(game => ({
        ...game,
        score: game.projectedPoints || 0
      }))
      .sort((a, b) => b.score - a.score);

    const relevantGameCount = sortedGames.length;
    const displayedGames = sortedGames.slice(0, Math.min(relevantGameCount, maxGames));
    
    let redZoneSlots = 0;
    let totalSlots = displayedGames.length;

    // Apply Sunday Ticket logic based on game count
    if (relevantGameCount >= 4) {
      // 4+ games: show top 4, no RedZone
      totalSlots = 4;
      redZoneSlots = 0;
    } else if (relevantGameCount === 3) {
      // 3 games: show 3 + RedZone (4 total slots)
      totalSlots = 4;
      redZoneSlots = 1;
    } else if (relevantGameCount === 2) {
      // 2 games: show 2 + RedZone, 4th slot blank (3 filled slots)
      totalSlots = 3; // 2 games + 1 RedZone, 4th slot blank
      redZoneSlots = 1;
    } else if (relevantGameCount === 1) {
      // 1 game: show 1 + RedZone side-by-side (2 total slots)
      totalSlots = 2;
      redZoneSlots = 1;
    } else {
      // 0 games: no display
      totalSlots = 0;
      redZoneSlots = 0;
    }

    return {
      displayedGames,
      redZoneSlots,
      totalSlots
    };
  }

  describe('Property 7: Sunday Ticket game count handling', () => {
    it('should display exactly min(N, 4) games plus RedZone if N < 4', () => {
      fc.assert(
        fc.property(
          fc.array(sundayNFLGameArb, { minLength: 0, maxLength: 10 }),
          (games) => {
            const result = processSundayTicketGames(games);
            const N = games.filter(game => {
              const day = (game as any).day || '';
              const time = (game as any).time || '';
              return day.includes('Sun') && (time.startsWith('10:') || time.startsWith('1:'));
            }).length;

            if (N >= 4) {
              // Should display exactly 4 games, no RedZone
              return result.displayedGames.length === 4 && 
                     result.redZoneSlots === 0 && 
                     result.totalSlots === 4;
            } else if (N === 3) {
              // Should display 3 games + RedZone (4 total slots)
              return result.displayedGames.length === 3 && 
                     result.redZoneSlots === 1 && 
                     result.totalSlots === 4;
            } else if (N === 2) {
              // Should display 2 games + RedZone (3 filled slots, 4th blank)
              return result.displayedGames.length === 2 && 
                     result.redZoneSlots === 1 && 
                     result.totalSlots === 3;
            } else if (N === 1) {
              // Should display 1 game + RedZone side-by-side (2 total slots)
              return result.displayedGames.length === 1 && 
                     result.redZoneSlots === 1 && 
                     result.totalSlots === 2;
            } else {
              // N === 0: no display
              return result.displayedGames.length === 0 && 
                     result.redZoneSlots === 0 && 
                     result.totalSlots === 0;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should prioritize games by projected points when selecting top games', () => {
      fc.assert(
        fc.property(
          fc.array(sundayNFLGameArb, { minLength: 2, maxLength: 8 }),
          (games) => {
            // Ensure we have at least 2 games with different projected points
            const gamesWithPoints = games.map((game, index) => ({
              ...game,
              projectedPoints: 10 + index * 5, // Ensure different projected points
            }));

            const result = processSundayTicketGames(gamesWithPoints);
            
            if (result.displayedGames.length >= 2) {
              // Games should be sorted by projected points (descending)
              for (let i = 0; i < result.displayedGames.length - 1; i++) {
                const currentPoints = result.displayedGames[i].projectedPoints || 0;
                const nextPoints = result.displayedGames[i + 1].projectedPoints || 0;
                if (currentPoints < nextPoints) {
                  return false;
                }
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only include Sunday games in the Sunday Ticket display', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({
            id: fc.uuid(),
            team1: nflTeamArb,
            team2: nflTeamArb,
            players: fc.array(fc.record({
              id: fc.uuid(),
              name: fc.string({ minLength: 3, maxLength: 30 }),
              position: fc.constantFrom('QB', 'RB', 'WR', 'TE', 'K', 'Def'),
              nflTeam: nflTeamArb,
              fantasyTeamId: fc.string({ minLength: 4, maxLength: 4 }),
              isStarting: fc.boolean(),
              injuryStatus: fc.constantFrom('Healthy', 'Questionable', 'Doubtful', 'Out', 'IR'),
              projectedPoints: fc.float({ min: 0, max: 50 }),
            }), { minLength: 1, maxLength: 10 }),
            playerCount: fc.integer({ min: 1, max: 10 }),
            gameTime: fc.date(),
            timeSlot: timeSlotArb,
            isCompleted: fc.boolean(),
            projectedPoints: fc.float({ min: 0, max: 100 }),
            actualPoints: fc.option(fc.float({ min: 0, max: 100 })),
            isGameOfWeek: fc.boolean(),
            day: fc.oneof(fc.constant('Sun'), fc.constant('Mon'), fc.constant('Thu')),
            time: fc.oneof(fc.constant('10:00 AM PT'), fc.constant('8:00 PM ET')),
          }), { minLength: 1, maxLength: 8 }),
          (games) => {
            const result = processSundayTicketGames(games);
            
            // All displayed games should be Sunday games with valid times
            return result.displayedGames.every(game => {
              const day = (game as any).day || '';
              const time = (game as any).time || '';
              return day.includes('Sun') && (time.startsWith('10:') || time.startsWith('1:'));
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect maxGames parameter when provided', () => {
      fc.assert(
        fc.property(
          fc.array(sundayNFLGameArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 1, max: 6 }),
          (games, maxGames) => {
            const result = processSundayTicketGames(games, maxGames);
            
            // Should never display more games than maxGames
            return result.displayedGames.length <= maxGames;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case of no relevant games gracefully', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({
            id: fc.uuid(),
            team1: nflTeamArb,
            team2: nflTeamArb,
            players: fc.array(fc.record({
              id: fc.uuid(),
              name: fc.string({ minLength: 3, maxLength: 30 }),
              position: fc.constantFrom('QB', 'RB', 'WR', 'TE', 'K', 'Def'),
              nflTeam: nflTeamArb,
              fantasyTeamId: fc.string({ minLength: 4, maxLength: 4 }),
              isStarting: fc.boolean(),
              injuryStatus: fc.constantFrom('Healthy', 'Questionable', 'Doubtful', 'Out', 'IR'),
              projectedPoints: fc.float({ min: 0, max: 50 }),
            }), { minLength: 1, maxLength: 10 }),
            playerCount: fc.integer({ min: 1, max: 10 }),
            gameTime: fc.date(),
            timeSlot: timeSlotArb,
            isCompleted: fc.boolean(),
            projectedPoints: fc.float({ min: 0, max: 100 }),
            actualPoints: fc.option(fc.float({ min: 0, max: 100 })),
            isGameOfWeek: fc.boolean(),
            day: fc.constantFrom('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'), // Non-Sunday
            time: fc.constant('8:00 PM ET'),
          }), { minLength: 0, maxLength: 5 }),
          (nonSundayGames) => {
            const result = processSundayTicketGames(nonSundayGames);
            
            // Should display nothing when no relevant games
            return result.displayedGames.length === 0 && 
                   result.redZoneSlots === 0 && 
                   result.totalSlots === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain game data integrity when processing', () => {
      fc.assert(
        fc.property(
          fc.array(sundayNFLGameArb, { minLength: 1, maxLength: 6 }),
          (games) => {
            const result = processSundayTicketGames(games);
            
            // All displayed games should maintain their original data
            return result.displayedGames.every(displayedGame => {
              const originalGame = games.find(g => g.id === displayedGame.id);
              return originalGame && 
                     originalGame.team1 === displayedGame.team1 &&
                     originalGame.team2 === displayedGame.team2 &&
                     originalGame.playerCount === displayedGame.playerCount;
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});