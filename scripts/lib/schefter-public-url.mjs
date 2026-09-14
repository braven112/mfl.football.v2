/**
 * Absolute URLs for Schefter's chat CTAs — the ONE prefix-aware builder.
 *
 * Internal routes are stored PREFIXED (`/theleague/trade-builder`) because
 * that is the real Astro route and the only form that resolves on the shared
 * host. A league's own apex domain serves the BARE path via the middleware
 * rewrite, and vercel.json 301s the prefixed form back to it. So the correct
 * absolute form depends on WHICH origin the message is pointing at, and
 * concatenating an origin with a path gets it wrong in one direction or the
 * other every time:
 *
 *   - own apex host  → the prefix is redundant; pasting it ships
 *     `theleague.us/theleague/trade-builder` and burns a 301. That exact link
 *     was live in Roger's reminders, Schefter's Trade Builder CTAs, both
 *     article GroupMe promos, the August-cut touches and the AFL announcement
 *     deep link (fixed Aug 2026).
 *   - anything else (mfl.football, a *.vercel.app preview, a path-suffixed
 *     base) → there is no rewrite, so the BARE path falls through to the 404
 *     catch-all and the prefix is required.
 *
 * This lived inside `scripts/schefter-rumor-scan.mjs` until the speculation
 * lane needed the same answer for its own CTA (2026-09-11). Copying it would
 * have been the "five copies existed and two silently disagreed" failure this
 * repo has already paid for once — and the copy would have been the naive
 * concatenation, since that is what the speculation lane's GroupMe helper
 * already did for its `/news` deep link.
 *
 * `leagueUrl()` in the registry is the builder for everything that does NOT
 * need to honour a `SCHEFTER_PUBLIC_BASE_URL` override; it pins the canonical
 * cookie-safe origin. These lanes DO need the override (preview deploys,
 * mfl.football), which is why they get a wrapper rather than calling it.
 *
 * See docs/claude/rules/league-urls.md.
 */

import {
  buildHostToSlugMap,
  stripLeaguePrefix,
  ensureLeaguePrefix,
} from '../../src/config/leagues-data.mjs';

/**
 * Origin (+ optional path prefix) a route can be appended to.
 *
 * A base URL is not a place to carry a query or fragment: concatenating a
 * route after one yields `https://www.theleague.us?x=1/theleague/schefter/tip`,
 * which is simply a broken link. Drop them, along with any trailing slash.
 *
 * Throws on an unparseable value rather than limping on — this base is pasted
 * into the CTA of every post a run ships, so a typo'd override would quietly
 * poison a whole slate of GroupMe messages. Better to die at startup.
 */
export function normalizeBaseUrl(raw) {
  const trimmed = String(raw).replace(/\/+$/, '');
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error(
      `SCHEFTER_PUBLIC_BASE_URL is not a valid absolute URL: ${JSON.stringify(raw)}`,
    );
  }
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

/**
 * Is `baseUrl` the ROOT of one of THIS league's own apex hosts — i.e. a base
 * where the middleware rewrite actually runs, so the bare path resolves?
 *
 * Registry-derived, not a string compare against the canonical origin: an
 * operator can spell the same host a dozen equivalent ways — bare apex,
 * uppercase, http://, an explicit :443 — and every one must still strip.
 *
 * Hostname alone is not enough. The rewrite is served at the domain root on
 * the standard port, so a non-default port (`:444`) or a path-suffixed base
 * (`https://www.theleague.us/preview`) is NOT the apex even though it shares a
 * hostname — stripping there produces a path nothing serves. Those, like
 * mfl.football and *.vercel.app previews, need the prefix kept.
 *
 * `new URL()` normalizes a scheme's default port to '', so any port left over
 * is by definition non-default.
 */
export function isOwnApexBase(baseUrl, leagueSlug) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    return false;
  }
  if (u.port !== '') return false;
  if (u.pathname !== '/') return false;
  return buildHostToSlugMap()[u.hostname.toLowerCase()] === leagueSlug;
}

/**
 * Build the `publicUrl(path)` function for one league and one base.
 *
 * Symmetric, and it keeps the operator's chosen origin rather than
 * substituting the canonical one. Takes the PREFIXED internal path every feed
 * link carries and returns the absolute form that actually resolves against
 * this base.
 *
 * Resolve the apex question ONCE here rather than per call: it parses a URL
 * and builds the registry host map, and every CTA in a run asks the same
 * question of the same base.
 */
export function createPublicUrl({ baseUrl, leagueSlug, registryLeague }) {
  const base = normalizeBaseUrl(baseUrl);
  const isApex = isOwnApexBase(base, leagueSlug);
  return (p) => (isApex
    ? `${base}${stripLeaguePrefix(registryLeague, p)}`
    : `${base}${ensureLeaguePrefix(registryLeague, p)}`);
}
