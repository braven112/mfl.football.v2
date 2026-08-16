/**
 * Astro Middleware
 *
 * Handles two concerns for the per-league domains:
 *
 * 1. URL rewriting: Rewrites clean URLs (e.g., /rosters) to their internal
 *    Astro route (e.g., /theleague/rosters) using context.rewrite(). This is
 *    needed because Vercel's vercel.json rewrites don't fire before the Astro
 *    SSR catch-all route in the build output config.
 *
 * 2. Link generation flag: Sets context.locals.hideLeaguePrefix so components
 *    can generate clean links without the /<slug> prefix on the league's
 *    apex host.
 *
 * 3. Link punctuation: 302s /rosters. → /rosters. Chat clients autolink the
 *    sentence's period along with the URL, so links arrive with a trailing
 *    `.` and 404. See src/utils/link-punctuation.mjs for the full story and
 *    the outgoing half of the fix.
 *
 * Vercel 301 redirects in vercel.json still handle catching leaked /<slug>/*
 * links at the edge before this middleware runs.
 *
 * The host → slug map and the path-rewrite logic live in
 * src/utils/league-host-map.ts and are unit-tested.
 */

import './utils/ensure-pt-timezone';
import { defineMiddleware } from 'astro:middleware';
import { HOST_TO_SLUG, resolveLeagueRewrite } from './utils/league-host-map';
import { trimTrailingPunctuationFromPath } from './utils/link-punctuation.mjs';

/**
 * Only navigations get punctuation-trimmed. A 3xx on a POST/PATCH is a real
 * hazard: clients re-issue the follow-up as a GET and silently drop the body,
 * so a mistyped write would look like it succeeded and land nowhere. Every
 * broken chat link is a GET, so this costs us nothing.
 */
const REDIRECTABLE_METHODS = new Set(['GET', 'HEAD']);

export const onRequest = defineMiddleware(async (context, next) => {
  // Runs before the league-host rewrite so the trimmed path goes through the
  // normal resolution afterwards, and so the URL bar gets cleaned up too
  // (a rewrite would leave the broken URL visible and shareable).
  if (REDIRECTABLE_METHODS.has(context.request.method)) {
    const trimmedPath = trimTrailingPunctuationFromPath(context.url.pathname);
    if (trimmedPath !== null) {
      // 302, not 301. A permanent redirect is cached indefinitely by browsers
      // AND by the Cloudflare layer in front of the apex domains — the same
      // layer that kept serving stale 404s for hours during the NFL-logo
      // saga. This normalization is defensive rather than canonical, so keep
      // it revocable.
      return context.redirect(trimmedPath + context.url.search, 302);
    }
  }

  const hostname = context.url.hostname;
  const isLeagueHost = Boolean(HOST_TO_SLUG[hostname]);

  context.locals.hideLeaguePrefix = isLeagueHost;

  if (!isLeagueHost) return next();

  const rewrite = resolveLeagueRewrite(hostname, context.url.pathname);
  if (!rewrite) return next();

  const newUrl = new URL(rewrite.newPath + context.url.search, context.url);
  return context.rewrite(newUrl);
});
