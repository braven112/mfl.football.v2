---
slug: locked-player-claim-502
status: open
severity: P1
opened: 2026-09-24
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1209
hotfix_sha: 9b01c6d
followup_issue: 1210
followup_pr:
followup_session: session_01SSVCWRYssUywm63qCE5tBv
---

# Follow-up: claiming a locked (recently dropped) player failed as a bare HTTP 502

## What broke
During the AFL's first-come window (Wed 8pm PT → Sunday kickoff, 2026-09-24),
claiming a recently dropped player (the 49ers DEF, `0530`, dropped in the AL)
showed only "Claim failed (HTTP 502)." MFL refuses to add a locked player, and
`/api/waiver-claim` relayed that refusal as a JSON **502**. The edge replaces
origin 5xx bodies with its own page (`docs/claude/insights/domains/deployment.md`,
2026-07-07), so the message never reached the modal. `get_runtime_errors` showed
nothing for the route: the error was handled, its body was just discarded.

## What the hotfix did
- `src/utils/mfl-locked-players.ts` (new): reads MFL's lock list from
  `export?TYPE=freeAgents` (`status: "locked"`), keyed per unit (AFL conference
  id `00`/`01`; TheLeague's single `LEAGUE` unit under `''`), cached 60s, and
  fails open (null = unknown). Guard: `tests/mfl-locked-players.test.ts`.
- `src/pages/api/waiver-claim.ts`: re-reads the list fresh before the write and
  refuses a locked add with a **409** (4xx passes the edge). In FCFS only
  `claims[0]` is checked, because it's the only claim written.
- `src/pages/afl-fantasy/players.astro` and `src/pages/theleague/players.astro`:
  a lock icon (with visually-hidden text) beside a locked free agent, and the ⋮
  menu drops Claim. AFL scopes this to the viewed conference; TheLeague leaves
  its offseason auction flow alone.

## Deferred items

- [ ] **F1 — Every other handled failure in the claim routes still loses its message at the edge**
  - Source: deferred at implementation (root-cause diagnosis, step 1)
  - Where: `src/pages/api/waiver-claim.ts:130`, `:186`, `:441`, `:492`, `:585`,
    `:646` (all `fail(…, 502)`), plus `:678` (500); `src/pages/api/waiver-claims.ts:122`,
    `:163`, `:247`
  - What: MFL's own refusal text ("Cannot Save Request: …", bid below minimum,
    roster limit…) is built into a JSON body and then replaced by the edge, so owners
    get "Claim failed (HTTP 502)" for all of them. Per the deployment insight, return
    handled failures as `200` + `{ success: false, message }`. The modal already
    branches on `!res.ok || !data.success` (`src/components/shared/WaiverClaimModal.astro:458`),
    so no client change is needed for it to show the message. Check
    `WaiverClaimsPanel` / `src/scripts/transaction-hub.ts` / `src/utils/player-claim-client.ts`
    for status-code assumptions before flipping. Add a scan guard that these routes
    never `fail(…, 5xx)` for a handled MFL answer (`/guard-test`).
  - Why deferred: touches ~10 return sites across two routes and every client that
    reads them — too wide for a hotfix whose reported case the 409 already fixes.

- [ ] **F2 — The modal's fallback text says nothing useful when the body is unreadable**
  - Source: deferred at implementation
  - Where: `src/components/shared/WaiverClaimModal.astro:470`
  - What: `Claim failed (HTTP ${res.status}).` is what owners see whenever the body
    isn't our JSON (edge page, timeout). Say what to do ("MFL didn't answer —
    check MyFantasyLeague's add/drop page before retrying") and still offer the
    add/drop link: the server's `confirmUrl` is lost with the body, so build it
    client-side from the modal's config (league host/year/id are already on `cfg`
    or the page; use the registry, never a literal).
  - Why deferred: polish on top of F1; F1 removes most of the cases.

- [ ] **F3 — Two docs contradict what MFL actually does**
  - Source: Copilot review (rejected with evidence) + deferred at implementation
  - Where: `docs/features/mfl-api.md:357-368` (says `freeAgents` is owner-authenticated);
    `docs/claude/insights/domains/mfl-api.md:924` (guesses `status: "locked"` means
    offseason-only)
  - What: observed 2026-09-24. Unauthenticated `freeAgents` (via
    `api.myfantasyleague.com`, redirect followed, no cookie, including from a Vercel
    preview) returns `status: "locked"` rows. They're per `leagueUnit` (`CONFERENCE00`/
    `CONFERENCE01` for the AFL, `LEAGUE` for TheLeague), and a player can be locked in
    one conference and rostered in the other. The lock is the recently-dropped lock
    MFL's add/drop page marks with `*`. Correct both docs and add a dated insight.
  - Why deferred: docs only, no owner impact.

- [ ] **F4 — TheLeague offseason auction: does a locked player take a bid?**
  - Source: deferred at implementation
  - Where: `src/pages/theleague/players.astro` (the `acqOffered` line, `!(p.locked && !isAuctionSeason)`)
  - What: during auction season the ⋮ menu still offers the bid on a locked player,
    because nobody has verified how MFL's auction treats one. Confirm against MFL
    next offseason (Feb–Mar) and gate or keep accordingly.
  - Why deferred: can't be verified until the auction runs.

## Context to start cold
- Ruled out: a game-start lock (the 49ers' week-3 game was Sunday 9/27) and a
  function crash (no runtime errors). The bare 502 is the edge replacing a
  handled JSON 5xx.
- The lock-vs-claim-window question was settled in review: both leagues' rules keep
  a dropped player locked until Sunday, after the claim/bid period that could
  process him (`docs/claude/afl-rules.md` § Free Agents; `src/data/league-constitution.ts`
  FCFS rules). So blocking locked players on the queued path too is intended.
- Vercel `get_runtime_logs` timed out on every query for this project; use
  `get_runtime_errors` (pre-aggregated) instead.
