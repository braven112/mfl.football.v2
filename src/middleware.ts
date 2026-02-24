/**
 * Astro Middleware
 *
 * Detects when the site is accessed via theleague.us domain and sets
 * a flag so link generation can omit the /theleague prefix, keeping
 * URLs clean (e.g., theleague.us/rosters instead of theleague.us/theleague/rosters).
 *
 * Vercel rewrites handle the actual URL → internal path mapping at the edge.
 * This middleware only sets context for link generation.
 */

import { defineMiddleware } from 'astro:middleware';

const THELEAGUE_HOSTS = new Set(['theleague.us', 'www.theleague.us']);

export const onRequest = defineMiddleware(async (context, next) => {
  const hostname = context.url.hostname;
  context.locals.hideLeaguePrefix = THELEAGUE_HOSTS.has(hostname);
  return next();
});
