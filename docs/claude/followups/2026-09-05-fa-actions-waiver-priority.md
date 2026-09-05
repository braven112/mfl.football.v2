---
slug: fa-actions-waiver-priority
status: open
severity: P1
opened: 2026-09-05
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/974
hotfix_sha: 2e6ac2b
followup_issue: 975
followup_pr:
followup_session:
---

# Follow-up: free-agent actions off-screen, waiver priority dialog stuck on "Reading the live order…"

## What broke
Reported 2026-09-05 (Week 1 waivers) from the AFL free-agents page on a phone.
The waiver priority dialog opened on "Reading the live order from
MyFantasyLeague…" and stayed there, so an owner could not see where they stood
before filing. And the Claim / Bid button plus the ⋮ actions menu (shipped in
#971) were the LAST columns of a table that scrolls sideways on mobile — nine
columns off-screen on both leagues' free-agent pages.

## What the hotfix did
Forward fix, three commits squashed:
- `src/components/shared/WaiverPriorityModal.astro` — takes `initialOrder`
  (the committed league feed's waiver order, via `readWaiverSortOrder`) and
  renders it server-side, so the dialog opens with a list. The client live read
  of `/api/waiver-order` is time-boxed (`LIVE_READ_TIMEOUT_MS`, 12s, via
  `AbortController`) and on failure keeps the synced list on screen with the
  reason in the foot.
- `src/pages/afl-fantasy/players.astro`, `src/pages/theleague/players.astro`
  — the Bid/Claim cell and the ⋮ kebab moved to sit right after the Player
  column, ahead of Age. Sign-in subtitle on TheLeague now mentions watching.
- `src/components/shared/WatchListBridge.astro` — the ⋮ sheet gains a Bid /
  Claim action built from the row's OWN `.col-fa-action .place-bid-link`
  button, re-queried at run time (a watch toggle re-renders rows).
- `src/components/shared/PlayerActionModal.astro`, `src/utils/player-actions.ts`
  — `closeFirst` on an action spec closes the sheet before `run()` so the claim
  dialog does not race it for the top layer.
- Guard: `tests/free-agents-action-placement.test.ts`.

## Deferred items

- [ ] **F1 — What's New `enhancement` entry (with screenshot) for the ⋮ Bid / Claim action**
  - Source: deferred at implementation
  - Where: `src/data/whats-new.json` (top; the `my-watch-list` entry at line 3
    describes the sheet without this action), `public/assets/whats-new/`
  - Why deferred: needs a real phone screenshot of the sheet showing Bid/Claim +
    Watch; `whats-new-data.test.ts` fails without one. The column move itself is
    a `style-tweak` already in `weekly-changelog-staging.json` and needs nothing.
  - Note: set `excludeFromHero: true` — it is an enhancement, not a launch.

- [ ] **F2 — Signed-in / claim-context resolution is computed three ways on the free-agent pages**
  - Source: Claude review on #971, carried over
  - Where: `src/pages/afl-fantasy/players.astro:212` (`waiverPriorityConfig.signedIn`),
    `:240` (`promptSignIn`), `:242` (`watchSignedIn`), `:903`
    (`watchListSignedIn` in the classic script); the same trio in
    `src/pages/theleague/players.astro:743` and around it; and
    `src/components/shared/WatchListBridge.astro:64` re-reads it from the DOM.
  - Why deferred: a shared resolver is a refactor across both siblings and the
    bridge; not what the outage needed. Each copy currently agrees (all derive
    from `claimFranchiseId`), so it is drift risk, not a live bug.

- [ ] **F3 — Root cause of the production dialog hang is unconfirmed; add diagnosability**
  - Source: deferred at implementation (step 1 could not reproduce)
  - Where: `src/pages/api/waiver-order.ts:55` (`fetchWithTimeout` around the MFL
    read), `:110` (`readLiveOrder`); client at
    `src/components/shared/WaiverPriorityModal.astro:226-228`.
  - Why deferred: the fix removes the failure mode (the dialog never again
    depends on the live read to show anything) rather than proving what hung.
    Vercel `get_runtime_errors` showed nothing in the 6h before the report and
    the route answered in <1s from the sandbox. Add a server-side log line with
    the MFL round-trip time and the `ok`/timeout outcome so the next report has
    a trace, and consider surfacing `asOf` in the dialog foot.

- [ ] **F4 — `closeFirst` actions run un-awaited; a rejected `run()` becomes an unhandled rejection**
  - Source: Copilot, https://github.com/braven112/mfl.football.v2/pull/974#discussion_r3942180954
  - Where: `src/components/shared/PlayerActionModal.astro:157` (`void spec.run()`)
  - Why deferred: the only `closeFirst` action today clicks a DOM button and
    cannot reject, so it is hygiene, not a live bug. Attach a `.catch()` that
    logs, or route the error through the sheet's error rendering.

- [ ] **F5 — Fold in any Copilot / Gemini / CodeQL findings that landed on #974 after the merge**
  - Source: external reviewers not waited on (hotfix step 5)
  - Where: https://github.com/braven112/mfl.football.v2/pull/974 comments
  - Why deferred: by design; re-read the PR thread before starting.

## Context to start cold
- The waiver priority dialog is mounted ONLY on the AFL free-agents page
  (`WaiverPriorityModal` — TheLeague uses blind-bid auction in season and has
  no rolling waiver order). `initialOrder` is passed only there.
- `closeFirst` is consumed only by `PlayerActionModal`; the only spec that sets
  it is the acquire action in `WatchListBridge`.
- The best-ball players page is not a sibling for this change: it has no
  claims and no watch list.
- Ruled out: a JS error on the AFL page (a signed-in SSR crash from a missing
  `rankWithinConference` import WAS found and fixed in the second commit —
  `astro dev` truncated the page silently; `npx astro dev logs` shows it). That
  crash was introduced by the first commit of this branch, not by #971, so it
  is not the production cause either.
- The sandbox cannot reach production through the proxy; signed-in production
  verification of the dialog was not possible from the session and was left to
  the owner.
- Playwright notes for the FA pages: `networkidle` never fires; use
  `domcontentloaded` then `waitForFunction(() => window.openPlayerActionModal)`.
