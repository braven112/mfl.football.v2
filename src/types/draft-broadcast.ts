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
 * One marquee NFL defender standing in for a team defense on the reveal card.
 *
 * A DEF "player" is a crest, not a person, so a team-defense pick would
 * otherwise reveal with an empty figure column. Same ranked pool the Free
 * Agents hero spotlight and the player modal already draw from
 * (`src/data/theleague/def-spotlight-players.ts`), resolved SERVER-side —
 * importing that 20 KB map into the island would put all 32 teams' pools on
 * the wire to use one, and the TV must not wait on a fetch mid-reveal.
 */
export interface BroadcastDefenseFace {
  name: string;
  /** ESPN athlete id — the headshot URL is built from it client-side. */
  espnId: string;
  /** Real NFL position (DT/LB/CB/S…), shown beside the name. */
  position?: string;
}

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
  /**
   * Logo for the SCHOOL the origin line names, resolved server-side.
   *
   * The DARK cut where one exists — the card's background is dark in both
   * themes, so it opts out of the site's `html.dark` swap (see `resolveOrigin`)
   * — but NOT unconditionally: `resolveCollegeDarkLogoUrl` returns null for the
   * NCAA ids whose `500-dark` cut 404s upstream, and those fall back to the
   * light mark, which is the same call `buildCollegeLogoDarkCss` makes for them
   * in CSS. Don't assume a dark variant downstream.
   *
   * Present only for players whose origin is a college at all (`usesCollegeOrigin`
   * — rookies with a school), which is what keeps this affordable: the lookup
   * needs the 80 KB `college-logos.json`, so it cannot happen on the client, and
   * a pool of several hundred players would spend real bytes shipping a URL to
   * everyone who will be labelled with his NFL team instead. That NFL half is
   * derived on the client from `nflTeam` in `resolveOrigin`, which is also the
   * only place this field is read.
   */
  collegeLogo?: string;
}

/**
 * One player a franchise already holds, as the screensaver's roster panels
 * need him — and nothing more.
 *
 * A deliberately THIN record. `trimToDraftable` exists because a TV page
 * shipping every player wastes bytes on names that will never be revealed, and
 * a full `BroadcastPlayer` per rostered player would undo that (TheLeague
 * rosters 25 apiece across 16 franchises). The panel draws a face, a name, a
 * position and a team stripe; `espnId` is what the client builds the face URL
 * from, through the same cascade `BroadcastFace` walks for everyone else.
 */
export interface RosterHolding {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  espnId?: string;
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
  /** MFL league id + host for the poll URL. Registry-derived, never literal —
   *  unless `?mflLeague=` pointed the board at another league's live draft, in
   *  which case `sourceLabel` is set and says so on screen. See
   *  `draft-broadcast-source.ts`. */
  leagueId: string;
  mflHost: string;
  /**
   * Draft unit to ask `/api/draft/status` for, or `null` for "the first unit
   * on the board".
   *
   * Normally this is just `conference.unit`. It is separate from it because an
   * override can be watching a league whose board is not split by conference
   * at all, and asking a single-unit board for `CONFERENCE00` by name is a 404
   * — see `resolveBroadcastSource`.
   */
  feedUnit?: string | null;
  /**
   * On-screen flag when the board is following a feed that is not its own
   * league's. Empty/absent for the real board. A test feed that looks exactly
   * like draft night is how a room ends up watching the wrong draft.
   */
  sourceLabel?: string;
  /**
   * How many players deep to warm images for, from `?warm=`. 0 disables the
   * warm-up. See `planBroadcastImages` — and read the note there on ESPN's
   * four-minute cache window before assuming this is optional.
   */
  warmDepth?: number;
  /**
   * Franchise id → what that franchise already holds, for the screensaver's
   * roster panels. Keepers in the AFL, the standing dynasty roster in
   * TheLeague; tonight's picks are NOT in here — the island merges those from
   * the live board, where their pick numbers are known too. See
   * `loadFranchiseHoldings`.
   */
  holdings?: Record<string, RosterHolding[]>;
  /**
   * How long the idle board may sit unchanged before it starts replaying the
   * draft to itself, in ms. 0 switches the screensaver off entirely.
   *
   * From `?screensaver=` (seconds, or `off`) — see `resolveScreensaverIdleMs`.
   * It rides on the page data rather than being read in the island because the
   * island never sees the URL, and the twenty-second override is the only
   * practical way to check the feature without waiting ten minutes at a TV.
   */
  screensaverIdleMs?: number;
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
  /**
   * NFL team code → that defense's marquee defenders, best first. Keyed by the
   * RAW `nflTeam` string the pool's players carry (MFL's `NEP`/`GBP`/`KCC`
   * dialect), so the island looks a defense up with a plain index and needs no
   * team-code normalizer of its own.
   *
   * Shipped ONCE per team rather than on each player, which is not a
   * micro-optimization: `normPos` folds every MFL team-unit pseudo-player
   * (`TMQB`, `TMDL`, `TMPN`, …) into `DEF`, so 320 players in the 2026 pool
   * carry the position — 32 real defenses and 288 pseudo-players sharing their
   * names and teams. Hanging the pool off each of them added 101 KB (+28%) to
   * the serialized payload for 32 distinct lists.
   */
  defenseFaces?: Record<string, BroadcastDefenseFace[]>;
}
