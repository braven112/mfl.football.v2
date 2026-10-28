# Release review — 2026-10-28

**Verdict: GO. Released on the owner's explicit word ("Yes, do that") so the website
team logo maker (`/live/team-logo`) is live.** Promoted: `main` fast-forwarded
`158be51e → 04c76305` at about 04:57 UTC (Oct 27, 9:57 PM PT).
`scripts/release-blackout.mjs`: "Tuesday 2026-10-27 — clear to promote".

## What shipped

Range `158be51e..04c76305` (staging had all of main, so a plain fast-forward):

- Team logo prompt builder for the app and the website (#1576, #1578–#1581).
- Phone app chat: the league's GroupMe in the Chat tab, GroupMe sign-in on first Send,
  connect any league's GroupMe, and only a commissioner can switch a league's chat
  (#1568, #1570, #1571, #1574). Also the league chat send fix (#1567).
- The app's server address `mfl.football` (#1569) and the shared site host moving from
  `v2.mfl.football` to `mfl.football` (#1573).
- The record of the 2026-10-27 release (#1565).

## Checks

- Stored shapes: every new Redis key is new (`mfl-live:groupme-state:*`,
  `mfl-live:groupme-token:*`, the league GroupMe connection row); nothing on main read
  them, so there was no shape for production to misread.
- `CI` and `Visual tests` green on `04c76305`.
- `MFL Live mobile (Android)` is red on staging because Expo's free plan is out of Android
  builds until Nov 1. It is not a release gate.
