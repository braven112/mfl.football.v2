/**
 * Hero State Machine Types
 *
 * Defines the state machine output for the context-aware hero system.
 * The hero resolver determines which SeasonPhase and DailySlot to display
 * based on the current date, time of day (PT), and day of week.
 */

import type { HeroContent } from './whats-new';

/** The 14 season phases that drive hero selection */
export type SeasonPhase =
  | 'championship'        // Week 17 Thu → Mon night final
  | 'champion-crowned'    // Championship decided → +7 days
  | 'tag-window'          // After champion crowned → Feb 14
  | 'tagged-showcase'     // Feb 15 → auction hero start
  | 'auction-preview'     // Mon before 3rd Thu Mar → Thu 7am PT
  | 'auction-live'        // 3rd Thu Mar 7am PT → +10 days
  | 'draft-announced'     // Mon after NFL Draft → rookie draft starts
  | 'draft-live'          // Rookie draft start → draft completes
  | 'udfa-window'         // Draft completes → +7 days
  | 'cut-watch'           // ~Jul 15 → Aug 16
  | 'regular-season'      // NFL kickoff → end of Week 14
  | 'trade-deadline'      // Nov 13 (24h override)
  | 'playoffs'            // Week 15 → Week 16
  | 'offseason-fallback'; // Any gap not covered by above

/** Daily rotation slots for regular-season and playoff phases */
export type DailySlot =
  | 'live-scoring'       // TNF, Sunday, MNF game windows
  | 'standings'          // Monday pre-game
  | 'recap'              // Tuesday AM
  | 'waiver-wire'        // Tuesday PM → Wednesday 8pm
  | 'article'            // Scheftner articles (waiver pickups, weekend preview)
  | 'game-day-preview';  // Saturday, Sunday pre-game

/** Which NFL game window is active */
export type GameWindow = 'tnf' | 'sunday' | 'snf' | 'mnf' | null;

/** Hero priority level */
export type HeroPriority = 'P0++' | 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

/** The fully resolved hero state passed from page frontmatter to SeasonDailyHero */
export interface HeroState {
  /** Current season phase */
  phase: SeasonPhase;
  /** Daily slot (only set when phase is 'regular-season' or 'playoffs') */
  slot?: DailySlot;
  /** Priority level that matched */
  priority: HeroPriority;
  /** Fallback hero content for phases that delegate to HeroBanner */
  fallbackHero?: HeroContent;
  /** Auction-specific props (only when phase is 'auction-preview' or 'auction-live') */
  auctionProps?: {
    live: boolean;
    leagueYear: number;
  };
  /** Draft-specific props (only when phase is 'draft-announced' or 'draft-live') */
  draftProps?: {
    live: boolean;
    leagueYear: number;
    draftStartFormatted: string;
  };
  /** Champion-specific props (only when phase is 'champion-crowned') */
  championProps?: {
    winnerFranchiseId: string;
    winnerName: string;
    winnerIcon: string;
    winnerColor: string;
    loserFranchiseId: string;
    loserName: string;
    winnerScore: number;
    loserScore: number;
    leagueYear: number;
  };
  /** Tagged player showcase props (only when phase is 'tagged-showcase') */
  taggedShowcaseProps?: {
    taggedPlayers: Array<{
      playerId: string;
      playerName: string;
      position: string;
      nflTeam: string;
      headshot: string;
      franchiseId: string;
      franchiseName: string;
      franchiseIcon: string;
    }>;
  };
  /** Cut watch props (only when phase is 'cut-watch') */
  cutWatchProps?: {
    overLimitTeams: Array<{
      franchiseId: string;
      franchiseName: string;
      franchiseIcon: string;
      activeCount: number;
      cutCandidates: Array<{
        playerId: string;
        playerName: string;
        position: string;
        salary: number;
      }>;
    }>;
    deadlineDate: string;
    daysUntilDeadline: number;
  };
  /** Metadata for debugging and display */
  metadata: {
    /** NFL week number (1-17) */
    week?: number;
    /** Which game window is active */
    gameWindow: GameWindow;
    /** Is a game currently in progress */
    isLive: boolean;
    /** The effective date used for resolution */
    referenceDate: Date;
    /** Whether ?testDate was used */
    testMode: boolean;
    /** Which resolver rule matched (for debugging) */
    resolvedBy: string;
  };
}
