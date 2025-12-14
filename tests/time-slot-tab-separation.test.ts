import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { NFLGame, TimeSlot } from '../src/types/matchup-previews';

/**
 * Property-Based Tests for Time Slot Tab Separation
 * **Feature: dynamic-matchup-previews, Property 8: Time slot tab separation**
 * **Validates: Requirements 3.5**
 */

describe('Time Slot Tab Separation - Property-Based Tests', () => {
  // Generator for valid NFL teams
  const nflTeamArb = fc.constantFrom(
    'SF', 'KC', 'DAL', 'BUF', 'MIA', 'NYJ', 'NE', 'BAL', 'CIN', 'CLE', 'PIT',
    'HOU', 'IND', 'JAX', 'TEN', 'DEN', 'LV', 'LAC', 'GB', 'MIN', 'CHI', 'DET',
    'ATL', 'CAR', 'NO', 'TB', 'ARI', 'LAR', 'SEA', 'NYG', 'PHI', 'WAS'
  );

  // Generator for time slots
  const timeSlotArb = fc.constantFrom<TimeSlot>('early', 'late');

  // Generator for early game times (10 AM PT)
  const earlyGameTimeArb = fc.constantFrom('10:00 AM PT', '10:30 AM PT');

  // Generator for late game times (1 PM PT)
  const lateGameTimeArb = fc.constantFrom('1:00 PM PT', '1:30 PM PT');

  // Generator for NFL games with early time slot
  const earlyNFLGameArb = fc.record({
    id: fc.uuid(),
    team1: nflTeamArb,
    team2: nflTeamArb.filter(team => team !== fc.context().team1),
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
    timeSlot: fc.constant('early' as TimeSlot),
    isCompleted: fc.boolean(),
    projectedPoints: fc.float({ min: 0, max: 100 }),
    actualPoints: fc.option(fc.float({ min: 0, max: 100 })),
    isGameOfWeek: fc.boolean(),
    day: fc.constant('Sun'),
    time: earlyGameTimeArb,
  });

  // Generator for NFL games with late time slot
  const lateNFLGameArb = fc.record({
    id: fc.uuid(),
    team1: nflTeamArb,
    team2: nflTeamArb.filter(team => team !== fc.context().team1),
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
    timeSlot: fc.constant('late' as TimeSlot),
    isCompleted: fc.boolean(),
    projectedPoints: fc.float({ min: 0, max: 100 }),
    actualPoints: fc.option(fc.float({ min: 0, max: 100 })),
    isGameOfWeek: fc.boolean(),
    day: fc.constant('Sun'),
    time: lateGameTimeArb,
  });

  // Helper function to simulate the Sunday Ticket component tab logic
  function processSundayTicketTabs(games: NFLGame[], timeSlot: 'early' | 'late' | 'both' = 'both', showTabs: boolean = true): {
    shouldShowTabs: boolean;
    earlyGames: NFLGame[];
    lateGames: NFLGame[];
    hasEarlyGames: boolean;
    hasLateGames: boolean;
    tabsCreated: string[];
  } {
    // Helper to determine if game is in early time slot (10 AM PT)
    function isEarlyTimeSlot(game: NFLGame): boolean {
      const day = (game as any).day || '';
      const time = (game as any).time || '';
      if (!day.includes('Sun')) return false;
      return time.startsWith('10:');
    }

    // Helper to determine if game is in late time slot (1 PM PT)
    function isLateTimeSlot(game: NFLGame): boolean {
      const day = (game as any).day || '';
      const time = (game as any).time || '';
      if (!day.includes('Sun')) return false;
      return time.startsWith('1:') || time.startsWith('13:');
    }

    // Process games and add scores
    const gamesWithScores = games.map((game: NFLGame) => {
      const score = game.projectedPoints || 0;
      return { ...game, score };
    }).sort((a: NFLGame, b: NFLGame) => (b.score || 0) - (a.score || 0));

    // Filter games by time slot
    let earlyGames: NFLGame[] = [];
    let lateGames: NFLGame[] = [];

    if (timeSlot === 'early' || timeSlot === 'both') {
      earlyGames = gamesWithScores.filter(isEarlyTimeSlot);
    }

    if (timeSlot === 'late' || timeSlot === 'both') {
      lateGames = gamesWithScores.filter(isLateTimeSlot);
    }

    const hasEarlyGames = earlyGames.length > 0;
    const hasLateGames = lateGames.length > 0;

    // Determine if we should show tabs (matching component logic)
    const shouldShowTabs = showTabs && timeSlot === 'both' && hasEarlyGames && hasLateGames;

    // Determine which tabs are created
    const tabsCreated: string[] = [];
    if (shouldShowTabs) {
      if (hasEarlyGames) tabsCreated.push('early');
      if (hasLateGames) tabsCreated.push('late');
    }

    return {
      shouldShowTabs,
      earlyGames,
      lateGames,
      hasEarlyGames,
      hasLateGames,
      tabsCreated
    };
  }

  describe('Property 8: Time slot tab separation', () => {
    it('should create separate tabs for early (10 AM PT) and late (1 PM PT) games when both time slots have games', () => {
      fc.assert(
        fc.property(
          fc.array(earlyNFLGameArb, { minLength: 1, maxLength: 4 }),
          fc.array(lateNFLGameArb, { minLength: 1, maxLength: 4 }),
          (earlyGames, lateGames) => {
            const allGames = [...earlyGames, ...lateGames];
            const result = processSundayTicketTabs(allGames, 'both', true);

            // When games span multiple time slots, separate tabs should be created
            return result.shouldShowTabs === true &&
                   result.tabsCreated.includes('early') &&
                   result.tabsCreated.includes('late') &&
                   result.tabsCreated.length === 2;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not create tabs when only early games are present', () => {
      fc.assert(
        fc.property(
          fc.array(earlyNFLGameArb, { minLength: 1, maxLength: 6 }),
          (earlyGames) => {
            const result = processSundayTicketTabs(earlyGames, 'both', true);

            // With only early games, no tabs should be created
            return result.shouldShowTabs === false &&
                   result.hasEarlyGames === true &&
                   result.hasLateGames === false &&
                   result.tabsCreated.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not create tabs when only late games are present', () => {
      fc.assert(
        fc.property(
          fc.array(lateNFLGameArb, { minLength: 1, maxLength: 6 }),
          (lateGames) => {
            const result = processSundayTicketTabs(lateGames, 'both', true);

            // With only late games, no tabs should be created
            return result.shouldShowTabs === false &&
                   result.hasEarlyGames === false &&
                   result.hasLateGames === true &&
                   result.tabsCreated.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not create tabs when showTabs is disabled', () => {
      fc.assert(
        fc.property(
          fc.array(earlyNFLGameArb, { minLength: 1, maxLength: 3 }),
          fc.array(lateNFLGameArb, { minLength: 1, maxLength: 3 }),
          (earlyGames, lateGames) => {
            const allGames = [...earlyGames, ...lateGames];
            const result = processSundayTicketTabs(allGames, 'both', false);

            // When showTabs is false, no tabs should be created even with both time slots
            return result.shouldShowTabs === false &&
                   result.hasEarlyGames === true &&
                   result.hasLateGames === true &&
                   result.tabsCreated.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly separate games into early and late time slots', () => {
      fc.assert(
        fc.property(
          fc.array(earlyNFLGameArb, { minLength: 1, maxLength: 4 }),
          fc.array(lateNFLGameArb, { minLength: 1, maxLength: 4 }),
          (earlyGames, lateGames) => {
            const allGames = [...earlyGames, ...lateGames];
            const result = processSundayTicketTabs(allGames, 'both', true);

            // All early games should be in earlyGames array
            const allEarlyGamesCorrect = result.earlyGames.every(game => {
              const time = (game as any).time || '';
              return time.startsWith('10:');
            });

            // All late games should be in lateGames array
            const allLateGamesCorrect = result.lateGames.every(game => {
              const time = (game as any).time || '';
              return time.startsWith('1:') || time.startsWith('13:');
            });

            // No game should appear in both arrays
            const noOverlap = result.earlyGames.every(earlyGame => 
              !result.lateGames.some(lateGame => lateGame.id === earlyGame.id)
            );

            return allEarlyGamesCorrect && allLateGamesCorrect && noOverlap;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle single time slot requests correctly', () => {
      fc.assert(
        fc.property(
          fc.array(earlyNFLGameArb, { minLength: 1, maxLength: 3 }),
          fc.array(lateNFLGameArb, { minLength: 1, maxLength: 3 }),
          fc.constantFrom('early', 'late'),
          (earlyGames, lateGames, requestedTimeSlot) => {
            const allGames = [...earlyGames, ...lateGames];
            const result = processSundayTicketTabs(allGames, requestedTimeSlot as 'early' | 'late', true);

            // When requesting a single time slot, tabs should not be created
            return result.shouldShowTabs === false &&
                   result.tabsCreated.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain game data integrity when separating by time slots', () => {
      fc.assert(
        fc.property(
          fc.array(earlyNFLGameArb, { minLength: 1, maxLength: 4 }),
          fc.array(lateNFLGameArb, { minLength: 1, maxLength: 4 }),
          (earlyGames, lateGames) => {
            const allGames = [...earlyGames, ...lateGames];
            const result = processSundayTicketTabs(allGames, 'both', true);

            // All original games should be preserved in either early or late arrays
            const allGamesPreserved = allGames.every(originalGame => {
              const foundInEarly = result.earlyGames.some(g => g.id === originalGame.id);
              const foundInLate = result.lateGames.some(g => g.id === originalGame.id);
              return foundInEarly || foundInLate;
            });

            // Game data should remain intact
            const dataIntegrityMaintained = [...result.earlyGames, ...result.lateGames].every(processedGame => {
              const originalGame = allGames.find(g => g.id === processedGame.id);
              return originalGame &&
                     originalGame.team1 === processedGame.team1 &&
                     originalGame.team2 === processedGame.team2 &&
                     originalGame.playerCount === processedGame.playerCount;
            });

            return allGamesPreserved && dataIntegrityMaintained;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case of no games gracefully', () => {
      fc.assert(
        fc.property(
          fc.constant([]),
          (emptyGames) => {
            const result = processSundayTicketTabs(emptyGames, 'both', true);

            // With no games, no tabs should be created
            return result.shouldShowTabs === false &&
                   result.hasEarlyGames === false &&
                   result.hasLateGames === false &&
                   result.tabsCreated.length === 0 &&
                   result.earlyGames.length === 0 &&
                   result.lateGames.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify 10 AM PT as early time slot', () => {
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
            timeSlot: fc.constant('early' as TimeSlot),
            isCompleted: fc.boolean(),
            projectedPoints: fc.float({ min: 0, max: 100 }),
            actualPoints: fc.option(fc.float({ min: 0, max: 100 })),
            isGameOfWeek: fc.boolean(),
            day: fc.constant('Sun'),
            time: fc.constant('10:00 AM PT'),
          }), { minLength: 1, maxLength: 4 }),
          (tenAMGames) => {
            const result = processSundayTicketTabs(tenAMGames, 'both', true);

            // All 10 AM PT games should be classified as early
            return result.earlyGames.length === tenAMGames.length &&
                   result.lateGames.length === 0 &&
                   result.hasEarlyGames === true &&
                   result.hasLateGames === false;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify 1 PM PT as late time slot', () => {
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
            timeSlot: fc.constant('late' as TimeSlot),
            isCompleted: fc.boolean(),
            projectedPoints: fc.float({ min: 0, max: 100 }),
            actualPoints: fc.option(fc.float({ min: 0, max: 100 })),
            isGameOfWeek: fc.boolean(),
            day: fc.constant('Sun'),
            time: fc.constant('1:00 PM PT'),
          }), { minLength: 1, maxLength: 4 }),
          (onePMGames) => {
            const result = processSundayTicketTabs(onePMGames, 'both', true);

            // All 1 PM PT games should be classified as late
            return result.earlyGames.length === 0 &&
                   result.lateGames.length === onePMGames.length &&
                   result.hasEarlyGames === false &&
                   result.hasLateGames === true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});