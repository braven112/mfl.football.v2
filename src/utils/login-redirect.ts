/**
 * Sign-in return paths — "send me back where I was trying to go".
 *
 * THE ONE PLACE that builds a sign-in URL and the one place that decides
 * whether a return path may be followed. Before this module the same twelve
 * lines lived in three login pages and disagreed in three ways:
 *
 *   - TheLeague's gates emitted `?redirect=`, the AFL's `?next=`, and
 *     afl-fantasy/throwback-settings emitted `?redirect=` into a page that
 *     only worked because it happened to read both.
 *   - best-ball-1/login read `next` ALONE, so a `?redirect=` link there was
 *     silently dropped and the owner landed on the league home.
 *   - Each page validated with its own `startsWith('/<slug>')`, so league #4
 *     would have been a fourth copy — exactly what the registry rule in
 *     CLAUDE.md exists to prevent.
 *
 * `?next=` IS THE EMITTED PARAM. `?redirect=` stays READABLE forever: links
 * already sit in GroupMe messages, Schefter posts and owners' bookmarks, and
 * breaking those to tidy up a param name is a bad trade.
 * tests/login-redirect-guard.test.ts pins that emitters only ever write `next`.
 *
 * VALIDATION IS AGAINST THE LEAGUE BEING SIGNED INTO, not merely against
 * same-origin. Dual-league owners are real: an owner signed into TheLeague can
 * follow an AFL gate, and a same-origin-only check would happily return them
 * to `/theleague/lineup` after they authenticated against the AFL — landing
 * them on a page their fresh session cannot read. Same reason the rankings
 * scope is per-league: both leagues have a franchise 0001.
 *
 * APEX HOSTS ARE THE SHARP EDGE. On theleague.us the middleware rewrites
 * `/lineup` → `/theleague/lineup` and sets `locals.hideLeaguePrefix`. So a
 * return path arrives UNPREFIXED on the apex host and PREFIXED on the shared
 * host, and the sign-in URL has to go back out in whichever shape the visitor
 * is browsing. Get this wrong and the gate 302s to a prefixed URL that Vercel
 * 301s straight back — a redirect loop that appears on production only and
 * never on a preview deployment. Both directions are pinned by test.
 */

import {
  type LeagueDefinition,
  ensureLeaguePrefix,
  stripLeaguePrefix,
} from '../config/leagues';
// The prebuilt map, not buildHostToSlugMap() — this runs on every gated page
// load and the constant is built once at module load from the same registry.
import { HOST_TO_SLUG } from './league-host-map';

/**
 * The query parameter every gate writes.
 *
 * Exported so tests and the guard scan reference the constant rather than
 * retyping the string.
 */
export const RETURN_PARAM = 'next';

/**
 * Parameters a login page accepts, newest first. `redirect` is legacy-read
 * only — see the module note. Order matters: `next` wins when both appear.
 */
export const ACCEPTED_RETURN_PARAMS = ['next', 'redirect'] as const;

/**
 * Is this path safe to send a browser to after sign-in?
 *
 * Rejects everything that is not a plain, same-origin, this-league path:
 * absolute URLs, protocol-relative `//evil.com` (which passes a naive
 * `startsWith('/')`), backslash variants that some engines normalize into
 * slashes, control characters, and paths belonging to a DIFFERENT league.
 *
 * Returns the path in its INTERNAL (prefixed) form — `/theleague/lineup` —
 * regardless of which shape it arrived in, so callers have one thing to
 * reason about. Use `loginUrlFor`/`resolveLeaguePath` to put it back into the
 * visitor's shape on the way out.
 */
