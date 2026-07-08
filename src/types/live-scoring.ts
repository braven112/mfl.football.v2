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

/** A player's live NFL game state, derived from remaining game-seconds. */
export type NflGameState = 'not-started' | 'in-progress' | 'final';

/**
 * Live, per-poll player data from /api/live-scoring — the numbers that change
 * during games. Static identity (name, headshot, projection) is merged in on
 * the client from PlayerMeta, keyed by `id`.
 */
export interface LivePlayerRow {
  /** MFL player id. */
  id: string;
  /** Current live fantasy points. */
  live: number;
  /** NFL game-seconds still to be played (0 = final). */
  secondsRemaining: number;
  /** 'starter' | 'nonstarter' from the MFL liveScoring feed. */
  status: string;
}

/**
 * Static, per-player identity + projection resolved server-side (page load)
 * and merged onto LivePlayerRow by id on the client. Does not change during a
 * game, so it is passed once as a prop rather than re-fetched each poll.
 */
export interface PlayerMeta {
  id: string;
  name: string;
  position: string;
  /** ESPN-format NFL team code (KC, WSH, …). */
  nflTeam: string;
  headshot: string;
  espnId: string | null;
  /** Full-game league projection for the active week (0 if unavailable). */
  projected: number;
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
  /** Per-franchise starter rows (live points + remaining game-time). */
  players?: Record<string, LivePlayerRow[]>;
  /** Per-franchise count of starters whose NFL game hasn't started. */
  playersYetToPlay?: Record<string, number>;
}

/**
 * Props for the standalone live-scoring page island (progressive scoreboard →
 * matchup detail). Carries the static context; live numbers arrive via polling.
 */
export interface LiveScoringPageProps {
  week: number;
  year: number;
  /** MFL league id + host so the island can poll the right league. */
  leagueId: string;
  host: string;
  /** Canonical league slug (drives per-league theming / labels). */
  slug: string;
  isLive: boolean;
  gameWindow: GameWindow;
  userFranchiseId?: string;
  matchups: MatchupPairing[];
  teams: Record<string, TeamInfo>;
  /** Static identity + projection for every starter, keyed by MFL player id. */
  playerMeta: Record<string, PlayerMeta>;
  initialScores?: Record<string, number>;
  initialRemaining?: Record<string, number>;
  initialPlayers?: Record<string, LivePlayerRow[]>;
  initialYetToPlay?: Record<string, number>;
}
