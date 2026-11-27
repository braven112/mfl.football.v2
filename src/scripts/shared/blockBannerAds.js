/**
 * Banner + sticky-footer ad suppression for our MFL skin (TheLeague + AFL).
 *
 * MFL serves its ads through Freestar (a.pub.network/myfantasyleague-com),
 * to signed-in owners only. Its placements, per that site's fsdata.json:
 *   myfantasyleague_leaderboard_atf_mobile / _desktop, _btf_mobile / _desktop,
 *   myfantasyleague_leftrail, myfantasyleague_rightrail,
 *   myfantasyleague_stickyfooter (rendered into #fs-sticky-footer),
 *   myfantasyleague_interstitial (handled by blockFullScreenAds.js).
 *
 * The CSS half (src/assets/css/src/_misc.scss) hides every placement on first
 * paint. CSS cannot hide the slot's WRAPPER, though: a page-owned box that
 * holds nothing but the ad would stay behind as an empty grey band. This
 * module collapses those wrappers, and gives back any bottom margin the
 * sticky footer reserved on <body>.
 */

export const BANNER_AD_SELECTORS = [
  '[data-freestar-ad]',
  'div[id^="myfantasyleague_leaderboard"]',
  'div[id^="myfantasyleague_leftrail"]',
  'div[id^="myfantasyleague_rightrail"]',
  'div[id^="myfantasyleague_stickyfooter"]',
  '#fs-sticky-footer',
  '.fs-sticky-footer',
  '.fs-sticky-parent',
  '.fs-sticky-wrapper',
].join(',');

const HIDDEN_ATTR = 'data-mfl-ad-hidden';

// Walk up from an ad slot, hiding each ancestor that holds nothing else a
// person could see. Stops at the first box with real content.
function collapseWrappers(slot) {
  let child = slot;
  let parent = slot.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    if (parent.children.length !== 1) break;
    const otherText = (parent.textContent || '').replace(child.textContent || '', '').trim();
    if (otherText) break;
    parent.setAttribute(HIDDEN_ATTR, '');
    child = parent;
    parent = parent.parentElement;
  }
}

function hideBannerAds() {
  document.querySelectorAll(BANNER_AD_SELECTORS).forEach((slot) => {
    if (slot.hasAttribute(HIDDEN_ATTR)) return;
    slot.setAttribute(HIDDEN_ATTR, '');
    collapseWrappers(slot);
  });
  const body = document.body;
  if (body && body.style.marginBottom && !document.querySelector('#fs-sticky-footer:not([' + HIDDEN_ATTR + '])')) {
    // The sticky footer pads the page so it never covers content; with the
    // footer gone, that padding is just dead space at the bottom.
    if (/vh$/.test(body.style.marginBottom)) body.style.marginBottom = '';
  }
}

export function initBlockBannerAds() {
  if (typeof window === 'undefined' || window.__mflBannerShield) return;
  window.__mflBannerShield = true;

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      hideBannerAds();
    });
  };

  const start = () => {
    hideBannerAds();
    // Ads arrive after load and refresh every 60 s; watch for new slots only.
    new MutationObserver(schedule).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}
