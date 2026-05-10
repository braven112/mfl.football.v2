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
import { HOST_TO_SLUG, resolveLeagueRewrite } from './utils/league-host-map';

export const onRequest = defineMiddleware(async (context, next) => {
  const hostname = context.url.hostname;
  const isLeagueHost = Boolean(HOST_TO_SLUG[hostname]);

  context.locals.hideLeaguePrefix = isLeagueHost;

  if (!isLeagueHost) return next();

  const rewrite = resolveLeagueRewrite(hostname, context.url.pathname);
  if (!rewrite) return next();

  const newUrl = new URL(rewrite.newPath + context.url.search, context.url);
  return context.rewrite(newUrl);
});
