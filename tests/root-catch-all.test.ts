import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Root catch-all route — regression guard.
 *
 * Clean apex-domain URLs (theleague.us/rosters, afl-fantasy.com/schefter/tip)
 * match no explicit page route. Without a root [...path].astro page, they fall
 * through to the Vercel adapter's fallback route, which carries a forced
 * `status: 404` — so the middleware host-rewrite rendered the right page body
 * but the response status was 404, and redirects (the Schefter tip page's
 * login bounce) died outright. That is how every GroupMe tip link broke for
 * logged-out owners in July 2026.
 *
 * The catch-all page must stay: (a) present, (b) server-rendered so it lands
 * in the SSR manifest as a real route, and (c) an honest 404 for the paths
 * that genuinely reach it.
 */

const pagePath = path.resolve(__dirname, '..', 'src', 'pages', '[...path].astro');

describe('root [...path].astro catch-all', () => {
  it('exists — clean apex URLs must match a real route, not the forced-404 fallback', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  const src = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : '';

  it('is server-rendered (prerender = false) so it stays in the SSR route manifest', () => {
    expect(src).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });

  it('returns an honest 404 status for genuinely unknown paths', () => {
    expect(src).toMatch(/Astro\.response\.status\s*=\s*404/);
  });

  it('renders the styled 404 page', () => {
    expect(src).toMatch(/import\s+\w+\s+from\s+['"]\.\/404\.astro['"]/);
  });
});
