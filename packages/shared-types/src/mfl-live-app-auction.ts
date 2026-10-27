/**
 * The MFL Football app's auction room — the wire contract for
 * `GET /api/mfl-live/auction?league=`. Package R, step 3 (slow auctions first,
 * the owner's choice on 2026-10-27).
 *
 * A league can run a draft AND an auction in one year (TheLeague drafts its
 * rookies and auctions its free agents), so this is its own read, not a mode
 * of the draft room. Works for ANY MFL league the account is in.
 *
 * READ-ONLY. MFL's developer API has no request for nominating or bidding
 * (docs/claude/insights/domains/mfl-api.md, 2026-10-27): owners bid on MFL's
 * own Auction Bid page, which `bidUrl` opens.
 *
 * Money is in the league's own units: whole dollars as MFL stores them
 * (TheLeague bids in the hundreds of thousands, a $200 league in single
 * dollars). Store-safe: MFL data only.
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-auction-contract.ts` asserts the server's view stays
 * assignable to it.
 */

import type { MflLiveAppDraftPlayer, MflLiveAppDraftTeam } from './mfl-live-app-draft';

/** How MFL runs this league's auction, from its `auction_kind`. */
export type MflLiveAppAuctionKind =
  /** A slow auction: bids over hours or days. */
  | 'email'
  /** MFL's live auction room: everyone online, seconds per player. */
  | 'live'
  /** The league has no auction this year. */
  | 'none';

/**
 * - `none`: nothing has been nominated this year.
 * - `open`: at least one player is up for bids.
 * - `quiet`: players have been won and nothing is up right now.
 */
export type MflLiveAppAuctionStatus = 'none' | 'open' | 'quiet';

/** A player up for bids. */
export interface MflLiveAppAuctionLot {
  player: MflLiveAppDraftPlayer;
  /** The high bid now. */
  highBid: number;
  /** The team holding the high bid. */
  highBidder: string;
  /** True when that is the signed-in owner's team. */
  mine: boolean;
  /** True when the owner bid on this player and someone has since bid more. */
  outbid: boolean;
  /** When the current high bid was made, ISO 8601. */
  highBidAt?: string;
  /** When the player was nominated, ISO 8601. */
  nominatedAt?: string;
  /** Who nominated him, when MFL says. */
  nominatedBy?: string;
  /** How many bids he has drawn, nomination included. */
  bids: number;
}

/** A player won. */
export interface MflLiveAppAuctionWin {
  player: MflLiveAppDraftPlayer;
  amount: number;
  franchiseId: string;
  mine: boolean;
  /** ISO 8601, when MFL says. */
  wonAt?: string;
}

/** What the owner's team can still spend. */
export interface MflLiveAppAuctionBudget {
  /**
   * What MFL counts the team as able to spend before any bids it is winning:
   * cap room in a salary-cap league, the auction purse less what the team has
   * won otherwise.
   */
  available: number;
  /** The team's high bids still open: money it would owe if every one stood. */
  committed: number;
  /** `available - committed`. */
  left: number;
  /** Which number `available` is. */
  basis: 'cap-room' | 'purse';
}

export interface MflLiveAppAuctionRoom {
  ok: true;
  leagueId: string;
  leagueName: string;
  year: number;
  franchiseId: string;
  kind: MflLiveAppAuctionKind;
  status: MflLiveAppAuctionStatus;
  /** The smallest opening bid, and the smallest raise, when MFL says. */
  minBid?: number;
  bidIncrement?: number;
  teams: MflLiveAppDraftTeam[];
  /** Players up for bids, the owner's outbid ones first, then newest bid first. */
  lots: MflLiveAppAuctionLot[];
  /** Players won this year, newest first. */
  won: MflLiveAppAuctionWin[];
  /** Absent when MFL would not give us the numbers it needs. */
  budget?: MflLiveAppAuctionBudget;
  /** MFL's own Auction Bid page for this league, where owners nominate and bid. */
  bidUrl: string;
  generatedAt: string;
  /** How long the app should wait before reading again. */
  pollAfterMs: number;
}
