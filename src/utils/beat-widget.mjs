/**
 * The Beat Reporter widget for a league's own myfantasyleague.com pages.
 *
 * The commissioner pastes ONE script tag (public/mfl/beat.js) into a Home Page
 * Message. That loader has no logic of its own: it sends the page's league id
 * and the league's key to /api/beat/widget and drops in the HTML this module
 * renders. Everything that decides what a league sees lives here, on the
 * server (plan: "AI Beat Reporter on MFL league pages", Brandon 2026-11-15).
 *
 *   - A league sees its news only with a valid key: an HMAC of its MFL id
 *     under a server secret, so a snippet copied into another league shows
 *     that league the ad card instead.
 *   - A league that has not paid (no reporter on our side, no key, a wrong
 *     key) gets the ad card. It costs no AI: nothing is generated for it.
 *   - Only league news is shown. ESPN wire posts, odds, and posts addressed
 *     to one franchise never leave our site.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/** Post types a league's MFL page may show. Everything else stays on our site. */
export const WIDGET_POST_TYPES = new Set(['transaction', 'article', 'milestone', 'power-ranking', 'matchup-preview']);

/** How many posts the widget lists. */
export const WIDGET_POST_LIMIT = 12;

/** Where the ad card's buttons go until the Beat Reporter page exists. */
export const AD_LINKS = {
  buy: '/pricing',
  learn: '/features',
};

/**
 * The secret the league keys are signed with: its own env value when set,
 * else derived from JWT_SECRET under its own label (the push-credentials
 * idiom), so no new env var is needed. Null when the server has neither.
 */
export function widgetSecret(env = process.env) {
  if (env.BEAT_WIDGET_SECRET) return Buffer.from(env.BEAT_WIDGET_SECRET, 'utf8');
  if (!env.JWT_SECRET) return null;
  return Buffer.from(hkdfSync('sha256', env.JWT_SECRET, 'mfl-football-beat', 'beat-widget-key-v1', 32));
}

/** A league's widget key: 24 hex characters, stable for its MFL id. */
export function widgetKey(mflId, secret) {
  return createHmac('sha256', secret).update(`beat:${String(mflId)}`).digest('hex').slice(0, 24);
}

/** Whether `key` is this league's key. Constant time. */
export function verifyWidgetKey(mflId, key, secret) {
  if (!secret || typeof key !== 'string' || !/^[0-9a-f]{24}$/.test(key)) return false;
  const want = Buffer.from(widgetKey(mflId, secret));
  const got = Buffer.from(key);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** An MFL league page origin: https://www49.myfantasyleague.com and the like. */
export function isMflOrigin(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && (u.hostname === 'myfantasyleague.com' || u.hostname.endsWith('.myfantasyleague.com'));
  } catch {
    return false;
  }
}

