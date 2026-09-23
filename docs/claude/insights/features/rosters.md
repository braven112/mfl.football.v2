## 2026-09-23 - The Roster Header, And Four Things That Only Showed Up In A Browser

**Context:** Replacing both leagues' forked roster team cards with one shared
header (`src/components/shared/roster-header/`). Everything below was found by
rendering the thing, not by reading the diff — the unit suite and the parity
harness were green through all four.

**Insight:**

**1. A week-shaped rail drops half a doubleheader.** The season rail was one
mark per WEEK. TheLeague opens 2026 with three doubleheader weeks and runs a
fourth in week 12; the AFL runs two. `franchiseSchedule` returns an ARRAY per
week, and taking `[0]` silently discards the other game — which is how a 1-1
club showed two wins on its own header. The rail is per GAME now, and both
tiles render a row per game with the week's record in the kicker. Any per-week
UI on this site has to ask whether the league plays two that week; the answer is
in the schedule, never in the week number.

**2. "Now" has to be able to be absent.** `currentWeek` was `getCurrentWeek()`
— today's NFL week — applied to whatever season was on screen. On a completed
season that reports "Week 2 · Final" as the last result and leaves weeks 3-18
looking unplayed, because a bounded search finds the last game BEFORE week 2.
It is null off the live season now, and every consumer treats null as "this
season is history". Same shape as the doubleheader bug: a value correct for the
live season applied to one it does not describe.

**3. A prop shape copied by hand hides the real type.** `RosterHeader` declared
`throwback?: { throwbackActive?: boolean; throwbackOverrides?: Record<string, any> }`,
hand-written to match what `buildFranchiseBandBrands` takes. The real option is
`Record<string, ThrowbackPick | number>`, and the nameplate below it did not
declare the prop at all — three `astro check` errors that the ratchet counted
and nobody read. Importing `BuildFranchiseBandBrandsOptions` cleared all three.
A prop that forwards to a function should be typed as that function's parameter,
not described again: the description is a copy that cannot be kept honest.

**4. A stale NodeList corrupts the club name on the way back.** TheLeague's
in-place switcher parks each club's nameplate in a `<template>`. A helper that
had captured `document.querySelectorAll('[data-team-name]')` at init wrote into
nodes that were no longer in the document, so switching away and back rendered
the previous club's name under the new club's crest. The fix was deleting the
helper — the header now re-renders from the template — and the guard asserts
the page holds no query for markup the switcher swaps.

