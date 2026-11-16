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
 *   - It reads like the league homepage's news rail: a League tab (the
 *     reporter's own desk and Ask Roger) and an All tab that adds Vegas Vic,
 *     Doc Rivers and the NFL wire (Brandon, 2026-11-16). The widget cannot
 *     tell who is viewing on its own; when MFL's page names the signed-in
 *     franchise (its `franchise_id` global) the first tab becomes My News:
 *     the league desk plus posts about that team and its players. That id is
 *     a hint anyone can fake, so it only filters public news. Posts addressed
 *     to one franchise (lineup nudges) and the group chat never leave our site.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/** Post types that stay on our site: one franchise's nudges, the group chat, the Board. */
export const PRIVATE_POST_TYPES = new Set(['assistant', 'groupme', 'board']);

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

/**
 * The league's own desk: the reporter's posts and Ask Roger. Mirrors
 * SOURCE_PREDICATES.theleague (src/utils/schefter-sources.ts); the route
 * passes that one in, this is the fallback for tests.
 */
export function isLeagueDeskPost(p) {
  const author = p?.authorId ?? 'claude';
  return (author === 'claude' || author === 'roger') && !String(p?.id ?? '').startsWith('wire_');
}

/**
 * The posts a league's MFL page shows, newest first, and which of them are
 * the League tab's. Each tab gets `limit` of its own (the homepage rail's
 * rule), or the wire, which posts all day, would push the league off the list.
 */
