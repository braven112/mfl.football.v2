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
  /**
   * Player id → the franchise this viewer could TRADE for him with.
   *
   * A strict subset of `rosteredIds`, and deliberately not derivable from it:
   * that set answers "can I add him", which is one bit, while a trade needs to
   * know WHO to ask. The viewer's OWN franchise is excluded, so the three
   * states an owner can be in read straight off these two fields with no
   * fourth question:
   *
   *   in tradeTargets            → someone else in my scope has him → trade
   *   in rosteredIds only        → I have him → nothing to offer
   *   in neither                 → free agent → claim/bid
   *
   * Scoped exactly like `rosteredIds` (see claim-context.ts): in the AFL that
   * means the viewer's OWN conference only. A rival conference's copy of the
   * same player is not a trade this league can run, so it never appears here.
   */
  tradeTargets: Record<string, string>;
  /**
   * Display names for the franchises named in `tradeTargets`, so the button can
   * say who to ask without the page it opened from having to know.
   *
   * Kept as a separate map rather than inlined per player because a roster's
   * worth of ids share one name — inlining it repeats the same string ~25
   * times per franchise for no gain.
   */
  franchiseNames: Record<string, string>;
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
