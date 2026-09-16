---
slug: waiver-hero-hardcoded-day
status: shipped
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1122
hotfix_sha: 3703981504c02d0ad14c1e6bc896af28038cb283
followup_issue: 1124
followup_pr: https://github.com/braven112/mfl.football.v2/pull/PENDING
followup_sha:
shipped: 2026-09-16
followup_session: session_015W3Mj2tHPbHd5jPQgffXkB
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

- [x] **F1 — DST drift in `resolveWaiverWindow`'s recurrence expansion** — **FIXED** in #1126, squash `ee7cb04`.
  - Source: Claude review, `/code-review --comment` on #1122
  - Where: `src/utils/waiver-window.ts:87` (`occurrences()`), consumed at
    `src/utils/waiver-deadline-copy.ts:149`
  - The bug: `occurrences()` expanded MFL's weekly `happens` recurrence with a
    fixed `i * SEVEN_DAYS_MS` step of EPOCH time. MFL recurs on WALL CLOCK. So
    every occurrence after the November DST change landed an hour early:
    verified against the committed 2026 calendars, the AFL printed
    `Wed 8:00 PM PT` on 2026-10-27 and `Wed 7:00 PM PT` from 2026-11-03 on
    (TheLeague `7:00` → `6:00`), while the 2025 transaction logs show MFL
    actually processed at 8:00 PM / 7:00 PM PT on Nov 5, 12, 19 and Dec 3, 10,
    17.
  - User-visible effect: the countdown expired an hour early, and the hero read
    "CLAIMS HAVE PROCESSED / Open now" for a full hour while the claim window
    was genuinely still open.
  - The fix: `addWeeksOnWallClock` (`src/utils/waiver-window.ts`) adds 7
    calendar days in the league's own zone rather than 7×24h of epoch time, so
    the wall-clock hour survives the transition. It reuses the two-pass zone
    solve `nextSundayKickoffEpoch` already uses and takes `zoneOffsetMs` from
    `viewer-preferences.ts` (now exported) rather than adding a third copy.
    Guard: `tests/waiver-window-dst.test.ts`, 8 cases straddling 2026-11-01 in
    both leagues. `tests/waiver-window.test.ts` could not have caught this on
    its own — it deliberately pins the SHAPE (in-season processing lands
    Wednesday evening PT) and never the hour.

  - **This item was deferred and then un-deferred, and the reversal was right.**
    The original deferral argued: not this PR's bug (pre-existing in
    `waiver-window.ts` and already shipping on both `/players` pages through
    `describeWaiverWindow`, so the hotfix propagated it rather than introducing
    it); cannot bite until 2026-11-01; and fixing it properly means reworking
    recurrence inside the module that also decides which MFL endpoint a live
    claim goes to — not a change to ride a hotfix the night before waiver day.

    Every one of those statements is still true, and together they were still
    the wrong call, because the deferral rested on a premise nobody had
    checked: that the damage was cosmetic. It was not.
    `/api/waiver-claim:161` does `const immediate = window.mode === 'fcfs'` to
    pick the MFL endpoint, so in the drifted hour — AFL 7–8 PM PT, TheLeague
    6–7 PM PT, every week after Nov 1 — a live claim would have been submitted
    as an instant FCFS add against a pool MFL still had LOCKED. That is the
    exact failure this file's own header documents from 2026-09-03, where every
    pickup 502'd. A "cosmetic, has six weeks" item was really a live
    wrong-endpoint bug with a date on it.

    **The lesson worth keeping is about the adjudication, not the code:** the
    severity of a deferred item is a claim about its blast radius, and that
    claim needs the call sites read before it is made. Here the same field
    (`mode`) fed both the copy and a write path, and only the copy was looked
    at.

  - The fix also verified the premise against MFL's OWN 2025 transaction log
    rather than assuming it: 141 AFL awards at Wed 20:00 PT and 58 TheLeague
    awards at Wed 19:00 PT, the wall-clock hour constant straight through the
    2025-11-02 transition.

