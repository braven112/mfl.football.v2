# Release review — 2026-10-25

**Verdict: GO, released, over a game-day blackout on the owner's explicit override.**
`main` fast-forwarded `61f04c79 → 6b11f780` at about 07:10 UTC (00:10 PT, Sunday Oct 25).
Production deployment `dpl_G99uBMiPiSVhMkqoVZBzqabFmtZT` went READY within a few minutes.
Rollback candidate: `dpl_3Ry8LvA4ddbMyM82uCctR7E9xKFE` (`61f04c79`).

`scripts/release-blackout.mjs` said "Sunday 2026-10-25 — DO NOT PROMOTE". The owner picked
"Release now, rivalries included" on a decision card that named the blackout. Kickoff was
about 10 hours away, which left time to roll back.

## What shipped

- League History: the history home page, Record Book and franchise pages (#1484), owner pages
  in the Trophy Room look (#1487), rivalry pair pages (#1488), and the Rivalries index with
  the pair page sharing one record per pairing (#1489, #1490). History stays gated by
  `canViewLeagueHistory`. The history franchise page replaces `/<league>/franchises/<id>`.
- Owner Map: hometown map, picker, commissioner import, and a franchise mini map (#1481).
- Pecking Order map: Top 3, Full order and Movers (#1486).
- Visual Matchup Preview: a Game of the Week panel and Tale of the Tape cards (#1478), plus
  hometown mini maps and hometown flavor for Schefter (#1485). It first runs on the next
  Saturday preview.
- MFL Live: the Broadcast in real rooms on the home page (#1482), and the Broadcast steered
  with the TV remote (#1483).
- Fixes: AFL 2007-2015 weekly scores restored, with credits for 2015-2020 (#1479); the Top
  Players Owner column now reads live rosters (#1480).
- The 2026-10-24 release record (#1477).

## Left out

- **The Redis draft server and mock draft (#1471, #1472).** Neither is on staging. Both
  branches were checked and are not ancestors of `6b11f780`.

## Gates

- Merge-down was healthy, and its run for the 07:02 roster sync finished before promotion.
- Staging CI (Tests and Type baseline) was green on `6b11f780`, the exact tip that was
  promoted.
- Blackout: overridden by the owner, as described above.

## Verified on production

- Vercel showed no runtime errors in the 15 minutes after READY.
- `/theleague/pecking-order` returned 200. Its map renders with real cities from production
  Redis (Ames, IA for No. 1). That confirms the hometowns Brandon entered on the #1481
  preview are in the production store, so the Saturday Schefter job will have them.
- `/theleague/franchises/0001` and `/theleague/rivalries` returned 200.
  `/afl-fantasy/history` returned the sign-in page while signed out, which is the
  expected gate.

## Not run, or noted

- The weekly changelog rollup was not dispatched. It is still the week of 2026-10-19, which
  has already published, so a dispatch would stand down. Monday's cron (Oct 26) publishes
  this release together with the 2026-10-24 queue.
- Release-review lenses not run: gemini sweep, sibling-drift, guard-gap.
- Next, for the Tuesday (Oct 27) release: the Rivalries index redesign.

## Second release, same day

**Verdict: GO, released over the same Sunday blackout on the owner's explicit word ("finish
the release").** `main` fast-forwarded `8ea39f5b → f16bfdc9` at about 15:27 UTC (08:27 PT).
Production deployment `dpl_7Cxhd4UN7ZgvLHb3qtCjCHXiVzRN`. Rollback candidate:
`dpl_DhTGbkXfVbs7zhg2cAp1dKRkbEES` (`8ea39f5b`, a roster sync on top of the morning release).

- **#1492:** League History on afl-fantasy.com answered **508 Loop Detected** for a signed-in
  viewer who failed the gate. The page's `Astro.rewrite('/_not-found')` re-ran the league-host
  middleware, which re-prefixed the target until Astro's rewrite guard tripped.
  `/_not-found` now skips the rewrite, so that viewer gets a 404. The same PR lets the site
  owner's AFL commissioner seat (AFL 0001) VIEW League History. Sessions are per domain, so
  the TheLeague seat never reaches the AFL host. Fixing champions stays with the insights seat.
- Gates: staging CI (Tests and Type baseline) was green on `f16bfdc9`. The PR's Vercel preview
  failed with the known stale branch build cache (`cookie` `parseCookie`), not the code.
