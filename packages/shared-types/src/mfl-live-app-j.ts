/**
 * Set Lineup in the MFL Football app (package J) — what
 * `GET /api/mfl-live/lineup?league=<id>&week=<n>` answers, and what
 * `POST /api/mfl-live/lineup?league=<id>` takes and returns.
 *
 * Every judgement is made on the server with the site's own functions and
 * shipped as an answer: which slots a player may fill, whether his game has
 * locked, whether he is ruled out or on bye, and above all what the slots
 * MEAN (`mode`). The phone only moves players between slots and re-reads the
 * per-player flags; it keeps no second copy of the lineup rules.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-j-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/**
 * What the slots represent. "No lineup on file" (`unsaved-offer`) and "we
 * couldn't read it" (`read-failed`) are deliberately different: treating the
 * second as the first would let one tap overwrite the lineup the owner
 * really had (docs/claude/rules/lineups.md).
 */
export type MflLiveAppLineupMode =
  /** MFL holds a lineup and these are it. */
  | 'saved'
  /** A saved lineup, but some of its starters are no longer on the roster. */
  | 'saved-partial'
  /** A saved lineup read from our daily copy, possibly not today's edit. */
  | 'saved-from-cache'
  /** Nothing on file and the week is open: the slots are a suggestion. */
  | 'unsaved-offer'
  /** We could not read MFL's record. Nothing may be submitted. */
  | 'read-failed'
  /** A played week that never had a lineup. Read only. */
  | 'past-unset'
  /** MFL's season has no such week. */
  | 'week-unscheduled'
  /** MFL doesn't list this team that week (a playoff bye). */
  | 'franchise-unlisted';

export interface MflLiveAppLineupPlayer {
  id: string;
  name: string;
  /** MFL position, normalized (`PK`, `DEF`; IDP positions as MFL names them). */
  position: string;
  /** MFL's team code, as text. Never an NFL logo. */
  nflTeam: string;
  /** MFL's roster bucket: `ROSTER`, `TAXI_SQUAD`, `INJURED_RESERVE`. */
  rosterStatus: string;
  /** Active roster: only these may start. */
  canStart: boolean;
  /** The slot types (`QB`, `FLEX`, …) he may fill in this league. */
  slots: string[];
  /**
   * The league's full-game projection for the week: the SAME number the
   * Matchups tab uses (one loader on the server). Null when MFL has none.
   */
  projection: number | null;
  /** Points scored so far this week, from MFL's live scoring; null before the week is scored. */
  live: number | null;
  /** Live points plus the projection for the game time left (= `live` once final), as Matchups shows it. */
  projectedFinal: number | null;
  /** MFL's clock for his NFL game; null on bye or when unknown. */
  gameState: 'not-started' | 'in-progress' | 'final' | null;
  /** His NFL opponent this week, as text: `vs LV` at home, `@ LV` away. Null on bye. */
  opponent: string | null;
  /** MFL injury designation (`Questionable`, `Out`, `IR`, …), or null. */
  injury: string | null;
  /** Ruled out for the week (Out, IR, Suspended). */
  out: boolean;
  isBye: boolean;
  /** His game's kickoff, epoch seconds; null on bye or when unknown. */
  kickoff: number | null;
  /** His game has kicked off: he can't be moved in or out. */
  locked: boolean;
}

export interface MflLiveAppLineupSlot {
  /** Slot type, e.g. `QB` or `FLEX`. */
  position: string;
  playerId: string | null;
  locked: boolean;
}

export interface MflLiveAppLineupProblem {
  kind: 'ir-violation' | 'empty-slot' | 'bye' | 'out';
  /** `blocking`: MFL will refuse the lineup. `warning`: it saves but scores less. */
  severity: 'blocking' | 'warning';
  slotIndex?: number;
  playerId?: string;
  title: string;
  detail: string;
}

/** One side's numbers in a fantasy matchup, exactly as the Matchups tab shows them. */
export interface MflLiveAppLineupSide {
  live: number;
  projectedFinal: number;
  /** Starters whose NFL game hasn't kicked off. */
  yetToPlay: number;
}

/**
 * One of this week's fantasy games. A double-header week has two, scored off
 * one lineup. The numbers are for the lineup MFL HAS (the saved one); an
 * edited lineup's total is the sum of its starters' `projectedFinal`.
 */
export interface MflLiveAppLineupMatchup {
  opponentId: string;
  opponentName: string;
  isHome: boolean;
  mine: MflLiveAppLineupSide;
  opponent: MflLiveAppLineupSide;
  /** Your chance to win, 0-1, the same model the Matchups tab uses. */
  winProbability: number | null;
}

export interface MflLiveAppLineup {
  leagueId: string;
  leagueName: string;
  franchiseId: string;
  franchiseName: string;
  year: number;
  week: number;
  /** The NFL week in progress, for the week picker. */
  currentWeek: number;
  /**
   * False when this league's starter rules can't be read or laid out; the
   * screen then explains instead of offering slots that MFL would refuse.
   */
  supported: boolean;
  /** How many players start; every submit sends exactly this many. */
  starterCount: number;
  /** One entry per slot, in display order, seeded with the lineup to show. */
  slots: MflLiveAppLineupSlot[];
  /** The most of each position that may start, across every slot. */
  positionMax: Record<string, number>;
  /** The whole roster, starters and bench. */
  players: MflLiveAppLineupPlayer[];
  mode: MflLiveAppLineupMode;
  /** May the owner submit after editing? */
  canSubmit: boolean;
  /** May the untouched suggestion be submitted as is? */
  canSubmitUnsaved: boolean;
  /** Is the suggestion ordered by projection (false: roster order)? */
  fillIsProjected: boolean;
  /** Problems with the lineup as shipped; blocking ones first. */
  problems: MflLiveAppLineupProblem[];
  /**
   * The NFL season is being played (Labor Day + 3 onward, never
   * `month >= 9`). The who's-out warning shows only while this is true.
   */
  inSeason: boolean;
  /** The week's first kickoff, epoch seconds, or null when unknown. */
  firstKickoff: number | null;
  /** This week's fantasy games; empty when MFL lists none (a bye) or live scoring couldn't be read. */
  matchups: MflLiveAppLineupMatchup[];
  /** MFL is scoring this week right now (games under way or played). */
  scoring: boolean;
}

export interface MflLiveAppLineupSubmit {
  week: number;
  /** Exactly `starterCount` MFL player ids. */
  starters: string[];
}

export type MflLiveAppLineupSubmitResponse =
  | { success: true; message: string }
  | {
      success?: false;
      error: string;
      /** `ir-violation`: retrying can't work until the roster changes. */
      reason?: 'ir-violation';
      /** MFL's own page for the fix. */
      fixUrl?: string;
    };
