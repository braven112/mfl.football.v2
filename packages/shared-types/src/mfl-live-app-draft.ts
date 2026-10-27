/**
 * The MFL Football app's draft room — the wire contract for
 * `GET /api/mfl-live/draft?league=` (the board, who is on the clock and your
 * queue) and `GET /api/mfl-live/draft-pool?league=` (the players still on the
 * board). Package R, /mnt/project-files/mfl-live-app/parallel-work-packages.md.
 *
 * Works for ANY MFL league the account is in. Three things the shape carries
 * because real leagues need them (docs/plans/draft-hub-and-results.md):
 *
 * - Rounds are NOT all the same size (TheLeague's are 16, 17 and 18 picks), so
 *   every pick carries its own `overall` number and nothing here assumes a
 *   fixed stride.
 * - A league that drafts by conference (the AFL) has more than one board. The
 *   room shows the board YOUR team picks on, named in `unit`.
 * - `----` in MFL's feed is a pick the commissioner skipped, not a player.
 *
 * Store-safe: MFL data only. No headshots, no ESPN ids, no NFL marks.
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-draft-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/** How the league drafts, from MFL's `draft_kind`. */
export type MflLiveAppDraftKind =
  /** Everyone in MFL's live draft room at once, on a short clock. */
  | 'live'
  /** A slow draft: each owner picks when it's their turn, on a clock of hours. */
  | 'email'
  /** Bidding rather than picking. The app's room doesn't run these yet. */
  | 'auction'
  /** MFL did not say, or the league has no draft set up. */
  | 'unknown';

/**
 * Where the draft is.
 * - `not-set`: MFL has no pick order for this year yet.
 * - `upcoming`: the order is set and nobody has picked.
 * - `live`: at least one pick made, at least one left.
 * - `complete`: every pick made.
 */
export type MflLiveAppDraftStatus = 'not-set' | 'upcoming' | 'live' | 'complete';

/** A player as the draft room shows one. */
export interface MflLiveAppDraftPlayer {
  /** MFL player id. */
  id: string;
  /** "First Last". `Player <id>` when MFL could not name him. */
  name: string;
  /** QB, RB, WR, TE, PK, DEF, or an IDP position. */
  position: string;
  /** NFL club code as text, '' for a free agent. Never drawn as a logo. */
  nflTeam: string;
  /** A rookie in this year's NFL draft class, when the room knows. */
  rookie?: boolean;
}

/** One slot on the board, made or not. */
export interface MflLiveAppDraftSlot {
  /** 1-based, counted through every round's real size. */
  overall: number;
  round: number;
  /** Pick within the round, 1-based. */
  pick: number;
  /** "1.01" — round, then pick padded to two digits. */
  label: string;
  /** The team that holds this pick. */
  franchiseId: string;
  /** The team this pick was traded from, when MFL recorded a trade. */
  fromTeam?: string;
  /** Who was picked. Absent while the pick is still to make. */
  player?: MflLiveAppDraftPlayer;
  /** The commissioner skipped this pick. */
  skipped?: boolean;
  /** When it was made, ISO 8601. */
  madeAt?: string;
}

/** One team in the draft. */
export interface MflLiveAppDraftTeam {
  franchiseId: string;
  name: string;
}

export interface MflLiveAppDraftOnClock {
  /** The slot being picked now. */
  overall: number;
  label: string;
  franchiseId: string;
  /** True when it is the signed-in owner's team. */
  mine: boolean;
  /**
   * When the clock started, ISO 8601: the moment the pick before it was made.
   * Absent for the draft's first pick, whose start MFL doesn't publish.
   */
  since?: string;
}

export interface MflLiveAppDraftRoom {
  ok: true;
  leagueId: string;
  leagueName: string;
  year: number;
  /** The owner's team in this league — the one the room picks for. */
  franchiseId: string;
  kind: MflLiveAppDraftKind;
  status: MflLiveAppDraftStatus;
  /**
   * MFL's name for the board shown (`LEAGUE`, or `CONFERENCE00` /
   * `CONFERENCE01` in a league that drafts by conference).
   */
  unit?: string;
  /** "Rookies only", "Veterans only" or "Rookies and veterans", when MFL says. */
  pool?: string;
  /** The time each pick gets, in words ("12 hours a pick"), when MFL says. */
  pickClock?: string;
  rounds: number;
  teams: MflLiveAppDraftTeam[];
  /** Every slot, in draft order. */
  slots: MflLiveAppDraftSlot[];
  onClock?: MflLiveAppDraftOnClock;
  /** Your next unmade pick, and how many picks until it. */
  myNextPick?: { overall: number; label: string; picksAway: number };
  /**
   * Your MFL pre-draft list, in order, with players already taken removed.
   * MFL picks from it for you when your clock runs out (its feed then says
   * "Pick made from Pre-Draft List"). `null` when MFL would not give us your
   * list just now, which is not the same as an empty one.
   */
  queue: MflLiveAppDraftPlayer[] | null;
  /** When the server read the board, ISO 8601. */
  generatedAt: string;
  /**
   * How long the app should wait before reading the board again: seconds
   * while a live draft is running, a minute or more otherwise.
   */
  pollAfterMs: number;
}

/** One player still available to draft. */
export interface MflLiveAppDraftPoolPlayer extends MflLiveAppDraftPlayer {
  /** Where MFL's average draft position ranks him, 1 = first. */
  adpRank?: number;
}

export interface MflLiveAppDraftPool {
  ok: true;
  leagueId: string;
  /** Best first: by ADP, then position, then name. */
  players: MflLiveAppDraftPoolPlayer[];
  /** True when the league's pool is rookies only and this list was narrowed to them. */
  rookiesOnly: boolean;
  generatedAt: string;
}

export type MflLiveAppDraftError = { ok: false; error: string };
