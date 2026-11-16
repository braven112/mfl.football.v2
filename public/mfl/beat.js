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
  // Read as a bare name: a let/const global is not a window property.
  var fid = typeof franchise_id !== 'undefined' ? String(franchise_id) : '';
  var f = /^\d{4}$/.test(fid) ? '&F=' + fid : '';
  fetch(new URL(me.src).origin + '/api/beat/widget?L=' + m[1] + '&k=' + encodeURIComponent(me.getAttribute('data-key') || '') + f)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.html) return;
      root.innerHTML = '<style>' + d.css + '</style>' + d.html;
      // Unread count: posts newer than this browser's last visit. Kept here
      // (not on our server) so no visit history ever leaves the browser.
      var key = 'beat-seen:' + m[1] + ':' + (fid || '-'), seen = 0;
      try { seen = +localStorage.getItem(key) || 0; localStorage.setItem(key, String(Date.now())); } catch (e) { return; }
      if (!seen) return;
      var lead = root.querySelector('.bw-tabs') ? '.bw-post--league' : '.bw-post', n = 0;
      [].forEach.call(root.querySelectorAll('.bw-post[data-ts]'), function (li) {
        if (+li.getAttribute('data-ts') > seen) { li.classList.add('bw-post--new'); if (li.matches(lead)) n++; }
      });
      var badge = root.querySelector('.bw-new');
      if (badge && n) { badge.textContent = n + ' new'; badge.hidden = false; }
    })
    .catch(function () {});
})();
