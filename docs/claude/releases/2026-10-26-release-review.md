# Release review — 2026-10-26

**Verdict: GO, released a day early and over a game-day blackout, on the owner's explicit
word ("let's do a staging release to prod today when ready then we'll override").**
`main` fast-forwarded `b8ca8546 → 81ed0b15` at about 19:27 UTC (12:27 PT, Monday Oct 26).
Production deployment `dpl_4rH477DhJTUSGMf4Qg9ejfjYMJC8` went READY by 19:35 UTC.
Rollback candidate: `dpl_4EV9eZP9ddkwEPYQarsvAZqvr7P5` (`b8ca8546`).

`scripts/release-blackout.mjs` said "Monday 2026-10-26 — DO NOT PROMOTE" (a Monday in the
season). Monday Night Football was about five hours away, which left time to roll back.

## What shipped

- MFL Live store app, steps 1-3: the app sign-in token and the MFL-only board
  (`?source=mfl`) on the server (#1508), the Android app in `apps/mobile` (#1510), and the
  EAS build workflow (#1511). The plan of record for the store app (#1507).
- League History: Ask the History, with stats answered from the league's record (#1499) and
  a full-screen conversation plus "The league is asking" on the History home (#1502).
- The Rivalries index as one shared page in the League History design (#1505). This unforked
  `rivalries/index.astro`, so `page-fork-baseline.json` shrank by one.
- One definition of a head-to-head record, read everywhere (#1495).
- AFL: keeper history on franchise, owner and Record Book pages (#1500, with the 2005
  Rookies correction in #1503), draft-pick trades on franchise pages and the Record Book
  (#1504), and the Rafters showing every AFL title with rows by title kind (#1497, #1498).
- League History rafters hang every banner in its own era's colours (#1501). Bring The
  Pain's 2007-era logo lost its baked-in white square (#1506).
- The 2026-10-25 release record (#1496).

## Gates

- Merge-down was healthy. Its latest run, for the 19:05 Schefter scan, was green.
- `origin/main` was an ancestor of `origin/staging`, so the promotion was a fast-forward.
- Staging CI was green on `81ed0b15`, the exact tip that was promoted. Visual tests were
  green on the previous tip `138c4a09`; the last commit only adds a workflow file.
- Blackout: overridden by the owner, as described above.

## Review

- Stored shape: the only new Redis keys are `history-ask:<league>:…` (#1499, #1502). Nothing
  on `main` read that prefix, so production could not misread them.
- Ratchets: `typecheck-baseline.json` went 1316 → 1311, and `page-fork-baseline.json`
  dropped `rivalries/index.astro`. Neither grew.
- Sibling drift: the only one-sided changes are AFL-only features (keepers, pick trades,
  title rafters) and the shared Ask the History routes, which both leagues got.
- Bundle size checks passed.
- Not run: the duplication and reuse sweep, the gemini sweep, the guard-gap audit and the
  full-prebuild rehearsal.

## Verified on production

- `www.theleague.us/theleague/rivalries`, `www.afl-fantasy.com/` and
  `v2.mfl.football/live` returned 200 with their expected titles.
- Runtime errors in the 15 minutes after READY: only `[schefter-reactions]` reads failing
  with Upstash `ERR max requests limit exceeded. Limit: 500000`. They were first seen
  2026-10-25 on the previous deployment, so they come before this release. Still, the shared
  Redis database has hit its request cap, and that needs its own look.

## Not run, or noted

- The weekly changelog rollup was not dispatched. Monday's 8pm PT cron publishes this
  week's staged changes.
- An EAS preview build of the app started from the staging push (`dace8a9e`). The push to
  `main` starts another one for the same commit.
