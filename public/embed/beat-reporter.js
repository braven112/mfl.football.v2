/*
 * AI beat reporter embed — drop a league's latest news onto any page.
 *
 *   <div data-beat-reporter data-league="theleague" data-limit="5"></div>
 *   <script src="https://www.theleague.us/embed/beat-reporter.js" defer></script>
 *
 * Works on any host (MFL home-page modules, a portfolio, a blog): it reads the
 * public, CORS-open /api/schefter/public-feed from the SAME origin this script
 * was loaded from, and renders into a shadow root so the host page's CSS
 * cannot break it and its CSS cannot leak out. Only league news is ever
 * returned — tips and rumor-mill posts are filtered server-side.
 *
 * Options (data attributes on the container):
 *   data-league   registry slug or navSlug (default: the API's default league)
 *   data-limit    1-12 posts (default 5)
 *   data-theme    "dark" | "light" | "auto" (default auto)
 *   data-title    heading text (default "Latest from the beat"; "" hides it)
 * Anything inside the container is a fallback: it shows if the feed can't load.
 * Colors follow CSS custom properties set on the container, e.g.
 *   style="--br-accent:#c9a227; --br-bg:transparent; --br-font:Georgia,serif"
 * Also: --br-fg, --br-muted, --br-line, --br-border, --br-radius, --br-pad.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var origin = script && script.src ? new URL(script.src).origin : location.origin;

  var CSS =
    ':host{all:initial;display:block;font-size:15px;line-height:1.45;font-family:var(--br-font,system-ui,-apple-system,"Segoe UI",sans-serif);' +
    '--_bg:var(--br-bg,#fff);--_fg:var(--br-fg,#14171c);--_muted:var(--br-muted,#5b6472);' +
    '--_line:var(--br-line,rgba(0,0,0,.1));--_accent:var(--br-accent,#1c497c);color:var(--_fg)}' +
    ':host([data-theme-resolved=dark]){--_bg:var(--br-bg,#111418);--_fg:var(--br-fg,#eef1f5);' +
    '--_muted:var(--br-muted,#9aa4b2);--_line:var(--br-line,rgba(255,255,255,.12));--_accent:var(--br-accent,#7fb0ff)}' +
    '.wrap{background:var(--_bg);border:var(--br-border,1px solid var(--_line));border-radius:var(--br-radius,12px);padding:var(--br-pad,4px 16px)}' +
    'h3{margin:12px 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--_muted);font-weight:600}' +
    'ol{list-style:none;margin:0;padding:0}' +
    'li{padding:12px 0;border-top:1px solid var(--_line)}li:first-child{border-top:0}' +
    'a{color:inherit;text-decoration:none;display:block}a:hover b,a:focus-visible b{color:var(--_accent);text-decoration:underline}' +
    'a:focus-visible{outline:2px solid var(--_accent);outline-offset:2px;border-radius:4px}' +
    '.meta{display:block;font-size:12px;color:var(--_muted);margin-bottom:2px}' +
    '.kind{color:var(--_accent);font-weight:600}' +
    'b{display:block;font-weight:650;font-size:15px}' +
    'p{margin:4px 0 0;color:var(--_muted);font-size:14px}' +
    '.empty{padding:12px 0;color:var(--_muted)}';

  function timeAgo(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s) || s < 0) return '';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 14) return Math.round(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(host) {
    if (host.__beatReporter) return;
    host.__beatReporter = true;
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var theme = host.getAttribute('data-theme') || 'auto';
    var dark = theme === 'dark' || (theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    host.setAttribute('data-theme-resolved', dark ? 'dark' : 'light');

    var style = el('style');
    style.textContent = CSS;
    var wrap = el('div', 'wrap');
    var title = host.hasAttribute('data-title') ? host.getAttribute('data-title') : 'Latest from the beat';
    if (title) wrap.appendChild(el('h3', null, title));
    var list = el('ol');
    list.setAttribute('aria-busy', 'true');
    wrap.appendChild(list);
    root.appendChild(style);
    root.appendChild(wrap);

    var q = new URLSearchParams();
    if (host.getAttribute('data-league')) q.set('league', host.getAttribute('data-league'));
    q.set('limit', host.getAttribute('data-limit') || '5');

    fetch(origin + '/api/schefter/public-feed?' + q.toString())
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        list.removeAttribute('aria-busy');
        var posts = (data && data.posts) || [];
        if (!posts.length) { list.appendChild(el('li', 'empty', 'No news yet.')); return; }
        posts.forEach(function (p) {
          var li = el('li');
          var a = el('a');
          a.href = p.url;
          a.target = '_blank';
          a.rel = 'noopener';
          var meta = el('span', 'meta');
          meta.appendChild(el('span', 'kind', p.kind === 'article' ? 'Article' : 'League move'));
          meta.appendChild(document.createTextNode(' \u00b7 ' + timeAgo(p.timestamp)));
          a.appendChild(meta);
          a.appendChild(el('b', null, p.headline));
          if (p.excerpt && p.excerpt !== p.headline) a.appendChild(el('p', null, p.excerpt));
          li.appendChild(a);
          list.appendChild(li);
        });
      })
      .catch(function () {
        // Fall back to whatever the host page put inside the container (a
        // static snapshot, a link), or a one-line notice when it put nothing.
        if (root !== host && host.children.length) {
          wrap.replaceChild(document.createElement('slot'), list);
          return;
        }
        list.removeAttribute('aria-busy');
        list.appendChild(el('li', 'empty', 'News is unavailable right now.'));
      });
  }

  function boot() {
    var nodes = document.querySelectorAll('[data-beat-reporter]');
    for (var i = 0; i < nodes.length; i++) render(nodes[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
