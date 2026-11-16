/* Beat Reporter for MFL league pages. A loader only: every rule and all the
   content come from the server. Install: see /api/beat/snippet. */
(function () {
  var me = document.currentScript;
  if (!me) return;
  var m = location.pathname.match(/\/home\/(\d+)/) || location.search.match(/[?&]L=(\d+)/i);
  if (!m) return;
  var host = document.getElementById('beat-reporter');
  if (!host) { host = document.createElement('div'); me.parentNode.insertBefore(host, me); }
  // The widget is its own card. The skin's .report-wrapper (padding, shadow)
  // would frame it twice, so an older snippet that carries it loses it here.
  if (host.classList) host.classList.remove('report-wrapper');
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var origin = new URL(me.src).origin;
  // A font face must be declared on the page, not in the shadow root. Our own
  // display face, served from our origin (its CORS header is in vercel.json).
  if (!document.getElementById('bw-fonts')) {
    var ff = document.createElement('style');
    ff.id = 'bw-fonts';
    ff.textContent = ['CondensedBold', 'CondensedMedium'].map(function (w, i) {
      return '@font-face{font-family:"BW Display";src:url(' + origin + '/assets/fonts/UFCSans-' + w + '.woff2) format("woff2");font-weight:' + (i ? 500 : 700) + ';font-display:swap}';
    }).join('');
    document.head.appendChild(ff);
  }
  // MFL sets this global for a signed-in owner (its own chat reads it). Never the login cookie.
  // Read as a bare name: a let/const global is not a window property.
  var fid = typeof franchise_id !== 'undefined' ? String(franchise_id) : '';
  var f = /^\d{4}$/.test(fid) ? '&F=' + fid : '';
  fetch(origin + '/api/beat/widget?L=' + m[1] + '&k=' + encodeURIComponent(me.getAttribute('data-key') || '') + f)
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
