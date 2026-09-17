---
slug: pecking-order-permalink-500
status: open
severity: P1
opened: 2026-09-17
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1144
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: every Pecking Order issue permalink 500s in production

## What's broken

`/<league>/pecking-order/<year>/<week>` returns **HTTP 500** on both leagues'
apex hosts, for every issue, and has for at least as long as the 2025 archive
has existed. Verified live on 2026-09-17:

```
500  https://www.theleague.us/pecking-order/2026/1
500  https://www.theleague.us/pecking-order/2025/17
500  https://www.theleague.us/pecking-order/2025/16
500  https://www.afl-fantasy.com/pecking-order/2025/14
301  https://www.theleague.us/theleague/pecking-order/2026/1  → the bare path above (so it 500s too)
```

The landing page `/pecking-order` is fine (200). It is the per-issue permalink
that fails — which is the page the archive nav links, and the page the Owners'
Poll reveal feed post links as its `link`
(`buildRevealFeedPost` sets `link = ${COLUMN_PATH}/${year}/${week}`).

## The likely cause

`src/pages/*/pecking-order/[year]/[week].astro` declares
`export const prerender = true`. `src/pages/*/news/[id].astro` carries the
opposite setting and says exactly why:

> Server-rendered so the theleague.us middleware rewrite works correctly
> (prerendered static files bypass middleware on Vercel).

On a league apex host the bare path is canonical and `src/middleware.ts` →
`resolveLeagueRewrite` is what maps `/pecking-order/2026/1` onto the real Astro
route `/theleague/pecking-order/2026/1`. A prerendered route does not get that
rewrite, and `vercel.json` has no generic apex rewrite to fall back on — its
only rewrites are the two `/forum/:path*` proxies.

So the fix is probably dropping `prerender = true` from both permalink routes
(and keeping `getStaticPaths` off, or letting it stay for the shared host).
**This was not verified** — it needs a preview deploy, which is why it was not
folded into PR #1144.

## Why it was deferred

Found during PR #1144's cross-cutting pass, as a side effect of needing a
readiness probe for the Owners' Poll announcements. It is pre-existing, it is
not what that PR set out to fix, and the fix changes a route's rendering
strategy — which deserves its own preview verification rather than riding along
with an unrelated change.

## What #1144 did instead

It did **not** ship a probe against a route that can only time out. Both
Pecking Order lanes queue their announcement (so it still cannot go out ahead
of the commit step, and cannot go out at all if that step failed) but pass
`verifyPath: null` — no wait. The Schefter column lane's probe is unaffected
and was verified live: a real article permalink answers 200, a missing one 302s
to the news index.

## What to do when this is fixed

1. Fix the 500 and confirm on a preview deploy, both leagues.
2. Give the Tuesday column back its probe:
   `verifyPath: issuePermalink(league, year, week)` in `queueAnnouncement`
   (`scripts/generate-pecking-order.mjs`). That route is prerendered per issue,
   so an undeployed week has no path — the readiness signal is honest once the
   route serves at all.
3. The Thursday reveal needs **more than a status code**, because it AMENDS an
   issue whose permalink has answered 200 since Tuesday. The design that was
   built and then removed from #1144: a `data-poll-status={poll.status}`
   attribute on `OwnersPollSection.astro`'s root, and an `expectBody` option on
   `awaitPublished` that requires the body to contain
   `data-poll-status="closed"` before a 200 counts. Both are in #1144's history
   if they are wanted back rather than rewritten.
4. While in there: the reveal feed post's own `link` is one of the 500ing URLs,
   so it has been a dead "read more" for every reveal so far.
