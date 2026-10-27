/**
 * The My Team screen — what `GET /api/mfl-live/team?league=<id>` answers the
 * MFL Football app, for any MFL league the signed-in account is in.
 *
 * The owner's roster with each player's slot, injury designation and NFL bye,
 * the cap and contracts when the league uses them, and the draft picks the
 * team holds. MFL data only: no headshots, no NFL logos, no ESPN fields.
 *
 * Every decision is the SERVER's: which slot counts against the cap and by how
 * much (MFL's own `includeIRWithSalary` / `includeTaxiWithSalary`), the order
 * the roster reads in, and what a pick is called. The app renders what it is
 * sent and keeps no copy of the rules.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-team-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/** Which part of the roster MFL files the player in. */
export type MflLiveAppRosterSlot = 'active' | 'ir' | 'taxi';

export interface MflLiveAppRosterPlayer {
  /** MFL player id. */
  id: string;
  /** "First Last"; a team defence reads as its club name. */
  name: string;
  /** Display position: QB, RB, WR, TE, K, DEF, or the league's own (DL, LB…). */
  position: string;
  /** NFL club code as MFL spells it, '' for a free agent in the NFL. */
  nflTeam: string;
  slot: MflLiveAppRosterSlot;
  /**
   * The NFL injury designation (Questionable, Out, IR…), which is NOT the
   * roster slot: a player can sit on the active roster listed Out.
   */
  injury?: { status: string; detail?: string };
  /** The club's NFL bye this season; absent when it is not known yet. */
  byeWeek?: number;
  /** Present only in a league that uses salaries. */
  salary?: number;
  /** Contract years left, present only in a league that uses contract years. */
  contractYears?: number;
  /** MFL's free-text contract note, when the league writes one. */
  contractInfo?: string;
}

export interface MflLiveAppTeamCap {
  /** The league's salary cap. */
  cap: number;
  /**
   * Salary counted against the cap: the active roster in full, IR and taxi at
   * the share the league sets, plus salary adjustments (dead money).
   */
  committed: number;
  /** `cap - committed`; negative when the team is over. */
  room: number;
  /** The adjustments part of `committed`, so the screen can say so. */
  adjustments: number;
}

export interface MflLiveAppDraftPick {
  year: number;
  round: number;
  /** Pick within the round, once MFL has set the order (this year's draft). */
  pick?: number;
  /** Whose pick it was originally, when that is another team. */
  fromTeam?: string;
  /** Ready to print: "2027 Round 1 (from Smokane FC)", "2026 1.04". */
  label: string;
}

export interface MflLiveAppTeamPage {
  ok: true;
  leagueId: string;
  leagueName: string;
  /** The MFL league year the roster belongs to. */
  year: number;
  /** MFL's current week for this league, so a bye this week can be flagged. */
  week?: number;
  franchiseId: string;
  franchiseName: string;
  /** The franchise's own uploaded mark (https), when it has one. */
  icon?: string;
  /** Sorted: active, then IR, then taxi; by position within each. */
  players: MflLiveAppRosterPlayer[];
  /** Null when the league does not use salaries. */
  cap: MflLiveAppTeamCap | null;
  usesContracts: boolean;
  /** MFL's roster limits, when the league sets them. */
  limits: { roster?: number; ir?: number; taxi?: number };
  /** Every pick the team holds, soonest first. */
  picks: MflLiveAppDraftPick[];
  generatedAt: string;
}

/** A refusal or a failed read. `error` is a sentence the screen can show. */
export interface MflLiveAppTeamPageError {
  ok: false;
  error: string;
}

export type MflLiveAppTeamPageResponse = MflLiveAppTeamPage | MflLiveAppTeamPageError;
