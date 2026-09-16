---
slug: waiver-hero-hardcoded-day
status: open
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1122
hotfix_sha: 7ca8d25
followup_issue: 1124
followup_pr:
followup_session:
---

# Follow-up: the waiver hero named a hardcoded day inside a two-day slot

## What broke

`getDailySlot` holds the `waiver-wire` slot from **Tuesday 2pm PT through
Wednesday 8pm PT**, but the copy inside it was one fixed string in both leagues:
`CLAIMS RUN TONIGHT · Waivers process Wednesday at 8PM PT`. For the ten hours of
Tuesday afternoon and evening it named the wrong night. Reported from the AFL
homepage at Tue 6:19 PM PT, 2026-09-15, with a screenshot.

The slot ROUTING was never wrong — `getPTComponents` formats in
`America/Los_Angeles`. This was copy, which is why it rendered a clean 200 and
never showed up in `get_runtime_errors`. Worth remembering when triaging the
next "the page is showing the wrong thing": telemetry is silent on it by
construction.

## What the hotfix did

Forward fix, not a revert — the hardcoded copy had been there since the slot was
written, so there was no single commit to undo.

New `src/utils/waiver-deadline-copy.ts` wraps the `resolveWaiverWindow` that
`/players` already uses and words the result. The relative word (`TONIGHT` /
`TODAY` / `TOMORROW` / the weekday) is judged in the VIEWER's leading zone — PT
until they choose otherwise, never UTC — and the deadline prints through
`formatForViewer`. Both homepage routes resolve the calendar and the viewer
clock and hand it down, because a component cannot read the preference without
writing a cookie.

Files: `src/utils/waiver-deadline-copy.ts` (new),
`src/utils/afl-hero-resolver.ts`, `src/pages/afl-fantasy/index.astro`,
`src/pages/theleague/index.astro`,
`src/components/theleague/SeasonDailyHero.astro`,
`src/components/theleague/season-heroes/WaiverWireHero.astro`.
Guard: `tests/waiver-deadline-copy.test.ts` (20 cases), wired into
`.claude/hooks/path-guard.json` under `afl-waiver-order` and `hero-composites`.

Two further bugs were found by reading the calendar instead of the
constitution, and BOTH were fixed in the hotfix: the AFL's Dec 29 2026 run is a
**Tuesday**, and TheLeague processes at **7:00 PM PT**, not 8:00. TheLeague's
hero had also built its countdown with `new Date(y, m, d, 20, …)` in
server-local time plus a hardcoded `+7h` — near-correct only because Vercel runs
UTC, an hour late for TheLeague regardless, and 3am on a Pacific dev machine.
That math is gone.

## Deferred items

- [ ] **F1 — DST drift in `resolveWaiverWindow`'s recurrence expansion**
  - Source: Claude review, `/code-review --comment` on #1122
  - Where: `src/utils/waiver-window.ts:87` (`occurrences()`), consumed at
    `src/utils/waiver-deadline-copy.ts:149`
  - The bug: `occurrences()` expands MFL's weekly `happens` recurrence with a
    fixed `i * SEVEN_DAYS_MS` step of EPOCH time. MFL recurs on WALL CLOCK. So
    every occurrence after the November DST change lands an hour early:
    verified against the committed 2026 calendars, the AFL prints
    `Wed 8:00 PM PT` on 2026-10-27 and `Wed 7:00 PM PT` from 2026-11-03 on
    (TheLeague `7:00` → `6:00`), while the 2025 transaction logs show MFL
    actually processed at 8:00 PM / 7:00 PM PT on Nov 5, 12, 19 and Dec 3, 10,
    17.
  - User-visible effect: the countdown expires an hour early, and the hero
    reads "CLAIMS HAVE PROCESSED / Open now" for a full hour while the claim
    window is genuinely still open.
  - Why deferred: it is **not this PR's bug**. It is pre-existing in
    `waiver-window.ts` and ALREADY SHIPS TODAY on both `/players` pages through
    `describeWaiverWindow`; the hotfix propagates it to one more surface rather
    than introducing it. It cannot bite until **2026-11-01**, and fixing it
    properly means reworking recurrence onto wall clock inside the module that
    also decides which MFL endpoint a live waiver claim is submitted to
    (`fcfsWaiver` vs the queued import). That is not a change to ride a hotfix
    the night before waiver day.
  - **This has a deadline: it must land before 2026-11-01.** Unlike a normal
    follow-up item, letting it sit turns it into a live bug on a date certain.
  - Shape of the fix: expand occurrences by adding 7 calendar days in the
    league's own zone (`officialClock`) rather than 7×24h of epoch time, so the
    wall-clock hour is preserved across the transition. Pin it with a case that
    straddles 2026-11-01 in both leagues, and re-check
    `tests/waiver-window.test.ts`'s existing cadence assertions — that suite
    deliberately pins the SHAPE (in-season processing lands Wednesday evening
    PT) and never the hour, so it will NOT catch this on its own.

