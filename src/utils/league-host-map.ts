/**
 * Pure host/path → league-slug + rewrite-target resolver.
 *
 * Lives in src/utils so it's importable by both src/middleware.ts (which
 * pulls in astro:middleware and can't be unit-tested directly) and by
 * vitest.
 *
 * Adding a new league domain: extend HOST_TO_SLUG. The afl-fantasy.com
 * entry is wired in but dormant — flipping live requires DNS + Vercel
 * domain attachment (AFL_DUPLICATION_PLAN §2.3, Phase 7).
 */

/**
 * Map of apex hostnames → league slug (the path segment under src/pages/).
 * Both the bare host and `www.` variant should be present.
 */
export const HOST_TO_SLUG: Readonly<Record<string, string>> = {
  'theleague.us': 'theleague',
  'www.theleague.us': 'theleague',
  // Dormant until afl-fantasy.com is pointed at this Vercel project.
  'afl-fantasy.com': 'afl-fantasy',
  'www.afl-fantasy.com': 'afl-fantasy',
};

// Slug prefixes get a trailing slash so /theleagueX doesn't match /theleague
// as a substring. The exact path /theleague (no trailing slash) is caught
// by the slug-already-prefixed check inside resolveLeagueRewrite.
const ALL_LEAGUE_PREFIX_SLASHES: readonly string[] = Array.from(
  new Set(Object.values(HOST_TO_SLUG))
).map((slug) => `/${slug}/`);

/**
 * Paths that exist at the root level and should NOT be rewritten under
 * a league prefix when serving from a league apex host. Includes every
 * known league prefix so cross-league deep links continue working from
 * either host (e.g. an /afl-fantasy/* link visited from theleague.us
 * still resolves to the AFL page).
 */
export const SKIP_REWRITE_PREFIXES: readonly string[] = [
  '/api/',
  ...ALL_LEAGUE_PREFIX_SLASHES,
  '/_astro/',
  '/_image',
  '/_server-islands/',
  '/forum/',
  '/404',
  '/favicon.ico',
  '/assets/',
  '/manifest.json',
];

export interface LeagueRewrite {
  newPath: string;
  slug: string;
}

/**
 * Resolve a `(hostname, pathname)` pair to a rewrite target.
 *
 * @returns The rewritten pathname when the request should be rewritten under
 *   a league prefix, or `null` when no rewrite is needed.
 */
export function resolveLeagueRewrite(
  hostname: string,
  pathname: string
): LeagueRewrite | null {
  const slug = HOST_TO_SLUG[hostname];
  if (!slug) return null;

  const slugPrefix = `/${slug}`;
  if (pathname === slugPrefix || pathname.startsWith(`${slugPrefix}/`)) {
    return null;
  }

  if (SKIP_REWRITE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  const newPath = pathname === '/' ? slugPrefix : `${slugPrefix}${pathname}`;
  return { newPath, slug };
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build a minimal HTML document that performs a client-side redirect to
 * `location`.
 *
 * Why this exists: on a league apex host, clean (non-prefixed) URLs resolve
 * only via the middleware rewrite, so they fall through to the Vercel
 * build-output SSR fallback route, which carries `status: 404`. A 200 render
 * overrides that status, but a 3xx redirect does NOT — Vercel returns the
 * page's server redirect as a 404 (the Location header survives, but browsers
 * ignore it on a 404). That silently breaks every server redirect on a clean
 * URL, e.g. the login gate on /schefter/tip. Returning a 200 HTML document the
 * browser follows works around the fallback, which leaves 200s intact.
 *
 * The `<script>` does the redirect immediately; the `<meta refresh>` and
 * `<a>` are no-JS fallbacks. The URL is escaped for the attribute contexts and
 * `<` is escaped inside the script string so a crafted Location can't break
 * out of the tag.
 */
export function buildClientRedirectHtml(location: string): string {
  const attrSafe = escapeHtmlAttr(location);
  const scriptSafe = JSON.stringify(location).replace(/</g, '\\u003c');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="refresh" content="0; url=${attrSafe}">` +
    '<title>Redirecting…</title>' +
    `<script>location.replace(${scriptSafe})</script>` +
    '</head><body>Redirecting to ' +
    `<a href="${attrSafe}">${attrSafe}</a>…</body></html>`
  );
}
