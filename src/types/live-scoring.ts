/**
 * Live Scoring Hero Types
 *
 * Shared types for the LiveScoringHero React island and its backing API.
 */

import type { GameWindow, SeasonPhase } from './hero-state';

/** A matchup pairing: two franchise IDs playing each other */
export interface MatchupPairing {
  home: string; // franchiseId
  away: string; // franchiseId
}

/** Team display info passed from server to React island */
export interface TeamInfo {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  color: string;
  icon?: string;
}

/** Props passed from Astro to the LiveScoringHero React island */
export interface LiveScoringHeroProps {
  week: number;
  phase: Extract<SeasonPhase, 'regular-season' | 'playoffs' | 'championship'>;
  gameWindow: GameWindow;
  isLive: boolean;
  userFranchiseId?: string;
  matchups: MatchupPairing[];
  teams: Record<string, TeamInfo>;
  initialScores?: Record<string, number>;
  initialRemaining?: Record<string, number>;
}

/** API response from /api/live-scoring (enhanced with matchup pairings) */
export interface LiveScoringResponse {
  week: number;
  scores: Record<string, number>;
  remaining: Record<string, number>;
  matchups: MatchupPairing[];
}
