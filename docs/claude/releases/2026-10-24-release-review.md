# Release review — 2026-10-24

**Verdict: GO, released.** `main` fast-forwarded `124835b9 → 0ec10b5b` at 04:41 UTC
(21:41 PT, Friday Oct 23). Production deployment `dpl_F1fdLo45sNNZ33v1ZHtcmhqNjWPX` went READY
at 04:44 UTC and is aliased to every league domain, `mfl.football` included.
Rollback candidate: `dpl_HyzZKd65N9Ndcz7MS1nSpDHHqAZP` (`124835b9`).

The owner asked for it on Friday ("prepare a release from staging to prod"), and it went
out before the Saturday–Monday game-day blackout.

## What shipped

- Christmas seasonal theme, including Draft Order styling (#1431).
- Brand Book, franchise half and size guide (#1457).
- #1467.
- Fire Ready Aim: charcoal in dark theme instead of coral or pink (#1466).
- Component kit: ui-modal, ui-tabs, ui-table, ui-pill (#1453), with the pill kit rollout
  (#1461).
- Spotlight my players on the field between scores (#1469); a labelled Broadcast preview
  open button (#1465); TV broadcast fixes (#1458, #1459); the MFL Live TV app opens
  production `/tv` with QR sign-in (#1448, #1449).
- Monday hero: Sunday recap until 10am, then the closest MNF game (#1425).
- Build spend: two syncs no longer build production for nothing (#1450); current-year
  rosters and transactions are held out of the roster-sync commit (#1455).
- Visual tests fixes (#1452, #1454), plus #1443, #1445, #1447, #1451, #1462–#1464, #1468,
  #1470, #1473.

## Left on their branches, at the owner's request

- **#1471 and #1472, the mock draft.** #1472 replaces PartyKit with Redis and polling. They
  were built into the release-prep branch first, then removed by rebuilding the branch
  (not by reverting), so both PRs stay open and unmerged.

## Blocks promotion

None remaining. Three were found and cleared:

- **Merge-down was failing** on every run with conflicts in `BroadcastLanding.astro`,
  `MflAppLayout.astro` and the changelog staging file. Fixed by merging main into staging
  in #1474, which went in with a merge commit, not a squash.
- **Type baseline.** I first re-measured 1312 locally, but that count came from a stale
  `node_modules` left over from #1472's lockfile: its `@types/node` 24 clears four errors in
  `tests/inline-script-syntax.test.ts`. A clean `pnpm install` measures 1316, the same as CI
  and staging's recorded figure, so the baseline stays at 1316. Lesson: **re-measure after
  `rm -rf node_modules && pnpm install --frozen-lockfile` whenever the lockfile changed
  under the checkout.** "Already up to date" does not mean the installed `@types` versions
  match.
- **Design-literal shadow ratchet (214 → 215)** from the Christmas Draft Order patch.
  Fixed by dropping the special picks' ring (`box-shadow: none`) instead of hand-typing an
  rgba shadow.

## Gates

- Staging CI (Tests and Type baseline) was green on `0ec10b5b`, the exact tip that was
  promoted.
- Blackout: "Friday 2026-10-23 — clear to promote".
- Visual tests on #1474 failed only on Haunted Stats, which is the intended change from
  main's #1446 hotfix. The baselines rebuild from the staging push.

## Not run, or noted

- **Vercel preview for #1474 failed** both times. It restored the branch's build cache
  from a preview that still had #1472's lockfile, and the incremental install then
  resolved Astro's `cookie` import to CommonJS `cookie@0.7.2` (`Named export 'parseCookie'
  not found`). This was a cache artifact only: staging and production build the same
  lockfile with their own caches. The fix for a preview is "Redeploy without build cache".
- Release-review lenses not run: gemini sweep, sibling-drift, guard-gap.
- Smoke test on the production deployment: `/theleague`, `/afl-fantasy`, `/archies` and
  `/theleague/brand` each return 200 with the right league and title, and Vercel showed no
  runtime errors in the 15 minutes after READY.
- **Weekly changelog rollup** was dispatched on `main` (run 40063783721, green). It stood
  down because the week of 2026-10-19 was already published by Monday's cron, so the
  staging queue (27 changes) is PRESERVED and publishes as the 2026-10-26 article on
  Monday. Expected for a mid-week release, and the same as 2026-10-21.
