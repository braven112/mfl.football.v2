/**
 * Player claim — the client half of `GET /api/claim-context`.
 *
 * One question, asked by two callers (PlayerDetailsModal's Claim button and
 * the ⋮ action sheet's acquire action): "may this viewer add THIS player, and
 * what does this league call it?" Both read the answer from here so they can
 * never disagree — which is what happened while the ⋮ sheet derived its
 * acquire action by reading the free-agent table's own Claim button out of the
 * DOM: the affordance existed only where that column did.
 *
 * Fetched lazily and at most once per page load. Pages that never open a
 * player modal never ask.
 */

import type { ClaimContext } from './claim-context-shape';

declare global {
  interface Window {
    /**
     * Late-binding config entry point on WaiverClaimModal. Present wherever
     * that modal is mounted; called with the context fetched below.
     */
    configureWaiverClaim?: (cfg: unknown) => void;
    /**
     * The resolved context, parked for a claim form whose module had not
     * evaluated yet when it landed. See publishContext below.
     */
    __playerClaimContext?: unknown;
    /**
     * Open the claim form on one player. Present only once the modal is
     * wired — absence means "this page cannot claim", which every caller
     * must treat as a normal outcome rather than an error.
     */
    openWaiverClaim?: (player: {
      id?: string | null; name?: string | null; position?: string | null;
      nflTeam?: string | null; espnId?: string | null; headshot?: string | null;
    }) => void;
  }
}

export type PlayerClaimContext = ClaimContext;

/** The subset a caller needs to render an affordance for one player. */
export interface PlayerClaimOffer {
  /** League wording — 'Claim' (rolling priority) or 'Bid' (blind bid). */
  verb: 'Bid' | 'Claim';
  /** The attributes WaiverClaimModal's delegated `.claim-open` listener reads. */
  playerId: string;
}

let pending: Promise<ClaimContext | null> | null = null;
let cached: ClaimContext | null = null;
let rosteredSet: Set<string> | null = null;

/**
 * The viewer's claim context, fetched once.
 *
 * A failed fetch resolves to null and is NOT retried for the life of the page:
 * the fallback (no button) is correct and silent, and retrying on every modal
 * open would hammer a league that is already degraded.
 */
export function loadClaimContext(): Promise<ClaimContext | null> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch('/api/claim-context', { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .then((ctx: ClaimContext | null) => {
      cached = ctx && ctx.canClaim ? ctx : null;
      rosteredSet = cached ? new Set(cached.rosteredIds) : null;
      publishContext();
      return cached;
    })
    .catch(() => null);
  return pending;
}

/**
 * Hand the context to the claim form — BOTH ways round, because the ordering
 * is genuinely a race.
 *
 * The context IS the form's config (same shape, same source), so a surface
 * that offers the Claim button must never be one that cannot open the form.
 * But this module ships in PlayerDetailsModal's bundle and WaiverClaimModal's
 * is a separate one: the fetch can land BEFORE that module has evaluated, and
 * `window.configureWaiverClaim?.(…)` would then quietly do nothing and leave
 * the form unwired for the life of the page. A verification run caught exactly
 * that — the button rendered and the click opened nothing.
 *
 * So: call it if it is there, and park the context either way. The modal's own
 * init reads the parked copy, which closes the other ordering.
 */
function publishContext(): void {
  if (!cached) return;
  window.__playerClaimContext = cached;
  window.configureWaiverClaim?.(cached);
}

/** The already-resolved context, or null while it is still in flight. */
export function peekClaimContext(): ClaimContext | null {
  return cached;
}

/**
 * The offer for one player, or null when there is nothing to offer.
 *
 * Null covers every "no" in one place: nobody signed in, a viewer with no
 * roster to drop from, a degraded MFL read, and — the common case — a player
 * already rostered by someone whose roster counts against this viewer. See
 * src/utils/claim-context.ts for why the server ships the rostered set rather
 * than its complement.
 */
export function offerFor(playerId: string | null | undefined): PlayerClaimOffer | null {
  if (!playerId || !cached || !rosteredSet) return null;
  if (rosteredSet.has(String(playerId))) return null;
  return { verb: cached.verb, playerId: String(playerId) };
}

/**
 * Drop a player out of the claimable set after a successful claim, so the
 * button does not keep offering someone the viewer just added. Cheaper and
 * more honest than re-fetching: MFL's rosters export lags its own writes.
 */
export function markClaimed(playerId: string): void {
  if (rosteredSet) rosteredSet.add(String(playerId));
  if (cached) cached.rosteredIds = [...rosteredSet ?? []];
}

/** Test seam + ClientRouter safety: forget everything and re-ask on next use. */
export function resetClaimContext(): void {
  pending = null;
  cached = null;
  rosteredSet = null;
  window.__playerClaimContext = undefined;
}
