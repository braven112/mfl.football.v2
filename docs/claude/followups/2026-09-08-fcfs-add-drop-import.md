---
slug: fcfs-add-drop-import
status: in-progress
severity: P0
opened: 2026-09-08
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1018
hotfix_sha: 759aee0
followup_issue: 1020
followup_pr:
followup_session: https://claude.ai/code/session_01LpDY8gHp8RpWCqLfb5rVi1
worked: 2026-09-08
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
  - STATUS 2026-09-08: still open, and still the only item that matters. Not
    doable from the follow-up session: MFL itself is reachable from there
    (`export?TYPE=league` answers, and `add_drop` correctly bounces to
    `/login` without a cookie), so the missing pieces are only a league to
    write into and an owner session cookie for a franchise in it. Brandon has
    offered a test league; the exercise is written out under "The F1 exercise"
    below so it can be run in one sitting rather than re-derived.
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

- [x] **F2 — The owner's browser showed `Claim failed (HTTP 502)`, not the server's message**
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
  - **WORKED 2026-09-08 — and the leading theory above is WRONG. Read this
    before acting on any of it.** The service worker is ruled out twice over,
    mechanically, not by argument:
      1. `public/sw.js` returns early on every non-GET request
         (`if (request.method !== 'GET') return;`). The claim is a POST, so the
         service worker never sees this request or its response. It could not
         have altered what the modal received.
      2. A stale BUNDLE would have made no difference either. The
         `data.message || 'Claim failed (HTTP …)'` fallback has been in this
         component since #983 (2026-09-05 19:56 PT) — two days before the
         outage, and well outside `HTML_STALE_MAX_AGE_MS` (12h), which is the
         only window in which a stale document can be replayed at all and
         therefore the only way an old `/_astro/<hash>.js` can be reached. No
         servable copy of this bundle ever lacked the specific-message branch.
  - **So the fallback fired because `data.message` was genuinely absent on the
    client** — and `fail()` attaches a `message` to every failure the route
    produces. That means at least one of those three 502s did not carry the
    route's JSON at all: a platform-level 502 in front of the function, an
    error page, a proxy, an auth redirect. Which contradicts the brief's own
    "the server sent a specific message on every one of those three 502s" —
    that was inferred from `get_runtime_errors` being empty, and a gateway 502
    is not a runtime error cluster. Consistent with what the log actually
    showed: `MFL response: 200` **with nothing after it**, when the pre-hotfix
    code would have gone on to a roster read-back, a 900 ms sleep, and a
    `console.warn` before its own `fail()`. (`maxDuration` is 30 in
    `astro.config.ts`; a timeout is normally a 504, so this is a strong lead,
    not a conclusion. Settling it needs Vercel runtime logs, which were past
    retention by the time this was worked.)
  - **What shipped, which closes the class rather than the instance.** The
    modal now reads the body ONCE as text and parses it itself, so a non-JSON
    body cannot collapse into `{}` and become indistinguishable from a route
    response with no message; it `console.error`s the status and the first
    500 bytes of whatever did arrive; and the fallback sentence now says the
    server did not say why, instead of handing the owner a bare status code.
    That is the client-side half of the rule the route already follows — never
    discard the body on a write. Guard:
    `tests/waiver-claim-confirmation.test.ts` → "says when a failure did not
    come from the route at all", which also pins the service-worker theory as
    ruled out so it is not re-tested.

- [x] **F3 — Unreachable branch in the FCFS success payload**
  - Source: Claude review, `/code-review`
  - Where: `src/pages/api/waiver-claim.ts`, the `missing.length === 0 ? … :
    'MFL accepted the add but your roster does not show it yet'` message
  - Why deferred: cosmetic. `stored !== null && missing.length > 0` returns
    above it, so the else branch cannot be reached. Harmless, but it reads as a
    live case and will mislead the next reader.
  - **WORKED 2026-09-08, and it was TWO branches, not one.** The queued
    (waiver) payload has the identical shape and the identical dead else —
    `canDiff && unconfirmed.length > 0` returns 502 above it, so the "MFL
    accepted the request but your pending waivers do not show it yet" sentence
    is unreachable too. The finding named only the FCFS copy; fixing one and
    leaving its twin is how a finding half-lands.
  - Both payloads now derive `const verified = …` once and choose between
    exactly two sentences off that single value, so the flag and the prose
    cannot drift apart and there is no third slot for a future edit to fill
    back in. Guard: `tests/waiver-claim-confirmation.test.ts` → "offers the
    owner only outcomes that can actually happen", which pins the SHAPE (two
    outcomes, `verified` derived once) rather than the absence of one
    sentence. The pre-existing `expect(ROUTE).toContain('verified:')` guard
    was widened to `/\bverified[,:]/` in the same pass — the field still
    ships, it is now carried by the shorthand.

