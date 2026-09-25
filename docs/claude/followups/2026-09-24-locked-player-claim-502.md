---
slug: locked-player-claim-502
status: in-progress          # F1–F3 shipped; F4 waits on the Feb–Mar auction
severity: P1
opened: 2026-09-24
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1209
hotfix_sha: 9b01c6d
followup_issue: 1210
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1211
followup_session: session_01WVp1Z5rfi476eZ9Rjd3JsN
worked: 2026-09-24
---

# Follow-up: locked-player claims failed as a bare HTTP 502

Recreated from issue #1210 by `/followup`: the hotfix's brief file never landed
on `main`.

## What broke
During the AFL's first-come window (2026-09-24), claiming a recently dropped
player (the 49ers DEF, `0530`, dropped in the AL) showed only "Claim failed
(HTTP 502)." MFL refuses to add a locked player, and `/api/waiver-claim` relayed
that as a JSON **502**. The edge replaces origin 5xx bodies with its own page
(`docs/claude/insights/domains/deployment.md`, 2026-07-07), so the message never
reached the modal. No runtime errors were logged: the error was handled, its
body was discarded.

## What the hotfix did
- `src/utils/mfl-locked-players.ts` (new): reads MFL's lock list from
  `export?TYPE=freeAgents` (`status: "locked"`), per unit (AFL conference
  `00`/`01`, TheLeague `LEAGUE` → `''`), with a 60s cache, failing open. Guard:
  `tests/mfl-locked-players.test.ts`.
- `src/pages/api/waiver-claim.ts`: refuses a locked add with a **409** before
  any MFL write (FCFS checks only `claims[0]`).
- Both `players.astro` pages: a lock icon with screen-reader text, and Claim
  dropped from the ⋮ menu (AFL: per viewed conference; TheLeague: not during
  auction season).

## Deferred items

- [x] **F1 — Every other handled failure in the claim routes still loses its
  message at the edge.** Still true at re-validation (nine 5xx `fail` sites plus
  two `503` "blocked" paths across both routes). Every client already branches
  on `!res.ok || !data.success`. Shipped: `handledFailure` in
  `src/utils/api-response.ts` sends a 5xx as `200` + `{ success: false, message,
  status }` and passes a 4xx through; both routes build `fail` on it. Guard:
  `tests/claim-route-handled-failure-guard.test.ts` (no literal 5xx in either
  route, `fail` built on the helper, helper behaviour), wired into path-guard's
  `afl-waiver-order` domain. Mutation-checked red.
- [x] **F2 — The modal's fallback text is unhelpful when the body is
  unreadable.** Still true. Shipped: the claim context carries `addDropUrl`
  (registry-derived in `resolveClaimContext`), and `WaiverClaimModal` now says
  it could not read MFL's answer, tells the owner to check their roster /
  pending waivers before retrying, and links MFL's add/drop page.
- [x] **F3 — Two docs contradict what MFL does.** Still true. Shipped:
  `docs/features/mfl-api.md` `freeAgents` now says no auth and documents the
  per-unit `locked` shape; the 2026-02-13 insight is marked superseded; new
  dated entry in `docs/claude/insights/domains/mfl-api.md`.
- [ ] **F4 — TheLeague offseason auction: does a locked player take a bid?**
  Still open, and unverifiable until the auction runs (Feb–Mar 2027). Where:
  `src/pages/theleague/players.astro` (`acqOffered`,
  `!(p.locked && !isAuctionSeason)`). Verify against MFL during the auction,
  then gate or keep.

## Late review findings on #1209
None posted after merge. The three in-flight threads (queued-path lock, FCFS
`claims[0]`, `aria-label` on a span) were resolved on the hotfix PR itself; the
fourth (freeAgents needs auth) was disproved there and is F3.
