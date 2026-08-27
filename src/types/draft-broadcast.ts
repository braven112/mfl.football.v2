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
   * Rank in THIS conference's pre-draft pool — everyone the conference did not
   * keep, ordered by MFL ADP. Undefined for a kept player (he was never on the
   * board) and for anyone MFL lists no ADP for.
   *
   * The league's own ranking sources (`data/ranking-sources/`) are deliberately
   * NOT used or shipped here — Brandon, 2026-08-27: they are not for this
   * screen. MFL ADP is the single input.
   */
  boardRank?: number;
}

/** A player as the broadcast renders him: draft-room fields plus the extras. */
export type BroadcastPlayer = DraftRoomPlayer & BroadcastPlayerExtras;

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
  /**
   * Conference code → most recent season whose board for THAT conference is
   * actually complete. Drives the "Rehearse <year>" link on the idle screen.
   *
   * Keyed per conference, not a single year, because the conference switcher
   * has to stay correct DURING a replay: `duplicatePlayers` lets the two
   * conferences draft and finish independently (in 2025 they ran on separate
   * days), so carrying one conference's replay year onto the other's board can
   * land on a season it never finished — where the replay stalls on the first
   * empty slot and looks exactly like the page being broken. A conference with
   * no complete season is simply absent, and its link goes live instead.
   */
  rehearsalYears?: Record<string, number>;
}
