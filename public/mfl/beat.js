/* Beat Reporter for MFL league pages. A loader only: every rule and all the
   content come from the server. Install: see /api/beat/snippet. */
(function () {
  var me = document.currentScript;
  if (!me) return;
  var m = location.pathname.match(/\/home\/(\d+)/) || location.search.match(/[?&]L=(\d+)/i);
  if (!m) return;
  var host = document.getElementById('beat-reporter');
  if (!host) { host = document.createElement('div'); me.parentNode.insertBefore(host, me); }
  if (host.classList) host.classList.add('report-wrapper');
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  // MFL sets this global for a signed-in owner (its own chat reads it). Never the login cookie.
  var f = typeof window.franchise_id === 'string' && /^\d{4}$/.test(window.franchise_id) ? '&F=' + window.franchise_id : '';
  fetch(new URL(me.src).origin + '/api/beat/widget?L=' + m[1] + '&k=' + encodeURIComponent(me.getAttribute('data-key') || '') + f)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.html) root.innerHTML = '<style>' + d.css + '</style>' + d.html; })
    .catch(function () {});
})();
