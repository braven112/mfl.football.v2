import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard: an SSR throw must surface as a 500, not as the 404 page.
 *
 * On 2026-09-08 `theleague.us/rosters` threw a TypeError in frontmatter for
 * every owner on TheLeague. Production answered **404**, with our styled 404
 * page and no `x-vercel-error` header, so a total outage looked like a deleted
 * route — three wrong theories were chased before the Vercel runtime logs
 * showed the real stack. `astro dev` had said 500 the whole time.
 *
 * The mechanism is Astro's error-route lookup, in
 * `astro/dist/core/routing/match.js`:
 *
 *     if (isRoute500(pathname)) {
 *       const errorRoute = manifest.routes.find((r) => isRoute500(r.route));
 *       if (errorRoute) return errorRoute;          // exact `/500` route
 *     }
 *     return manifest.routes.find((r) => r.pattern.test(pathname) || …);
 *
 * With no `src/pages/500.astro`, the first branch found nothing and the
 * fall-through matched `[...path].astro` — the shared-host router, which pins
 * `Astro.response.status = 404`. Astro then returned that page's own status,
 * so every crash on the site rendered as a 404.
 *
 * Deleting `src/pages/500.astro` silently reinstates that. Nothing else in the
 * repo would fail: the site still builds, still serves, still renders a
 * plausible page. That is exactly the shape of bug this file exists to stop.
 *
 * See docs/claude/followups/2026-09-08-roster-page-unpaired-week-404.md (F1).
 */

const ROOT = process.cwd();
const ERROR_PAGE = 'src/pages/500.astro';
const CATCH_ALL = 'src/pages/[...path].astro';

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('Astro can find a real /500 route', () => {
  it('src/pages/500.astro exists', () => {
    expect(
      existsSync(join(ROOT, ERROR_PAGE)),
      'Astro looks up its error page by the exact route `/500`. Without this ' +
        'file the lookup falls through to `[...path].astro`, which pins 404 — ' +
        'and every SSR crash on the site renders as a missing page.',
    ).toBe(true);
  });

  it('the catch-all would absorb /500, which is why the exact route must exist', () => {
    // The reason this guard is not merely "a file exists". `[...path].astro`
    // matches literally every path, /500 included, and answers 404.
    const catchAll = read(CATCH_ALL);
    expect(catchAll, `${CATCH_ALL} no longer pins 404; re-check the /500 fall-through`)
      .toMatch(/Astro\.response\.status\s*=\s*404/);
    expect(existsSync(join(ROOT, 'src/pages/404.astro'))).toBe(true);
  });
});

describe('500.astro answers with the status it is named for', () => {
  it('sets Astro.response.status = 500', () => {
    // Explicit, not inherited: it makes a direct GET /500 honest as well as
    // the error-handler render, and it is the same assignment the catch-all
    // uses for 404.
    expect(read(ERROR_PAGE)).toMatch(/Astro\.response\.status\s*=\s*500/);
  });

  it('is server-rendered, so the handler can hand it the error', () => {
    // Astro's prerendered-error-page branch fetches a static file instead of
    // rendering with `initialProps = { error }`. Prerender this and the log
    // line below never runs and the error is lost again.
    expect(read(ERROR_PAGE)).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });
});

describe('a crash leaves one greppable line in the runtime logs', () => {
  it('500.astro logs the error server-side under a fixed prefix', () => {
    const source = read(ERROR_PAGE);
    expect(
      source,
      'The 2026-09-08 outage was found by filtering Vercel runtime logs. Keep ' +
        'the `[ssr-500]` prefix so that stays a one-call query.',
    ).toMatch(/console\.error\(\s*[`'"]\[ssr-500\]/);
  });

  it('does not render the error into the response body', () => {
    // The stack belongs in the server log, not in every visitor's browser.
    const [, template = ''] = read(ERROR_PAGE).split(/^---$/m).slice(1);
    expect(template).not.toMatch(/\{\s*error\b/);
  });
});

describe('the retry link cannot leave the site', () => {
  it('rejects a protocol-relative pathname', () => {
    // `new URL('https://theleague.us//evil.com').pathname` is `//evil.com`,
    // which as an href is a protocol-relative link off-site. The path that
    // threw is attacker-influenced, so it is checked before it becomes an
    // anchor.
    expect(read(ERROR_PAGE)).toMatch(/startsWith\(\s*['"]\/\/['"]\s*\)/);
  });
});
