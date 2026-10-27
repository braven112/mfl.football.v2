/**
 * Add/drop and waivers in the MFL Football app (package L) — what
 * `/api/mfl-live/waivers`, `/api/mfl-live/waivers-manage` and
 * `/api/mfl-live/drop` answer.
 *
 * The rules (bid minimum, increment, which window is open, who is taken) are
 * decided on the server with the site's own code and shipped as data, so the
 * phone never keeps a second copy of them. The server stays the authority:
 * everything here is what to OFFER, and the POST re-checks it all against MFL
 * before writing.
 *
 * Every write answers HTTP 200 with `success: false` on a handled failure
 * (the edge replaces a 5xx body), so read `success`, then `message`.
 * `verified` says the server READ the result back from MFL, which is the only
 * evidence there is: MFL answers a refusal with a 200 page too.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-l-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/** Blind bid (FAAB) or rolling priority. Never normalize the two. */
export type MflLiveAppWaiverSystem = 'bbid' | 'priority';

/** Which window MFL's calendar says is open right now. `unknown` files a queued claim. */
export type MflLiveAppWaiverMode = 'waiver' | 'fcfs' | 'unknown';

export interface MflLiveAppBidRules {
  system: MflLiveAppWaiverSystem;
  blindBid: boolean;
  /** Minimum legal bid. */
  minimum: number;
  /** Bids are a multiple of this above zero (0.01 in a cents league). */
  increment: number;
  /** MFL wants a round number with each claim. */
  conditional: boolean;
  maxRounds: number;
}

export interface MflLiveAppDropOption {
  id: string;
  name: string;
  /** Only `active` frees a roster slot; IR and taxi players are still droppable. */
  slot: 'active' | 'ir' | 'taxi';
}

/** Everything the add/drop sheet needs to offer a claim, and fill it in. */
export interface MflLiveAppWaiverContext {
  /** False when MFL could not be read well enough to offer a legal claim. */
  canClaim: boolean;
  /** The league's own word for the act: bid leagues "Bid", priority leagues "Claim". */
  verb: 'Bid' | 'Claim';
  system: MflLiveAppWaiverSystem;
  rules: MflLiveAppBidRules;
  /** The owner's players, for the drop picker. */
  roster: MflLiveAppDropOption[];
  /** The MFL league year a write lands in; send it back as `year`. */
  year: number;
  activeRosterCount?: number;
  rosterLimit?: number;
  /** Remaining FAAB, bid leagues only. */
  balance?: number;
  windowMode: MflLiveAppWaiverMode;
  /** e.g. "Waivers run Wed 9:00 AM PT". */
  windowLabel: string;
  /** MFL's own add/drop page, for when a reply cannot be read. */
  addDropUrl: string;
  /** Players nobody in the owner's scope may add (anyone rostered). Everyone else is a free agent. */
  rosteredIds: string[];
}

/** One claim already filed, in MFL's order (which is its priority within the round). */
export interface MflLiveAppFiledClaim {
  round: string;
  index: number;
  addPlayerId: string;
  addName: string | null;
  addPosition: string;
  addNflTeam: string;
  /** null when the claim adds without dropping. */
  dropPlayerId: string | null;
  dropName: string | null;
  dropPosition: string;
  dropNflTeam: string;
  bid: number | null;
  comment: string;
  /** MFL's epoch seconds for when it was filed. */
  timestamp: string | null;
}

/** `GET /api/mfl-live/waivers?league=` */
export interface MflLiveAppWaivers {
  success: true;
  context: MflLiveAppWaiverContext;
  /** null when MFL's pending list could not be read (not the same as none filed). */
  claims: MflLiveAppFiledClaim[] | null;
}

/** One claim to file, in priority order. */
export interface MflLiveAppClaimRequest {
  addPlayerId: string;
  /** Bid leagues only. */
  bid?: number;
  /** Omit to add without dropping. */
  dropPlayerId?: string;
}

/** `POST /api/mfl-live/waivers?league=` body. */
export interface MflLiveAppSubmitClaims {
  claims: MflLiveAppClaimRequest[];
  /** Required in a waiver window when the league is conditional. Ignored in FCFS. */
  round?: number;
  /** The `context.year` the sheet was built from; a mismatch is refused. */
  year?: number;
}

/** `POST /api/mfl-live/waivers-manage?league=` body. */
export interface MflLiveAppManageClaim {
  action: 'delete' | 'editDrop';
  round: string;
  addPlayerId: string;
  /** editDrop only: the new drop, or omitted / '0000' for none. */
  dropPlayerId?: string | null;
  comment?: string;
}

/** `POST /api/mfl-live/drop?league=` body. */
export interface MflLiveAppDropRequest {
  playerId: string;
  year?: number;
}

/**
 * Every write's reply. On a handled failure `success` is false, `message`
 * says why in MFL's own words where it gave any, and `status` carries the
 * intended HTTP status.
 */
export interface MflLiveAppWriteResult {
  success: boolean;
  message: string;
  verified?: boolean;
  /** Which kind of write happened: a queued claim, or an immediate add. */
  mode?: 'waiver' | 'fcfs';
  /** waivers-manage: the pending list after the change. */
  claims?: MflLiveAppFiledClaim[] | null;
  /** Player ids MFL refused because they are locked (recently dropped). */
  locked?: string[];
  confirmUrl?: string;
  status?: number;
}
