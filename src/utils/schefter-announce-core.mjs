/**
 * Schefter announcement — shared compose core.
 *
 * Pure, dependency-free functions + constants shared by BOTH sides of the
 * announcement feature so a preview can never drift from what actually ships:
 *   - the CLI/Action script `scripts/schefter-announce.mjs` (writes the feed +
 *     sends GroupMe), and
 *   - the admin endpoint `src/pages/api/admin/schefter-announce.ts` (renders an
 *     in-page preview, then dispatches the workflow).
 *
 * NOTHING here touches the filesystem, the network, or secrets — those live in
 * the script (feed paths, GroupMe bot ids) and the endpoint (workflow dispatch).
 * `.mjs` so plain `node` scripts and the Astro/TS runtime can both import it,
 * the same way `src/config/leagues-data.mjs` is shared.
 */

// GroupMe rejects bot messages over 1000 chars. Headline is a feed card field
// (~60 chars by design); we cap generously so a runaway paste fails fast.
export const GROUPME_MAX_CHARS = 1000;
export const HEADLINE_MAX_CHARS = 120;

export const CTA_PREFIX = 'See what’s new →';

// Kebab-case; makes the post id deterministic so re-runs are idempotent.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export const DEFAULT_HEADLINE =
  'The site just got a facelift: dark mode + fresh player images';
export const DEFAULT_BODY =
  '📱 SCHEFTER: The site just leveled up. Dark mode is officially LIVE — your retinas at 11pm finally get a break. And fresh player imagery is rolling out in select spots across the site. Same league, sharper look. Flip the theme toggle and see for yourself.';

/**
 * Display metadata per announce target — no fs paths, no secrets. The CLI script
 * extends these with `feedPath` + `botId`; the endpoint uses them as-is for the
 * preview deep link. `label` is for the admin UI league picker.
 * @type {Record<string, { navSlug: 'theleague'|'afl', baseUrl: string, newsPath: string, label: string }>}
 */
export const ANNOUNCE_TARGETS = {
  theleague: {
    navSlug: 'theleague',
    baseUrl: 'https://theleague.us',
    newsPath: '/news',
    label: 'The League',
  },
  afl: {
    navSlug: 'afl',
    baseUrl: 'https://afl-fantasy.com',
    newsPath: '/afl-fantasy/news',
    label: 'AFL',
  },
};

/**
 * Resolve a "theleague|afl|both" value to a list of target keys. Empty/absent
 * defaults to theleague; anything else unrecognized THROWS — this broadcasts to
 * a whole league, so a typo must fail loudly rather than hit the wrong audience.
 * @param {unknown} raw
 * @returns {Array<'theleague'|'afl'>}
 */
export function resolveLeagues(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') return ['theleague'];
  if (v === 'both') return ['theleague', 'afl'];
  if (v === 'theleague') return ['theleague'];
  if (v === 'afl' || v === 'afl-fantasy') return ['afl'];
  throw new Error(
    `Unknown leagues value "${raw}". Expected one of: theleague, afl, both.`,
  );
}

/** Deterministic feed post id for an announcement slug. */
export function announcePostId(slug) {
  return `sf_announce_${slug}`;
}

/**
 * Absolute deep link to the specific feed post (used in the GroupMe CTA).
 * @param {{ baseUrl: string, newsPath: string, postId: string }} args
 */
export function buildDeepLink({ baseUrl, newsPath, postId }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const enc = encodeURIComponent(postId);
  return `${base}${newsPath}?post=${enc}#post-${postId}`;
}

/**
 * Build the SchefterPost object prepended to the feed. Classified as an
 * `article` (renders under Articles, not as a fake transaction). Matches the
 * `SchefterPost` contract in src/types/schefter.ts. When `link` is supplied the
 * post points the reader at that URL (e.g. a What's New article) instead of
 * defaulting to itself.
 * @param {{ slug: string, headline: string, body: string, navSlug: 'theleague'|'afl', timestamp: string, link?: string, linkLabel?: string }} args
 */
export function buildAnnouncePost({ slug, headline, body, navSlug, timestamp, link, linkLabel }) {
  const post = {
    id: announcePostId(slug),
    timestamp,
    type: 'article',
    category: 'articles',
    tier: 'standard',
    headline,
    body,
    franchiseIds: [],
    league: navSlug,
    authorId: 'claude',
  };
  if (link) {
    post.link = link;
    post.linkLabel = linkLabel || 'See what’s new';
  }
  return post;
}

/**
 * Compose the exact GroupMe message bytes (body + CTA + link). When `link` is
 * given, the CTA points there (e.g. a What's New article); otherwise it falls
 * back to a deep link to the feed post itself.
 * @param {{ body: string, baseUrl: string, newsPath: string, postId: string, link?: string }} args
 */
export function buildGroupMeText({ body, baseUrl, newsPath, postId, link }) {
  const url = link || buildDeepLink({ baseUrl, newsPath, postId });
  return `${body}\n\n${CTA_PREFIX} ${url}`;
}

/**
 * Central validation + normalization for an announcement, shared by the CLI and
 * the endpoint so both enforce identical rules. Never throws — collects errors.
 *
 * @param {{ slug?: string, headline?: string, body?: string, leagues?: unknown, sendGroupMe?: boolean, link?: string }} input
 * @returns {{ errors: string[], resolved: { slug: string, headline: string, body: string, leagues: Array<'theleague'|'afl'>, sendGroupMe: boolean, link: string } }}
 */
export function validateAnnounceInput(input = {}) {
  const errors = [];

  const slug = String(input.slug ?? '').trim();
  if (!slug || !SLUG_RE.test(slug)) {
    errors.push('slug is required and must be kebab-case (e.g. dark-mode-2026-07).');
  }

  const headline = String(input.headline || DEFAULT_HEADLINE).trim();
  const body = String(input.body || DEFAULT_BODY).trim();
  if (!headline) errors.push('headline must be non-empty.');
  else if (headline.length > HEADLINE_MAX_CHARS) {
    errors.push(`headline is ${headline.length} chars (max ${HEADLINE_MAX_CHARS}).`);
  }
  if (!body) errors.push('body must be non-empty.');

  // Optional custom CTA link (e.g. a What's New article). Must be an absolute
  // http(s) URL — it is embedded in the GroupMe message and the feed post, not
  // fetched server-side, so format validation is the only guard needed.
  const link = String(input.link ?? '').trim();
  if (link) {
    let u;
    try {
      u = new URL(link);
    } catch {
      errors.push('link must be a valid absolute URL (e.g. https://www.theleague.us/whats-new/dark-mode).');
    }
    if (u && u.protocol !== 'http:' && u.protocol !== 'https:') {
      errors.push('link must be an http(s) URL.');
    }
  }

  let leagues = ['theleague'];
  try {
    leagues = resolveLeagues(input.leagues);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const sendGroupMe = input.sendGroupMe !== false; // default true

  if (sendGroupMe && body && slug) {
    const postId = announcePostId(slug);
    for (const key of leagues) {
      const target = ANNOUNCE_TARGETS[key];
      if (!target) continue;
      const text = buildGroupMeText({
        body,
        baseUrl: target.baseUrl,
        newsPath: target.newsPath,
        postId,
        link: link || undefined,
      });
      if (text.length > GROUPME_MAX_CHARS) {
        errors.push(
          `GroupMe message for ${target.navSlug} is ${text.length} chars (max ${GROUPME_MAX_CHARS}). Shorten the body or turn off GroupMe.`,
        );
      }
    }
  }

  return { errors, resolved: { slug, headline, body, leagues, sendGroupMe, link } };
}