- [ ] **F4 — Fold in any post-merge reviewer findings**
  - Source: Gemini / Copilot / CodeQL, which land after the merge
  - Where: PR #1018 comments
  - Why deferred: `/hotfix` does not wait on the advisory reviewers. CodeQL
    (`Analyze`) *was* waited on because this touches a server route handling
    user-supplied input; the others were not.
  - STATUS 2026-09-08: **still open, blocked on tooling, not on judgment.** The
    follow-up session had no GitHub access at all — no `gh` CLI, and
    `api.github.com` answers "GitHub access is not enabled for this session" —
    so PR #1018's comments could not be read. Nothing here was adjudicated and
    nothing was dropped; the item is untouched. Whoever picks this up reads the
    PR comments and adjudicates them the way `/live` step 7 does.

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

## The F1 exercise

Written out so it can be run in one sitting. The point is not "does a pickup
work" — it is **does the exact payload `waiver-claim.ts` sends get accepted by
`add_drop` from a roster that is already at the limit**, which is the condition
`fcfsWaiver` refused and the condition no test in this repo can reach.

**What it needs, and why each part:**

| Input | Why |
|---|---|
| A league id + its MFL host (`www##`) | The write goes to the LEAGUE's own host, never `api.` — that is already the route's rule and the exercise must not diverge from it |
| An owner session cookie for a franchise in it | `add_drop` bounces to `/login` without one; commissioner credentials are NOT a substitute, the route is owner-mode only and MFL treats `FRANCHISE_ID` as impersonation |
| That franchise at **exactly `rosterSize`/`rosterSize`** | A roster with a free slot passes even through `fcfsWaiver`. The full roster IS the bug |
| A genuine free agent's player id, and one of the franchise's own players to drop | Same pair shape as the lost 0019 attempt (add `0525`, drop `17518`) |
| The league's free-agent pool open (no `LOCK_ALL_PLAYERS` in force) | Otherwise the refusal under test is "Is Locked", not the limit |

**The payload, copied from the route's `immediate` branch — do not retype it
from memory, read it off `src/pages/api/waiver-claim.ts`:**

```
POST https://<host>/<year>/add_drop
Cookie: MFL_USER_ID=<owner session>
Content-Type: application/x-www-form-urlencoded

L=<leagueId>&add_settings=&PROJSRC=mfl&add_pid=<ADD>&drop_pid=<DROP>
&ROUND=1&COMMENTS=&SUBMIT=Perform+Add%2FDrop
```

No `FORCE_WAIVER`, and `Perform Add/Drop` rather than `Submit Request` — that
pair is the whole difference between an instant pickup and a queued claim, and
sending half of it is the failure mode this route has already shipped twice.

**What counts as passing.** Not the HTTP status, and not the response body —
`add_drop` answers a success and a refusal with the same 200 and the same page
furniture, which is the recurring shape below. Three things together:

1. The returned page carries **no** `Cannot Save Request:` /
   `Cannot Be (Added|Dropped) Because` / `Transaction Would Create` /
   `Exceeds League Limit` sentence.
2. `export?TYPE=rosters&L=…&FRANCHISE=…&JSON=1&_=<now>` shows the added player
   on that franchise. Cache-busted, and give it a second try before believing a
   miss — MFL's export trails its own write.
3. `export?TYPE=transactions&DAYS=1` carries a row for the add. This is the one
   the outage failed silently: three attempts left **no** row, which is how the
   refusal was proven to be a refusal rather than a display problem.

Then run it a second time with the roster back at the limit but asking for a
player who **is** locked, and confirm the page's complaint reaches the owner as
prose rather than as a status code — that exercises the `Cannot Be Added`
scan the hotfix added, which is guarded only by a source scan today.

**Do not run this against a live league in an open FCFS window.** A test league
exists for it; an exercise that files a real transaction in a real window is a
transaction some owner did not ask for.

## What the follow-up session could not do

Recorded so the next reader does not mistake an untouched item for a dropped
one.

- **No GitHub access.** No `gh` CLI, and `api.github.com` answers *"GitHub
  access is not enabled for this session"*. So PR #1018's post-merge comments
  (F4) were never read, and issue #1020 was not commented on or closed.
- **No Vercel access.** The Vercel MCP server was disconnected, and the
  incident's runtime logs were past retention regardless. F2 was therefore
  settled from the code and from git history rather than from the logs — which
  turned out to be enough to disprove the stated theory, but not enough to name
  what did happen.
- **MFL itself was reachable**, which is why F1 is blocked on a test league and
  a session cookie rather than on the network.
