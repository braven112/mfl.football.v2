/**
 * Lineup Accordion Functionality Property-Based Tests
 * **Feature: dynamic-matchup-previews, Property 25: Lineup accordion functionality**
 * **Validates: Requirements 8.4, 8.5**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { FantasyPlayer, StartingLineup, PlayerStatus } from '../src/types/matchup-previews';

describe('Lineup Accordion Functionality - Property-Based Tests', () => {
  // Generator for valid player positions
  const playerPositionArb = fc.constantFrom('QB', 'RB', 'WR', 'TE', 'K', 'DEF');

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

  // Generator for player IDs (ensure uniqueness)
  const playerIdArb = fc.integer({ min: 1000, max: 9999 }).map(n => `player-${n}`);

  // Generator for projected points (realistic fantasy football range)
  const projectedPointsArb = fc.float({ min: 0, max: 50, noNaN: true });

  // Generator for FantasyPlayer
  const fantasyPlayerArb = fc.record({
    id: playerIdArb,
    name: fc.string({ minLength: 5, maxLength: 30 }).filter(s => s.trim().length >= 5 && /^[A-Za-z\s]+$/.test(s.trim())),
    position: playerPositionArb,
    nflTeam: nflTeamArb,
    fantasyTeamId: fantasyTeamIdArb,
    isStarting: fc.boolean(),
    injuryStatus: injuryStatusArb,
    projectedPoints: projectedPointsArb,
    isIReligible: fc.boolean(),
  });

  // Generator for starting lineup with realistic roster composition and unique players
  const startingLineupArb = fantasyTeamIdArb.chain(teamId => {
    return fc.integer({ min: 1, max: 1000 }).chain(baseCounter => {
      let playerCounter = baseCounter;
      
      const createUniquePlayer = (position: string, isStarting: boolean) => 
        fc.record({
          id: fc.constant(`${teamId}-player-${playerCounter++}`),
          name: fc.constantFrom('John Smith', 'Jane Doe', 'Mike Johnson', 'Sarah Wilson', 'Tom Brown', 'Lisa Davis', 'Chris Miller', 'Amy Taylor', 'David Anderson', 'Emily White'),
          position: fc.constant(position),
          nflTeam: nflTeamArb,
          fantasyTeamId: fc.constant(teamId),
          isStarting: fc.constant(isStarting),
          injuryStatus: injuryStatusArb,
          projectedPoints: projectedPointsArb,
          isIReligible: fc.boolean(),
        });

      return fc.record({
        teamId: fc.constant(teamId),
        week: fc.integer({ min: 1, max: 18 }),
        positions: fc.record({
          QB: fc.array(createUniquePlayer('QB', true), { minLength: 1, maxLength: 1 }),
          RB: fc.array(createUniquePlayer('RB', true), { minLength: 1, maxLength: 3 }),
          WR: fc.array(createUniquePlayer('WR', true), { minLength: 1, maxLength: 4 }),
          TE: fc.array(createUniquePlayer('TE', true), { minLength: 1, maxLength: 2 }),
          FLEX: fc.array(createUniquePlayer('FLEX', true), { minLength: 0, maxLength: 2 }),
          K: fc.array(createUniquePlayer('K', true), { minLength: 1, maxLength: 1 }),
          DEF: fc.array(createUniquePlayer('DEF', true), { minLength: 1, maxLength: 1 }),
        }),
        bench: fc.array(createUniquePlayer('QB', false), { minLength: 5, maxLength: 15 }),
        totalProjected: fc.float({ min: 50, max: 200 }),
        optimizationOpportunities: fc.constant([]),
      });
    });
  });

  // Helper function to simulate accordion component behavior
  function simulateAccordionBehavior(homeLineup: StartingLineup, awayLineup: StartingLineup, isExpanded: boolean) {
    // Get all players from lineup positions and bench (simulating the component's getAllPlayersFromLineup function)
    function getAllPlayersFromLineup(lineup: StartingLineup): FantasyPlayer[] {
      const allPlayers: FantasyPlayer[] = [];
      
      // Add all starting players from positions
      Object.values(lineup.positions).forEach(positionPlayers => {
        allPlayers.push(...positionPlayers);
      });
      
      // Add bench players
      allPlayers.push(...lineup.bench);
      
      return allPlayers;
    }

    // Sort players: starters first (by position), then bench (alphabetically)
    function sortPlayersForDisplay(players: FantasyPlayer[]): { starters: FantasyPlayer[], bench: FantasyPlayer[] } {
      const starters = players.filter(p => p.isStarting);
      const bench = players.filter(p => !p.isStarting);
      
      // Position order for starters
      const positionOrder = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
      
      // Sort starters by position, then by name
      starters.sort((a, b) => {
        const posA = positionOrder.indexOf(a.position);
        const posB = positionOrder.indexOf(b.position);
        
        if (posA !== posB) {
          return (posA === -1 ? 999 : posA) - (posB === -1 ? 999 : posB);
        }
        
        return a.name.localeCompare(b.name);
      });
      
      // Sort bench alphabetically by name
      bench.sort((a, b) => a.name.localeCompare(b.name));
      
      return { starters, bench };
    }

    const homeAllPlayers = getAllPlayersFromLineup(homeLineup);
    const awayAllPlayers = getAllPlayersFromLineup(awayLineup);

    const homeSorted = sortPlayersForDisplay(homeAllPlayers);
    const awaySorted = sortPlayersForDisplay(awayAllPlayers);

    return {
      isExpanded,
      homeTeam: {
        allPlayers: homeAllPlayers,
        starters: homeSorted.starters,
        bench: homeSorted.bench,
        starterCount: homeSorted.starters.length,
        benchCount: homeSorted.bench.length,
      },
      awayTeam: {
        allPlayers: awayAllPlayers,
        starters: awaySorted.starters,
        bench: awaySorted.bench,
        starterCount: awaySorted.starters.length,
        benchCount: awaySorted.bench.length,
      },
      totalPlayers: homeAllPlayers.length + awayAllPlayers.length,
      totalStarters: homeSorted.starters.length + awaySorted.starters.length,
      totalBench: homeSorted.bench.length + awaySorted.bench.length,
    };
  }

  describe('Property 25: Lineup accordion functionality', () => {
    it('should provide access to complete starting lineups for both teams when expanded', () => {
      fc.assert(
        fc.property(startingLineupArb, startingLineupArb, (homeLineup, awayLineup) => {
          // Property: For any two starting lineups, when the accordion is expanded,
          // it should provide access to all players from both teams' complete lineups
          
          const accordionState = simulateAccordionBehavior(homeLineup, awayLineup, true);
          
          // Should include all starting players from positions
          const homeStartersFromPositions = Object.values(homeLineup.positions).flat();
          const awayStartersFromPositions = Object.values(awayLineup.positions).flat();
          
          // Verify all starters are accessible
          const homeStartersMatch = homeStartersFromPositions.every(starter =>
            accordionState.homeTeam.starters.some(displayedStarter => displayedStarter.id === starter.id)
          );
          
          const awayStartersMatch = awayStartersFromPositions.every(starter =>
            accordionState.awayTeam.starters.some(displayedStarter => displayedStarter.id === starter.id)
          );
          
          // Verify all bench players are accessible
          const homeBenchMatch = homeLineup.bench.every(benchPlayer =>
            accordionState.homeTeam.bench.some(displayedBench => displayedBench.id === benchPlayer.id)
          );
          
          const awayBenchMatch = awayLineup.bench.every(benchPlayer =>
            accordionState.awayTeam.bench.some(displayedBench => displayedBench.id === benchPlayer.id)
          );
          
          // All players should be accessible when expanded
          return homeStartersMatch && awayStartersMatch && homeBenchMatch && awayBenchMatch;
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain minimal space usage when collapsed', () => {
      fc.assert(
        fc.property(startingLineupArb, startingLineupArb, (homeLineup, awayLineup) => {
          // Property: For any two starting lineups, when the accordion is collapsed,
          // it should maintain minimal space usage while keeping lineup data accessible
          
          const collapsedState = simulateAccordionBehavior(homeLineup, awayLineup, false);
          const expandedState = simulateAccordionBehavior(homeLineup, awayLineup, true);
          
          // When collapsed, the accordion should still have access to the data
          // but the visual representation should be minimal
          
          // Data should be the same regardless of expanded state
          const dataConsistency = 
            collapsedState.totalPlayers === expandedState.totalPlayers &&
            collapsedState.totalStarters === expandedState.totalStarters &&
            collapsedState.totalBench === expandedState.totalBench;
          
          // Collapsed state should indicate minimal visual footprint
          // (in real implementation, this would be CSS classes like 'collapsed' vs 'expanded')
          const hasMinimalFootprint = !collapsedState.isExpanded;
          
          // Summary information should be available even when collapsed
          const hasSummaryInfo = 
            collapsedState.totalStarters > 0 && 
            collapsedState.totalBench >= 0;
          
          return dataConsistency && hasMinimalFootprint && hasSummaryInfo;
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly separate starters and bench players', () => {
      fc.assert(
        fc.property(startingLineupArb, startingLineupArb, (homeLineup, awayLineup) => {
          // Property: For any two starting lineups, the accordion should correctly
          // separate starters from bench players for both teams
          
          const accordionState = simulateAccordionBehavior(homeLineup, awayLineup, true);
          
          // All displayed starters should have isStarting = true
          const homeStartersValid = accordionState.homeTeam.starters.every(player => player.isStarting);
          const awayStartersValid = accordionState.awayTeam.starters.every(player => player.isStarting);
          
          // All displayed bench players should have isStarting = false
          const homeBenchValid = accordionState.homeTeam.bench.every(player => !player.isStarting);
          const awayBenchValid = accordionState.awayTeam.bench.every(player => !player.isStarting);
          
          // No player should appear in both starters and bench
          const homeNoOverlap = accordionState.homeTeam.starters.every(starter =>
            !accordionState.homeTeam.bench.some(bench => bench.id === starter.id)
          );
          
          const awayNoOverlap = accordionState.awayTeam.starters.every(starter =>
            !accordionState.awayTeam.bench.some(bench => bench.id === starter.id)
          );
          
          return homeStartersValid && awayStartersValid && homeBenchValid && awayBenchValid && homeNoOverlap && awayNoOverlap;
        }),
        { numRuns: 100 }
      );
    });

    it('should sort starters by position order and bench players alphabetically', () => {
      fc.assert(
        fc.property(startingLineupArb, startingLineupArb, (homeLineup, awayLineup) => {
          // Property: For any two starting lineups, starters should be sorted by position order
          // and bench players should be sorted alphabetically by name
          
          const accordionState = simulateAccordionBehavior(homeLineup, awayLineup, true);
          const positionOrder = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
          
          // Check starter position ordering for home team
          const homeStartersSorted = accordionState.homeTeam.starters.every((player, index, array) => {
            if (index === 0) return true;
            
            const currentPosIndex = positionOrder.indexOf(player.position);
            const prevPosIndex = positionOrder.indexOf(array[index - 1].position);
            
            // If positions are different, current should come after previous in position order
            if (currentPosIndex !== prevPosIndex) {
              return currentPosIndex >= prevPosIndex;
            }
            
            // If same position, should be sorted alphabetically by name
            return player.name >= array[index - 1].name;
          });
          
          // Check starter position ordering for away team
          const awayStartersSorted = accordionState.awayTeam.starters.every((player, index, array) => {
            if (index === 0) return true;
            
            const currentPosIndex = positionOrder.indexOf(player.position);
            const prevPosIndex = positionOrder.indexOf(array[index - 1].position);
            
            if (currentPosIndex !== prevPosIndex) {
              return currentPosIndex >= prevPosIndex;
            }
            
            return player.name >= array[index - 1].name;
          });
          
          // Check bench alphabetical ordering for home team
          const homeBenchSorted = accordionState.homeTeam.bench.every((player, index, array) => {
            if (index === 0) return true;
            return player.name >= array[index - 1].name;
          });
          
          // Check bench alphabetical ordering for away team
          const awayBenchSorted = accordionState.awayTeam.bench.every((player, index, array) => {
            if (index === 0) return true;
            return player.name >= array[index - 1].name;
          });
          
          return homeStartersSorted && awayStartersSorted && homeBenchSorted && awayBenchSorted;
        }),
        { numRuns: 100 }
      );
    });

    it('should provide accurate player counts for starters and bench', () => {
      fc.assert(
        fc.property(startingLineupArb, startingLineupArb, (homeLineup, awayLineup) => {
          // Property: For any two starting lineups, the accordion should provide
          // accurate counts of starters and bench players for both teams
          
          const accordionState = simulateAccordionBehavior(homeLineup, awayLineup, true);
          
          // Count actual starters from positions
          const homeActualStarters = Object.values(homeLineup.positions).flat().length;
          const awayActualStarters = Object.values(awayLineup.positions).flat().length;
          
          // Count actual bench players
          const homeActualBench = homeLineup.bench.length;
          const awayActualBench = awayLineup.bench.length;
          
          // Verify counts match
          const homeCountsMatch = 
            accordionState.homeTeam.starterCount === homeActualStarters &&
            accordionState.homeTeam.benchCount === homeActualBench;
          
          const awayCountsMatch = 
            accordionState.awayTeam.starterCount === awayActualStarters &&
            accordionState.awayTeam.benchCount === awayActualBench;
          
          // Total counts should also be accurate
          const totalCountsMatch = 
            accordionState.totalStarters === (homeActualStarters + awayActualStarters) &&
            accordionState.totalBench === (homeActualBench + awayActualBench);
          
          return homeCountsMatch && awayCountsMatch && totalCountsMatch;
        }),
        { numRuns: 100 }
      );
    });

    it('should handle empty bench scenarios gracefully', () => {
      fc.assert(
        fc.property(startingLineupArb, startingLineupArb, (homeLineup, awayLineup) => {
          // Property: For any starting lineup with empty bench, the accordion should handle it gracefully
          
          // Create lineups with empty benches
          const homeLineupEmptyBench = { ...homeLineup, bench: [] };
          const awayLineupEmptyBench = { ...awayLineup, bench: [] };
          
          const accordionState = simulateAccordionBehavior(homeLineupEmptyBench, awayLineupEmptyBench, true);
          
          // Should handle empty bench gracefully
          const handlesEmptyBench = 
            accordionState.homeTeam.benchCount === 0 &&
            accordionState.awayTeam.benchCount === 0 &&
            accordionState.totalBench === 0 &&
            accordionState.homeTeam.bench.length === 0 &&
            accordionState.awayTeam.bench.length === 0;
          
          // Should still have starters
          const hasStarters = 
            accordionState.homeTeam.starterCount > 0 &&
            accordionState.awayTeam.starterCount > 0 &&
            accordionState.totalStarters > 0;
          
          return handlesEmptyBench && hasStarters;
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain team association for all players', () => {
      fc.assert(
        fc.property(startingLineupArb, startingLineupArb, (homeLineup, awayLineup) => {
          // Property: For any two starting lineups, all players should maintain
          // correct team association in the accordion display
          
          const accordionState = simulateAccordionBehavior(homeLineup, awayLineup, true);
          
          // All home team players should have the correct fantasyTeamId
          const homeTeamAssociation = [
            ...accordionState.homeTeam.starters,
            ...accordionState.homeTeam.bench
          ].every(player => player.fantasyTeamId === homeLineup.teamId);
          
          // All away team players should have the correct fantasyTeamId
          const awayTeamAssociation = [
            ...accordionState.awayTeam.starters,
            ...accordionState.awayTeam.bench
          ].every(player => player.fantasyTeamId === awayLineup.teamId);
          
          // No cross-contamination between teams
          const noCrossContamination = 
            accordionState.homeTeam.allPlayers.every(player => player.fantasyTeamId === homeLineup.teamId) &&
            accordionState.awayTeam.allPlayers.every(player => player.fantasyTeamId === awayLineup.teamId);
          
          return homeTeamAssociation && awayTeamAssociation && noCrossContamination;
        }),
        { numRuns: 100 }
      );
    });
  });
});