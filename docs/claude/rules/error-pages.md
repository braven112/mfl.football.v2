# Error pages — what a crash looks like from the outside

Every rule here is a bug that shipped. The domain is small but it decides how
every other outage in this repo *presents*, which is why it gets its own doc.

Files: `src/pages/500.astro`, `src/pages/404.astro`, `src/pages/[...path].astro`.
Guard: `tests/ssr-error-page-status.test.ts`.

## `src/pages/500.astro` must exist, or every crash renders as a 404

**This is the whole doc.** Astro resolves its error page by *exact route*
(`astro/dist/core/routing/match.js`):

```js
if (isRoute500(pathname)) {
  const errorRoute = manifest.routes.find((r) => isRoute500(r.route));
  if (errorRoute) return errorRoute;          // a route whose path IS `/500`
}
return manifest.routes.find((r) => r.pattern.test(pathname) || …);
```

With no `500.astro` the first branch finds nothing and the fall-through matches
`[...path].astro` — the shared-host router, which pins
`Astro.response.status = 404`. Astro returns *that page's* status, so a
frontmatter throw anywhere on the site came back as **404 with the styled 404
page**.

On 2026-09-08 `theleague.us/rosters` threw a `TypeError` in frontmatter for
every owner on TheLeague. Because the throw surfaced as a 404, a total outage
looked like a deleted route: the build being wrong, a Vercel rewrite problem
and a stale deployment were all chased and ruled out before anyone read the
runtime logs. `astro dev` had been reporting an honest **500** the entire time —
only production lied, because only production has the built manifest that the
catch-all lives in.

Deleting `500.astro` reinstates all of that silently. Nothing else fails: the
site builds, serves, and renders a plausible page. That is why there is a guard.

**Corollary — the catch-all is load-bearing in both directions.**
`[...path].astro` cannot simply be removed either; it exists so that clean apex
URLs (`theleague.us/rosters`) don't hit the Vercel adapter's fallback route,
which force-pins 404 and killed every logged-out Schefter tip link in July 2026.
The two error routes have to coexist: the catch-all answers *unknown paths*, and
`500.astro` answers *crashes*. Changing either, read the other's header comment
first.

## Triage: a 404 **with an error payload** is a throw, not a missing route

In the Vercel runtime logs the tell is the bracketed suffix:

```
GET /theleague/rosters 404 [error/serverless]     ← a crash
GET /theleague/nonsense 404                       ← genuinely no such route
```

`mcp__Vercel__get_runtime_logs` filtered to the route found the real stack in
one call, after hours of reading found nothing. Reach for production telemetry
*first* on any "the page is 404ing" report — reading code cannot see which of
the two you have.

Since the follow-up, `500.astro` also logs every SSR throw server-side under a
fixed prefix, so the query is now literally one string:

```
[ssr-500] GET /theleague/rosters — TypeError: …
```

Keep that prefix. It is pinned by the guard test precisely because a renamed
prefix would cost the next outage the same afternoon.

## Do not read a mixed 200/404 stream as flakiness

Both leagues serve `/rosters`, `/lineup`, `/standings` and most other paths. In
the 2026-09-08 log window the interleaved 200s were AFL requests (league
`19621` in the body) while TheLeague's were all 404. The route looked
intermittent; it was not. Split the log by league before concluding anything
about consistency.

## The error pages are not in the page directory, on purpose

`src/data/page-directory.json` is the site-search index. `404.astro` and
`500.astro` are deliberately absent — nobody searches for the error page, and
`tests/helpers/astro-routes.ts` documents that the directory is an index a real
route may legitimately be missing from. Do not "fix" this by adding entries.

## Keep `500.astro`'s frontmatter boring

It runs on the path where something has already failed. If it throws too,
Astro retries once with middleware skipped and then gives up and serves a
bodiless 500 — the reader gets a blank page and you get nothing in the log. So:
no data loading, no Redis, no MFL fetch, no `Astro.cookies.set()`. Pure
resolution of the league from the host, and the log line.

For the same reason it must stay server-rendered (`export const prerender =
false`). Astro's prerendered-error-page branch fetches a static file instead of
rendering with `initialProps = { error }`, which would silently drop both the
error object and the log line.
