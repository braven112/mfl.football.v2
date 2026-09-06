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
import { activeRankingsScope, type RankingsScope } from './rankings-scope';

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

interface ScopeState {
  pending: Promise<ClaimContext | null> | null;
  context: ClaimContext | null;
  rostered: Set<string> | null;
}

/**
 * State per LEAGUE, and the scope re-read on every call.
 *
 * Not a single context, for the reason rankings-scope spells out: one JS module
 * instance survives a ClientRouter navigation from one league's page to the
 * other's, so anything captured belongs to the page before this one. And the
 * page's league is not decoration here — see the guard in loadClaimContext.
 */
const states = new Map<RankingsScope, ScopeState>();

function stateFor(scope: RankingsScope): ScopeState {
  let s = states.get(scope);
  if (!s) {
    s = { pending: null, context: null, rostered: null };
    states.set(scope, s);
  }
  return s;
}

/**
 * The viewer's claim context for the league whose page they are on, fetched
 * once per league.
 *
 * `?league=` IS THE POINT, not bookkeeping. The server resolves the league from
 * the SESSION, so an owner signed into TheLeague who opens a player on an AFL
 * page would otherwise be answered for TheLeague — and since MFL player ids are
 * global, an AFL free agent who happens to be unrostered in TheLeague reads as
 * claimable. The button appears on the wrong league's page and files a real
 * bid in the other one. So the client sends the page's league and the server
 * refuses a mismatch, exactly as /api/watch-list, /api/draft-list and
 * kv-franchise-store do. The param is a CHECK, never an input.
 *
 * A failed fetch resolves to null and is NOT retried for the life of the page:
 * the fallback (no button) is correct and silent, and retrying on every modal
 * open would hammer a league that is already degraded.
 */
export function loadClaimContext(): Promise<ClaimContext | null> {
  const scope = activeRankingsScope();
  const state = stateFor(scope);
  if (state.context) return Promise.resolve(state.context);
  if (state.pending) return state.pending;
  state.pending = fetch(`/api/claim-context?league=${encodeURIComponent(scope)}`, {
    credentials: 'same-origin',
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((ctx: ClaimContext | null) => {
      state.context = ctx && ctx.canClaim ? ctx : null;
      state.rostered = state.context ? new Set(state.context.rosteredIds) : null;
      publishContext(scope);
      return state.context;
    })
    .catch(() => null);
  return state.pending;
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
function publishContext(scope: RankingsScope): void {
  const context = states.get(scope)?.context;
  // Only ever publish the league the viewer is looking at NOW. A fetch begun
  // before a ClientRouter hop resolves after it, and handing that stale
  // league's config to the claim form is the same cross-league write the
  // `?league=` check exists to stop.
  if (!context || scope !== activeRankingsScope()) return;
  window.__playerClaimContext = context;
  window.configureWaiverClaim?.(context);
}

/** The already-resolved context for the current page, or null if not loaded. */
export function peekClaimContext(): ClaimContext | null {
  return states.get(activeRankingsScope())?.context ?? null;
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
  const state = states.get(activeRankingsScope());
  if (!playerId || !state?.context || !state.rostered) return null;
  if (state.rostered.has(String(playerId))) return null;
  return { verb: state.context.verb, playerId: String(playerId) };
}

/**
 * Drop a player out of the claimable set after a successful claim, so the
 * button does not keep offering someone the viewer just added. Cheaper and
 * more honest than re-fetching: MFL's rosters export lags its own writes.
 */
export function markClaimed(playerId: string): void {
  const state = states.get(activeRankingsScope());
  if (!state?.rostered) return;
  state.rostered.add(String(playerId));
  if (state.context) state.context.rosteredIds = [...state.rostered];
}

/**
 * Test seam: forget everything and re-ask on next use.
 *
 * NOT called on navigation. The state is keyed by league, so a hop between the
 * two leagues' pages already reads the right bucket — and a blanket reset on
 * `astro:page-load` raced the warm-up fired on that same dispatch, discarding
 * a fetch that was already in flight and letting its late `.then` repopulate
 * what had just been cleared.
 */
export function resetClaimContext(): void {
  states.clear();
  window.__playerClaimContext = undefined;
}
