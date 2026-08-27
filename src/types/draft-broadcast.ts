/**
 * Types for the AFL live draft broadcast board (`/afl-fantasy/draft-broadcast`).
 *
 * Deliberately separate from `draft-room.ts`: the draft room is an interactive
 * tool (queue, chat, filters, submit-pick) and the broadcast is a zero-input
 * display for a TV. They share the DATA layer — `DraftRoomPick`,
 * `DraftRoomTeam`, `DraftRoomPlayer` and the whole `pick-reveal.ts` composite —
 * but nothing about the page shell, so the page-data shapes stay independent.
 */

import type { DraftRoomPick, DraftRoomTeam, DraftRoomPlayer } from './draft-room';

/**
 * Per-player extras the broadcast card shows that the draft room never needed.
 * Joined server-side and shipped with the page — the TV must not depend on a
 * client fetch landing mid-reveal.
 */
export interface BroadcastPlayerExtras {
  /** MFL week-1 projected fantasy points (`projectedScores.json`). */
  projectedPoints?: number;
  /** NFL bye week for the player's pro team this season. */
  byeWeek?: number;
  /** Injury status string from MFL's `injuries.json`, when the player has one. */
  injuryStatus?: string;
  /**
   * Consensus rank across the built-in ranking sources — the median of
   * whichever sources list the player. Median, not mean: one source omitting a
   * player entirely shouldn't drag him, and superflex QB ranks are wild
   * outliers in a 1-QB league.
   */
  consensusRank?: number;
  /** Per-source ranks, in `data/ranking-sources/<year>.json` order. */
  sourceRanks?: { label: string; rank: number }[];
}

/** A player as the broadcast renders him: draft-room fields plus the extras. */
export type BroadcastPlayer = DraftRoomPlayer & BroadcastPlayerExtras;

/** How a selection compares to where the player was going in other drafts. */
export type ValueVerdict = 'steal' | 'reach' | 'on-script' | 'unknown';

/**
 * The value read-out under a revealed player — the single most fun number on
 * the board, and the one the room reacts to out loud.
 */
export interface PickValue {
  verdict: ValueVerdict;
  /**
   * Picks between the selection and the player's average draft position.
   * Positive = taken LATER than ADP (a steal). Always absolute in the label;
   * the sign lives in `verdict`.
   */
  delta: number;
  /** The ADP this was measured against, for the fine print. */
  adp?: number;
}

/** One conference's board. The AFL drafts two of these independently. */
export interface BroadcastConference {
  /** Config code — "00" (American) / "01" (National). */
  code: string;
  /** Display name, e.g. "American League". */
  name: string;
  /** MFL draft unit id, e.g. "CONFERENCE00". */
  unit: string;
}

/** Data serialized from Astro frontmatter into the broadcast island. */
export interface DraftBroadcastPageData {
  leagueYear: number;
  conference: BroadcastConference;
  totalRounds: number;
  picksPerRound: number;
  teams: DraftRoomTeam[];
  /** Full board skeleton — every slot, filled or not, in draft order. */
  picks: DraftRoomPick[];
  /** Only players who could plausibly be drafted, to keep the payload sane. */
  players: BroadcastPlayer[];
  /** MFL league id + host for the poll URL. Registry-derived, never literal. */
  leagueId: string;
  mflHost: string;
  /**
   * Replay the board up to this pick and reveal each one as it "lands".
   * Rehearsal only — the real board is empty until draft night, so this is the
   * only way to see the page work before the room fills up.
   */
  rehearseUpTo?: number;
}
