# Roster Action Button — Move to IR / Practice Squad

Owner-mode roster moves wired into the existing player action button on `src/pages/theleague/rosters.astro`. Bidirectional (Move to IR ↔ Activate from IR; Move to Practice ↔ Promote from Practice). Rookies-only for the practice squad. Auto-taxi enhancement to the draft-pick contract-sync GitHub Action.

---

## 2026-05-04 - Architecture Summary

**API surface:**
- `POST /api/move-to-ir` — body `{ playerId, direction: 'to' | 'from' }`. Validates auth, roster membership, then calls `MFLMatchupApiClient.movePlayerToIR(playerId, franchiseId, direction)`.
- `POST /api/move-to-practice` — same shape; adds two server-authoritative gates for `direction='to'`: rookie classification (`status === 'R'` from the MFL players export) and practice-squad cap (TheLeague = 3).

**MFL endpoints used (canonical, owner mode):**
- IR: `POST {host}/{year}/import?TYPE=ir` with `ACTIVATED=<id>&DEACTIVATED=` (or inverse). NOT the legacy `/freeagency&TYPE=moveToIR`.
- Taxi: `POST {host}/{year}/import?TYPE=taxi_squad` with `PROMOTED=<id>&DEMOTED=` (or inverse).
- Both go through `mflFetch()` (Cookie-safe across the api→www49 redirect).
- Both share a private `runRosterMove()` helper in `src/utils/mfl-matchup-api.ts` that takes `{ type, onParam, offParam, playerId, direction }`.

**UI surface:**
- `populateCdmActionOptions()` at ~line 8404 of `rosters.astro` adds 4 conditional options to the existing action menu: Move to IR, Activate from IR, Move to Practice Squad, Promote from Practice. Owner-only gate (`config.authUser.franchiseId === currentTeam`). Practice-squad rookies retain access to "Move to IR" (an injury on practice should still be reachable from this menu).
- `goToRosterMoveStep(target, direction)` (~line 8672) builds the in-modal confirmation step: cap-impact preview (Practice only — IR is 100% cap-counted in TheLeague), inline error region with `role="alert"`, primary CTA, focus management to the back button on open.
- `applyLocalRosterMove()` (~line 8914) mutates `teamData.players` / `.practiceSquad` / `.injuredReserve` and calls `updateView()` to re-render the table.

---

## 2026-05-04 - Bidirectionality Was Free Once We Knew the API

**Context:** Original spec asked whether "already on IR" should hide the option or show the inverse. We assumed inverse would double the implementation cost.

**Insight:** MFL's `import?TYPE=ir` and `import?TYPE=taxi_squad` accept BOTH `ACTIVATED`/`DEACTIVATED` (or `PROMOTED`/`DEMOTED`) in the same request. The direction is implicit in which field you populate — there's no `MOVE=ACTIVATE/DEACTIVATE` parameter. So one private helper handles both directions for both endpoints — total surface is 4 directions × 2 endpoints with one server function and one client function each.

**Recommendation:** When designing a roster move flow that has a clear "undo" semantic (IR ↔ active, Practice ↔ active), check MFL's API for inverse-in-same-call support before scoping out one-way only. It's almost always there, and the implementation cost is negligible.

---

## 2026-05-04 - Server-Authoritative Gates + Client-Side UI Gates Have Different Sources of Truth

**Context:** The "Move to Practice Squad" option must only appear for rookies. The user said "MFL classifies rookies, use that."

**Insight:** MFL's rookie classification is `status === 'R'` on the players export. That field is NOT exposed on the rosters export, nor on the player object passed to the SSR template on the rosters page. There's no clean way to bring it client-side without an extra fetch.

We landed on a two-gate design:
- **Client-side (UI)**: gate on `contractInfo === 'RC' || 'TO'`. TheLeague's auto-stamp script writes one of these onto every drafted rookie within minutes, so this is a reliable proxy. Used only to decide whether to render the option button.
- **Server-side (authoritative)**: `/api/move-to-practice` fetches MFL's players export and rejects unless `status === 'R'`. This is the actual gate that matters.

