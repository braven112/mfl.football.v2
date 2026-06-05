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
 * Vercel 301 redirects in vercel.json still handle catching leaked /<slug>/*
 * links at the edge before this middleware runs.
 *
 * The host → slug map and the path-rewrite logic live in
 * src/utils/league-host-map.ts and are unit-tested.
 */

import { defineMiddleware } from 'astro:middleware';
import {
  HOST_TO_SLUG,
  resolveLeagueRewrite,
  buildClientRedirectHtml,
} from './utils/league-host-map';

export const onRequest = defineMiddleware(async (context, next) => {
  const hostname = context.url.hostname;
  const isLeagueHost = Boolean(HOST_TO_SLUG[hostname]);

  context.locals.hideLeaguePrefix = isLeagueHost;

  if (!isLeagueHost) return next();

  const rewrite = resolveLeagueRewrite(hostname, context.url.pathname);
  if (!rewrite) return next();

  const newUrl = new URL(rewrite.newPath + context.url.search, context.url);
  const response = await context.rewrite(newUrl);

  // Clean (non-prefixed) league-host URLs resolve only via the rewrite above,
  // so they fall through to the Vercel build-output SSR fallback route, which
  // carries `status: 404`. A 200 render overrides that status, but a 3xx
  // server redirect does NOT — Vercel returns it as a 404 (the Location header
  // survives, but browsers ignore it). That silently 404s every server
  // redirect on a clean URL, e.g. the login gate on /schefter/tip (confirmed:
  // 302s correctly in dev, 404s in prod). Re-issue GET redirects as a 200 HTML
  // document the browser follows; the fallback leaves 200s intact. Non-GET
  // requests keep the native 3xx (page forms post to /api/*, which skip the
  // rewrite, so this is effectively GET-only in practice).
  if (
    context.request.method === 'GET' &&
    response.status >= 300 &&
    response.status < 400
  ) {
    const location = response.headers.get('location');
    if (location) {
      const headers = new Headers({
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      // Preserve any cookies the redirect set (e.g. a session clear).
      const cookies = response.headers.getSetCookie?.() ?? [];
      for (const cookie of cookies) headers.append('set-cookie', cookie);
      return new Response(buildClientRedirectHtml(location), {
        status: 200,
        headers,
      });
    }
  }

  return response;
});