- [ ] **F3 — the open branch never consults `window.nextMode`**
  - Source: Claude review, `/code-review --comment` on #1122
  - Where: `src/utils/waiver-deadline-copy.ts:173`
  - The bug: `changesAt` is only "the next transition", not "the next
    PROCESSING run". Where two `WAIVER_LOCK` marks run consecutively — which
    TheLeague's own 2026 calendar does, Aug 16 → Sep 2 — the open branch says
    "Waivers process <that time>" about what is actually a pool re-lock, and
    counts down to it. Confirmed reachable: at 2026-08-20 the window resolves
    `mode=waiver, nextMode=waiver` and the copy reads
    "Waivers process Wed 7:00 PM PT".
  - Why deferred: preseason-shaped, and unreachable from the hero, which only
    renders this slot when `isRegularSeasonActive` is true. Real in the module,
    not currently on a page.
  - Shape of the fix: when `mode === 'waiver'` and `nextMode === 'waiver'`, the
    next mark is a re-lock, not a run — fall through to the no-day-named copy
    rather than naming it.

- [ ] **F4 — post-merge reviewer findings**
  - Source: Gemini / Copilot / CodeQL, which `/hotfix` deliberately did not
    wait for
  - Re-read https://github.com/braven112/mfl.football.v2/pull/1122 comments and
    fold anything real in here before starting. Nothing had landed at merge
    time.

## Context to start cold

**What made this findable.** The calendar feed was already synced and already
had a resolver — `resolveWaiverWindow`, written for `/players`. The hero simply
never asked it. Both extra bugs (the Tuesday Dec 29 run, TheLeague's 7pm) fell
out of pointing the hero at the existing resolver, not out of hunting.
`docs/claude/afl-rules.md` already said, in as many words, that the processing
time documented in prose is not the source of truth; this was the first hero to
act on it.

**The three-state trap, already paid for once.** `WaiverDeadlineCopy.open`
answers "are claims being queued", so it is false for `fcfs` AND for `unknown`.
The first version of the fix had both heroes branch on `!open` to render the
cleared treatment, which — with the calendar unreadable — produced the headline
`CLAIMS HAVE SOON.` over a summary saying claims were still queued, pill
`WAIVERS CLEARED`, count label "Claims process at the league deadline". Four
parts of one card disagreeing. The copy now carries `mode` uncollapsed and the
heroes branch on `mode === 'fcfs'`. **Do not reintroduce a boolean here** — the
calendar export is owner-gated, so an empty read is a real production state, not
a hypothetical.

**What was ruled out.** This was NOT a UTC-vs-PT bug in the slot routing, which
was the first hypothesis and is wrong: `getDailySlot` → `getPTComponents`
formats in `America/Los_Angeles` and is correct. The UTC confusion was real but
lived elsewhere — in TheLeague's hand-rolled countdown, and in the session's own
clock (the harness reported the date as 2026-09-16 while it was Tuesday
2026-09-15 in PT, which is the same off-by-one-day the bug itself was about).
Check `TZ=America/Los_Angeles date` before reasoning about a day-of-week bug
here.

**Relative words are judged on the VIEWER's clock, deliberately.** A Sydney
owner reading at Wed 11am PT sees `TODAY`, not `TONIGHT`, because Wed 8pm PT is
Thursday 1pm for them. This was a judgement call, flagged to Brandon and not
overruled; if it ever needs to change, the decision lives in `relativeDayWord`'s
`zone` argument and nowhere else.
