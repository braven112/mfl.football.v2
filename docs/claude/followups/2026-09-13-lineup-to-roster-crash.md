---
slug: lineup-to-roster-crash
status: shipped
severity: P0
opened: 2026-09-13
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1072
hotfix_sha: 8988ce8
followup_issue: 1073
followup_pr: PENDING
shipped: 2026-09-13
followup_session: session_01Sta1eGQbdQc3M5qmJz91oi
---

# Follow-up: the lineup controller crashed every page you navigated to

## What broke

After visiting Set Lineup, navigating anywhere else in the site — Roster was how
Brandon hit it — blanked the page and rendered the red "Page error caught" box:
`Uncaught TypeError: Cannot read properties of null (reading 'querySelector')`,
thrown from an `HTMLDocument` listener in the lineup chunk, called by
ClientRouter. Sticky for the whole session: once the lineup page had been
opened, every subsequent in-site navigation crashed until a hard reload. Both
leagues carried it identically. Introduced by the Sept 2026 ClientRouter
re-init fix on these same pages — the fix for "the page goes inert after a
navigation" created "every other page crashes after visiting this one".

## What the hotfix did

Forward fix, one line of code per page.

`init()` is registered on `document`, which the router does not replace, so it
fires on every navigation for the rest of the session. Its only "am I still on
this page" gate was `window.__LINEUP_DATA__` — also un-replaced, so it still
held the lineup payload on the next page. That made `if (!data) return`
unfalsifiable: init ran its body on `/rosters`, `getElementById('lineup-submit')`
answered null, and `submitBtn.querySelector(...)` threw.

The gate now asks for a node the router actually replaced
(`document.getElementById('lineup-slots')`), placed **after** the teardown so the
surviving `document`/`window` registrations still come off on the way out.

- `src/pages/theleague/lineup.astro:935`
- `src/pages/afl-fantasy/lineup.astro:975`
- `tests/lineup-page-clientrouter.test.ts` — new case pinning the gate's
  existence and position; sibling-parity regex widened to cover the gate line
- `docs/claude/rules/lineups.md` — rule recorded

## Deferred items

