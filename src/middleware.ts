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
import './utils/ensure-demo-isolation';
import { defineMiddleware } from 'astro:middleware';
import { HOST_TO_SLUG, resolveLeagueRewrite } from './utils/league-host-map';
import { resolveSharedHostHiddenLeague } from './config/leagues';
import {
  PUNCTUATION_REDIRECT_STATUS,
  resolvePunctuationRedirect,
} from './utils/link-punctuation.mjs';
import { shouldBlockIndexing } from './utils/deploy-environment';

export const onRequest = defineMiddleware(async (context, next) => {
  // Keep staging and preview deployments out of search indexes.
  //
  // A HEADER rather than a <meta> tag, and set here rather than in the layouts,
  // because it has to cover what a layout cannot: API routes, the OG image
  // endpoints, redirects, and any route that renders without going through
  // TheLeagueLayout. `staging.theleague.us` is a real subdomain of a real
  // domain, so left alone it gets crawled and becomes duplicate content
  // competing with theleague.us.
  //
  // public/robots.txt cannot do this job: one file ships with the deployment
  // and would have to serve every host the same answer.
  //
  // Declared ABOVE the punctuation redirect on purpose. It sat below on first
  // write, which meant the 302 returned from that early exit carried no
  // X-Robots-Tag — a redirect is exactly one of the responses the comment
  // claimed to cover, and the only one that could still be crawled.
  const blockIndexing = shouldBlockIndexing(context.url);
  const stamp = (response: Response): Response => {
    // Header sets can throw on an immutable Response (one constructed from a
    // fetch, say). Not indexing is worth less than serving the page, so a
    // failure here must never take the request down with it.
    if (blockIndexing) {
      try {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      } catch {
        /* immutable response — nothing to do */
      }
    }
    return response;
  };

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
    return stamp(
      new Response(null, {
        status: PUNCTUATION_REDIRECT_STATUS,
        headers: { Location: punctuationRedirect, 'Cache-Control': 'no-store' },
      }),
    );
  }

  const hostname = context.url.hostname;
  const isLeagueHost = Boolean(HOST_TO_SLUG[hostname]);

  context.locals.hideLeaguePrefix = isLeagueHost;

  // The shared app host is not a second front door for a league that has its
  // own. TheLeague and the AFL are served at theleague.us and afl-fantasy.com;
  // reaching them at mfl.football/theleague/* as well means two sets of links
  // to keep alive, two things for a search engine to index, and two places an
  // owner can be signed in. Best Ball #1 is deliberately unaffected — it has
  // no apex, so the path prefix here is the only address it has.
  //
  // Rewritten to a path no route claims rather than answered inline, so the
  // catch-all renders it: `[...path].astro` is where this repo's real 404
  // status lives (`Astro.response.status = 404`), and the visitor gets the
  // styled page. A bare `new Response(null, { status: 404 })` would be a blank
  // screen, and rewriting to `/404` would be a SOFT 404 — that page sets no
  // status, so it answers 200 and stays indexed, which is the opposite of
  // hiding it. The target is outside every league prefix, so this cannot
  // re-enter the branch even where a rewrite re-runs middleware.
  if (resolveSharedHostHiddenLeague(hostname, context.url.pathname)) {
    return stamp(await context.rewrite(new URL('/_not-found', context.url)));
  }

  if (!isLeagueHost) return stamp(await next());

  const rewrite = resolveLeagueRewrite(hostname, context.url.pathname);
  if (!rewrite) return stamp(await next());

  const newUrl = new URL(rewrite.newPath + context.url.search, context.url);
  return stamp(await context.rewrite(newUrl));
});
