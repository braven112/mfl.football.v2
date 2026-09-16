---
slug: schefter-pending-trade-lane
status: open
severity: P1
opened: 2026-09-16
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1137
hotfix_sha: 43af657f27
followup_issue: 1139
followup_pr:
followup_session:
---

# Follow-up: Schefter's pending-trade lane still can't see the approval queue

## What broke
Schefter's pending-trade lane, which announces a trade both sides accepted that is waiting on commissioner approval, has never posted in either league. Every scan hit MFL's `Commissioner can not impersonate another franchise with lockout on.` and logged it as one quiet line. A real AFL trade is waiting on approval now (2026-09-16) and has not been announced.

## What the hotfix did
PR https://github.com/braven112/mfl.football.v2/pull/1137, squash `43af657f27`.
- `scripts/schefter-scan.mjs#fetchPendingCommishTrades`: when MFL refuses `FRANCHISE_ID=0000` because of commissioner lockout, it retries with no FRANCHISE_ID (the commissioner's own view). Only rows passing `isApprovalQueueRow` (`scripts/lib/pending-trade-rows.mjs`) are kept.
- The lane is now league-scoped: bot from `league.groupMeSchefterBotId`, tag from `league.slug`, year from `leagueYearFor`. It had used TheLeague's bot for the AFL.
- Copy frames the deal as agreed and awaiting sign-off. Guard: `tests/schefter-pending-trade-lane.test.ts`.

**Production result (run 35125212023):** the lockout error is gone in both leagues, but the commissioner's own view returned **0 rows**. The AFL trade is still unannounced, so the root symptom is NOT fixed.

## Deferred items

- [ ] **F1: The commissioner's own view does not list other franchises' approval-queue trades. Find a read that does.**
  - Source: production verification, hotfix step 7
  - Where: `scripts/schefter-scan.mjs` (`fetchPendingCommishTrades` / `readPendingTradesExport`)
  - Why deferred: needs either a league-settings decision (turn commissioner lockout OFF in MFL for the AFL and TheLeague, after which `FRANCHISE_ID=0000` should work) or live MFL probing with the commish cookie, which the hotfix session did not have (no `MFL_USER_ID` locally, Chrome extension offline). Candidates: `FRANCHISE_ID=<the commish's own franchise>`, `TYPE=pendingTrades` on the league's `www##` host directly, or `TYPE=transactions&TRANS_TYPE=TRADE_PROPOSAL/pending`. Confirm with Brandon whether the AFL trade is actually in the approval queue (accepted) rather than an open offer. The lane must never announce an open offer as agreed.
- [ ] **F2: `/api/trades/pending?commish=1` makes the same `FRANCHISE_ID=0000` call and fails the same way under lockout**
  - Source: Claude review
  - Where: `src/pages/api/trades/pending.ts` (commissioner block near `fetchMflTrades(year, leagueId, mflCookie, '0000')`); consumers `src/components/schefter/AdminDashboard.astro:1263`, `src/scripts/transaction-hub.ts:1620`
  - Why deferred: a separate surface; its failure is silent (`commishTrades` stays `[]`), not a crash. Reuse whatever read F1 settles on.
- [ ] **F3: The AFL's Schefter post history is never committed by the scan workflow**
  - Source: Claude review
  - Where: `.github/workflows/schefter-scan.yml` commit step lists only `data/schefter/theleague/post-history.json`; `appendPostHistory` with `navSlug: 'afl'` writes the AFL's own file
  - Why deferred: pre-existing, affects every AFL lane, and not part of the reported failure. Verify the AFL path first (`scripts/lib/schefter-lore.mjs`).

## Context to start cold
- MFL confirmed on 2026-09-16 that commissioner lockout is enforced on the API, not just the UI. Both leagues' `league.json` have `lockout: "Yes"`. Neither league has a trade-approval field in the export; only `defaultTradeExpirationDays`.
- Owner-view pendingTrades rows (`will_give_up` / `will_receive` / `offeredto` / `trade_id`) are open proposals. Commissioner-view rows (`franchise` / `franchise2` / `franchise1_gave_up` / `franchise2_gave_up` / `id`) are the approval queue.
- The owner-reported intake (`src/utils/owner-trade-reports.ts`) is TheLeague-only and feeds the REDACTED trade-offer rumor lane, not this one. Don't route open offers into this lane.
- Two local tests time out on the corporate network (`tests/url-guard.test.ts`, `tests/waiver-priority-league-gate.test.ts`); CI passes them.