/** The posts a league's MFL page shows, newest first. */
export function selectWidgetPosts(feed, limit = WIDGET_POST_LIMIT) {
  const posts = Array.isArray(feed?.posts) ? feed.posts : [];
  return posts
    .filter((p) => p && WIDGET_POST_TYPES.has(p.type) && p.headline)
    .filter((p) => p.type !== 'transaction' || p.transactionSubType !== 'TRADE_PENDING')
    .slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** "3h ago", "2d ago", or a short date. */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

/** The widget's stylesheet: inherits the MFL skin's text color, so it fits light and dark skins alike. */
export const WIDGET_CSS = `
:host{display:block;font:inherit;color:inherit;margin-bottom:24px}
*{box-sizing:border-box}
.bw{--bw-line:color-mix(in srgb,currentColor 18%,transparent);--bw-soft:color-mix(in srgb,currentColor 6%,transparent);--bw-dim:color-mix(in srgb,currentColor 65%,transparent);max-width:760px;margin:0 auto}
.bw{padding:0 12px}
@media (min-width:640px){.bw{padding:0}}
.bw-head{display:flex;align-items:center;gap:12px;padding:4px 0 12px;border-bottom:1px solid var(--bw-line)}
.bw-head img{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none}
.bw-title{font-weight:700;font-size:1.15em;line-height:1.2}
.bw-sub{color:var(--bw-dim);font-size:.85em}
.bw-list{list-style:none;margin:0;padding:0}
.bw-post{padding:12px 0;border-bottom:1px solid var(--bw-line)}
.bw-meta{color:var(--bw-dim);font-size:.8em;margin-bottom:2px}
.bw-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:var(--bw-soft);margin-right:6px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;font-size:.9em}
.bw-headline{font-weight:700;line-height:1.3;margin:0 0 4px;font-size:1em}
.bw-body{margin:0;line-height:1.45;white-space:pre-line}
.bw-link{display:block;color:inherit;text-decoration:none}
.bw-link:hover .bw-headline,.bw-link:hover .bw-more{text-decoration:underline}
.bw-link:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.bw-more{display:inline-block;margin-top:6px;font-weight:600;text-decoration:underline}
.bw-foot{padding:10px 0 0;font-size:.8em;color:var(--bw-dim)}
.bw-foot a,.bw-ad a{color:inherit}
.bw-btn{all:unset;cursor:pointer;padding:9px 14px;border-radius:8px;font-weight:600;text-align:center;border:1px solid color-mix(in srgb,currentColor 30%,transparent)}
.bw-ad{padding:16px;border:1px solid var(--bw-line);border-radius:12px;background:var(--bw-soft)}
.bw-ad .bw-head{border:none;padding-top:0}
.bw-ad-pitch{margin:0 0 12px;line-height:1.45}
.bw-ad-sample{padding:10px 12px;border-radius:8px;border:1px solid var(--bw-line);margin-bottom:8px}
.bw-ad-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.bw-ad-actions a{text-decoration:none}
.bw-ad .bw-btn--primary{flex:none;background:color-mix(in srgb,currentColor 14%,transparent);color:inherit;border-color:currentColor}
.bw-ad-note{margin-top:10px;font-size:.85em;color:var(--bw-dim)}
`;

function badgeFor(post) {
  if (post.type === 'article' || post.type === 'matchup-preview' || post.type === 'power-ranking') return 'Column';
  if (post.type === 'milestone' || post.transactionSubType === 'milestone') return 'Milestone';
  if (post.tier === 'rumor') return 'Rumor';
  if (post.transactionSubType === 'TRADE') return 'Trade';
  if (post.tier === 'breaking') return 'Breaking';
  return 'News';
}

/**
 * The news widget's HTML for one league.
 * @param {object} o
 * @param {any[]} o.posts         selectWidgetPosts output
 * @param {{ name: string, avatar: string, report: string }} o.reporter  absolute avatar URL
 * @param {(path: string) => string} o.absolute  the league's leagueUrl
 * @param {string} o.leagueSlug  registry slug, for the share link path
 * @param {number} [o.now]
 */
export function renderNewsWidget({ posts, reporter, absolute, leagueSlug, now = Date.now() }) {
  const newsPage = absolute(`/${leagueSlug}/news`);
  const items = posts.map((post) => {
    // Every card opens our site: a column on its own article page (charts and
    // all), anything else on the league's news page. Brandon, 2026-11-15:
    // the write-ups are too nice to squeeze into a pop-up on MFL.
    const isColumn = Array.isArray(post.content) && post.content.length > 0;
    const href = isColumn ? absolute(`/${leagueSlug}/news/${encodeURIComponent(post.id)}`) : newsPage;
    const meta = `<div class="bw-meta"><span class="bw-badge">${badgeFor(post)}</span>${escapeHtml(relativeTime(post.timestamp, now))}</div>`;
    const body = post.body ? `<p class="bw-body">${escapeHtml(post.body)}</p>` : '';
    // A headline only on a column. A news post is a tweet: its text is the
    // story, and a headline over it says the same thing twice (Brandon).
    const text = isColumn
      ? `<h3 class="bw-headline">${escapeHtml(post.headline)}</h3>${body}<span class="bw-more">Read the column</span>`
      : body || `<p class="bw-body">${escapeHtml(post.headline)}</p>`;
    return `<li class="bw-post"><a class="bw-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${meta}${text}</a></li>`;
  });
  const empty = posts.length === 0 ? '<li class="bw-post"><p class="bw-body">No news yet. Check back after the next move.</p></li>' : '';
  return (
    `<div class="bw">${reporterHead(reporter)}<ul class="bw-list">${items.join('')}${empty}</ul>` +
    `<div class="bw-foot">${escapeHtml(reporter.report)} · <a href="${escapeHtml(newsPage)}" target="_blank" rel="noopener">More news</a></div></div>`
  );
}

function reporterHead(reporter) {
  return (
    `<div class="bw-head"><img src="${escapeHtml(reporter.avatar)}" alt="" width="44" height="44">` +
    `<div><div class="bw-title">${escapeHtml(reporter.report)}</div><div class="bw-sub">by ${escapeHtml(reporter.name)}, your league's beat reporter</div></div></div>`
  );
}

/** Sample posts for the ad card: a made-up league, no AI. */
export const AD_SAMPLES = [
  { badge: 'Trade', headline: 'BREAKING: Blockbuster deal reshapes the title race', body: "Sources tell me the two-time champs just paid a first-round pick to land a WR1. The rest of the league has 48 hours to answer." },
  { badge: 'Column', headline: 'Saturday Matchup Preview: the rivalry nobody wants to lose', body: 'Six straight meetings decided by under 10 points. My pick, with a predicted score, is inside.' },
  { badge: 'News', headline: 'Waiver wire: $31 winning bid for the backup RB', body: 'Three teams bid. Only one is still talking about it.' },
];

/**
 * The ad card a league sees when it has not paid. `origin` is our shared
 * origin (https://mfl.football) for the buttons and avatar.
 */
export function renderAdWidget({ origin, avatar, name = 'Max Insider' }) {
  const samples = AD_SAMPLES.map(
    (s) =>
      `<div class="bw-ad-sample"><div class="bw-meta"><span class="bw-badge">${escapeHtml(s.badge)}</span>Sample</div>` +
      `<h3 class="bw-headline">${escapeHtml(s.headline)}</h3><p class="bw-body">${escapeHtml(s.body)}</p></div>`,
  ).join('');
  return (
    `<div class="bw"><div class="bw-ad">` +
    `${reporterHead({ avatar: `${origin}${avatar}`, name, report: 'Your league deserves a beat reporter' })}` +
    `<p class="bw-ad-pitch">An AI beat reporter that covers every trade, bid and matchup in your league, right here on your MFL home page. Add History and he remembers every rivalry and record.</p>` +
    samples +
    `<div class="bw-ad-actions"><a class="bw-btn bw-btn--primary" href="${origin}${AD_LINKS.buy}" target="_blank" rel="noopener">Get the Beat Reporter</a>` +
    `<a class="bw-btn" href="${origin}${AD_LINKS.learn}" target="_blank" rel="noopener">Learn more</a></div>` +
    `<div class="bw-ad-note">Not the commissioner? Ask yours to turn this on.</div></div></div>`
  );
}

/** The paste-in snippet for a league's Home Page Message. */
export function widgetSnippet({ origin, key }) {
  return `<div id="beat-reporter" class="report-wrapper"></div>\n<script src="${origin}/mfl/beat.js" data-key="${key}" defer></script>`;
}
