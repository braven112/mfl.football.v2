/**
 * Property-Based Tests for URL Shareability
 * **Feature: dynamic-matchup-previews, Property 22: URL shareability**
 * **Validates: Requirements 7.5**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  generateShareableUrl,
  parseMatchupParams,
  updateMatchupUrl,
  MatchupNavigationState,
} from '../src/utils/matchup-routing';
import { generateMockMatchups } from '../src/utils/mock-matchup-data';
import type { Matchup } from '../src/types/matchup-previews';

describe('URL Shareability - Property-Based Tests', () => {
  beforeEach(() => {
    // Mock window and location for URL generation tests
    // @ts-ignore
    global.window = {
      location: {
        origin: 'https://example.com',
        href: 'https://example.com/theleague/matchup-preview',
        protocol: 'https:',
        host: 'example.com',
        hostname: 'example.com',
        port: '',
        pathname: '/theleague/matchup-preview',
        search: '',
        hash: '',
      },
      history: {
        replaceState: vi.fn(),
        pushState: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        go: vi.fn(),
        length: 1,
        scrollRestoration: 'auto',
        state: null,
      },
    };
  });

  // Generator for valid week numbers (1-18 for NFL season)
  const weekArb = fc.integer({ min: 1, max: 18 });

  // Generator for matchup counts (8 regular, up to 16 for doubleheader weeks)
  const matchupCountArb = fc.integer({ min: 1, max: 16 });

  // Generator for mock matchups with consistent structure
  const mockMatchupsArb = fc.tuple(weekArb, matchupCountArb).chain(([week, count]) => {
    const mockMatchups = generateMockMatchups(week).slice(0, count);
    return fc.constant(mockMatchups);
  });

  describe('Property 22: URL shareability', () => {
    it('should update URL to reflect current selection for sharing purposes', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any selected matchup, the URL should update to reflect the selection for sharing purposes
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const week = matchups[0].week;
          const navigationState = new MatchupNavigationState(matchups, week);
          
          // Test that every matchup selection updates the URL appropriately
          return matchups.every(matchup => {
            // Switch to the matchup
            const switchSuccess = navigationState.switchToMatchup(matchup.id);
            if (!switchSuccess) return false;
            
            // Generate shareable URL
            const shareableUrl = navigationState.getShareableUrl();
            if (!shareableUrl) return false;
            
            // Parse the generated URL to verify it contains correct parameters
            const url = new URL(shareableUrl);
            const params = parseMatchupParams(url);
            
            // Verify URL contains the correct matchup ID and week for sharing
            const hasCorrectMatchupId = params.matchupId === matchup.id;
            const hasCorrectWeek = params.week === week;
            
            // Verify URL is properly formatted for sharing (no extra parameters)
            const urlParams = Array.from(url.searchParams.keys());
            const hasOnlyNecessaryParams = urlParams.length <= 2 && // matchup and week
              urlParams.includes('matchup') && 
              urlParams.includes('week');
            
            return hasCorrectMatchupId && hasCorrectWeek && hasOnlyNecessaryParams;
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should generate consistent shareable URLs for the same matchup', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any matchup, multiple calls to generate shareable URL should produce identical results
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const week = matchups[0].week;
          const navigationState = new MatchupNavigationState(matchups, week);
          
          // Test consistency for each matchup
          return matchups.every(matchup => {
            navigationState.switchToMatchup(matchup.id);
            
            // Generate URL multiple times
            const url1 = navigationState.getShareableUrl();
            const url2 = navigationState.getShareableUrl();
            const url3 = navigationState.getShareableUrl();
            
            // All URLs should be identical
            return url1 === url2 && url2 === url3 && url1 !== undefined;
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should generate shareable URLs that can be parsed back to original parameters', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any generated shareable URL, parsing it should recover the original matchup parameters
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const week = matchups[0].week;
          const navigationState = new MatchupNavigationState(matchups, week);
          
          // Test round-trip consistency for each matchup
          return matchups.every(matchup => {
            navigationState.switchToMatchup(matchup.id);
            const shareableUrl = navigationState.getShareableUrl();
            
            if (!shareableUrl) return false;
            
            // Parse the URL back
            const parsedUrl = new URL(shareableUrl);
            const params = parseMatchupParams(parsedUrl);
            
            // Verify we can recover the original parameters
            const matchupIdMatches = params.matchupId === matchup.id;
            const weekMatches = params.week === week;
            
            return matchupIdMatches && weekMatches;
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should generate valid URLs that can be used for sharing across different contexts', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any matchup, the generated shareable URL should be a valid, complete URL
          
          if (matchups.length === 0) return true; // Edge case: no matchups
          
          const week = matchups[0].week;
          const navigationState = new MatchupNavigationState(matchups, week);
          
          // Test URL validity for each matchup
          return matchups.every(matchup => {
            navigationState.switchToMatchup(matchup.id);
            const shareableUrl = navigationState.getShareableUrl();
            
            if (!shareableUrl) return false;
            
            try {
              // Should be able to construct a valid URL object
              const url = new URL(shareableUrl);
              
              // Should have all required components for sharing
              const hasProtocol = url.protocol === 'https:';
              const hasHost = url.host.length > 0;
              const hasPath = url.pathname.length > 0;
              const hasRequiredParams = url.searchParams.has('matchup') && url.searchParams.has('week');
              
              return hasProtocol && hasHost && hasPath && hasRequiredParams;
            } catch (error) {
              // If URL construction fails, the URL is invalid
              return false;
            }
          });
        }),
        { numRuns: 100 }
      );
    });

    it('should handle URL updates when switching between different matchups', () => {
      fc.assert(
        fc.property(mockMatchupsArb, (matchups) => {
          // Property: For any sequence of matchup selections, each selection should update the URL appropriately
          
          if (matchups.length < 2) return true; // Need at least 2 matchups to test switching
          
          const week = matchups[0].week;
          const navigationState = new MatchupNavigationState(matchups, week);
          
          // Test switching between different matchups
          for (let i = 0; i < Math.min(matchups.length, 5); i++) {
            const matchup = matchups[i];
            navigationState.switchToMatchup(matchup.id);
            
            const shareableUrl = navigationState.getShareableUrl();
            if (!shareableUrl) return false;
            
            // Verify the URL reflects the current matchup
            const url = new URL(shareableUrl);
            const params = parseMatchupParams(url);
            
            if (params.matchupId !== matchup.id || params.week !== week) {
              return false;
            }
          }
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should generate shareable URLs that work across different week scenarios', () => {
      fc.assert(
        fc.property(weekArb, (week) => {
          // Property: For any week, shareable URLs should be generated correctly regardless of week type
          
          const matchups = generateMockMatchups(week);
          if (matchups.length === 0) return true;
          
          const navigationState = new MatchupNavigationState(matchups, week);
          
          // Test a sample of matchups from this week
          const sampleSize = Math.min(matchups.length, 3);
          for (let i = 0; i < sampleSize; i++) {
            const matchup = matchups[i];
            navigationState.switchToMatchup(matchup.id);
            
            const shareableUrl = navigationState.getShareableUrl();
            if (!shareableUrl) return false;
            
            // Verify the URL contains the correct week
            const url = new URL(shareableUrl);
            const params = parseMatchupParams(url);
            
            if (params.week !== week) return false;
          }
          
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});