---
slug: waiver-claim-locked
status: shipped
severity: P1
opened: 2026-09-30
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1280
hotfix_sha: 4e0ecbc
followup_issue: 1281
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1287
shipped: 2026-10-01
followup_session: https://claude.ai/code/session_013KbzgSmzCoSxmsPETQvJVM
---

# Follow-up: every waiver claim refused as "player locked"

## What broke
From the locked-player pre-check's arrival on main (~2026-09-27, via merge
`9ca6e20`) until PR #1280, every waiver claim in both leagues was refused with
"This player is locked on MFL — he was recently dropped… No claim was
submitted." (7× 409 on `/api/waiver-claim` in production over 3 days;
reported in the AFL GroupMe 2026-09-30). Both Free Agents pages also marked
every free agent locked and hid the Add action.

## What the hotfix did
MFL's `export?TYPE=freeAgents` tags `status: "locked"` for "cannot be added
INSTANTLY". In the waiver window that is the whole pool (812/812 AL, 814/814 NL,
619/619 TheLeague on 2026-09-30), and a queued claim is how those players get
added. New `dropLocksIn(locked, mode)` in `src/utils/mfl-locked-players.ts`
honours locks only when MFL's calendar (`resolveWaiverWindow`) says `fcfs`.
Callers: `src/pages/api/waiver-claim.ts` (~line 234),
`src/pages/theleague/players.astro` and
`src/components/afl-family/PlayersPage.astro` (calendar block hoisted above the
lock marking on both). Guard: `tests/mfl-locked-players.test.ts`.

## Deferred items

- [x] ~~**F1 — Drop locks are invisible during the waiver window**~~ — DROPPED (unverifiable, user's call 2026-10-01). Whether MFL refuses a queued claim on a player dropped inside the waiver window can only be settled by a real claim, which this follow-up cannot safely place. A submit-time refusal already reaches the owner verbatim via the route's `Cannot Save Request:` pattern. Recorded as an open question in `mfl-api.md` (2026-09-30 entry) with the transactions-feed approach to build only once a real case is observed.
  - Source: deferred at implementation
  - Where: `src/utils/mfl-locked-players.ts` (`dropLocksIn`)
  - Why deferred: in the waiver window the freeAgents export cannot tell a
    drop lock from the pool lock, so the hotfix shows none and lets MFL
    adjudicate. Open question for the follow-up: does MFL refuse a waiver
    CLAIM on a recently dropped player? If so, derive the drop set from the
    transactions feed (FREE_AGENT/WAIVER drops since the lock) rather than the
    flag, and verify against a real refusal before building it.

- [x] **F2 — Route gates twice** — DONE. One gate: `fetchDropLocks(leagueId, year, mode)` answers null outside FCFS without reading MFL; the raw `fetchLockedPlayers` is now private.
  - Source: Claude review, hotfix step 5
  - Where: `src/pages/api/waiver-claim.ts:~234` — `dropLocksIn(immediate ? await fetch… : null, window.mode)`
  - Why deferred: `immediate` already means `window.mode === 'fcfs'`; harmless
    redundancy kept so the fetch is skipped. Pick one gate.

- [x] **F3 — Players pages read the build-synced calendar, the route reads it live** — DONE. Both pages read the calendar live with the signed-in viewer's cookie (`waiverEventsLiveFirst`, `src/utils/live-waiver-calendar.ts`, 60s per-league cache) and fall back to the synced copy; `claim-context.ts` shares the same reader.
  - Source: deferred at implementation (pre-existing)
  - Where: both players pages' `calendarModules` glob vs the route's live
    `export?TYPE=calendar`
  - Why deferred: pre-existing; the lock gate now inherits it. If a sync
    lags a window flip, the page can show/hide locks for the wrong window
    while the route decides correctly. Decide whether that matters.

- [x] **F4 — Record the MFL semantics** — DONE. New 2026-09-30 entry in `docs/claude/insights/domains/mfl-api.md`; the 2026-09-24 entry's "windows do not overlap" claim is struck through as wrong.
  - Source: deferred at implementation
  - Where: `docs/claude/insights/domains/mfl-api.md` (or the waivers rules doc)
  - Why deferred: insight belongs in the follow-up. Content: `locked` in
    freeAgents = "no instant add"; the whole pool reads locked in the waiver
    window; only in FCFS does it mean a drop lock.

## Guard added by the follow-up
- `tests/mfl-locks-window-gate.test.ts` — the call-site guard the hotfix lacked (its unit test pinned `dropLocksIn`, but nothing stopped a caller reading the flag raw, which is the bug that shipped). Verified to fail when the window gate is removed.

## Context to start cold
- The pre-check was added to turn MFL's bare HTTP 502 on an instant add of a
  dropped player ("Okonkwo, Chigoziem WAS TE Cannot Be Added Because Is
  Locked.") into a plain message. That case is still covered in FCFS.
- The user explicitly rejected inferring the window from "every row is
  locked"; the MFL calendar is the source of truth.
- Waiver processing on 2026-09-30: TheLeague 7pm PT, AFL 8pm PT.
