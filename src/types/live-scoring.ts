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
  /** Vibrant chart color (3rd-choice fallback for the predictor chart). */
  color: string;
  /** Brand primary — the predictor chart's home color / away 1st choice. */
  colorPrimary?: string;
  /** Brand secondary — the predictor chart's away 2nd choice. */
  colorSecondary?: string;
  /** Dark-mode brand primary — used in place of `colorPrimary` on dark surfaces. */
  colorPrimaryDark?: string;
  /** Dark-mode brand secondary — used in place of `colorSecondary` on dark surfaces. */
  colorSecondaryDark?: string;
  icon?: string;
  banner?: string;
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

/**
 * Live drive state for a game that is actually being played.
 *
 * ESPN attaches this ONLY while a game is in progress — it is absent before
 * kickoff and after the final whistle, which is normal and not an error.
 */
export interface NflGameSituation {
  /**
   * True when the POSSESSING team has the ball inside the 20. It belongs to
   * whoever has the ball, so any UI keyed on it must first check `possession`
   * against the player's own NFL team — otherwise a receiver gets a red-zone
   * flag while his team is on defense.
   */
  isRedZone: boolean;
  /** Canonical code of the team with the ball; '' when ESPN omits it. */
  possession: string;
  /** e.g. "1st & Goal at WSH 8". Empty when absent. */
  downDistanceText: string;
  /** e.g. "1st & Goal" — the narrow-width form. Empty when absent. */
  shortDownDistanceText: string;
  /** Narration of the most recent play. Empty when absent. */
  lastPlay: string;
}

/** A real NFL game from the ESPN scoreboard (powers the NFL games strip). */
export interface NflGame {
  id: string;
  /** 'pre' (not started), 'in' (live), 'post' (final). */
  state: 'pre' | 'in' | 'post';
  /** ESPN short detail, e.g. "8:12 - 3rd", "Final", "Sun 1:00 PM ET". */
  shortDetail: string;
  period: number;
  clock: string;
  home: { code: string; score: number };
  away: { code: string; score: number };
  /** Team code with possession during a live game, else null. */
  possession: string | null;
  date: string;
  /** Present only while the game is being played; see NflGameSituation. */
  situation?: NflGameSituation | null;
}


/**
 * Which ESPN slate a route actually fetched. `overridden` is true when the
 * validation query params (?espnSeason/?espnWeek/?espnYear) pointed it
 * somewhere other than the page's own week — the UI badges that, because a
 * board quietly showing a different week's NFL games than its header claims
 * would be worse than having no override at all.
 */
export interface EspnSlotInfo {
  /** 1 = preseason, 2 = regular season, 3 = postseason. */
  seasonType: 1 | 2 | 3;
  week: number;
  year: number;
  overridden: boolean;
}

/** API response from /api/nfl-scoreboard. */
export interface NflScoreboardResponse {
  /**
   * False when the upstream ESPN request failed. An empty `games` with
   * `ok: true` is a healthy off-day; `ok: false` is an outage, and the two
   * must not render the same way.
   */
  ok?: boolean;
  week: number;
  games: NflGame[];
  /** What we actually asked ESPN for; flags an active validation override. */
  espnSlot?: EspnSlotInfo;
}

/**
 * A starter's real NFL box-score line, keyed by MFL player id.
 *
 * `statLine` is EMPTY when the player has a box-score entry but nothing worth
 * printing yet (no touches). A player missing from the map entirely has no
 * entry at all. Neither means the fetch failed — that is
 * `NflGameDetailResponse.ok`.
 */
export interface PlayerBoxScore {
  playerId: string;
  /** Canonical NFL team code the box score listed him under. */
  nflTeam: string;
  /** Compact line, e.g. "5 rec (8 tgt), 64 yds, 1 TD". '' = no touches yet. */
  statLine: string;
  /** ESPN event id of the game the line came from. */
  gameId: string;
}

/**
 * A real, athlete-attributed scoring play. Replaces the old Moments feed,
 * which inferred a "delta" by diffing fantasy points between two 60s polls and
 * invented the clock it displayed alongside it.
 */
export interface LiveScoringPlay {
  playId: string;
  gameId: string;
  /** ESPN's play ordering within the game. */
  sequence: number;
  period: number;
  /** Game clock at the play, e.g. "11:49". */
  clock: string;
  /** ESPN's one-line summary of the play. */
  text: string;
  /** TD, FG, SF… Empty when ESPN omits it. */
  typeAbbrev: string;
  typeText: string;
  /** Canonical code of the scoring team. */
  nflTeam: string;
  scoreValue: number;
  /**
   * MFL player ids credited on the play. Empty when nobody on the play is in
   * our player feed (an offensive lineman, or a defense). Resolved server-side
   * from PlayerIdentity.nflEspnId — never from PlayerMeta.espnId, which can
   * hold a college athlete id.
   */
  playerIds: string[];
}

/** API response from /api/nfl-game-detail. */
export interface NflGameDetailResponse {
  /** Did this route get a usable read? Distinct from "is there any data". */
  ok: boolean;
  week: number;
  year: number;
  fetchedAt: string;
  /** Keyed by MFL player id. */
  boxScore: Record<string, PlayerBoxScore>;
  plays: LiveScoringPlay[];
  /** Games we tried to expand, and how many came back complete. Partial is normal. */
  gamesRequested: number;
  gamesLoaded: number;
  /** What we actually asked ESPN for; flags an active validation override. */
  espnSlot?: EspnSlotInfo;
}

/** API response from /api/live-scoring (enhanced with matchup pairings) */
export interface LiveScoringResponse {
  /** False when the upstream MFL liveScoring request failed (route still 200s). */
  ok?: boolean;
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
  /** Demo/sample mode (?demo=1): render bundled sample data, no polling. */
  demo?: boolean;
  /**
   * Demo variant that keeps the ESPN pollers RUNNING (?demo=live): the fantasy
   * side is a sample built from real current rosters, while the NFL side —
   * clocks, red zone, box scores, scoring plays — is genuinely live. Without
   * this, `demo` disables both pollers and the whole point is lost.
   */
  demoLiveNfl?: boolean;
  /** Badge text for demo mode; defaults to "Sample data". */
  demoLabel?: string;
  /** Sample NFL games for the strip in demo mode (skips the live fetch). */
  initialNflGames?: NflGame[];
  /** Sample box scores + scoring plays for demo mode. */
  initialDetail?: LiveScoringDemoDetail;
}

/** Sample scoring plays for demo mode (skips the live /api/nfl-game-detail fetch). */
export interface LiveScoringDemoDetail {
  boxScore: Record<string, PlayerBoxScore>;
  plays: LiveScoringPlay[];
}
