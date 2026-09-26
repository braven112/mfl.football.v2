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
import { isDemoDeploy, shouldBlockIndexing } from './utils/deploy-environment';
import { isDemoOnlyPath, isDemoRefusedPath, resolveDemoPath, rewriteDemoHtml } from './utils/demo-isolation-core.mjs';
import { demoLeaguePaths } from './config/leagues-data.mjs';
import { DEMO_START_PATH } from './utils/demo-access-core.mjs';
import type { MiddlewareHandler } from 'astro';
import { getAuthUser } from './utils/auth';
import { demoTokenFromUserId, lookupDemoLink } from './utils/demo-access';
import { demoRequestContext } from './utils/demo-request-context';
import { setDemoMflAnswer } from './utils/demo-isolation';

// The custom-site demo's MFL stand-in. `__DEMO_BUILD__` is a compile-time
// constant (astro.config.ts `vite.define`), so every other build sees
// `if (false)` and drops the stand-in and its loaders entirely.
if (typeof __DEMO_BUILD__ !== 'undefined' && __DEMO_BUILD__) {
  setDemoMflAnswer(async (url, method, body) =>
    (await import('./utils/demo-mfl-standin')).answerDemoMfl(url, method, body),
  );
}

const handle: MiddlewareHandler = async (context, next) => {
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

  // The custom-site demo carries only one league — a fictional one in
  // TheLeague's slot (docs/plans/custom-site-demo.md). The other leagues'
  // routes are deleted by the demo build; this refuses anything that still
  // reaches them at request time (never during prerender — no such page is
  // built there, and a rewrite at build time has no route to land on).
  if (isDemoDeploy() && !context.isPrerendered && isDemoRefusedPath(context.url.pathname)) {
    return stamp(await context.rewrite(new URL('/_not-found', context.url)));
  }
  // …and the other way round: a demo-only slot's routes do not exist anywhere else.
  if (!isDemoDeploy() && !context.isPrerendered && isDemoOnlyPath(context.url.pathname)) {
    return stamp(await context.rewrite(new URL('/_not-found', context.url)));
  }
  // `originPathname` differs from the current path only when this run is the
  // re-entry after a rewrite — Astro runs middleware again for the rewritten
  // path, and routing it a second time would bounce /theleague/x back to
  // /dynasty/x forever.
  // Astro normalizes the stored origin (a trailing slash may be added), so
  // compare without one.
  const bare = (p: string) => p.replace(/\/+$/, '') || '/';
  const isRewriteReentry =
    context.originPathname !== undefined && bare(context.originPathname) !== bare(context.url.pathname);
  if (isDemoDeploy() && !context.isPrerendered && !isRewriteReentry) {
    // A prospect signs in with their private link, never MFL credentials — the
    // demo has no MFL behind it. Send the sign-in page to the demo's front door.
    const login = context.url.pathname.match(/^(?:\/([\w-]+))?\/login\/?$/);
    if (login) {
      // Each demo league's sign-in goes to that league's own picker.
      const paths = demoLeaguePaths();
      const slot = login[1];
      const demoPath = slot && (paths[slot] ? slot : Object.keys(paths).find((p) => paths[p] === slot));
      return stamp(context.redirect(`/${demoPath || firstDemoPath()}${DEMO_START_PATH}`, 302));
    }
    // The demo host's front door is the pitch and questionnaire.
    if (context.url.pathname === '/') {
      return stamp(await context.rewrite(new URL('/demo' + context.url.search, context.url)));
    }
    // demo.mfl.football/dynasty/… serves TheLeague's route slot; the slot's
    // own name redirects to the demo path, so it never shows in a URL.
    const demo = resolveDemoPath(context.url.pathname, demoLeaguePaths());
    if (demo && 'redirect' in demo) {
      return stamp(context.redirect(demo.redirect + context.url.search, 302));
    }
    if (demo && 'rewrite' in demo) {
      return stamp(await context.rewrite(new URL(demo.rewrite + context.url.search, context.url)));
    }
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
};

/**
 * On the custom-site demo, every request runs inside the prospect's context —
 * read by the MFL stand-in and the Redis key namespace, so each prospect's
 * simulated league is theirs alone (docs/plans/custom-site-demo.md).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (!isDemoDeploy()) return (await handle(context, next)) as Response;
  const user = context.isPrerendered ? null : getAuthUser(context.request);
  const token = demoTokenFromUserId(user?.id);
  // A session lives only as long as its link: revoked or expired, the next
  // request signs the prospect out instead of waiting out the cookie.
  if (token && !(await demoLinkIsLive(token))) {
    const ended = context.url.pathname.startsWith('/api/')
      ? new Response(JSON.stringify({ message: 'This demo link has ended.' }), { status: 401 })
      : new Response(null, { status: 302, headers: { Location: `/${firstDemoPath()}${DEMO_START_PATH}?ended=1` } });
    ended.headers.append('Set-Cookie', 'session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    return ended;
  }
  return demoRequestContext.run(
    { token, franchiseId: user?.franchiseId || null },
    async () => withDemoLinks((await handle(context, next)) as Response),
  );
});

/** Link liveness, cached a minute per process so a page load isn't a Redis read per asset. */
const linkLiveCache = new Map<string, { live: boolean; at: number }>();
async function demoLinkIsLive(token: string): Promise<boolean> {
  const hit = linkLiveCache.get(token);
  if (hit && Date.now() - hit.at < 60_000) return hit.live;
  const live = Boolean(await lookupDemoLink(token).catch(() => null));
  linkLiveCache.set(token, { live, at: Date.now() });
  return live;
}

const firstDemoPath = () => Object.keys(demoLeaguePaths())[0];

/**
 * Point a demo page's links at the demo path (`/theleague/x` → `/dynasty/x`)
 * so navigation skips the redirect hop. HTML only; everything else untouched.
 */
async function withDemoLinks(response: Response): Promise<Response> {
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const html = rewriteDemoHtml(await response.text(), demoLeaguePaths());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
