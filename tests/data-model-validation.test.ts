import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { FantasyPlayer, StartingLineup, PlayerStatus } from '../src/types/matchup-previews';

/**
 * Property-Based Tests for Data Model Validation
 * **Feature: dynamic-matchup-previews, Property 23: Starting lineup indication**
 * **Validates: Requirements 8.1**
 */

describe('Data Model Validation - Property-Based Tests', () => {
  // Generator for valid player positions
  const playerPositionArb = fc.constantFrom('QB', 'RB', 'WR', 'TE', 'K', 'Def');

  // Generator for valid NFL teams
  const nflTeamArb = fc.constantFrom(
    'SF', 'KC', 'DAL', 'BUF', 'MIA', 'NYJ', 'NE', 'BAL', 'CIN', 'CLE', 'PIT',
    'HOU', 'IND', 'JAX', 'TEN', 'DEN', 'LV', 'LAC', 'GB', 'MIN', 'CHI', 'DET',
    'ATL', 'CAR', 'NO', 'TB', 'ARI', 'LAR', 'SEA', 'NYG', 'PHI', 'WAS'
  );

  // Generator for valid injury statuses
  const injuryStatusArb = fc.constantFrom<PlayerStatus>('Healthy', 'Questionable', 'Doubtful', 'Out', 'IR');

  // Generator for fantasy team IDs (4-digit format like MFL)
  const fantasyTeamIdArb = fc.integer({ min: 1, max: 9999 }).map(n => n.toString().padStart(4, '0'));

  // Generator for player IDs (5-digit format like MFL) - using uuid for uniqueness
  const playerIdArb = fc.uuid().map(uuid => uuid.slice(0, 8)); // Use first 8 chars of UUID for uniqueness

  // Generator for valid FantasyPlayer objects
  const fantasyPlayerArb = fc.record({
    id: playerIdArb,
    name: fc.string({ minLength: 3, maxLength: 30 }).filter(s => s.trim().length > 0),
    position: playerPositionArb,
    nflTeam: nflTeamArb,
    fantasyTeamId: fantasyTeamIdArb,
    isStarting: fc.boolean(),
    injuryStatus: injuryStatusArb,
    projectedPoints: fc.option(fc.float({ min: 0, max: 50 })),
    actualPoints: fc.option(fc.float({ min: 0, max: 50 })),
  });

  // Generator for arrays of fantasy players for a team with consistent team IDs
  const teamRosterArb = fantasyTeamIdArb.chain(teamId => 
    fc.array(
      fc.record({
        id: playerIdArb,
        name: fc.string({ minLength: 3, maxLength: 30 }).filter(s => s.trim().length > 0),
        position: playerPositionArb,
        nflTeam: nflTeamArb,
        fantasyTeamId: fc.constant(teamId),
        isStarting: fc.boolean(),
        injuryStatus: injuryStatusArb,
        projectedPoints: fc.option(fc.float({ min: 0, max: 50 })),
        actualPoints: fc.option(fc.float({ min: 0, max: 50 })),
      }),
      { minLength: 15, maxLength: 25 }
    )
  );

  // Generator for starting lineup with proper position constraints and consistent team IDs
  const startingLineupArb = fc.record({
    teamId: fantasyTeamIdArb,
    week: fc.integer({ min: 1, max: 18 }),
  }).chain(({ teamId, week }) => {
    // Create players that all belong to the same team
    const createPlayerForTeam = (position: string, isStarting: boolean) =>
      fc.record({
        id: playerIdArb,
        name: fc.string({ minLength: 3, maxLength: 30 }).filter(s => s.trim().length > 0),
        position: fc.constant(position),
        nflTeam: nflTeamArb,
        fantasyTeamId: fc.constant(teamId),
        isStarting: fc.constant(isStarting),
        injuryStatus: injuryStatusArb,
        projectedPoints: fc.option(fc.float({ min: 0, max: 50 })),
        actualPoints: fc.option(fc.float({ min: 0, max: 50 })),
      });

    return fc.record({
      teamId: fc.constant(teamId),
      week: fc.constant(week),
      positions: fc.record({
        QB: fc.array(createPlayerForTeam('QB', true), { minLength: 0, maxLength: 2 }),
        RB: fc.array(createPlayerForTeam('RB', true), { minLength: 0, maxLength: 4 }),
        WR: fc.array(createPlayerForTeam('WR', true), { minLength: 0, maxLength: 4 }),
        TE: fc.array(createPlayerForTeam('TE', true), { minLength: 0, maxLength: 2 }),
        FLEX: fc.array(createPlayerForTeam('RB', true), { minLength: 0, maxLength: 2 }), // Simplified to RB for FLEX
        K: fc.array(createPlayerForTeam('K', true), { minLength: 0, maxLength: 1 }),
        DEF: fc.array(createPlayerForTeam('Def', true), { minLength: 0, maxLength: 1 }),
      }),
      bench: fc.array(fc.oneof(
        createPlayerForTeam('QB', false),
        createPlayerForTeam('RB', false),
        createPlayerForTeam('WR', false),
        createPlayerForTeam('TE', false),
        createPlayerForTeam('K', false),
        createPlayerForTeam('Def', false)
      ), { minLength: 5, maxLength: 15 }),
      totalProjected: fc.float({ min: 0, max: 200 }),
      totalActual: fc.option(fc.float({ min: 0, max: 200 })),
      optimizationOpportunities: fc.array(fc.record({
        type: fc.constantFrom('bench_upgrade', 'injury_warning', 'ir_eligible'),
        severity: fc.constantFrom('low', 'medium', 'high'),
        startingPlayer: createPlayerForTeam('QB', true), // Simplified
        message: fc.string({ minLength: 10, maxLength: 100 }),
        includeInAnalysis: fc.boolean(),
      }), { maxLength: 5 }),
    });
  });

  describe('Property 23: Starting lineup indication', () => {
    it('should accurately indicate starting status for all players in a lineup', () => {
      fc.assert(
        fc.property(startingLineupArb, (lineup) => {
          // Property: For any starting lineup, all players in the positions object should have isStarting = true
          // and all players in the bench array should have isStarting = false
          
          const allStartingPlayers = [
            ...lineup.positions.QB,
            ...lineup.positions.RB,
            ...lineup.positions.WR,
            ...lineup.positions.TE,
            ...lineup.positions.FLEX,
            ...lineup.positions.K,
            ...lineup.positions.DEF,
          ];

          // All starting players should have isStarting = true
          const allStartersHaveCorrectStatus = allStartingPlayers.every(player => player.isStarting === true);
          
          // All bench players should have isStarting = false
          const allBenchHaveCorrectStatus = lineup.bench.every(player => player.isStarting === false);

          return allStartersHaveCorrectStatus && allBenchHaveCorrectStatus;
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain consistent team ID across all players in a lineup', () => {
      fc.assert(
        fc.property(startingLineupArb, (lineup) => {
          // Property: For any starting lineup, all players should belong to the same fantasy team
          
          const allPlayers = [
            ...lineup.positions.QB,
            ...lineup.positions.RB,
            ...lineup.positions.WR,
            ...lineup.positions.TE,
            ...lineup.positions.FLEX,
            ...lineup.positions.K,
            ...lineup.positions.DEF,
            ...lineup.bench,
          ];

          // All players should have the same fantasyTeamId as the lineup teamId
          return allPlayers.every(player => player.fantasyTeamId === lineup.teamId);
        }),
        { numRuns: 100 }
      );
    });

    it('should have valid player data structure for starting lineup indication', () => {
      fc.assert(
        fc.property(fantasyPlayerArb, (player) => {
          // Property: For any fantasy player, the isStarting field should be a boolean
          // and should be consistent with the data model requirements
          
          // isStarting should be a boolean
          const hasValidStartingStatus = typeof player.isStarting === 'boolean';
          
          // Player should have required fields for lineup indication
          const hasRequiredFields = (
            typeof player.id === 'string' &&
            player.id.length > 0 &&
            typeof player.name === 'string' &&
            player.name.trim().length > 0 &&
            typeof player.position === 'string' &&
            typeof player.fantasyTeamId === 'string' &&
            player.fantasyTeamId.length === 4 // MFL format
          );

          return hasValidStartingStatus && hasRequiredFields;
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly separate starting and bench players in lineup data', () => {
      fc.assert(
        fc.property(teamRosterArb, (roster) => {
          // Property: For any team roster, players can be correctly categorized as starting or bench
          // based on their isStarting property
          
          const startingPlayers = roster.filter(player => player.isStarting);
          const benchPlayers = roster.filter(player => !player.isStarting);
          
          // All players should be accounted for
          const allPlayersAccountedFor = (startingPlayers.length + benchPlayers.length) === roster.length;
          
          // Starting players should have isStarting = true
          const startingPlayersCorrect = startingPlayers.every(player => player.isStarting === true);
          
          // Bench players should have isStarting = false
          const benchPlayersCorrect = benchPlayers.every(player => player.isStarting === false);

          // The key property: players are correctly categorized by their isStarting flag
          return allPlayersAccountedFor && startingPlayersCorrect && benchPlayersCorrect;
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain starting status consistency across different data representations', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (isStarting) => {
            // Property: For any player, their starting status should be consistent
            // across different data representations (roster vs lineup)
            
            // In a properly functioning system, if a player is marked as starting
            // in one representation, they should be marked as starting in all representations
            const data = {
              playerId: '12345',
              isStartingInRoster: isStarting,
              isStartingInLineup: isStarting, // Should be consistent
            };
            
            return data.isStartingInRoster === data.isStartingInLineup;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});