# Release review — 2026-10-27

**Verdict: GO, released on the owner's explicit word ("obviously yes") so the first test
APK of the MFL Football phone app can reach its server.** The test APK (EAS build
`769f637a`, staging `c2ccff85`) points at production, which had none of the app's
`/api/mfl-live/*` routes and the older `/api/live-standings` (week required). Every error
in the owner's first test screenshots came from that gap, not from app code.

`scripts/release-blackout.mjs`: "Tuesday 2026-10-27 — clear to promote".

## Merge-down repair before the promotion

`staging-merge-down.yml` had failed on both main pushes since #1536 (the MFL Football
rename merged straight to `main`) because staging carried its own rename (#1535, #1537).
Promoted: `main` fast-forwarded `2755c3a8 → bf676c0d` at about 17:26 UTC (10:26 PT). CI (`Tests`, `Type baseline`) green on `bf676c0d`.

Three conflicts, all wording: `apps/mobile/README.md`, `src/pages/index.astro` and
`src/data/weekly-changelog-staging.json`. Took MAIN's side for all three: #1536 is the later
pass (the mfl.football homepage says "Live scores", and the changelog line is split per
league with the `/guides/tv-app` link). Merge commit `bf676c0d` pushed to `staging`.

## What shipped

The MFL Football phone app's server and screens (store-mode board, standings, league board,
Leagues to watch per account, Pair a TV, My Team, Players, Set Lineup, add/drop and waivers,
trades, transactions, chat, draft room and auction room read-only), push alerts (Expo push
registration, the one-minute `/api/cron/push-watch` checker in `vercel.json`, needs
`CRON_SECRET`; `EXPO_PUSH_ACCESS_TOKEN` is only needed if Expo's enhanced push security is on), Sleeper leagues in MFL Football
standings (#1561), the site and TV rename to MFL Football (#1537), the TV app QR sign-in
(#1524) and the privacy policy's phone section (#1522). Range `2755c3a8..bf676c0d`.

## Checks

- Unit tests on the merge commit: all pass except the known sandbox-DNS failure in
  `tests/url-guard.test.ts`.
- The phone APK's API contract: only additive changes since its build commit (auction).
- `MFL Live mobile (Android)` is red on staging because the free Expo plan is out of
  Android builds until Nov 1. It is not a release gate.
