/**
 * Navigation progress bar
 *
 * Injects a thin <div id="nav-progress"> bar at the top of the viewport
 * and animates it on internal link clicks. Pairs with the #nav-progress
 * styles in _header.scss.
 */
export function initNavProgress() {
  // Create the bar element if it doesn't already exist
  let bar = document.getElementById('nav-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'nav-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.prepend(bar);
  }

  // Trigger progress bar on internal link clicks
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href]');
    if (!link) return;
    if (link.target === '_blank') return;
    if (link.origin !== location.origin) return;
    if (link.pathname === location.pathname && link.search === location.search) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    bar.classList.remove('active');
    void bar.offsetWidth; // force reflow to restart animation
    bar.classList.add('active');
  });

  // Clear the bar when the new page finishes loading
  window.addEventListener('load', function () {
    bar.classList.remove('active');
  });
}
