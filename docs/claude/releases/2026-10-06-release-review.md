# Release review — 2026-10-06

**Verdict: GO**, for Wednesday 2026-10-07. That is the next clear day before Thursday's game-day blackout.

**Range:** `origin/main..origin/staging` at `141103d501`. 77 non-merge commits; ~1,000 non-data files, +51k/−19k.
**On the train:** Archie's Fantasy Football League (MFL 10105) onboarding and its pages; shared Set Lineup, Rosters, Players,
Trade Builder, Standings, Playoffs, Franchise and Homepage components for every league; League Launcher and
package-league sites; Owners' Poll at `/owners-poll`; live-scoring per-player stat sheet; per-league themes;
Ask Roger and Playoffs for any league; the waiver-claim cents-bid / division-pool work.

## Blocks promotion

None remaining. One blocker found and cleared:

- **Merge-down was broken.** `staging-merge-down.yml` had failed on every main push since #1336. The cause:
  main edited `components/afl-family/RostersPage.astro` after staging had moved it to
  `components/shared/rosters/`. Resolved in `141103d501`: staging's structure kept, #1336's additions
  re-applied at the new import depth, the stale path in `dom-roster-groups.ts` fixed.
  Staging now contains main, and the fast-forward check passes.

## Stored-shape compatibility

Staging and production share Redis. Every storage touch in the range is additive:

- `persona:<slug>` (`persona.mjs`), `branding:pending:<slug>`, `league-history:mfl:<id>` + index/overrides/lock.
  These are new keys and main reads none of them.
- `ownersPollStandingKey`: a new READ (`owners-poll-store.ts`) of a key main already writes, with the shape unchanged.

Nothing changes a key production reads.

## Waivers and lineups (asked about specifically)

- **Waivers:** `/api/waiver-claim` gained a 30/min per-owner rate limit. Cents bids are sent as `"12.50"`, but only
  when the increment is fractional, so TheLeague still sends bare integers. A `$0` bid is accepted only when the
  league minimum is 0. Division pools (`poolOfFranchise`) leave CONFERENCE (AFL) behaviour unchanged. The drop-lock
  read was consolidated into `fetchDropLocks`. **Unproven:** the cents form against a live MFL claim (Archie's only).
- **Lineups:** TheLeague's 2,862-line page became a wrapper over `shared/lineup/LineupPage.astro`. A parity audit of
  the old TL page, the old AFL component and the new shared page found no lost behaviour. The submit endpoint is
  still `/api/lineup` for TheLeague (`lineupApiPath`) and `/api/afl-fantasy/lineup` for the AFL. The draft key is
  still `lineup-draft`. Year clock, Throwback Week, brand registry, week nav and auth gate are all preserved. The
  only differences are cosmetic: the success/primary button tokens moved onto `*-fill`, and all four are defined
  in both themes. The API routes are untouched.

## Build rehearsal

`PREBUILD_FULL=1 pnpm prebuild` exited 0. Derived-file diffs were data freshness (2026 games counted in the
AFL record book, new player names), not shape changes. Warnings:

- Archie's 2023 standings name franchise `0100`, which is not in its config, so those seasons are dropped from
  franchise history. This is a data gap and does not block (follow-up).
- MFL ADP and FantasySharks ranking sources returned 404 for 2027. Both are omitted with a warning by design.

## Fix before promotion (applied in `141103d501`)

- `weekly-changelog-staging.json`: main's #1336 rosters entry and staging's live-scoring and Archie's entries
  were each `featured`, and two per league fails Monday's rollup. #1336 was demoted to a line item, because the
  week's new-page/new-feature entries lead.
- Typecheck baseline re-measured on the merged tree: 1347 → 1320.

## Follow-up filed

- Add Archie's franchise `0100` (2023) to its config so those seasons attribute.
- First live Archie's cents bid: confirm MFL accepts `BBID_AMT=12.50`.

## Ratchets

| Baseline | Before | After | Why |
|---|---|---|---|
| typecheck | 1347 | 1320 | shared-page extractions took their errors with them |
| page-fork | — | lineup, rules-chat removed | unified; rosters/players/playoffs/franchises/index stay custom by the owner's call |
| clientrouter-init | — | entries moved theleague/ → shared/; afl playoffs removed | file moves |

## Checked, nothing found

Sibling drift (lineups, standings, rosters, playoffs: all now shared, no stranded fix), bundle size, the
full unit suite (15,086 passing after the changelog fix), rosters + standings suites (121), lineup suites (177),
blackout script: clear Tue 10-06 and Wed 10-07, CI on `141103d501` (success).

## Still to do at promotion (`/promote`)

1. Dispatch `chromatic.yml` on `staging` and accept or reject the week's visual diffs before the fast-forward.
2. Manual smoke on staging: a TheLeague lineup submit, an AFL lineup submit, a TheLeague bid, an AFL priority claim.
3. Fast-forward `main`, confirm production on each apex host, then dispatch `weekly-changelog-rollup.yml`.

## Addendum — 2026-10-07, after hotfix #1343

Staging Vercel builds failed after Archie's landed: its feed archive pushed `_render` to 254.55 MB (limit 250).
Hotfix #1343 (`6c51060516`) derives the archived-feed exclusions from the registry. Staging `89dffd102e` builds
READY on Vercel; `tests/archived-feed-files.test.ts` passes (8/8); `PREBUILD_FULL=1 pnpm prebuild` on that tip
exits 0 with the same two known warnings (ESPN 2028 draft date, MFL ADP/FantasySharks 404s). Verdict unchanged: **GO**.

## Promotion — 2026-10-06 23:20 PT

**Shipped:** `674bd01384..0a7f3c07b6` fast-forwarded to `main` (78 non-merge commits), after:

- Merge-down healthy, fast-forward OK, blackout clear (Tuesday PT).
- CI green and Vercel staging build READY on the exact SHA `0a7f3c07b6`. That SHA also carries #1345
  (glob-only feeds and `derived/` kept out of `_render`), which landed after the review.
- **Chromatic was not a real check this week.** Build 578 ran LIMITED because the monthly snapshot quota is exhausted:
  45 of 356 tests ran, with no UI review. In its place, 26 signed-in staging screenshots (TheLeague and AFL home, lineup,
  rosters, standings, free agents and playoffs, plus Archie's home, each in light and dark) were reviewed by the
  owner before promotion. All pages returned 200 with no page script errors.

**Production:** deployment `dpl_7jJpYeUqSDYknxwLMa6X7JnmHmC4` READY and aliased to theleague.us, afl-fantasy.com
and v2.mfl.football. A signed-out smoke test of 14 pages returned 200 with correct titles; `/lineup` redirects to
sign-in as expected. Vercel reported no runtime errors in the 30 minutes after the deploy.

**Announced:** `weekly-changelog-rollup.yml` run 37581946007 published `weekly-rollup-2026-10-05` for
theleague, afl, bb1 and archies (commit `0c248dcfa3`), waited for the permalink, and sent the site-update push.

**Left open:** Archie's franchise `0100` (2023) config gap; the first live cents bid; Chromatic quota/TurboSnap
(build 578 says TurboSnap was disabled by a changed static file, so every story bills at full price).
