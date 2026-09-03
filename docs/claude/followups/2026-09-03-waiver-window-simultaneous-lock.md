---
slug: waiver-window-simultaneous-lock
status: open
severity: P1
opened: 2026-09-03
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/735
hotfix_sha: c893004
followup_issue: 736
followup_pr:
followup_session:
---

# Follow-up: Free Agents said FCFS for a week while MFL's pool was locked

## What broke

From **Wed 2026-09-02 19:00 PT**, TheLeague's Free Agents page showed
"First come, first served · waivers reopen Wed, 7:00 PM PDT" while MFL's
free-agent pool was actually locked. The claim modal therefore offered an
immediate pickup, `/api/waiver-claim` wrote to `import?TYPE=fcfsWaiver`, MFL
answered a locked pool with an empty 200 that stores nothing, and the route's
roster read-back correctly found no player — so every pickup returned 502.
Reproduced live on 2026-09-03 15:30 PT (Nick Folk, player 8851, franchise 0001).

## What the hotfix did

`src/utils/waiver-window.ts` — `resolveWaiverWindow` now collapses calendar
marks that share a timestamp into one transition, with the lock winning.

TheLeague's 2026 calendar carries `WAIVER_LOCK` and `WAIVER_BBID` on the same
minute (Wed 2026-09-02 19:00 PT), and MFL's transaction log confirms it ran
both — `BBID_AUTO_PROCESS_WAIVERS` **and** `LOCK_ALL_PLAYERS` at that minute.
`Array.prototype.sort` is stable, so the winner of the tie was whichever event
MFL happened to list last; TheLeague's payload listed the run last, which read
as FCFS for the whole locked week. A lock is a state and a run is an event, so
after both have happened the pool is shut.

Guard test in `tests/waiver-window.test.ts` pins both payload orderings of a
lock/run tie, plus the AFL's own same-minute pair (`WAIVER_REVERSE` +
`WAIVER_UNLOCK`, Labor Day) still resolving to FCFS. Verified red before the fix,
green after.

## Deferred items

- [ ] **F1 — The FCFS pickup path has never been observed succeeding in TheLeague**
  - Source: deferred at implementation
  - Where: `src/pages/api/waiver-claim.ts:255-262` (the `import?TYPE=fcfsWaiver`
    branch), exercised from `src/components/shared/WaiverClaimModal.astro`
  - Why deferred: the pool is locked until **Wed 2026-09-09 19:00 PT**, so there
    is no way to exercise the branch before then. Every observed call to it has
    been against a locked pool.
  - What to do: after 9/9 19:00 PT, do one real FCFS pickup end-to-end and
    confirm the roster read-back, the "Added — the player is on your roster now"
    message, and the `bustRosterCaches` refresh. If MFL turns the add into an
    `AUCTION_INIT` instead of a `FREE_AGENT` transaction (see F4), the modal's
    copy and the route's verification are both wrong and need rework.

- [ ] **F2 — The owner saw the client's fallback error, not the route's message**
  - Source: deferred at implementation
  - Where: `src/components/shared/WaiverClaimModal.astro:285`,
    `src/pages/api/waiver-claim.ts:329-334`
  - Why deferred: does not change the fix, and chasing it would have widened a
    P1 diff.
  - Detail: the screenshot showed the bare fallback `Claim failed (HTTP 502).`,
    which only renders when `data.message` is absent — but every `fail()` in the
    route returns JSON carrying a `message`. Two candidates, not distinguished:
    (a) the owner was on an older deployment (four deploys landed within the
    hour), or (b) the function did not return its own response and Vercel
    supplied a bodyless 502. Weak evidence for (b): the production log for that
    request shows the pre-write `rosters` fetch but **no** post-write `rosters`
    fetch, even though the FCFS branch reads the roster back before returning.
    Worth pinning down — an owner should never see a status code where the route
    wrote them a sentence.

- [ ] **F3 — "waivers reopen" is the wrong label when the next mark is another run**
  - Source: noticed while reading the resolver
  - Where: `src/utils/waiver-window.ts:163` (`describeWaiverWindow`)
  - Why deferred: cosmetic; the mode itself is now correct.
  - Detail: the FCFS string hardcodes "waivers reopen {changesAt}", but
    `changesAt` is simply the next transition — which can be another processing
    run rather than a lock. Before this hotfix that produced "First come, first
    served · waivers reopen Wed, 7:00 PM PDT" pointing at a `WAIVER_BBID`, i.e.
    when waivers *close*. Phrase it off `nextMode`, not off the mode you are in.

- [ ] **F4 — An owner reports MFL turned a free-agent add into an auction bid**
  - Source: owner report (The Music City Mafia, franchise 0006), 2026-09-03
  - Where: league mechanics + the modal's copy in
    `src/components/shared/WaiverClaimModal.astro:189`
    ("Free agent pickup at the league minimum ($425,000)")
  - Why deferred: not caused by this site — production logs show exactly one
    `fcfsWaiver` POST in the whole window and it was franchise 0001's. MFL logged
    `AUCTION_INIT 0006 8851|425000|` at 15:04 PT, one minute after that owner's
    `/api/waiver-claim` returned 400, which reads as them going to MFL directly
    after our page refused them.
  - What to do: confirm with the owner how they placed it, then establish what a
    free-agent add actually does in TheLeague while the pool is locked
    (`currentWaiverType: BBID_FCFS`, `bbidConditional: Yes`,
    `auction_kind: email`). 2025's in-season months are almost all `FREE_AGENT`
    adds with `AUCTION_INIT` near zero, so auctions look like an offseason /
    preseason mechanism — but if a locked-pool add nominates an auction, the
    modal's "pickup at the league minimum" copy is wrong in exactly the state
    owners hit it in.

## Context to start cold

**How the diagnosis was reached**, so none of it needs redoing:

- `mcp__Vercel__get_runtime_logs`, production, query `fcfsWaiver` — one POST in
  8h, `L=13522&ADD=8851`, MFL 200 with an empty body, then 502.
- `curl "https://api.myfantasyleague.com/2026/export?TYPE=transactions&L=13522&DAYS=3&JSON=1"`
  — `LOCK_ALL_PLAYERS` and `BBID_AUTO_PROCESS_WAIVERS` both at Wed 09-02 19:00 PT.
  No `FREE_AGENT` transaction since the Aug 16 cutdown: the pool has been shut
  the entire preseason.
- `data/theleague/mfl-feeds/2026/calendar.json` is the ground truth for the
  schedule and is committed, so the resolver can be re-run offline against it.
  The weekly cadence starts `WAIVER_LOCK Sun 2026-09-13 10:00 happens=16` /
  `WAIVER_BBID Wed 2026-09-16 19:00 happens=14`; everything before that is
  one-off preseason events.

**Ruled out:** a client-side bug in the modal (the wrong mode came from the
server-rendered `windowMode`), the write host, and the auth cookie — the
calendar and rosters reads both succeeded as the owner.

**Sibling parity is not an issue here**: `theleague/players.astro`,
`afl-fantasy/players.astro` and `api/waiver-claim.ts` all call the one shared
`resolveWaiverWindow`, so there is no second copy to drift. The AFL's behavior is
unchanged — its same-minute pair is two closing events.

**Verified on production** at `https://theleague.us/players` after the merge:
`windowMode":"waiver"` and "Waivers open · claims process Wed, 7:00 PM PDT".
