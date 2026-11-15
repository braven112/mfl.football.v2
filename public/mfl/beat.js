/* Beat Reporter for MFL league pages. A loader only: every rule and all the
   content come from the server. Install: see /api/beat/snippet. */
(function () {
  var me = document.currentScript;
  if (!me) return;
  var api = new URL(me.src).origin + '/api/beat/widget';
  var m = location.pathname.match(/\/home\/(\d+)/) || location.search.match(/[?&]L=(\d+)/i);
  if (!m) return;
  var host = document.getElementById('beat-reporter');
  if (!host) { host = document.createElement('div'); me.parentNode.insertBefore(host, me); }
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  fetch(api + '?L=' + m[1] + '&k=' + encodeURIComponent(me.getAttribute('data-key') || ''))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.html) return;
      root.innerHTML = '<style>' + d.css + '</style>' + d.html + '<dialog class="bw-dialog"></dialog>';
      var dlg = root.querySelector('dialog');
      root.addEventListener('click', function (e) {
        var open = e.target.closest('[data-bw-open]');
        if (open) {
          var t = root.getElementById ? root.getElementById(open.getAttribute('data-bw-open')) : root.querySelector('#' + open.getAttribute('data-bw-open'));
          dlg.innerHTML = '';
          dlg.appendChild(t.content.cloneNode(true));
          dlg.showModal();
        } else if (e.target.closest('[data-bw-close]') || e.target === dlg) dlg.close();
      });
    })
    .catch(function () {});
})();