- [x] **F1 — The gate cannot tell the two leagues apart (cross-league double-bind)** — WORKED
  - Source: Copilot review, PR #1072 — threads
    [r3999118278](https://github.com/braven112/mfl.football.v2/pull/1072#discussion_r3999118278)
    and [r3999118265](https://github.com/braven112/mfl.football.v2/pull/1072#discussion_r3999118265)
  - Where: `src/pages/theleague/lineup.astro:935`,
    `src/pages/afl-fantasy/lineup.astro:975`
  - What: `#lineup-slots` exists on BOTH league lineup pages. On a same-origin
    lineup→lineup navigation across leagues (reachable on the shared host,
    `mfl.football`, where both `/theleague/...` and `/afl-fantasy/...` resolve),
    the departing league's `document` listener is still registered and its gate
    passes on the arriving league's page. Both controllers then bind the same
    DOM, and their submit handlers post to different endpoints —
    `/api/lineup` (`theleague/lineup.astro:1643`) vs `/api/afl-fantasy/lineup`
    (`afl-fantasy/lineup.astro:1683`). A dual-league owner could submit to the
    wrong league.
  - Why deferred: **pre-existing, not introduced.** Before this PR both
    controllers read the same `window.__LINEUP_DATA__` global — whichever
    league's `is:inline` block ran last sets it — so both already saw truthy
    data and both already bound. The shared-ID gate reproduces that behaviour
    exactly. Fixing it properly means a league-specific page marker plus a
    cross-league case in the guard, which widens a P0 diff that was live for
    every owner on the Saturday before games.
  - Shape of the fix: `data-league={league.slug}` on the `.lineup-page` root,
    gate on `document.querySelector('.lineup-page[data-league="theleague"]')`,
    and add a lineup→lineup cross-league transition case to
    `tests/lineup-page-clientrouter.test.ts`. Check whether the sibling
    `LineupGameStrip` carousel and any other per-league `astro:page-load` init
    have the same blind spot while you are in there.

- [x] **F2 — `AREA_LABELS` has no `lineups` slug** — WORKED
  - Source: deferred at implementation
  - Where: `scripts/lib/weekly-changelog-format.mjs` (the `AREA_LABELS` map);
    surfaced by `tests/whats-new-data.test.ts:530`
  - What: lineups are a first-class domain here — own rules doc, own guard
    suites, own path-guard entry — but a staged changelog change cannot be
    tagged to them. This entry went out under `rosters`, which is where the
    crash landed but not what was fixed.
  - Why deferred: adding a vocabulary entry is a rollup-format change, not a
    hotfix; it would have pulled `weekly-changelog-format` and its test into a
    P0 diff.

- [x] **F3 — The guard's positional assertions index raw script text, comments included** — WORKED
  - Source: deferred at implementation
  - Where: `tests/lineup-page-clientrouter.test.ts` — `controllerScript()` and
    the `indexOf` assertions in both "every ref is re-read inside init()" and
    the new gate case
  - What: the assertions compare `indexOf` offsets in the raw file text, so a
    *comment* that happens to quote `getElementById('lineup-submit')` shifts
    them and fails a correct file. This bit twice while writing the fix, and
    the workaround was to reword the explanatory comment — i.e. the test is
    currently constraining prose. It also means a commented-out call could
    satisfy an assertion.
  - Why deferred: the workaround was sound and the guard is doing its job; the
    cleanup is a test-infrastructure change.
  - Shape of the fix: strip line and block comments in `controllerScript()`
    before measuring positions, then restore the clearer comment wording on
    both pages (`the Submit button id resolved to null` →
    `` `getElementById('lineup-submit')` answered null ``).

## Context to start cold

**The causal chain, so you don't re-derive it.** Three things have to be true
together, and each one is individually reasonable:
1. `init` is on `document` via `astro:page-load` — required, and correct: that
   is the Sept 2026 fix for the page going inert on a return visit.
2. `document` and `window` are exactly the nodes ClientRouter does *not*
   replace — which is why the teardown block exists.
3. Therefore any "am I on my page" gate read off `window` or `document`-global
   state is not a gate at all. It has to be a node the swap replaced.

Point 3 is the generalizable rule and it is now in `docs/claude/rules/lineups.md`.

**What was ruled out.** Swept for the same shape elsewhere: a `window.__X__`
global read inside an `astro:page-load` init exists *only* on these two pages
(`grep -rln "window\.__[A-Z_]*__" src/pages src/components` cross-referenced
against `astro:page-load`). No other page needs this fix.

**Why `#lineup-slots` is a safe gate for the single-league case.** It is
rendered unconditionally at `theleague/lineup.astro:692` and
`afl-fantasy/lineup.astro:732` — outside every `fillState` conditional — so a
bye week, `week-unscheduled` and `read-failed` all still render the `<ol>` and
the controller still initialises. It is also the only `#lineup-slots` in the
repo. The cross-league case is F1.

**Verification — CONFIRMED on production.** Brandon confirmed the fix on a real
authenticated session on 2026-09-13, after `8988ce8` deployed: Set Lineup →
Roster no longer throws. Nothing further to verify; work the items directly.

For the record, on why that confirmation had to come from a person: this is a
*client-side* crash, so it never appears in Vercel's runtime-error telemetry
(all four live clusters there are unrelated server-side issues); the preview
build was `Ignored` because `vercel-ignore-build.mjs` ran before the PR existed;
and the lineup page is auth-gated, so the shipping session could not drive the
click-through itself. The automated evidence was a guard proven to fail against
the pre-fix source on both leagues and pass after, plus green CI and a green
full suite (448 files, 10,855 tests). Worth remembering next hotfix: for a
client-side crash behind auth, budget for a human tap-through — the telemetry
step in `/hotfix` step 7 cannot see it.

**Severity note for the audit.** Called P0 on the day: gameday eve, and Set
Lineup → Roster is the single most-used flow of the week.

---

## Outcome (2026-09-13)

All three items **worked**; nothing dropped. Re-validated against `8988ce8`
before building — the code each finding pointed at was unchanged and every
concern held. No late reviewer comments landed on #1072 after the merge beyond
the two Copilot threads already captured as F1.

### F1 — worked, and it was wider than the brief assumed

Two things the brief did not have:

1. **It is one click away, not a hand-typed URL.** `buildSwitchUrl`
   (`src/utils/nav-utils.ts:581`) returns the bare equivalent path whenever
   `hideLeaguePrefix` is false — which is the case on the shared host. So on
   `mfl.football` the nav header's own league-switch chevron emits a RELATIVE
   href, and lineup -> lineup across leagues is a ClientRouter swap reachable
   from the page itself. (On each league's apex domain the switch is
   cross-origin and this cannot happen.)
2. **`players.astro` has the same blind spot, and worse.** Both leagues' pages
   gate on `#players-table` AND share the `dataset.init` flag key, so the
   departing league's listener — registered first, therefore run first — wires
   the wrong league's handlers and then sets the flag, which locks the arriving
   league's own init out of running at all. Fixed alongside lineup, at the
   user's direction.

The fix is the shape the brief proposed: `data-league={...}` from the registry
on the gated element, and `document.querySelector('<sel>[data-league="<slug>"]')`
in the gate. The lineup pages keep the `#lineup-slots` check too, since the
controller's first ref read is a non-null assertion on it.

Also audited, per the brief's instruction to check other per-league
`astro:page-load` inits:

- `LineupGameStrip` — **clean.** It is one shared component, so both leagues run
  the same module and there is only ever one listener; it already gates on a
  router-replaced node with an element-scoped flag.
- `initPlayerModalTrigger` (both players pages) — **clean.** Shares
  `#player-table-body` across leagues, but the handler is fully league-agnostic
  (it reads each row's own `data-player-modal` payload), so a cross-league bind
  is a no-op difference.

### F2 — worked

`lineups: 'Set Lineup'` added to `AREA_LABELS`. Both staged changes that were
mis-filed under `rosters` for want of the slug — the hotfix line and the
2026-09-09 network-badge tweak — are retagged.

### F3 — worked, and it reproduced on the first edit

`tests/helpers/js-source.ts#stripComments` blanks line and block comments
(preserving length, so offsets still map to the real file) and
`controllerScript()` runs every positional assertion against that. The clearer
comment wording is restored on both pages. Worth noting the guard failed the
moment that wording went back in, which is the item demonstrating itself.

### Guards

- `tests/cross-league-init-gate.test.ts` — new, covers both pairs. Verified
  failing against the pre-fix source on both pages and passing after. Wired into
  the `client-scripts` path-guard domain, so it runs on every `src/pages/**`
  edit.
- `tests/lineup-page-clientrouter.test.ts` — positional assertions now
  comment-blind; the sibling-parity check normalises the league slug, which is
  the one thing that is supposed to differ between the two copies.

### Rule recorded

`docs/claude/rules/lineups.md` gains the league-marker half of the gate rule,
and `CLAUDE.md` gains a cross-cutting subsection under "Second league's copy of
a page" — that is where the hazard actually lives, since it is a property of
forked siblings rather than of lineups.

### One more pair found, and deliberately NOT fixed here

The cross-cutting review pass on the follow-up PR turned up a **third**
instance of the same bug class, in the ROSTERS pair:
`afl-fantasy/rosters.astro` gates on a bare `.roster-page`, which TheLeague's
rosters page also renders, so an AFL -> TheLeague swap carries the AFL
controller onto that page (its `switchView` relabels the header "AFL Roster"
and force-sets `display: grid`). The reverse direction was already safe —
TheLeague's init gates on `#roster-config`, which only its own page renders.

P3, and cosmetic: no wrong-league write, and TheLeague's own init is not
locked out. The two-line fix was written and verified (guard failing pre-fix,
passing after) and then **backed out of this PR**, because any `rosters.astro`
edit owes a `scripts/roster-parity-check.mjs` run before and after
(`docs/plans/rosters-page-split.md`) and that needs a dev server plus
`.env.local`, neither of which this cloud session had. Shipping an unverified
edit to that page was the wrong trade for a P3.

Tracked as its own follow-up: `docs/claude/followups/2026-09-13-rosters-cross-league-init-gate.md`, issue #1077.
