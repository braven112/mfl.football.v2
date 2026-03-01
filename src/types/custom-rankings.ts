/**
 * Custom Rankings Types
 *
 * Type definitions for the custom player rankings feature.
 * Rankings are stored in Vercel KV (Upstash Redis) keyed by franchise ID.
 */

export type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'DEF';

export interface TierBreak {
  /** Tier break appears after this player in the list */
  afterPlayerId: string;
  /** Optional label, e.g., "Elite", "Starter" */
  label?: string;
  /** How this tier break was created */
  source: 'auto' | 'imported' | 'manual';
}

/**
 * Persisted custom rankings state (stored in Vercel KV).
 * Contains only IDs and overrides — player details are enriched at runtime.
 */
export interface CustomRankingsState {
  version: 1;
  /** ISO 8601 timestamp of last save */
  lastModified: string;
  /** Hash of composite config to detect when imports changed */
  sourceCompositeHash: string;
  /** Player IDs in custom ranked order (overall) */
  rankings: string[];
  /** Player IDs that were manually repositioned by the user */
  overrides: string[];
  /** Tier breaks in the ranking list */
  tiers: TierBreak[];
}

/** Runtime-enriched player data for rendering the ranking list */
export interface RankedPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  /** Original composite rank (for delta display), null if not in composite */
  compositeRank: number | null;
  /** Current rank in the custom list */
  customRank: number;
  /** Whether this player was manually repositioned */
  isOverride: boolean;
  /** VORP points (projected points above replacement), null if unavailable */
  vorpPoints?: number | null;
}

/** Simplified MFL player data passed from Astro page to React */
export interface MFLPlayerBasic {
  id: string;
  name: string;
  position: string;
  team: string;
}
