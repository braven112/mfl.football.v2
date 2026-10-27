/**
 * The Players tab and the player card — what `/api/mfl-live/players` and
 * `/api/mfl-live/player` answer the MFL Football app (package K).
 *
 * Every number here is MFL's own, read for ONE league with the owner's own
 * cookie: a projection or a season total belongs to a player IN A LEAGUE,
 * because the same back is worth different points under two rule sets. The
 * two exceptions are MFL-wide and say so: `ownedPct` and `addedPct` come from
 * MFL's "top owned" and "top adds" lists across every league it hosts.
 *
 * Store rules: MFL data only. No headshots, no NFL club marks or colours —
 * `team` is the club's text code and nothing more.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-k-contract.ts` asserts the server stays assignable.
 */

/** Which players the list holds. */
export type MflLiveAppPlayersStatus = 'fa' | 'all' | 'trending';

/** How the list is ordered, highest first. */
export type MflLiveAppPlayersSort = 'proj' | 'pts' | 'owned';

/** A franchise in the league, as the card and list name it. */
export interface MflLiveAppPlayerOwner {
  franchiseId: string;
  name: string;
}

export interface MflLiveAppPlayerSummary {
  /** MFL player id. */
  id: string;
  /** "First Last", or the club name for a team defense. */
  name: string;
  /** MFL's position code: QB, RB, WR, TE, PK, Def, DL, LB, DB, … */
  position: string;
  /** NFL club code ("KC"), or "FA" for a player with no club. Text only. */
  team: string;
  /** The club's bye week this season, or null when MFL has none on file. */
  bye: number | null;
  /** MFL's injury status ("Questionable", "Out", "IR", …), or null when healthy. */
  injury: string | null;
  /** This week's projection under this league's scoring, or null when MFL has none. */
  projected: number | null;
  /** Season-to-date points under this league's scoring, or null when none scored. */
  points: number | null;
  /** Percent of MFL leagues rostering him, MFL-wide; null when he is off MFL's list. */
  ownedPct: number | null;
  /** Percent of MFL leagues that added him this week, MFL-wide; null when off the list. */
  addedPct: number | null;
  /**
   * Who rosters him in THIS league. Empty for a free agent. More than one only
   * in a league whose units each hold their own copy of a player.
   */
  owners: MflLiveAppPlayerOwner[];
  /** Free to add for the account's own team (MFL's free-agent list for its unit). */
  isFreeAgent: boolean;
}

export interface MflLiveAppPlayersResponse {
  ok: true;
  leagueId: string;
  /** The NFL week `projected` is for; 0 outside the season. */
  week: number;
  status: MflLiveAppPlayersStatus;
  sort: MflLiveAppPlayersSort;
  /** The positions this league starts, in roster order, for the filter chips. */
  positions: string[];
  /** Players matching the filter before `limit` cut the list. */
  total: number;
  players: MflLiveAppPlayerSummary[];
}

/** One week's points for the card. */
export interface MflLiveAppPlayerWeek {
  week: number;
  points: number;
}

export interface MflLiveAppPlayerCardResponse {
  ok: true;
  leagueId: string;
  week: number;
  player: MflLiveAppPlayerSummary;
  /** MFL's injury detail when he has one. */
  injuryDetail: { status: string; bodyPart: string | null; expectedReturn: string | null } | null;
  /** Every scored week this season under this league's rules, newest first. */
  weeks: MflLiveAppPlayerWeek[];
}
