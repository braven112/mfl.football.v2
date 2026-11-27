/**
 * Full-screen ad suppression for our MFL skin (TheLeague + AFL league pages).
 *
 * MFL's pages can serve Google full-screen ads between page loads:
 *   - AdSense "vignette": an <ins class="adsbygoogle" data-vignette-loaded="true">
 *     pinned over the viewport; the URL gains #google_vignette.
 *   - Ad Manager (GPT) web interstitial: the URL gains #goog_fullscreen_ad.
 *
 * Both work by HOLDING the link the owner just tapped: the ad shows first and
 * the browser only goes to the new page when the ad's Close button is pressed.
 * So hiding the ad with CSS alone would leave the owner stuck on the old page
 * with a dead tap. This module therefore does three things:
 *   1. remembers the last link tapped (capture phase, never blocks the tap),
 *   2. when a full-screen ad's URL hash appears, removes the ad and finishes
 *      that navigation,
 *   3. clears any scroll lock the ad left on <html>/<body>.
 * The CSS half (src/assets/css/src/_misc.scss) hides the ad on first paint so
 * it never flashes; this module makes the tap still go where it was aimed.
 */

const AD_HASHES = ['#google_vignette', '#goog_fullscreen_ad'];

// Full-screen ad containers. Ordinary in-page ad slots are NOT listed here:
// removing a node that a page script still references is safe, but the goal
// is only the takeover ads.
export const FULL_SCREEN_AD_SELECTORS = [
  'ins.adsbygoogle[data-vignette-loaded]',
  'ins.adsbygoogle[data-ad-format="interstitial"]',
  'ins[id^="gpt_unit_"][id*="_oop"]',
  'div[id^="google_ads_iframe"][id*="nterstitial"]',
  'div[id*="google_vignette"]',
  'iframe[id^="aswift_"][style*="position: fixed"]',
].join(',');

let lastTappedHref = null;
let lastTapAt = 0;
let pollTimer = null;
const TAP_WINDOW_MS = 15000;
const POLL_EVERY_MS = 100;
const POLL_FOR_MS = 4000;

const isAdHash = (hash) => AD_HASHES.some((h) => (hash || '').startsWith(h));

function unlockScroll() {
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    if (el.style.overflow === 'hidden') el.style.overflow = '';
    if (el.style.position === 'fixed') el.style.position = '';
  }
}

function clearAd() {
  if (!isAdHash(window.location.hash)) return false;

  // Only now, with the ad actually showing, take its nodes out. A vignette
  // is preloaded hidden long before any tap; removing it then could leave
  // the ad script holding a tap with nothing to show and nothing to close.
  document.querySelectorAll(FULL_SCREEN_AD_SELECTORS).forEach((node) => node.remove());
  unlockScroll();

  const pending = lastTappedHref && Date.now() - lastTapAt < TAP_WINDOW_MS;
  if (pending) {
    const href = lastTappedHref;
    lastTappedHref = null;
    window.location.assign(href);
  } else {
    // No tap to finish (e.g. the ad fired on Back) — drop the ad's hash so a
    // reload or a shared link doesn't carry it.
    const clean = window.location.href.split('#')[0];
    window.history.replaceState(window.history.state, '', clean);
  }
  return true;
}

// The ad script may set its hash with history.pushState, which fires no
// hashchange, so after a tap we also watch the URL for a few seconds.
function watchAfterTap() {
  clearInterval(pollTimer);
  const until = Date.now() + POLL_FOR_MS;
  pollTimer = setInterval(() => {
    if (clearAd() || Date.now() > until) clearInterval(pollTimer);
  }, POLL_EVERY_MS);
}

function rememberTap(event) {
  const target = event.target;
  const link = target && target.closest ? target.closest('a[href]') : null;
  if (!link) return;
  const href = link.href;
  if (!href || !/^https?:/i.test(href)) return;
  // A new-tab link leaves this page where it is; nothing for us to finish.
  if ((link.getAttribute('target') || '').toLowerCase() === '_blank') return;
  // A same-page anchor is not a navigation the ad could be holding.
  const here = window.location.href.split('#')[0];
  if (href.split('#')[0] === here) return;
  lastTappedHref = href;
  lastTapAt = Date.now();
  watchAfterTap();
}

export function initBlockFullScreenAds() {
  if (typeof window === 'undefined' || window.__mflAdShield) return;
  window.__mflAdShield = true;

  // Capture phase so we see the tap even if a later handler stops it. We
  // never preventDefault or stopPropagation: every other click handler on
  // the page behaves exactly as before.
  window.addEventListener('click', rememberTap, true);
  window.addEventListener('hashchange', clearAd);
  window.addEventListener('popstate', clearAd);
  // A page can land with the ad hash already on it (Back into a vignette).
  clearAd();
}
