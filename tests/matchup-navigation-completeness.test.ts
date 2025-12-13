/**
 * Property-Based Tests for Matchup Navigation Completeness
 * **Feature: dynamic-matchup-previews, Property 4: Matchup navigation completeness**
 * **Validates: Requirements 1.5, 7.2**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  MatchupNavigationState,
  findMatchupById,
  findMatchupByTeamId,
  getDefaultMatchup,
  resolveCurrentMatchup,
  parseMatchupParams,
  generateMatchupUrl,
} from '../src/utils/matchup-routing';
import { generateMockMatchups } from '../src/utils/mock-matchup-data';
import type { Matchup } from '../src/types/matchup-previews';

describe('Matchup Navigation Completeness - Property-Based Tests', () => {
  beforeEach(() => {
    // Mock window and location for URL generation tests
    // @ts-ignore
    global.window = {
      location: {
        origin: 'https://example.com',
        href: 'https://example.com/theleague/matchup-preview',
      },
      history: {
        replaceState: vi.fn(),
      },
    };
  });

  // Generator for valid week numbers (1-18 for NFL season)
  const weekArb = fc.integer({ min: 1, max: 18 });

  // Generator for matchup counts (8 regular, up to 16 for doubleheader weeks)
  const matchupCountArb = fc.integer({ min: 1, max: 16 });

  // Generator for team IDs in MFL format (4-digit strings)
  const teamIdArb = fc.integer({ min: 1, max: 9999 }).map(n => n.toString().padStart(4, '0'));

  // Generator for matchup IDs
  const matchupIdArb = fc.integer({ min: 1, max: 16 }).map(n => `matchup-${n}`);

  // Generator for mock matchups with consistent structure
  const mockMatchupsArb = fc.tuple(weekArb, matchupCountArb).chain(([week, count]) => {
    const mockMatchups = generateMockMatchups(week).slice(0, count);
    return fc.constant(mockMatchups);
  });

  describe('Property 4: Matchup navigation completeness', () => {
    it('should provide navigation mechanism for all available matchups in the league', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any league week, the navigation mechanism should provide access 
          // to all available matchups in that week
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const navigationState = new MatchupNavigationState(matchups, matchups[0].week);
          const availableMatchups = navigationState.getAvailableMatchups();
          
          // The navigation should provide access to exactly the same matchups that exist
          const navigationProvidesAllMatchups = availableMatchups.length === matchups.length;
          
          // Every matchup in the original list should be accessible through navigation
          const allMatchupsAccessible = matchups.every(originalMatchup => 
            availableMatchups.some(navMatchup => navMatchup.id === originalMatchup.id)
          );
          
          // Every matchup provided by navigation should exist in the original list
          const noExtraMatchups = availableMatchups.every(navMatchup =>
            matchups.some(originalMatchup => originalMatchup.id === navMatchup.id)
          );
          
          return navigationProvidesAllMatchups && allMatchupsAccessible && noExtraMatchups;
        }),
        { numRuns: 100 }
      );
    });

    it('should allow switching to any matchup by ID', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any set of matchups, the navigation should allow switching to any matchup by ID
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const navigationState = new MatchupNavigationState(matchups, matchups[0].week);
          
          // Test that we can switch to every matchup by its ID
          const canSwitchToAllMatchups = matchups.every(matchup => {
            const switchSuccess = navigationState.switchToMatchup(matchup.id);
            const currentMatchup = navigationState.getCurrentMatchup();
            
            return switchSuccess && currentMatchup?.id === matchup.id;
          });
          
          return canSwitchToAllMatchups;
        }),
        { numRuns: 100 }
      );
    });

    it('should allow switching to any matchup by team ID', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any set of matchups, the navigation should allow switching to matchups by team ID
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const navigationState = new MatchupNavigationState(matchups, matchups[0].week);
          
          // Collect all team IDs from all matchups
          const allTeamIds = matchups.flatMap(matchup => [matchup.homeTeam.id, matchup.awayTeam.id]);
          
          // Test that we can switch to a matchup for every team ID
          const canSwitchToAllTeams = allTeamIds.every(teamId => {
            const switchSuccess = navigationState.switchToTeam(teamId);
            const currentMatchup = navigationState.getCurrentMatchup();
            
            // Verify that the current matchup contains the team we switched to
            const matchupContainsTeam = currentMatchup && 
              (currentMatchup.homeTeam.id === teamId || currentMatchup.awayTeam.id === teamId);
            
            return switchSuccess && matchupContainsTeam;
          });
          
          return canSwitchToAllTeams;
        }),
        { numRuns: 100 }
      );
    });

    it('should provide selection mechanism that clearly identifies teams in each matchup', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any set of matchups, the selection mechanism should clearly identify 
          // which teams are involved in each available matchup
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          // Test that each matchup has clearly identifiable team information
          const allMatchupsHaveClearTeamInfo = matchups.every(matchup => {
            // Each matchup should have home and away teams with valid IDs and names
            const hasValidHomeTeam = (
              matchup.homeTeam &&
              typeof matchup.homeTeam.id === 'string' &&
              matchup.homeTeam.id.length > 0 &&
              typeof matchup.homeTeam.name === 'string' &&
              matchup.homeTeam.name.trim().length > 0
            );
            
            const hasValidAwayTeam = (
              matchup.awayTeam &&
              typeof matchup.awayTeam.id === 'string' &&
              matchup.awayTeam.id.length > 0 &&
              typeof matchup.awayTeam.name === 'string' &&
              matchup.awayTeam.name.trim().length > 0
            );
            
            // Teams should be different (can't play against themselves)
            const teamsAreDifferent = matchup.homeTeam.id !== matchup.awayTeam.id;
            
            return hasValidHomeTeam && hasValidAwayTeam && teamsAreDifferent;
          });
          
          return allMatchupsHaveClearTeamInfo;
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain URL shareability for all matchup selections', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any matchup selection, the URL should update to reflect the current selection for sharing
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const navigationState = new MatchupNavigationState(matchups, matchups[0].week);
          
          // Test that every matchup can generate a shareable URL
          const allMatchupsHaveShareableUrls = matchups.every(matchup => {
            navigationState.switchToMatchup(matchup.id);
            const shareableUrl = navigationState.getShareableUrl();
            
            // URL should exist and contain the matchup ID and week
            const hasValidUrl = (
              shareableUrl &&
              typeof shareableUrl === 'string' &&
              shareableUrl.includes(matchup.id) &&
              shareableUrl.includes(`week=${matchup.week}`)
            );
            
            return hasValidUrl;
          });
          
          return allMatchupsHaveShareableUrls;
        }),
        { numRuns: 100 }
      );
    });

    it('should handle navigation completeness across different week scenarios', () => {
      fc.assert(
        fc.property(weekArb, (week) => {
          // Property: For any week (regular or doubleheader), navigation should provide complete access
          
          const matchups = generateMockMatchups(week);
          const navigationState = new MatchupNavigationState(matchups, week);
          
          // Navigation should provide access to all generated matchups
          const availableMatchups = navigationState.getAvailableMatchups();
          const providesCompleteAccess = availableMatchups.length === matchups.length;
          
          // Should be able to navigate to default matchup
          const defaultMatchup = getDefaultMatchup(matchups);
          const hasDefaultMatchup = defaultMatchup !== undefined;
          
          // If there are matchups, navigation should work
          if (matchups.length > 0) {
            return providesCompleteAccess && hasDefaultMatchup;
          }
          
          // If no matchups, navigation should handle gracefully
          return availableMatchups.length === 0 && defaultMatchup === undefined;
        }),
        { numRuns: 100 }
      );
    });

    it('should resolve current matchup correctly from URL parameters', () => {
      fc.assert(
        fc.property(
          mockMatchupsArb,
          fc.option(matchupIdArb),
          fc.option(teamIdArb),
          (matchups, maybeMatchupId, maybeTeamId) => {
            // Property: For any URL parameters, the system should resolve to a valid matchup or default
            
            if (matchups.length === 0) return true; // Edge case: no matchups
            
            const params = {
              matchupId: maybeMatchupId,
              teamId: maybeTeamId,
              week: matchups[0].week,
            };
            
            const resolvedMatchup = resolveCurrentMatchup(matchups, params);
            
            // Should always resolve to a matchup if matchups exist
            const resolvesToValidMatchup = resolvedMatchup !== undefined;
            
            // Resolved matchup should be one of the available matchups
            const resolvedMatchupIsAvailable = matchups.some(m => m.id === resolvedMatchup?.id);
            
            return resolvesToValidMatchup && resolvedMatchupIsAvailable;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should provide consistent navigation behavior across all matchup operations', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: Navigation operations should be consistent and maintain state correctly
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const navigationState = new MatchupNavigationState(matchups, matchups[0].week);
          
          // Test consistency: switching to a matchup and back should work
          const firstMatchup = matchups[0];
          const secondMatchup = matchups.length > 1 ? matchups[1] : matchups[0];
          
          // Switch to first matchup
          const firstSwitchSuccess = navigationState.switchToMatchup(firstMatchup.id);
          const firstCurrent = navigationState.getCurrentMatchup();
          
          // Switch to second matchup
          const secondSwitchSuccess = navigationState.switchToMatchup(secondMatchup.id);
          const secondCurrent = navigationState.getCurrentMatchup();
          
          // Switch back to first matchup
          const backToFirstSuccess = navigationState.switchToMatchup(firstMatchup.id);
          const backToFirstCurrent = navigationState.getCurrentMatchup();
          
          // All operations should succeed and maintain correct state
          const allOperationsSucceed = firstSwitchSuccess && secondSwitchSuccess && backToFirstSuccess;
          const stateIsConsistent = (
            firstCurrent?.id === firstMatchup.id &&
            secondCurrent?.id === secondMatchup.id &&
            backToFirstCurrent?.id === firstMatchup.id
          );
          
          return allOperationsSucceed && stateIsConsistent;
        }),
        { numRuns: 100 }
      );
    });
  });
});