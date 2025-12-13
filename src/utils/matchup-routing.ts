/**
 * Matchup routing utilities
 * Handles URL routing for different matchups with query parameters
 * Provides functions for URL generation, parsing, and navigation
 */

import type { Matchup } from '../types/matchup-previews';

// Type guard for browser environment
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Matchup route parameters
 */
export interface MatchupRouteParams {
  matchupId?: string;
  teamId?: string;
  week?: number;
}

/**
 * Parse matchup parameters from URL
 */
export function parseMatchupParams(url: URL): MatchupRouteParams {
  const searchParams = url.searchParams;
  
  const weekParam = searchParams.get('week');
  const weekNumber = weekParam ? parseInt(weekParam, 10) : undefined;
  
  return {
    matchupId: searchParams.get('matchup') || undefined,
    teamId: searchParams.get('team') || undefined,
    week: weekNumber && !isNaN(weekNumber) ? weekNumber : undefined,
  };
}

/**
 * Generate matchup URL with parameters
 */
export function generateMatchupUrl(
  baseUrl: string,
  params: MatchupRouteParams
): string {
  const origin = isBrowser() ? window.location.origin : 'https://example.com';
  const url = new URL(baseUrl, origin);
  
  if (params.matchupId) {
    url.searchParams.set('matchup', params.matchupId);
  }
  
  if (params.teamId) {
    url.searchParams.set('team', params.teamId);
  }
  
  if (params.week) {
    url.searchParams.set('week', params.week.toString());
  }
  
  return url.toString();
}

/**
 * Find matchup by team ID
 */
export function findMatchupByTeamId(
  matchups: Matchup[],
  teamId: string
): Matchup | undefined {
  return matchups.find(matchup => 
    matchup.homeTeam.id === teamId || matchup.awayTeam.id === teamId
  );
}

/**
 * Find matchup by matchup ID
 */
export function findMatchupById(
  matchups: Matchup[],
  matchupId: string
): Matchup | undefined {
  return matchups.find(matchup => matchup.id === matchupId);
}

/**
 * Get default matchup from available matchups
 * Prioritizes by chronological order (earliest games first)
 */
export function getDefaultMatchup(matchups: Matchup[]): Matchup | undefined {
  if (matchups.length === 0) return undefined;
  
  // Sort by earliest game time
  const sorted = matchups.slice().sort((a, b) => {
    const aEarliestGame = a.nflGames.reduce((earliest, game) => 
      !earliest || game.gameTime < earliest ? game.gameTime : earliest, 
      null as Date | null
    );
    const bEarliestGame = b.nflGames.reduce((earliest, game) => 
      !earliest || game.gameTime < earliest ? game.gameTime : earliest, 
      null as Date | null
    );
    
    if (!aEarliestGame && !bEarliestGame) return 0;
    if (!aEarliestGame) return 1;
    if (!bEarliestGame) return -1;
    
    return aEarliestGame.getTime() - bEarliestGame.getTime();
  });
  
  return sorted[0];
}

/**
 * Resolve current matchup from URL parameters and available matchups
 * Follows priority: matchupId > teamId > default
 */
export function resolveCurrentMatchup(
  matchups: Matchup[],
  params: MatchupRouteParams
): Matchup | undefined {
  // First try to find by explicit matchup ID
  if (params.matchupId) {
    const matchup = findMatchupById(matchups, params.matchupId);
    if (matchup) return matchup;
  }
  
  // Then try to find by team ID
  if (params.teamId) {
    const matchup = findMatchupByTeamId(matchups, params.teamId);
    if (matchup) return matchup;
  }
  
  // Fall back to default matchup
  return getDefaultMatchup(matchups);
}

/**
 * Update URL with new matchup parameters
 */