**Evidence:** All four shipped green through 13,000+ unit tests and a 12-render
parity harness. The rail bug was reported from a screenshot ("Pigskins has 2
green but is one and one"); the historical-season bug was found by clicking the
AFL's year picker; the type bug surfaced only because the ratchet moved by 3
after a rebase; the name bug needed clicking through four clubs and back.

**Recommendation:** For a surface that summarizes a season, walk it at both
ends — a live week AND a finished season — and click every control twice. The
harnesses on this page prove the TABLE is unchanged, which is exactly why they
were silent about a header that had not existed before.

## 2026-09-23 - Comparing Against A Moving `staging` Without A Worktree

**Context:** The parity harness needs a baseline from the branch's own base, and
`staging` now moves several times an hour (roster syncs, Schefter scans). A
baseline captured yesterday reports drift that is just new scores.

**Insight:** The 2026-08-28 entry below is right that a worktree needs its own
install — the symlinked `node_modules` trap reproduced exactly as described,
doubled path and all. But for a BASELINE capture there is a cheaper route that
avoids the worktree entirely: check the base out in the working tree itself
(`git checkout --detach origin/staging`), let the running dev server reload,
capture, then check the branch back out and capture again. One server, one
install, no second port.

Two conditions make it safe: commit or stash first (the checkout will refuse
otherwise, which is the failure you want), and give the server a few seconds
plus a real request before capturing — a capture fired into a reloading server
records `ERR_CONNECTION_REFUSED` on half its pages and reads as a page error
rather than a timing one.

**Evidence:** 2026-09-23. A stale baseline reported 405 cell diffs that were
entirely injury designations and points moving under a sync; a same-tree
recapture of `origin/staging` at the branch's real base returned 12/12
identical. The first attempt at the worktree route failed on the symlink trap,
costing more time than the whole recapture.

**Recommendation:** Worktree when you need both versions running AT ONCE.
Same-tree checkout when you only need two captures in sequence, which is what a
before/after parity comparison actually is.

## 2026-08-28 - Comparing A Branch Against Main Needs A Real Install, Not A Symlinked One

**Context:** Proving the roster split was render-identical to the *current*
main, not to a stale pre-rebase capture. The method: a `git worktree` of
`origin/main`, a second dev server on another port, and the parity harness
pointed at each in turn.

**Insight:** The obvious shortcut — symlinking the main checkout's
`node_modules` into the worktree to skip an install — breaks Astro in a way
that reads as a page bug rather than a setup mistake. The page 500s and the
daemon log says:

```
No cached compile metadata found for ".../astro/components/ClientRouter.astro"
The main Astro module "/tmp/wt/home/user/repo/node_modules/astro/..."
```

Note the doubled path. Vite resolves through the symlink to the *real* location
and then keys compile metadata under the worktree-prefixed path, so the module
that compiled and the module being requested are never the same key. `pnpm
install --frozen-lockfile` in the worktree costs ~7s against a warm store and
avoids the whole class.

Worth pairing with CLAUDE.md's existing note that worktrees don't inherit
`.env`: a worktree is a fresh checkout in every way that matters, and the two
shortcuts people reach for — symlinked deps and inherited env — both fail.

**Evidence:** Run on 2026-08-28 comparing `origin/main` (a2d3f4d) against the
rebased split branch. Result once the install was real: 64 (season, team)
renders identical, payload 10.29 MB -> 1.12 MB.

**Recommendation:** For any before/after that needs two versions of this app
running at once, use a worktree with its own install and its own port. It is
the only way to compare against a moving main rather than against a capture
that silently ages.

## 2026-08-27 - The Roster Page Shipped 320 Team-Seasons To Render One

**Context:** Starting the rosters.astro split (`docs/plans/rosters-page-split.md`).
The goal included "let users check other rosters really quickly", so the first
step was measuring what the page actually costs.

**Insight:** A single authenticated request returned **14.08 MB of HTML**, of
which **10.37 MB was the `#roster-config` JSON**. It carried all 20 seasons x 16
teams — 320 team-seasons — so that the season picker could switch without a
fetch. Nobody looks at 320 rosters; they look at one. Team switching *felt*
instant only because the entire cost had already been paid before first paint.

Three of its keys were byte-identical duplicates of data already in the same
payload, and all three were read only as fallbacks sitting *behind* the very
lookups they duplicated, so no consumer could reach them:

| key | size | duplicate of |
|---|---:|---|
| `adjustmentsBySeason` | 1,574 KB | `seasons[y].salaryAdjustments`, all 20 |
| `initialSeasonData` | 557 KB | `seasons[defaultSeason]` |
| `initialTeamData` | 35 KB | `seasons[ds].teams[dt]` |

The blocker to loading seasons on demand turned out to be dead code:
`createPlayerLookup()` walked all 320 team-seasons on init to build a
2,027-entry name map "for dead money", but its only reader was
`findPlayerData()`, which had no callers — `renderDeadMoney()` resolves identity
from the build-time enriched fields on each adjustment instead.

**Evidence:** 10.37 MB -> 1.17 MB (-88.7%); page HTML 14.08 -> 4.88 MB; gzipped
1.25 -> 0.45 MB. Only live (non-frozen) seasons ship inline; the rest come from
`/api/roster-season/[league]/[year]` with an idle prefetch after first paint.
Verified render-identical across 64 (season, team) pairs.

**Recommendation:** Never pre-resolve into the client config anything that is
already a key of `seasons`. When adding data to this page, ask whether it is
needed for the *current* view or only for a view the user may never open — the
second kind belongs behind the season endpoint or a dynamic import. And note the
general shape: the expensive thing was not slow code, it was correct code
operating on 320x the data anyone asked for.

## 2026-08-27 - A Parity Harness Needs A Decodable Placeholder Image, Not An Empty 200

**Context:** Building `scripts/roster-parity-check.mjs` so the rosters split
could be proven behavior-preserving. It drives a real browser, walks a
(season, team) matrix and fingerprints rendered output.

**Insight:** Three separate ways the harness lied before it was trustworthy, all
worth knowing before writing the next one:

1. **Text-only capture missed image URLs.** Swapping the function that builds
   headshot and crest URLs diffed completely clean. Fixed by fingerprinting
   `img` src attributes too (3,879 of them).
2. **A zero-byte placeholder image manufactured 291 phantom diffs.** Headshots
   carry an inline `onerror` cascade (ESPN NFL -> ESPN college -> MFL photo ->
   placeholder) that REASSIGNS `this.src`, which rewrites the attribute. An
   empty 200 fails to decode, fires the cascade, and makes the captured src a
   race against how far it walked. Serving a real 1x1 GIF made two runs of
   identical code produce identical fingerprints.
3. **The page keeps mutating after load.** `hydrateTeamFromSession()` awaits
   `/api/auth/session` and then re-selects the owner's team, so walking the
   matrix immediately after load captured a team the harness never asked for.
   Fixed with a `settle()` pass that polls a render signature until it stops
   changing — deliberately not `networkidle`, which the season prefetch keeps
   busy long after the page is visually done.

**Evidence:** `scripts/roster-parity-check.mjs`. 64 renders in ~23s. The
`--compare` mode diffs two fingerprints and fails on any new page error.

**Recommendation:** Before trusting any before/after harness, run it twice
against UNCHANGED code and require an empty diff. Every one of the three
problems above would have been read as a real regression — or worse, masked one.

## 2026-03-08 - Roster Page Secondary Tabs Should Warm After Primary Render

**Context:** Improving the `/theleague/rosters` page without regressing the fast in-page tab switching that makes roster, analytics, and planner comparisons feel good.

**Insight:** The main client bottleneck was not just the size of the route; `updateView()` was recalculating analytics charts, college/NFL grouping reports, planner metrics, and planner component datasets on every team switch even when the user stayed on the roster tab. Splitting that work into `renderAnalyticsForContext()` and `renderPlannerForContext()` and warming them with `requestIdleCallback` preserved instant tab switching while letting the roster table finish first.

**Evidence:** `src/pages/theleague/rosters.astro` now keeps roster rendering in `updateView()` and defers secondary work through `ensureSecondaryViewReady()` and `scheduleSecondaryWarmup()`. The same pass also removed an unused `PlayerNewsModal` payload from the page and replaced one-off eager feed globs (`playoff-brackets`, `draftResults`, `transactions`, `fetch.meta`) with direct `loadFeedJson()` reads.

**Recommendation:** Future roster-page work should keep the roster table and summary path separate from analytics/planner enrichment. If a new feature is hidden behind a secondary tab or modal, prefer lazy warming or on-demand rendering rather than recomputing it on every team change.

## 2026-03-08 - Demo Highlighting Must Stay Isolated From Real Eligibility

**Context:** Fixing the roster page when franchise `0001` was logged in and every player appeared highlighted, even outside the contract demo flow.

**Insight:** The page had two separate visual systems: mock/demo rows were supposed to use `roster-row--mock`, while normal eligibility wiring also added `player-cell__avatar--eligible` to any eligible roster row. That leaked demo-like emphasis into real roster views. The intended demo-only styling works best when mock players are explicitly tagged with `isMock: true` and normal eligibility logic stays functional without avatar glow.

**Evidence:** `src/pages/theleague/rosters.astro` now tags both `?testEligibility=true` fixtures and `buildDemoPlayers()` fixtures with `isMock: true`, and `applyEligibilityStyling()` no longer adds `player-cell__avatar--eligible` to live roster rows.

**Recommendation:** If future roster walkthroughs need extra visual emphasis, attach it to explicit demo/mock markers rather than auth state or generic eligibility checks. Keep real-owner flows limited to actionable controls like chips, buttons, and modal entry points.

## 2026-07-21 - Contract Demo Overlay Retired; Its JS Deliberately Remains Inert

**Context:** Disabling the "How It Works" contract-declaration walkthrough tab on `/theleague/rosters` after declaration season ended.

**Insight:** The overlay's DOM lives in `src/components/theleague/ContractDemoOverlay.astro`, but ALL of its interactivity (~500 lines: tutorial stepper, demo mode, mock player injection via `buildDemoPlayers()`) lives inline in `rosters.astro` and is fully null-guarded (`if (demoTrigger) ...`, `demoTutorial?.`). Removing just the component render + import disables the whole feature cleanly — the demo JS goes inert without its DOM and was intentionally left in place.

**Evidence:** Commit "Remove 'How It Works' contract demo tab from TheLeague rosters page" removed only the import and `<ContractDemoOverlay />` from `src/pages/theleague/rosters.astro`. The component file and the `cdemo-*` JS block (search `cdemo` in rosters.astro) remain.

**Recommendation:** To re-enable for next declaration season, re-add the import and render — nothing else. If instead the demo is ever removed for good, delete the component file, the `cdemo` JS block, `buildDemoPlayers()`, and the `window.__cdemoSetStep` export together. (Note: `__cdemoSetStep` is defined in rosters.astro but nothing calls it — the overlay's step-2 glossary link is wired by the component's own inline script, despite what the old comment next to the export claims.)
