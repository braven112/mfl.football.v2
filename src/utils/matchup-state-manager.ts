/**
 * Matchup state management utilities
 * Handles client-side state management for matchup switching
 * Provides reactive state updates and event handling
 */

import type { Matchup } from '../types/matchup-previews';
import { MatchupNavigationState, parseMatchupParams, resolveCurrentMatchup } from './matchup-routing';

/**
 * Matchup state change event detail
 */
export interface MatchupStateChangeEvent {
  previousMatchup?: Matchup;
  currentMatchup: Matchup;
  week: number;
  source: 'url' | 'navigation' | 'initialization';
}

/**
 * Matchup state manager configuration
 */
export interface MatchupStateManagerConfig {
  matchups: Matchup[];
  week: number;
  onStateChange?: (event: MatchupStateChangeEvent) => void;
  enableUrlSync?: boolean;
}

/**
 * Client-side matchup state manager
 * Manages current matchup state and provides reactive updates
 */
export class MatchupStateManager {
  private navigationState: MatchupNavigationState;
  private currentMatchup: Matchup | undefined;
  private config: MatchupStateManagerConfig;
  private listeners: Set<(event: MatchupStateChangeEvent) => void>;
  
  constructor(config: MatchupStateManagerConfig) {
    this.config = config;
    this.navigationState = new MatchupNavigationState(config.matchups, config.week);
    this.listeners = new Set();
    
    if (config.onStateChange) {
      this.listeners.add(config.onStateChange);
    }
    
    // Initialize from URL if enabled
    if (config.enableUrlSync !== false) {
      this.initializeFromUrl();
    }
  }
  
  /**
   * Initialize state from current URL
   */
  initializeFromUrl(): void {
    const url = new URL(window.location.href);
    const previousMatchup = this.currentMatchup;
    this.currentMatchup = this.navigationState.initializeFromUrl(url);
    
    if (this.currentMatchup) {
      this.notifyStateChange({
        previousMatchup,
        currentMatchup: this.currentMatchup,
        week: this.config.week,
        source: 'initialization',
      });
    }
  }
  
  /**
   * Switch to a specific matchup
   */
  switchToMatchup(matchupId: string): boolean {
    const previousMatchup = this.currentMatchup;
    const success = this.navigationState.switchToMatchup(matchupId);
    
    if (success) {
      this.currentMatchup = this.navigationState.getCurrentMatchup();
      
      if (this.currentMatchup) {
        this.notifyStateChange({
          previousMatchup,
          currentMatchup: this.currentMatchup,
          week: this.config.week,
          source: 'navigation',
        });
      }
    }
    
    return success;
  }
  
  /**
   * Switch to matchup by team ID
   */
  switchToTeam(teamId: string): boolean {
    const previousMatchup = this.currentMatchup;
    const success = this.navigationState.switchToTeam(teamId);
    
    if (success) {
      this.currentMatchup = this.navigationState.getCurrentMatchup();
      
      if (this.currentMatchup) {
        this.notifyStateChange({
          previousMatchup,
          currentMatchup: this.currentMatchup,
          week: this.config.week,
          source: 'navigation',
        });
      }
    }
    
    return success;
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
    return this.config.matchups;
  }
  
  /**
   * Add state change listener
   */
  addStateChangeListener(listener: (event: MatchupStateChangeEvent) => void): void {
    this.listeners.add(listener);
  }
  
  /**
   * Remove state change listener
   */
  removeStateChangeListener(listener: (event: MatchupStateChangeEvent) => void): void {
    this.listeners.delete(listener);
  }
  
  /**
   * Get shareable URL for current matchup
   */
  getShareableUrl(): string | undefined {
    return this.navigationState.getShareableUrl();
  }
  
  /**
   * Handle browser back/forward navigation
   */
  handlePopState(): void {
    const url = new URL(window.location.href);
    const params = parseMatchupParams(url);
    const newMatchup = resolveCurrentMatchup(this.config.matchups, params);
    
    if (newMatchup && newMatchup.id !== this.currentMatchup?.id) {
      const previousMatchup = this.currentMatchup;
      this.currentMatchup = newMatchup;
      
      this.notifyStateChange({
        previousMatchup,
        currentMatchup: this.currentMatchup,
        week: this.config.week,
        source: 'url',
      });
    }
  }
  
  /**
   * Notify all listeners of state change
   */
  private notifyStateChange(event: MatchupStateChangeEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in matchup state change listener:', error);
      }
    });
  }
  
  /**
   * Destroy the state manager and clean up listeners
   */
  destroy(): void {
    this.listeners.clear();
  }
}

/**
 * Create and initialize a global matchup state manager
 */
export function createMatchupStateManager(config: MatchupStateManagerConfig): MatchupStateManager {
  const manager = new MatchupStateManager(config);
  
  // Set up browser navigation handling
  if (config.enableUrlSync !== false) {
    window.addEventListener('popstate', () => {
      manager.handlePopState();
    });
  }
  
  return manager;
}

/**
 * Dispatch custom matchup change event
 */
export function dispatchMatchupChangeEvent(
  element: Element,
  matchup: Matchup,
  week: number
): void {
  const event = new CustomEvent('matchupchange', {
    detail: {
      matchup,
      week,
      matchupId: matchup.id,
    },
    bubbles: true,
  });
  
  element.dispatchEvent(event);
}

/**
 * Listen for matchup change events
 */
export function onMatchupChange(
  element: Element,
  handler: (event: CustomEvent<{ matchup: Matchup; week: number; matchupId: string }>) => void
): () => void {
  const listener = (event: Event) => {
    handler(event as CustomEvent<{ matchup: Matchup; week: number; matchupId: string }>);
  };
  
  element.addEventListener('matchupchange', listener);
  
  // Return cleanup function
  return () => {
    element.removeEventListener('matchupchange', listener);
  };
}

/**
 * Initialize matchup state management for a page
 */
export function initializeMatchupStatePage(config: MatchupStateManagerConfig): {
  manager: MatchupStateManager;
  cleanup: () => void;
} {
  const manager = createMatchupStateManager(config);
  
  // Set up global event handlers
  const handleMatchupChangeEvent = (event: CustomEvent) => {
    const { matchupId } = event.detail;
    if (matchupId) {
      manager.switchToMatchup(matchupId);
    }
  };
  
  document.addEventListener('matchupchange', handleMatchupChangeEvent as EventListener);
  
  // Cleanup function
  const cleanup = () => {
    document.removeEventListener('matchupchange', handleMatchupChangeEvent as EventListener);
    manager.destroy();
  };
  
  return { manager, cleanup };
}