export function updateMatchupUrl(params: MatchupRouteParams): void {
  if (!isBrowser()) return;
  
  const url = new URL(window.location.href);
  
  // Clear existing matchup parameters
  url.searchParams.delete('matchup');
  url.searchParams.delete('team');
  
  // Set new parameters
  if (params.matchupId) {
    url.searchParams.set('matchup', params.matchupId);
  }
  
  if (params.teamId) {
    url.searchParams.set('team', params.teamId);
  }
  
  if (params.week) {
    url.searchParams.set('week', params.week.toString());
  }
  
  // Update URL without page reload
  window.history.replaceState({}, '', url.toString());
}

/**
 * Navigate to matchup with parameters
 */
export function navigateToMatchup(
  baseUrl: string,
  params: MatchupRouteParams
): void {
  if (!isBrowser()) return;
  
  const url = generateMatchupUrl(baseUrl, params);
  window.location.href = url;
}

/**
 * Generate shareable URL for current matchup
 */
export function generateShareableUrl(matchup: Matchup, week: number): string {
  if (!isBrowser()) {
    return `https://example.com/matchup-preview?matchup=${matchup.id}&week=${week}`;
  }
  
  const url = new URL(window.location.href);
  
  // Clear existing parameters and set clean matchup parameters
  url.search = '';
  url.searchParams.set('matchup', matchup.id);
  url.searchParams.set('week', week.toString());
  
  return url.toString();
}

/**
 * Check if URL has matchup parameters
 */
export function hasMatchupParams(url: URL): boolean {
  return url.searchParams.has('matchup') || url.searchParams.has('team');
}

/**
 * Get team ID from matchup for URL generation
 */
export function getTeamIdFromMatchup(matchup: Matchup, preferHome: boolean = true): string {
  return preferHome ? matchup.homeTeam.id : matchup.awayTeam.id;
}

/**
 * Validate matchup parameters
 */
export function validateMatchupParams(params: MatchupRouteParams): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (params.week !== undefined) {
    if (params.week < 1 || params.week > 18) {
      errors.push('Week must be between 1 and 18');
    }
  }
  
  if (params.matchupId !== undefined) {
    if (typeof params.matchupId !== 'string' || params.matchupId.trim() === '') {
      errors.push('Matchup ID must be a non-empty string');
    }
  }
  
  if (params.teamId !== undefined) {
    if (typeof params.teamId !== 'string' || params.teamId.trim() === '') {
      errors.push('Team ID must be a non-empty string');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Create matchup navigation state manager
 */
export class MatchupNavigationState {
  private matchups: Matchup[];
  private currentMatchup: Matchup | undefined;
  private week: number;
  
  constructor(matchups: Matchup[], week: number) {
    this.matchups = matchups;
    this.week = week;
    this.currentMatchup = undefined;
  }
  
  /**
   * Initialize state from URL
   */
  initializeFromUrl(url: URL): Matchup | undefined {
    const params = parseMatchupParams(url);
    this.currentMatchup = resolveCurrentMatchup(this.matchups, params);
    return this.currentMatchup;
  }
  
  /**
   * Switch to a different matchup
   */
  switchToMatchup(matchupId: string): boolean {
    const matchup = findMatchupById(this.matchups, matchupId);
    if (!matchup) return false;
    
    this.currentMatchup = matchup;
    updateMatchupUrl({ matchupId, week: this.week });
    return true;
  }
  
  /**
   * Switch to matchup by team ID
   */
  switchToTeam(teamId: string): boolean {
    const matchup = findMatchupByTeamId(this.matchups, teamId);
    if (!matchup) return false;
    
    this.currentMatchup = matchup;
    updateMatchupUrl({ matchupId: matchup.id, week: this.week });
    return true;
  }
  
  /**
   * Get current matchup
   */
  getCurrentMatchup(): Matchup | undefined {
    return this.currentMatchup;
  }
  
  /**
   * Get all available matchups
   */
  getAvailableMatchups(): Matchup[] {
    return this.matchups;
  }
  
  /**
   * Generate shareable URL for current matchup
   */
  getShareableUrl(): string | undefined {
    if (!this.currentMatchup) return undefined;
    return generateShareableUrl(this.currentMatchup, this.week);
  }
}