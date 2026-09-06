/**
 * The claim-context wire shape, and the one rule about its wording.
 *
 * Its own module because the two halves live on opposite sides of the network
 * and must not drag each other's dependencies along: `claim-context.ts` (the
 * server resolver) reaches MFL, the session and the auth helpers, while
 * `player-claim-client.ts` ships to the browser inside PlayerDetailsModal — and
 * a plain `import type` from the server module still puts that whole chain in
 * the module graph as far as the Storybook dependency scan is concerned
 * (tests/chromatic-path-filter.test.ts). The two type imports below are to
 * dependency-free modules, deliberately: re-declaring the rules shape here
 * would be the drift this repo keeps paying for.
 */

import type { WaiverBidRules } from './waiver-claim';
import type { WaiverMode } from './waiver-window';

/** What `GET /api/claim-context` answers with. */
export interface ClaimContext {
  /** The viewer holds a franchise in THIS league. */
  signedIn: boolean;
  /** …and has a roster to drop from, so the claim form can actually be filled. */
  canClaim: boolean;
  /** League wording. TheLeague bids, the AFL claims — never normalize these. */
  verb: 'Bid' | 'Claim';
  system: 'bbid' | 'priority';
  franchiseId: string | null;
  rules: WaiverBidRules;
  roster: Array<{ id: string; name: string }>;
  year: number;
  balance?: number;
  windowMode: WaiverMode;
  windowLabel: string;
  /**
   * Player ids that are NOT claimable by this viewer. Everything absent from
   * this list is offered — see claim-context.ts for why the set ships this way
   * round rather than as its complement.
   */
  rosteredIds: string[];
}

/**
 * The verb a league puts on the acquisition affordance.
 *
 * Blind-bid leagues bid; rolling-priority leagues claim. This is the ONE place
 * that decides, so the table header, the ⋮ action sheet and the player modal
 * cannot end up calling the same act three different things.
 */
export function claimVerb(system: 'bbid' | 'priority'): 'Bid' | 'Claim' {
  return system === 'bbid' ? 'Bid' : 'Claim';
}
