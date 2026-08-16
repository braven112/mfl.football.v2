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
 * 3. Link punctuation: a request for `/rosters.` is 302'd to `/rosters` (no
 *    trailing period on the destination). Chat clients autolink the
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
import {
  PUNCTUATION_REDIRECT_STATUS,
  resolvePunctuationRedirect,
} from './utils/link-punctuation.mjs';

export const onRequest = defineMiddleware(async (context, next) => {
  // Runs before the league-host rewrite so the trimmed path goes through the
  // normal resolution afterwards, and so the URL bar gets cleaned up too
  // (a rewrite would leave the broken URL visible and shareable). The whole
  // decision — method gate, open-redirect guard, query forwarding — lives in
  // resolvePunctuationRedirect so it can be unit-tested rather than grepped.
  const punctuationRedirect = resolvePunctuationRedirect(context.request.method, context.url);
  if (punctuationRedirect !== null) {
    // 302, not 301: a permanent redirect is cached indefinitely by browsers,
    // and this normalization is defensive rather than canonical. `no-store`
    // is what actually makes it revocable — Cloudflare fronts the apex
    // domains and has stamped its own max-age on responses regardless of
    // status before (the NFL-logo saga), so the status code alone is not the
    // protection it looks like.
    return new Response(null, {
      status: PUNCTUATION_REDIRECT_STATUS,
      headers: { Location: punctuationRedirect, 'Cache-Control': 'no-store' },
    });
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
