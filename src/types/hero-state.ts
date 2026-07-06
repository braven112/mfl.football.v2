/**
 * Hero State Machine Types
 *
 * Defines the state machine output for the context-aware hero system.
 * The hero resolver determines which SeasonPhase and DailySlot to display
 * based on the current date, time of day (PT), and day of week.
 */

import type { HeroContent } from './whats-new';
import type { LeagueEventView } from '../utils/league-event-hero-view';
import type { PlayoffRoundView } from '../utils/hero-data/playoff-round-data';

/** The 14 season phases that drive hero selection */
export type SeasonPhase =
  | 'championship'        // Week 17 Thu → Mon night final
  | 'breaking-story'      // A fresh (<48h) trade/auction bomb from the feed takes the homepage
  | 'champion-crowned'    // Championship decided → +7 days
  | 'tag-window'          // After champion crowned → Feb 14
  | 'tagged-showcase'     // Feb 15 → auction hero start
  | 'auction-preview'     // Mon before 3rd Thu Mar → Thu 7am PT
  | 'auction-live'        // 3rd Thu Mar 7am PT → +10 days
  | 'draft-countdown'     // Auction Hero end → Draft Hero start (rookie scouting lull)
  | 'draft-announced'     // Mon after NFL Draft → rookie draft starts
  | 'draft-live'          // Rookie draft start → draft completes
  | 'udfa-window'         // Draft completes → +7 days
  | 'cut-watch'           // Jun 1 → 3rd Sun of Aug (early=P3 ambient, final 30d=P1 urgent)
  | 'preseason-countdown' // FA close → NFL kickoff
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
  | 'article'            // Schefter articles (waiver pickups, weekend preview)
  | 'game-day-preview';  // Saturday, Sunday pre-game

/** Which NFL game window is active */
export type GameWindow = 'tnf' | 'sunday' | 'snf' | 'mnf' | null;

/** Hero priority level */
export type HeroPriority = 'P0++' | 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

/** A single game in the compact bracket summary for the playoff hero */
export interface PlayoffBracketSummaryGame {
  gameId: string;
  roundWeek: number;
  home: { franchiseId?: string; seed?: number; displayName: string; icon?: string; points?: number };
  away: { franchiseId?: string; seed?: number; displayName: string; icon?: string; points?: number };
  isComplete: boolean;
}

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
  /** Branded LeagueEventHero view — set on offseason-fallback states. */
  eventView?: LeagueEventView;
  /** Whether the branded event hero draws its accent border (calendar events only). */
  eventBordered?: boolean;
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
    winnerGroupMeIcon: string;
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
      /** Short franchise name (nameShort → nameMedium → name) for compact UI. */
      franchiseNameShort: string;
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
    /** True in the final 30 days before the deadline — drives the urgent (red) tier. */
    urgent: boolean;
  };
  /** Preseason countdown props (only when phase is 'preseason-countdown') */
  preseasonProps?: {
    /** Formatted NFL kickoff date, e.g. "Thu, Sep 10". */
    kickoffDate: string;
    /** Whole days from the reference date to kickoff. */
    daysUntilKickoff: number;
  };
  /** Draft countdown props (only when phase is 'draft-countdown') */
  draftCountdownProps?: {
    /** Formatted NFL Draft date, e.g. "Thu, Apr 23". */
    nflDraftDate: string;
    /** Whole days from the reference date to the NFL Draft (clamped at 0). */
    daysUntilDraft: number;
  };
  /** Trade deadline props (only when phase is 'trade-deadline') */
  tradeDeadlineProps?: {
    /** ISO string for midnight PT cutoff — used by client-side countdown */
    deadlineMidnightPT: string;
  };
  /** Playoff bracket props (only when phase is 'playoffs' and slot is 'standings') */
  playoffProps?: {
    leagueYear: number;
    userFranchiseId?: string;
    userIsEliminated?: boolean;
    bracketSummary: PlayoffBracketSummaryGame[];
    /** "Player to Watch" accent — the top remaining seed's headliner. */
    watchModel?: { name: string; position: string; nflTeam: string; headshot: string; teamPrimary: string } | null;
    /**
     * The current playoff round resolved to the round-hero shape (wild card /
     * semifinals / championship). When present, SeasonDailyHero renders the
     * composite round hero; otherwise it falls back to the legacy bracket list.
     */
    roundView?: PlayoffRoundView | null;
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
