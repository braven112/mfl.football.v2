# Release review — 2026-10-20

**Verdict: GO, released.** `main` fast-forwarded `f5744c04 → f07bf476` at 05:57 UTC
(22:57 PT, Oct 19). Production deployment `dpl_F7U87e66SGvntQzrgJyeqcr25ScL` went READY on
every league domain. The rollback candidate is `dpl_6aUYH1s3YnRZG9MsagTGpYLauMWr` (`f5744c04`).

**Range:** `f5744c04..f07bf476`. That is 132 first-parent commits and 343 non-merge commits.

**Scheduling:** the owner asked for 22:00 PT on a Monday, which falls in the game-day blackout,
and chose to override the blackout. The 22:00 run was held because the merge-down PR (#1424) had
not merged yet. The release went out once it had.

## Blocks promotion

None remaining. Three were found and cleared:

- **Merge-down conflicts (#1424).** These were in `resolved-events.json` (took main's copy),
  `weekly-changelog-staging.json` (union by date and summary, one featured `both` entry),
  `PeckingOrderIssue.astro` (main's redesign plus the `--style-card-*` tokens) and
  `design-literal-baseline.json` (re-measured).
- **IR move fix (#1427).** The owner asked for it to ride this release. It landed on staging,
  and CI was green before promotion.
- **Chromatic build crashed on staging.** `ThrowbackWeekModal.astro:20` hit a null `bandStart`
  because the AFL story's date (2026-10-28) fell outside every throwback band. #1429 moved it to
  week 11 (2026-11-18). The Storybook build then passed locally and in Chromatic on staging.

## Gates

- **Staging CI** (Tests and Type baseline) was green on `f07bf476`.
- **Stored-shape compatibility:** new Redis keys only (`bctv:*`, `product-interest:*`,
  `live:sleeper:*`), written and read only by new files. Main read none of them.
- **Ratchets** were unchanged across the range.
- **`PREBUILD_FULL=1` rehearsal** exited 0. It printed only warnings that already existed, and
  the shapes of the derived files did not change.
- **MFL Live access for Archie's:** `mflLiveSignInLeagueIds()` includes every non-best-ball
  registry league, so Archie's (10105) is covered. `getAuthUser` accepts those sessions.

## Not run, or overridden

- **Chromatic visual review was skipped at the owner's call.** The `main` run auto-accepts the
  week's diffs as the new baseline, unreviewed.
- **Pre-push suite was skipped, with the owner's approval.** The local run failed only on
  `tests/url-guard.test.ts`, because the sandbox cannot resolve DNS. CI passed on the same SHA.
- **Release-review lenses not run this week:** gemini duplication sweep, sibling-drift agent,
  altitude, efficiency and guard-gap passes.
- **Post-deploy smoke test** loaded only the home pages of TheLeague, the AFL and Archie's, plus
  `/live`, on the production deployment URL. All returned 200 with the right league. The apex
  hosts were not reachable from the session's network.

## After promotion

- `weekly-changelog-rollup.yml` was dispatched on `main`.
- **Halloween theme:** the window opens 2026-10-20 00:00 PT (`seasonal-themes.mjs`), about an
  hour after the release went out. A production render with `?testDate=2026-10-20` stamps
  `data-season="halloween"` with the dark lock.