export function selectWidgetPosts(feed, { limit = WIDGET_POST_LIMIT, isLeague = isLeagueDeskPost } = {}) {
  const all = (Array.isArray(feed?.posts) ? feed.posts : [])
    .filter((p) => p && p.headline && !PRIVATE_POST_TYPES.has(p.type))
    .filter((p) => p.transactionSubType !== 'TRADE_PENDING')
    .slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const league = all.filter((p) => isLeague(p)).slice(0, limit);
  const rest = all.filter((p) => !isLeague(p)).slice(0, limit);
  const posts = [...league, ...rest].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return { posts, leagueIds: new Set(league.map((p) => p.id)) };
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

/**
 * The widget's stylesheet: a white "Primetime" card (Brandon, 2026-11-16:
 * premium, white, the broadcast layout) in the league's own two colors.
 * `--bw-p` / `--bw-s` default to navy; widgetCss() sets them per league.
 * Breaking red stays fixed: it means the same thing in every league.
 */
export const WIDGET_CSS = `
:host{display:block;margin-bottom:24px;--bw-p:#1d3a6e;--bw-s:#1d3a6e}
*{box-sizing:border-box}
.bw{--ink:#0f172a;--ink2:#334155;--dim:#64748b;--hair:#e9edf3;--tint:color-mix(in srgb,var(--bw-p) 5%,#fff);--display:"BW Display","UFC Sans Condensed","Roboto Condensed","Arial Narrow",sans-serif-condensed,system-ui,sans-serif;
  max-width:760px;margin:0 auto;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:#fff;border-radius:20px;overflow:hidden;text-align:left;
  box-shadow:0 0 0 1px color-mix(in srgb,var(--bw-p) 12%,transparent),0 2px 4px rgba(15,23,42,.04),0 12px 28px -12px rgba(15,23,42,.14),0 36px 64px -36px rgba(15,23,42,.22)}
.bw a{color:inherit;text-decoration:none}
.bw-head{position:relative;display:flex;align-items:center;gap:14px;padding:20px 18px 16px;background:linear-gradient(180deg,color-mix(in srgb,var(--bw-p) 7%,#fff),#fff)}
.bw-head::after{content:"";position:absolute;left:18px;right:18px;bottom:0;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--bw-p),var(--bw-s) 55%,transparent)}
.bw-head img{width:54px;height:54px;border-radius:50%;object-fit:cover;flex:none;padding:2px;background:linear-gradient(135deg,var(--bw-p),var(--bw-s))}
.bw-head>div{min-width:0;padding-right:56px}
.bw-title{font-family:var(--display);font-weight:700;font-size:1.45em;line-height:1.05;letter-spacing:.02em;text-transform:uppercase;color:var(--bw-p)}
.bw-sub{margin-top:5px;font-size:.7em;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--bw-s)}
.bw-new{position:absolute;top:14px;right:16px;padding:3px 10px;border-radius:999px;background:#dc2626;color:#fff;font-size:.7em;font-weight:800;letter-spacing:.08em;text-transform:uppercase;box-shadow:0 6px 14px -6px rgba(220,38,38,.7)}
.bw-new[hidden]{display:none}
.bw-tab-in{position:absolute;opacity:0;pointer-events:none}
.bw-tabs{display:flex;gap:4px;margin:14px 18px 4px;padding:4px;border-radius:12px;background:#f1f4f8;box-shadow:inset 0 0 0 1px var(--hair)}
.bw-tabs label{flex:1;cursor:pointer;text-align:center;padding:8px 0;border-radius:9px;font-family:var(--display);font-weight:700;font-size:.95em;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);transition:background .15s,color .15s}
#bw-tab-league:checked~.bw-tabs label[for=bw-tab-league],#bw-tab-all:checked~.bw-tabs label[for=bw-tab-all]{background:var(--bw-p);color:#fff;box-shadow:0 6px 14px -8px color-mix(in srgb,var(--bw-p) 80%,transparent)}
#bw-tab-league:focus-visible~.bw-tabs label[for=bw-tab-league],#bw-tab-all:focus-visible~.bw-tabs label[for=bw-tab-all]{outline:2px solid var(--bw-p);outline-offset:2px}
#bw-tab-league:checked~.bw-list .bw-post:not(.bw-post--league){display:none}
.bw-list{list-style:none;margin:0;padding:2px 0 0}
.bw-post{padding:14px 18px;border-bottom:1px solid var(--hair)}
.bw-post:last-child{border-bottom:0}
.bw-link{display:flex;gap:12px;align-items:flex-start}
.bw-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;flex:none;background:#f1f4f8;box-shadow:0 0 0 2px #fff,0 0 0 3px color-mix(in srgb,var(--bw-p) 30%,transparent)}
.bw-post--new .bw-avatar{box-shadow:0 0 0 2px #fff,0 0 0 4px #dc2626}
.bw-post--new .bw-meta::after{content:"New";margin-left:8px;color:#dc2626;font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:.9em}
.bw-main{min-width:0;flex:1}
.bw-meta{color:var(--dim);font-size:.78em;margin-bottom:3px}
.bw-by{color:var(--ink);font-weight:700}
.bw-badge{display:inline-block;margin-right:8px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;font-size:.9em;color:var(--bw-s)}
.bw-badge--hot{color:#dc2626}
.bw-badge::after{content:"";display:inline-block;width:3px;height:3px;margin-left:8px;border-radius:50%;background:#cbd5e1;vertical-align:middle}
.bw-headline{font-family:var(--display);font-weight:700;font-size:1.3em;line-height:1.15;letter-spacing:.01em;margin:2px 0 5px;color:var(--ink)}
.bw-body{margin:0;line-height:1.5;color:var(--ink2);white-space:pre-line}
.bw-more::after{content:" →"}
.bw-more{display:inline-block;margin-top:6px;font-weight:700;font-size:.88em;color:var(--bw-p)}
.bw-link:hover .bw-headline,.bw-link:hover .bw-more{text-decoration:underline}
.bw-link:focus-visible{outline:2px solid var(--bw-p);outline-offset:2px}
.bw-foot{display:flex;justify-content:space-between;gap:8px;padding:13px 18px 15px;background:#f8fafc;border-top:1px solid var(--hair);font-size:.8em;color:var(--dim)}
.bw-foot a{color:var(--bw-p);font-weight:700}
.bw-btn{display:inline-block;cursor:pointer;padding:11px 18px;border-radius:12px;font-weight:700;text-align:center;color:var(--bw-p);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--bw-p) 30%,transparent)}
.bw-ad{padding-bottom:18px}
.bw-ad-pitch{margin:14px 18px 12px;line-height:1.5;color:var(--ink2)}
.bw-ad-sample{margin:0 18px 8px;padding:12px 14px;border-radius:14px;background:var(--tint);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--bw-p) 10%,transparent)}
.bw-ad-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 18px 0}
.bw-ad .bw-btn--primary{background:var(--bw-p);color:#fff;box-shadow:0 8px 18px -10px var(--bw-p)}
.bw-ad-note{margin:10px 18px 0;font-size:.85em;color:var(--dim)}
`;

const HEX = /^#[0-9a-f]{6}$/i;
/**
 * The stylesheet in one league's colors: `primary` for titles, tabs and
 * links, `secondary` for the small labels. Anything but a #rrggbb is ignored,
 * since the value lands inside CSS.
 */
export function widgetCss({ primary, secondary } = {}) {
  const p = HEX.test(primary ?? '') ? primary : null;
  const s = HEX.test(secondary ?? '') ? secondary : p;
  return p ? `${WIDGET_CSS}:host{--bw-p:${p};--bw-s:${s}}\n` : WIDGET_CSS;
}

/** Big news reads red in the feed, the one place it shows (no pinned strip; Brandon, 2026-11-16). */
const HOT_BADGES = new Set(['Breaking', 'Trade']);

function badgeFor(post) {
  if (post.type === 'odds') return 'Odds';
  if (post.type === 'injury') return 'Injury';
  if (post.type === 'ask-roger') return 'Commish';
  if (post.authorId === 'nfl-draft') return 'Draft';
  if (post.type === 'external') return 'NFL';
  if (post.type === 'article' || post.type === 'matchup-preview' || post.type === 'power-ranking') return 'Column';
  if (post.type === 'milestone' || post.transactionSubType === 'milestone') return 'Milestone';
  if (post.tier === 'rumor') return 'Rumor';
  if (post.transactionSubType === 'TRADE') return 'Trade';
  if (post.tier === 'breaking') return 'Breaking';
  return 'News';
}

/** An outside story (the NFL wire) opens where it was published. */
function externalLink(post) {
  return post.type === 'external' && typeof post.link === 'string' && /^https:\/\//.test(post.link) ? post.link : null;
}

/**
 * The news widget's HTML for one league.
 * @param {object} o
 * @param {any[]} o.posts         selectWidgetPosts(...).posts
 * @param {Set<string>} [o.leagueIds]  the first tab's posts; no tabs when absent
 * @param {string} [o.firstTab]  the first tab's label: 'League', or 'My News' when personalized
 * @param {(post: any) => { name: string, avatar: string }} [o.bylineFor]  absolute avatar URL; defaults to the reporter
 * @param {{ name: string, avatar: string, report: string }} o.reporter  absolute avatar URL
 * @param {(path: string) => string} o.absolute  the league's leagueUrl
 * @param {string} o.leagueSlug  registry slug, for the article path
 * @param {number} [o.now]
 */
export function renderNewsWidget({ posts, leagueIds, firstTab = 'League', bylineFor, reporter, absolute, leagueSlug, now = Date.now() }) {
  const newsPage = absolute(`/${leagueSlug}/news`);
  const byline = bylineFor ?? (() => ({ name: reporter.name, avatar: reporter.avatar }));
  const hrefFor = (post) => {
    const isColumn = Array.isArray(post.content) && post.content.length > 0;
    return externalLink(post) ?? (isColumn ? absolute(`/${leagueSlug}/news/${encodeURIComponent(post.id)}`) : newsPage);
  };
  const items = posts.map((post) => {
    // Every card opens our site: a column on its own article page (charts and
    // all), anything else on the league's news page. Brandon, 2026-11-15:
    // the write-ups are too nice to squeeze into a pop-up on MFL. A wire
    // story opens on ESPN, as it does on our news page.
    const isColumn = Array.isArray(post.content) && post.content.length > 0;
    const href = hrefFor(post);
    const by = byline(post);
    const meta =
      `<div class="bw-meta"><span class="bw-badge${HOT_BADGES.has(badgeFor(post)) ? ' bw-badge--hot' : ''}">${badgeFor(post)}</span>` +
      `<span class="bw-by">${escapeHtml(by.name)}</span> · ${escapeHtml(relativeTime(post.timestamp, now))}</div>`;
    const body = post.body ? `<p class="bw-body">${escapeHtml(post.body)}</p>` : '';
    // A headline only on a column. A news post is a tweet: its text is the
    // story, and a headline over it says the same thing twice (Brandon).
    const text = isColumn
      ? `<h3 class="bw-headline">${escapeHtml(post.headline)}</h3>${body}<span class="bw-more">Read the column</span>`
      : body || `<p class="bw-body">${escapeHtml(post.headline)}</p>`;
    const lane = leagueIds?.has(post.id) ? ' bw-post--league' : '';
    const avatar = by.avatar ? `<img class="bw-avatar" src="${escapeHtml(by.avatar)}" alt="" width="36" height="36" loading="lazy">` : '<span class="bw-avatar"></span>';
    return (
      `<li class="bw-post${lane}" data-ts="${Number.isFinite(Date.parse(post.timestamp)) ? Date.parse(post.timestamp) : 0}"><a class="bw-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">` +
      `${avatar}<div class="bw-main">${meta}${text}</div></a></li>`
    );
  });
  const empty = posts.length === 0 ? '<li class="bw-post"><p class="bw-body">No news yet. Check back after the next move.</p></li>' : '';
  // CSS-only tabs (radio + label): the loader runs no logic of its own, and
  // the inline HTML it drops in cannot run a script.
  const hasLeague = leagueIds && leagueIds.size > 0;
  const tabs =
    hasLeague && leagueIds.size < posts.length
      ? `<input type="radio" name="bw-tab" id="bw-tab-league" class="bw-tab-in" checked>` +
        `<input type="radio" name="bw-tab" id="bw-tab-all" class="bw-tab-in">` +
        `<div class="bw-tabs" role="tablist"><label for="bw-tab-league">${escapeHtml(firstTab)}</label><label for="bw-tab-all">All</label></div>`
      : '';
  return (
    `<div class="bw">${reporterHead(reporter)}${tabs}<ul class="bw-list">${items.join('')}${empty}</ul>` +
    `<div class="bw-foot"><span>${escapeHtml(reporter.report)}</span><a href="${escapeHtml(newsPage)}" target="_blank" rel="noopener">More news</a></div></div>`
  );
}

function reporterHead(reporter) {
  return (
    `<div class="bw-head"><img src="${escapeHtml(reporter.avatar)}" alt="" width="44" height="44">` +
    `<div><div class="bw-title">${escapeHtml(reporter.report)}<span class="bw-new" hidden></span></div><div class="bw-sub">by ${escapeHtml(reporter.name)}, your league's beat reporter</div></div></div>`
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
