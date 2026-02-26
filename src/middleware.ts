/**
 * Astro Middleware
 *
 * Handles two concerns for the theleague.us domain:
 *
 * 1. URL rewriting: Rewrites clean URLs (e.g., /rosters) to their internal
 *    Astro route (e.g., /theleague/rosters) using context.rewrite(). This is
 *    needed because Vercel's vercel.json rewrites don't fire before the Astro
 *    SSR catch-all route in the build output config.
 *
 * 2. Link generation flag: Sets context.locals.hideLeaguePrefix so components
 *    can generate clean links without the /theleague prefix on theleague.us.
 *
 * Vercel 301 redirects in vercel.json still handle catching leaked /theleague/*
 * links at the edge before this middleware runs.
 */

import { defineMiddleware } from 'astro:middleware';

const THELEAGUE_HOSTS = new Set(['theleague.us', 'www.theleague.us']);

/** Paths that exist at the root level and should NOT be rewritten to /theleague/* */
const SKIP_REWRITE_PREFIXES = [
  '/api/',
  '/afl-fantasy',
  '/_astro/',
  '/_image',
  '/_server-islands/',
  '/forum/',
  '/404',
  '/favicon.ico',
  '/assets/',
  '/manifest.json',
];

export const onRequest = defineMiddleware(async (context, next) => {
  const hostname = context.url.hostname;
  const isTheLeagueHost = THELEAGUE_HOSTS.has(hostname);

  context.locals.hideLeaguePrefix = isTheLeagueHost;

  if (isTheLeagueHost) {
    const path = context.url.pathname;

    // Already has /theleague prefix — no rewrite needed
    if (path.startsWith('/theleague')) {
      return next();
    }

    // Skip rewrite for root-level paths (API, AFL, static assets, forum)
    const shouldSkip = SKIP_REWRITE_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (shouldSkip) {
      return next();
    }

    // Rewrite / → /theleague, /rosters → /theleague/rosters, etc.
    const newPath = path === '/' ? '/theleague' : `/theleague${path}`;
    const newUrl = new URL(newPath + context.url.search, context.url);
    return context.rewrite(newUrl);
  }

  return next();
});