- [x] **F3 — the open branch names a deadline `changesAt` does not promise** — **FIXED**, but NOT as prescribed. Read this before trusting the original write-up.
  - Source: Claude review, `/code-review --comment` on #1122
  - Where: `src/utils/waiver-deadline-copy.ts:173`
  - The finding was right about the gap: `changesAt` is "the next transition",
    not "the next PROCESSING run", and `resolveWaiverWindow` does not guarantee
    the marks alternate. The open branch said "Waivers process `<changesAt>`"
    and handed the hero that timestamp to count down to, without ever checking
    what the mark actually was.
  - **The prescribed fix was wrong and would have shipped a regression.** It
    said: when `mode === 'waiver'` and `nextMode === 'waiver'`, the next mark is
    a re-lock, so fall through to the no-day-named copy. Re-validating against
    the committed calendars before implementing showed that is exactly backwards
    in the only span either league actually reaches. TheLeague 2026 is the case
    cited — `WAIVER_LOCK` Sun Aug 16 9:00 PM → Wed Sep 2 7:00 PM — but the Sep 2
    mark carries `WAIVER_LOCK` **and** `WAIVER_BBID` at the same instant.
    Claims genuinely DO process then; the pool merely shuts again afterwards.
    So "Waivers process Wed 7:00 PM PT" is TRUE there, the countdown is a real
    deadline, and guarding on `nextMode` would have deleted both. The AFL's 2026
    calendar never reaches the shape at all.
  - Why `nextMode` cannot answer it: the resolver's simultaneous-mark collapse
    (added for the 2026-09-03 `fcfsWaiver` outage) folds a run-and-re-lock down
    to the resulting STATE and throws the run away. Both a real run and a bare
    re-lock come back as `nextMode: 'waiver'`.
  - The fix: `resolveWaiverWindow` now carries `nextProcesses` — whether a
    processing run sits on `changesAt` — which the collapse OR's alongside
    `opens` instead of discarding. The copy names the day only when a run is
    actually there. Behaviourally a no-op on both committed calendars, which is
    the point: the true case keeps its deadline and the invented one loses it.
  - Guard: three cases in `tests/waiver-deadline-copy.test.ts` — the
    run-and-re-lock keeps its day, a bare double-lock names none, and the
    `fcfs` branch (whose next mark is a lock, so `nextProcesses` is false) still
    names the day waivers REOPEN. That third case is the regression the
    narrower fix would have caused, pinned as itself.

- [x] **F4 — post-merge reviewer findings** — **FIXED**, two real ones.
  - Source: Copilot review on #1122, which `/hotfix` deliberately did not wait
    for. Gemini did not run (opt-in, not requested); CodeQL passed clean.
  - Three Copilot comments landed. One — `unknown` collapsing into `open:
    false`, so an unreadable calendar rendered as "waivers have cleared" — was
    already fixed in #1122 itself as F2 and is **dropped as overtaken**. The
    other two were real and are fixed here:
    - `src/pages/afl-fantasy/index.astro:216` selected the AFL calendar with
      `aflRecapSeasonYear` (`getCurrentSeasonYear`), the season-results clock.
    - `src/pages/theleague/index.astro:204` selected TheLeague's with
      `getCurrentSeasonYear` likewise.
  - Why they are real: `data/<league>/mfl-feeds/<year>/calendar.json` is keyed
    by MFL's LEAGUE year. The AFL rolls its feed year on June 1 and TheLeague on
    Feb 14; the season year rolls at Labor Day. Between those dates the feed has
    rolled while the season clock still names last season, so the lookup reads a
    STALE calendar — or misses the file entirely and falls through to
    `unknown`, which is the copy that names no day at all. Both `/players` pages
    already had this right (`getAflLeagueYear` / `getCurrentLeagueYear`), which
    is what made the mismatch findable: two reads of one feed disagreeing.
  - Fixed to the league clock on both homepages. Guard:
    `tests/waiver-window-callers.test.ts` walks each page's `calendar.json`
    glob back to the year variable's declaration and fails on a season-year
    clock — so it catches a NEW page copying the pattern, not just the two that
    shipped wrong.

- [x] **F5 — production callers rode the Pacific fallback instead of naming their league's zone** — **FIXED**.
  - Source: Copilot review on #1126, moderate (3 votes)
  - Where: `resolveWaiverWindow`'s `zone` parameter. Six production callers:
    both `index.astro`, both `players.astro`, `src/utils/claim-context.ts:173`,
    `src/pages/api/waiver-claim.ts:155`.
  - Behaviourally a no-op today — every league in the registry is Pacific — so
    nothing was wrong in production. It is a discipline gap: the registry
    documents that fallback as "for a caller that cannot name its league", and
    all six can. Same shape as the league-literal rule.
  - Fixed by passing `leagueClock(<entry>.slug).zone` at each site. Guard:
    `tests/waiver-window-callers.test.ts` reads the balanced argument text of
    every `resolveWaiverWindow(` call in `src/` and fails on one that does not
    name a zone. A scan is the only thing that can hold this: while the no-op
    is total, nothing else would say the day it stops being one.

- [x] **F6 — the brief's F1 item contradicted itself** — **FIXED** (this file).
  - Source: Copilot review on #1126, nit (1 vote)
  - The original "Why deferred" block — "not this PR's bug", "cannot bite for
    6½ weeks", "not a change to ride a hotfix" — sat directly above the later
    **RESOLVED** note, so the durable record argued both sides.
  - Rewritten as what it is: a deferral that was reversed, with the three
    original arguments kept (they were all true) and the premise that made them
    add up to the wrong answer named — nobody had checked whether the damage
    was cosmetic, and `/api/waiver-claim` proved it was not. The lesson is
    recorded as being about the adjudication, not the code.

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
