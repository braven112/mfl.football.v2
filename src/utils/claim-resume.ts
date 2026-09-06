/**
 * Carrying a player across the sign-in reload.
 *
 * A signed-out visitor picks Bid/Claim on a specific player, signs in through
 * SignInModal, and the page RELOADS — it has to, because whether an owner may
 * claim is decided server-side. Without this, they land back on a page of 600
 * free agents with no memory of which one they wanted.
 *
 * THE TWO HALVES LIVE IN DIFFERENT COMPONENTS, WHICH IS WHY THEY LIVE HERE.
 * `rememberPendingClaim` runs in SignInModal, which is only rendered for a
 * signed-out visitor; `resumePendingClaim` runs in WaiverClaimModal, which
 * only has a form to reopen once they CAN claim. The two are never on the page
 * at the same time — putting the resume next to the remember (the first shape
 * this took) means the resume code is absent from precisely the page load that
 * needs it, and the parked id sits in sessionStorage forever.
 *
 * THE WHOLE PLAYER IS PARKED, NOT JUST THE ID. The resume used to find a
 * `.claim-open` button in the free-agent table and click it, which is where
 * the name, position and team came from. That column is gone — the claim now
 * lives in the player modal — so there is no element to read, and the payload
 * has to carry what the form needs to paint its header. A bare id string is
 * still accepted, and still resolved by looking for a button, so any surface
 * that does render one keeps working.
 *
 * sessionStorage, not the URL: LoginForm sanitises its redirect to a
 * same-origin path and would strip a query param, and a URL that outlives the
 * reload would re-open the modal on every back-navigation.
 */

const PENDING_KEY = 'signin.pendingClaimPlayer';

export interface PendingClaimPlayer {
  id: string;
  name?: string | null;
  position?: string | null;
  nflTeam?: string | null;
  espnId?: string | null;
  headshot?: string | null;
}

/** Park the player a signed-out visitor was trying to claim. Null clears it. */
export function rememberPendingClaim(player: string | PendingClaimPlayer | null): void {
  try {
    if (!player) return sessionStorage.removeItem(PENDING_KEY);
    const payload = typeof player === 'string' ? { id: player } : player;
    if (!payload.id) return sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    /* Private mode: sign-in still works, we just can't resume. */
  }
}

/** Read-and-clear, in one step: a stale player must never pop a modal later. */
function takePending(): PendingClaimPlayer | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) sessionStorage.removeItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  // Pre-payload sessions parked a bare id. Still readable, on purpose: someone
  // mid-sign-in when this shipped should not lose their player.
  if (!raw.startsWith('{')) return { id: raw };
  try {
    const parsed = JSON.parse(raw);
    return parsed?.id ? (parsed as PendingClaimPlayer) : null;
  } catch {
    return null;
  }
}

/**
 * After the post-sign-in reload, reopen the claim form on the player they were
 * after.
 *
 * Bounded polling rather than a MutationObserver, because there are now two
 * things worth waiting for and only one of them is a DOM node: the claim form
 * is configured from `/api/claim-context` on most pages, so
 * `window.openWaiverClaim` appears a network round-trip after this runs. The
 * window stays short — the player may simply have been claimed by somebody
 * else while they were signing in, and something left running forever would
 * fire on an unrelated re-render.
 */
export function resumePendingClaim(timeoutMs = 10_000, pollMs = 200): void {
  const pending = takePending();
  if (!pending) return;

  const tryOpen = () => {
    // A rendered trigger wins: it carries the surface's own idea of the
    // player, and clicking it keeps that surface's handler in the loop.
    const btn = document.querySelector<HTMLElement>(
      `.claim-open[data-claim-id="${CSS.escape(pending.id)}"]`,
    );
    if (btn) {
      btn.click();
      return true;
    }
    if (typeof window.openWaiverClaim === 'function') {
      window.openWaiverClaim(pending);
      return true;
    }
    return false;
  };

  if (tryOpen()) return;

  const started = Date.now();
  const timer = window.setInterval(() => {
    if (tryOpen() || Date.now() - started > timeoutMs) window.clearInterval(timer);
  }, pollMs);
}
