/**
 * Carrying a player across the sign-in reload.
 *
 * A signed-out visitor clicks Bid/Claim on a specific player, signs in through
 * SignInModal, and the page RELOADS — it has to, because whether an owner may
 * claim is decided in SSR frontmatter and the Claim column isn't in the DOM at
 * all for a signed-out visitor. Without this, they land back on a page of 600
 * free agents with no memory of which one they wanted.
 *
 * THE TWO HALVES LIVE IN DIFFERENT COMPONENTS, WHICH IS WHY THEY LIVE HERE.
 * `rememberPendingClaim` runs in SignInModal, which is only rendered for a
 * signed-out visitor; `resumePendingClaim` runs in WaiverClaimModal, which is
 * only rendered once they CAN claim. The two are never on the page at the same
 * time — putting the resume next to the remember (the first shape this took)
 * means the resume code is absent from precisely the page load that needs it,
 * and the parked id sits in sessionStorage forever.
 *
 * sessionStorage, not the URL: LoginForm sanitises its redirect to a
 * same-origin path and would strip a query param, and a URL that outlives the
 * reload would re-open the modal on every back-navigation.
 */

const PENDING_KEY = 'signin.pendingClaimPlayer';

/** Park the player a signed-out visitor was trying to claim. Null clears it. */
export function rememberPendingClaim(playerId: string | null): void {
  try {
    if (playerId) sessionStorage.setItem(PENDING_KEY, playerId);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* Private mode: sign-in still works, we just can't resume. */
  }
}

/**
 * After the post-sign-in reload, reopen the claim form on the player they were
 * after. The table renders client-side, so the button does not exist yet on
 * DOMContentLoaded — watch for it, but only for a bounded window: the player
 * may simply have been claimed by somebody else while they were signing in,
 * and an observer left running forever would fire on an unrelated re-render.
 *
 * Read-and-clear is a single step: a stale id must never pop a modal on some
 * later visit, including one where the click below never lands.
 */
export function resumePendingClaim(timeoutMs = 10_000): void {
  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PENDING_KEY);
    if (pending) sessionStorage.removeItem(PENDING_KEY);
  } catch {
    return;
  }
  if (!pending) return;

  const wanted = pending;
  const tryClick = () => {
    const btn = document.querySelector<HTMLElement>(
      `.claim-open[data-claim-id="${CSS.escape(wanted)}"]`,
    );
    if (!btn) return false;
    btn.click();
    return true;
  };

  if (tryClick()) return;

  const observer = new MutationObserver(() => {
    if (tryClick()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), timeoutMs);
}
