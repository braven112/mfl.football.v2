---
slug: fcfs-add-drop-import
status: open
severity: P0
opened: 2026-09-08
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1018
hotfix_sha: 759aee0
followup_issue: 1020
followup_pr:
followup_session: session_01LpDY8gHp8RpWCqLfb5rVi1
---

# Follow-up: teams could not add free agents in the FCFS window

## What broke

Every free-agent pickup from a **full roster** failed with `Claim failed (HTTP 502)`
and nothing reached MFL. Surfaced in the AFL's first FCFS window of the season,
which opened 2026-09-07 at 7:00 PM PT when `WAIVER_UNLOCK` fired. Three attempts
from franchise 0019 (add `0525` TB DEF, drop `17518` Cyrus Allen) at 19:08:10,
19:09:04 and 19:19:11 PT all vanished; `export?TYPE=transactions&DAYS=2` carries
no row for `0525` at any point that day.

`import?TYPE=fcfsWaiver` applies a strict "the resulting roster must be inside
the in-season limit" validation and scores the ADD before the DROP. The AFL's
`rosterSize` is 16 and the franchise was at 16/16 — the normal state of a roster
you are about to swap on — so the add alone is over the limit and the drop that
would fix it is never considered. It refuses with HTTP 200 and an **empty body**.

## What the hotfix did

Forward fix, not a revert — the bug was never in a single commit; it was in the
endpoint choice this route shipped with.

- `src/pages/api/waiver-claim.ts` — the immediate (FCFS) write now replays MFL's
  own `add_drop` page (`SUBMIT: 'Perform Add/Drop'`, no `FORCE_WAIVER`) instead
  of `import?TYPE=fcfsWaiver`. The queued path already used that page. Also:
  scans the returned page for `Cannot Be Added|Dropped Because` (immediate path
  only), returns `confirmUrl` on failures, reads the roster back cache-busted
  with one retry, and drops `readMflImportResult` from the route entirely.
- `src/components/shared/WaiverClaimModal.astro` — shows MFL's add/drop link
  next to the error on a failed pickup.
- `tests/waiver-claim-confirmation.test.ts` — guards for all of the above.
- `docs/claude/insights/features/waiver-claims.md` — the incident write-up.

## Deferred items

- [ ] **F1 — Exercise the new `add_drop` FCFS write against a live owner session**
  - Source: deferred at implementation
  - Where: `src/pages/api/waiver-claim.ts:272` (the `immediate` write body)
  - Why deferred: the guard tests are source scans, which is the established
    idiom for this route (it cannot be imported — Astro `APIRoute` + live MFL
    calls). Proving the *payload* works needs a real pickup in an open FCFS
    window, and the window was live during the outage.
  - Note: F1 is never optional. The evidence the payload is right is indirect —
    `cut-player.ts` and the queued-claim path use the same page handler
    successfully, and franchise 0006 made an identical full-roster swap on MFL's
    own site at 19:21:46 PT. That is strong but it is not a test.

- [ ] **F2 — The owner's browser showed `Claim failed (HTTP 502)`, not the server's message**
  - Source: unexplained detail from the incident
  - Where: `src/components/shared/WaiverClaimModal.astro:363`, and whatever
    service worker caches that bundle
  - Why deferred: it did not block diagnosis and it is not the outage. But it
    matters: the server sent a specific message on every one of those three
    502s, and the screenshot shows the generic fallback. The deployed commit
    contained the specific message, so the leading theory is a stale
    service-worker copy of the modal script on the owner's phone. If that is
    right, every error-message improvement in this route reaches owners late,
    which is worth knowing before relying on one again.

- [ ] **F3 — Unreachable branch in the FCFS success payload**
  - Source: Claude review, `/code-review`
  - Where: `src/pages/api/waiver-claim.ts`, the `missing.length === 0 ? … :
    'MFL accepted the add but your roster does not show it yet'` message
  - Why deferred: cosmetic. `stored !== null && missing.length > 0` returns
    above it, so the else branch cannot be reached. Harmless, but it reads as a
    live case and will mislead the next reader.

- [ ] **F4 — Fold in any post-merge reviewer findings**
  - Source: Gemini / Copilot / CodeQL, which land after the merge
  - Where: PR #1018 comments
  - Why deferred: `/hotfix` does not wait on the advisory reviewers. CodeQL
    (`Analyze`) *was* waited on because this touches a server route handling
    user-supplied input; the others were not.

## Context to start cold

**The evidence trail, so none of it has to be re-derived.** Vercel project
`prj_Ab677jUnJXlKpHmVLaAYeJIbdG9E`, team `team_9LcVP5jcAzXq3kKEZKU4qM84`. The
three failures are in production runtime logs for `/api/waiver-claim` around
2026-09-08T02:08–02:19Z; each shows `POST .../import?TYPE=fcfsWaiver
(L=19621&ADD=0525&DROP=17518)` then `MFL response: 200` with nothing after it.
`get_runtime_errors` returns **no** clusters for that route — the 502s were the
route's own `fail()`, not a crash or a timeout, which is what ruled out the
`maxDuration` theory early.

**What was ruled out, and why, so it is not re-litigated:**

- *Player was locked.* There is a `LOCK_ALL_PLAYERS` transaction at 15:30 PT
  that looks damning, but the AFL calendar has `WAIVER_UNLOCK` at Mon 19:00 PT
  and franchise 0006 completed a `FREE_AGENT` add at 19:21:46 — the pool was
  open. The lock was the waiver window opening, not a game lock.
- *Player was not actually a free agent.* Live rosters export: `0525` is on
  nobody's roster in either conference.
- *Our own roster cache served a stale pre-write snapshot.* `getRosters()` is a
  direct `mflFetch`, no Redis; the logs show a real network read-back each time.
  (The cache-buster added in the second commit is about HTTP-level caching and
  MFL's own lag, which is a different and still-real risk — see below.)
- *The queued path was affected.* It was not. It already used `add_drop` and its
  writes landed; the 23:56Z claim in the same log succeeded.

**The recurring shape, which is the actual lesson.** This is the third outage in
this one route caused by MFL's import API answering a refusal and a success
identically. `waiverRequest` stored nothing and said OK. `blindBidWaiverRequest`
the same. `fcfsWaiver` refuses a full roster and says nothing at all. `add_drop`
— the page an owner clicks — has never done this; it re-renders itself carrying
the complaint in prose. If a fourth write is ever added here, start from the
page, not the API.

**The review round mattered and its findings are worth knowing.** Three findings
came back and all three were "the fix under-delivers", so they were fixed rather
than deferred: the confirm link was inert because `showError` re-hides
`confirmBox`; the roster read-back had no cache-buster while every other read in
the file does, which would have turned a *successful* pickup into "nothing was
recorded" in the exact window where an owner retries; and the new
`Cannot Be Added` scan originally ran on the queued path too, where a false
positive aborts a multi-claim board after claim 1 was already filed.