The gates can disagree only in one window: between when a player is drafted and when the auto-stamp script runs (≤5 min). In that window the option might be hidden when MFL would accept the move, or vice versa. Acceptable.

**Recommendation:** Don't conflate "what the UI should show" with "what's allowed." The UI should be permissive enough that legitimate flows aren't blocked but tight enough that the obvious wrong cases don't even render. The server should be authoritative and reject loudly. Document the source of truth for each gate in a comment near the code.

---

## 2026-05-04 - Practice-Squad-Full Preflight UX Beats MFL's Error Message

**Context:** TheLeague caps the practice squad at 3. Submitting a 4th promotion to MFL returns a generic XML error.

**Insight:** Pre-flighting the cap on the client (`teamData.practiceSquad.length >= 3`) AND on the server (fetching the user's roster from MFL and counting `status === 'TAXI_SQUAD'`) lets us:
1. Show + disable the CTA in the confirmation step rather than letting the user click and bounce.
2. Render a contextual explanation ("Your practice squad is full. Demote a rookie first to free a slot.") instead of MFL's opaque error XML.
3. Keep the cap-impact card visible for educational value ("here's what the move WOULD do").

**Recommendation:** When MFL has a rule that's discoverable client-side (cap, roster size, draft player pool, etc.), preflight it and surface a friendly message. Only let MFL be the gate for things that aren't reasonably knowable client-side (timing, transient lock state, validation we don't model).

---

## 2026-05-04 - Auto-Taxi Policy: Fill in Pick Order, Newly-Drafted Only

**Context:** The `sync-draft-pick-contracts.mjs` GitHub Action runs every 5 min during May. After it stamps RC/TO contracts on freshly-drafted picks, it now also auto-promotes them onto the practice squad until each franchise's cap is full.

**Decision (B from the planning doc):** Fill in pick order — first 3 picks per franchise go to practice regardless of round. Newly-drafted picks only — never sweep already-rostered rookies, even if their franchise has open practice slots.

**Why pick order (not late-rounds-first):** The simplest policy that requires zero per-pick value judgment. Late-round picks naturally end up on practice anyway in most leagues, and a 1st-round pick that owners want on active can be demoted with one click via the action button. The asymmetry of "auto-add → owner removes" is fine because the action button makes removal a 2-click operation.

**Why newly-drafted only:** Predictability. Owners need to be able to reason about what the script touches. "It only acts on picks that just got their contract stamped" is a clear contract. Sweeping already-rostered rookies would surprise owners who chose to keep a 2024 rookie on active.

**Evidence:** `scripts/sync-draft-pick-contracts.mjs:buildTaxiPromotions` is pure logic, exhaustively tested in `tests/sync-draft-pick-contracts.test.ts` (6 cases covering pick-order, cap limit, missing counts, custom limits, no-fresh-picks, multi-franchise determinism).

---

## 2026-05-04 - Dry-Run Gate Placement Matters for Multi-Step Scripts

**Context:** The original `sync-draft-pick-contracts.mjs` had `if (cli.dryRun) return;` directly after printing the contract writes. After adding the auto-taxi block AFTER the contract write, dry-run mode never reached the taxi section — it returned before computing or printing the taxi promotions.

**Insight:** When a script has multiple write stages (contracts THEN taxi), the dry-run gate should wrap each stage's write call individually, NOT short-circuit the whole function. Dry-run should still compute and print what WOULD happen at every stage. Otherwise users running `--dry-run` to preview a deploy can't see the full impact.

**Pattern:**
```js
if (cli.dryRun) {
  console.log('[script] --dry-run: not writing stage A.');
} else {
  await writeStageA();
}
// always compute + print stage B preview
const stageBPlan = await computeStageBPlan();
console.log(`[script] Stage B plan: ${stageBPlan.length} actions`);
if (cli.dryRun) {
  console.log('[script] --dry-run: not writing stage B.');
} else {
  await writeStageB(stageBPlan);
}
```

**Recommendation:** For any multi-stage script, the dry-run check is per-stage, never script-wide. A `return` on dry-run is almost always a bug-in-waiting if more stages get added later.