export function safeReturnPath(
  requested: string | null | undefined,
  league: LeagueDefinition,
): string | null {
  // Everything that is not league-specific — off-site values, control
  // characters, protocol-relative and scheme-only strings, `..` segments —
  // is the same question `sameOriginPath` answers, so ask it once.
  const sameOrigin = sameOriginPath(requested);
  if (!sameOrigin) return null;

  // `/theleague/lineup?week=3#roster` → compare only the path portion, but
  // preserve the query and hash on the way back out. A gate that carried its
  // own query (schefter/tip does) must not lose it at the door.
  const pathEnd = sameOrigin.search(/[?#]/);
  const pathOnly = pathEnd === -1 ? sameOrigin : sameOrigin.slice(0, pathEnd);
  const suffix = pathEnd === -1 ? '' : sameOrigin.slice(pathEnd);

  // Normalize to the internal, prefixed form. On an apex host the visitor's
  // path has no prefix, so this is what makes `/lineup` and
  // `/theleague/lineup` the same answer.
  const prefixed = ensureLeaguePrefix(league, pathOnly);

  // The league check. `ensureLeaguePrefix` passes cross-league paths through
  // untouched (that is its documented contract), so an AFL path handed to
  // TheLeague still reads `/afl-fantasy/...` here and fails.
  const ownPrefix = `/${league.slug}`;
  if (prefixed !== ownPrefix && !prefixed.startsWith(`${ownPrefix}/`)) return null;

  return prefixed + suffix;
}

/**
 * Same-origin path validation WITHOUT the league check or the prefix rewrite.
 *
 * `safeReturnPath` does three things — rejects off-site values, rewrites the
 * path into this league's prefixed form, and rejects other leagues' paths.
 * The middle one is wrong for a caller that belongs to no league: LoginForm is
 * shared with the MFL app at `/login`, whose board lives at `/live`, and
 * running that through the league validator rewrote it to `/theleague/live` —
 * a route that does not exist, so every sign-in on the shared host 404'd.
 *
 * So this is the half a league-less caller wants: is it a plain, same-origin
 * path? Nothing more.
 *
 * YES, THIS OVERLAPS `resolveMflLoginRedirect` in mfl-login-redirect.ts, and
 * the two are deliberately NOT merged. That module is dependency-free on
 * purpose (its header says so, and it has zero imports) because it is the
 * security-relevant half of the shared host's login and is exercised directly;
 * this file imports the league registry. Collapsing them would either drag the
 * registry into that module or move this one's league logic out. The sibling
 * also carries two rules this does not — it refuses `/login` itself and drops
 * the fragment — so they are not the same function wearing two names.
 */
export function sameOriginPath(requested: string | null | undefined): string | null {
  if (!requested) return null;
  if (/[\u0000-\u0020\u007f]/.test(requested)) return null;
  if (requested.includes('\\')) return null;
  if (requested.includes('://') || /^[a-z][a-z0-9+.-]*:/i.test(requested)) return null;
  if (!requested.startsWith('/') || requested.startsWith('//')) return null;
  const pathOnly = requested.split(/[?#]/)[0] ?? '';
  if (pathOnly.split('/').includes('..')) return null;
  return requested;
}

/** Where a gate sends someone when there is no usable return path. */
export function loginFallbackPath(league: LeagueDefinition): string {
  return `/${league.slug}`;
}

/** Why a gate refused someone. Selects a fixed message on the 403 route. */
export type ForbiddenReason = 'commissioner' | 'league';

/**
 * The 403 route for a league — "You didn't ask Roger first."
 *
 * THE OTHER HALF OF A GATE. A gate answers two different questions and they
 * had collapsed into one `Astro.redirect('/theleague')`:
 *
 *   - NOT SIGNED IN → `loginUrlForRequest`, carrying a return path. Signing in
 *     may well be all they needed; a commissioner with an expired session hit
 *     this constantly and was simply dumped on the homepage.
 *   - SIGNED IN, NOT ALLOWED → here. Signing in again cannot help, so sending
 *     them to a login form would be a loop with extra steps.
 *
 * Use it with `Astro.rewrite()`, not `Astro.redirect()`, so the URL stays on
 * the page they were denied:
 *
 *     if (!user) return Astro.redirect(loginUrlForRequest(Astro, league));
 *     if (!isCommissionerOrAdmin(user)) return Astro.rewrite(forbiddenPathFor(league));
 */
export function forbiddenPathFor(
  league: LeagueDefinition,
  reason: ForbiddenReason = 'commissioner',
): string {
  return `/${league.slug}/forbidden?why=${reason}`;
}

/** The league's sign-in route, in internal (prefixed) form. */
export function loginPathFor(league: LeagueDefinition): string {
  return `/${league.slug}/login`;
}

export interface LoginUrlOptions {
  /** The league whose sign-in page this is. From the registry, never a literal. */
  league: LeagueDefinition;
  /**
   * Where to return afterwards. Usually `Astro.url.pathname + Astro.url.search`.
   * Validated by `safeReturnPath`; an unusable value simply yields a bare
   * sign-in URL rather than throwing, because a gate must always be able to
   * redirect somewhere.
   */
  returnTo?: string | null;
  /**
   * `Astro.locals.hideLeaguePrefix` — true on the league's apex host, where
   * paths are served without the `/<slug>` prefix. Defaults to false (the
   * shared host), which is the safe assumption off-apex.
   */
  hideLeaguePrefix?: boolean;
}

/**
 * Build the sign-in URL for a gate. THE only way to construct one.
 *
 * Both the login path and the return path are emitted in the visitor's own
 * shape — clean on an apex host, prefixed on the shared host — so the browser
 * is never handed a URL that the edge will immediately redirect again.
 */
export function loginUrlFor({
  league,
  returnTo,
  hideLeaguePrefix = false,
}: LoginUrlOptions): string {
  const loginPath = applyPrefixVisibility(loginPathFor(league), league, hideLeaguePrefix);
  const safe = safeReturnPath(returnTo, league);
  if (!safe) return loginPath;

  // Never bounce someone from the login page back to the login page.
  if (stripQuery(safe) === loginPathFor(league)) return loginPath;

  const visible = applyPrefixVisibility(safe, league, hideLeaguePrefix);
  return `${loginPath}?${RETURN_PARAM}=${encodeURIComponent(visible)}`;
}

/**
 * The shape a gate reads off the `Astro` global. Structural, so `Astro`
 * satisfies it without an import and the function stays unit-testable.
 */
export interface LoginRedirectContext {
  url: URL;
  locals: { hideLeaguePrefix?: boolean };
}

/**
 * `loginUrlFor` for the common case: return the visitor to the page they are
 * standing on, in whichever prefix shape this host serves.
 *
 * THE ONE-LINER IS THE POINT. A gate spelled out as a four-line object literal
 * pushed `theleague/draft/mock/[sessionId].astro` over the 80-line fork
 * threshold in `tests/page-fork-ratchet.test.ts` — the ratchet correctly
 * reading "this page grew" as "this page is forking". A gate should cost one
 * line, so keep it one line:
 *
 *     if (!user) return Astro.redirect(loginUrlForRequest(Astro, league));
 *
 * `Astro.redirect()` still lives in the PAGE, which it must — from a component
 * it only blanks the body (CLAUDE.md, the `/cr` note).
 */
export function loginUrlForRequest(
  ctx: LoginRedirectContext,
  league: LeagueDefinition,
): string {
  return loginUrlFor({
    league,
    returnTo: ctx.url.pathname + ctx.url.search,
    hideLeaguePrefix: hostHidesPrefixFor(ctx, league),
  });
}

/**
 * May this host serve THIS league's paths without their prefix?
 *
 * `Astro.locals.hideLeaguePrefix` answers "is this a league apex host", which
 * is not the same question. A league's apex serves its OWN pages unprefixed
 * but keeps every other league's prefix — `SKIP_REWRITE_PREFIXES` in
 * league-host-map.ts lists all of them precisely so a cross-league deep link
 * (`theleague.us/afl-fantasy/lineup`) still resolves to the AFL page.
 *
 * Stripping on the flag alone turned the AFL gate on that URL into
 * `/login?next=/lineup`, which theleague.us answers with TheLeague's sign-in
 * and TheLeague's lineup — the exact cross-league bounce this module exists to
 * stop. So the prefix comes off only when the league being signed into is the
 * host's own.
 */
function hostHidesPrefixFor(ctx: LoginRedirectContext, league: LeagueDefinition): boolean {
  if (!ctx.locals?.hideLeaguePrefix) return false;
  return HOST_TO_SLUG[ctx.url.hostname] === league.slug;
}

/**
 * Read the return path off a login page's own URL, honoring both the emitted
 * `?next=` and the legacy `?redirect=`, and validating against this league.
 *
 * Returns the INTERNAL (prefixed) path, which is what `Astro.redirect()`
 * wants — Astro resolves it against the current host, and the middleware
 * rewrite makes the prefixed form correct on the apex host too.
 */
export function readReturnPath(
  url: URL,
  league: LeagueDefinition,
): string | null {
  for (const param of ACCEPTED_RETURN_PARAMS) {
    const safe = safeReturnPath(url.searchParams.get(param), league);
    if (safe) return safe;
  }
  return null;
}

/**
 * The destination a successful sign-in should land on: the requested page, or
 * the league home. Never null, so callers cannot forget the fallback.
 */
export function resolveLoginDestination(
  url: URL,
  league: LeagueDefinition,
): string {
  return readReturnPath(url, league) ?? loginFallbackPath(league);
}

/** Put an internal path into the visitor's shape for this host. */
function applyPrefixVisibility(
  path: string,
  league: LeagueDefinition,
  hideLeaguePrefix: boolean,
): string {
  if (!hideLeaguePrefix) return path;
  const stripped = stripLeaguePrefix(league, path);
  return stripped === '' ? '/' : stripped;
}

function stripQuery(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}
