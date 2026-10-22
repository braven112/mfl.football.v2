# Release review — 2026-10-21

**Verdict: GO, released.** `main` fast-forwarded `2c3574d → d5702de` at 04:30 UTC
(21:30 PT, Oct 21). Production deployment `dpl_DVmN4x4BdKEZVN8gX839LusGgzmj` went READY
and is aliased to every league domain, `mfl.football` included. Rollback candidate:
`dpl_5WDkrW8L9M2WD7i77ga4LrbiEr5t` (`2c3574d`).

An extra mid-week release, at the owner's request ("get the whole staging into prod
tonight"), so Archie's members could use MFL Live before its DNS cutover.

## What shipped

- Playwright visual tests replace Chromatic (#1430).
- Free Agents phone sort pills (#1436, #1437).
- MFL Live Google TV app and `/privacy` (#1401).
- Via main, already merged that night: Archie's-branded `/live?from=archies` sign-in,
  own-league menu and install banner (#1442), the Gauntlet rewrite (#1440), the Suh Girls
  Cup spider mark (#1438) and #1441.

## Blocks promotion

None remaining. Two were found and cleared:

- **Merge-down conflict after #1442.** `chromatic.yml` was deleted on staging (#1430) and
  edited on main (#1442 added story paths). We kept the deletion, with the owner's OK.
  `weekly-changelog-staging.json` kept both sides. Archie's then had two `featured`
  changes (Free Agents, tagged `both`, plus the Archie's sign-in), which fails the Monday
  rollup. The Free Agents line was split: featured for `theleague` and `afl`, and a plain
  line for `archies`.
- **Roster syncs during the release** moved `main` twice. Each time we waited for the
  automatic merge-down and promoted only once CI was green on that exact tip (`d5702de`).

## Gates

- Staging CI (Tests and Type baseline) was green on `d5702de`.
- Blackout: "Wednesday 2026-10-21 — clear to promote".
- Stored shapes: no new or changed Redis keys in the range.
- Local `pnpm test:unit` on the merge: everything passed except `url-guard`'s DNS case,
  which fails the same way on main in the sandbox.

## Not run, or noted

- **Visual tests baseline push failed on `fdc907e`.** The screenshots rendered, but the
  push to `visual-baselines` failed on "shallow roots are not allowed to be updated". This
  looks like a workflow bug in #1430, not a story failure. Follow-up: watch the next
  staging push. If it fails again, fix the checkout depth in `visual-tests.yml`.
- Release-review lenses not run: gemini sweep, sibling-drift, guard-gap.
- Smoke test on the production deployment: `/live?from=archies` returns 200, renders
  "Sign in to Archie's live scoring" under the Halloween theme, and
  `/mfl/10105/archie-head.png` is served.
- The weekly changelog rollup was not dispatched. Monday's run publishes as usual.
