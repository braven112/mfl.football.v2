# August Roster Cuts Automation — Feature Plan

## Overview

Automate TheLeague's August cutdown (rosters must be at 22 active players by the
3rd Sunday in August, 8:45pm PT — `src/data/league-constitution.ts:29-48`).

Two halves:

1. **Owner intent (the "cut list"):** owners mark players on their roster to be
   cut first when the automation runs. Stored per-franchise, editable any time
   during the cut window.
2. **Deadline execution:** at the deadline, a scheduled job cuts each over-limit
   roster down to 22. Marked players go first; if the marked list is empty or
   insufficient, the job cuts the **most recently acquired** players until the
   roster reaches 22.

Everything below reuses existing, proven infrastructure — this feature is mostly
assembly, not invention.

## Cut-selection algorithm (the core logic)

New pure module `src/utils/august-cut-selection.ts` (mirrored or imported into
the script via a `scripts/lib/` shim if needed):

```
selectAutoCuts({ activeRoster, markedPlayerIds, acquisitions, target = 22 })
  → { cuts: PlayerId[], reason: Map<PlayerId, 'marked' | 'last-added'> }
```

Rules, in order:

1. `overage = activeRoster.length - target`. If `overage <= 0`, return no cuts —
   **marked players are only consumed to reach the cap, never cut for their own
   sake.** (An owner who marks 3 players but gets under 22 on their own keeps
   all 3.)
2. Take marked players first, in the order the owner ranked them, skipping any
   that are no longer on the roster (traded/already cut).
3. If still over, fill the remainder with the **newest acquisitions first**:
   order active-roster players by acquisition timestamp descending. Players with
   no acquisition record in the transactions feed are treated as oldest (cut
   last).
4. Only `status === 'ROSTER'` players count toward the 22 and are eligible;
   taxi/practice-squad and IR players are excluded from both the count and the
   cut pool (they have their own limits and don't block the cutdown).

Existing building blocks:

- Acquisition ordering: `getRecentPickups()` in
  `src/utils/offseason-hero-data.ts:795` and the richer typed parser in
  `src/utils/contract-eligibility.ts` (`parseTransactions`,
  `findAcquisitionTransaction`, `ACQUISITION_TYPES`). The new module should use
  the `contract-eligibility.ts` parser and share it with the script.
- Target constant: `TARGET_ACTIVE_COUNT = 22` in
  `src/utils/salary-calculations.ts:13` — import it, don't re-declare.
- Deadline: `getAugustCutdownDate(year)` in
  `src/utils/contract-eligibility.ts:197` is the single source of truth
  (3rd Sunday of August @ 8:45pm PT). The hero-resolver and offseason-hero-data
  each compute their own 3rd-Sunday date today; unifying them on this helper is
  an optional cleanup in this feature's scope, not a blocker.

## Storage — the per-franchise cut list

- **Key:** `autocut:{franchiseId}` in Upstash, via
  `createKvFranchiseStore('autocut', { label: 'auto-cut list' })`
  (`src/utils/kv-franchise-store.ts:34`) → instant authenticated GET/POST route
  at `src/pages/api/autocut-list.ts`.
- **Payload:** `{ year: number, playerIds: string[], updatedAt: string }` —
  `playerIds` is ordered (cut priority). Store the league year so a stale list
  from last August is ignored, not silently executed.
- The scheduled job reads these keys directly through `scripts/lib/redis.mjs`
  (raw Upstash REST — the `.ts` storage utils gate on `process.env.VERCEL`,
  which is unset in Actions runners; see `scripts/apply-pending-contracts.mjs:12-21`).

## UI — mark players on the rosters page

Extend the owner's own-team view in `src/pages/theleague/rosters.astro` (where
the "Must cut N players by cutdown" MetricCard already lives, line ~2860):

1. **Auto-cut toggle per player** (own franchise only, visible during the cut
   window — reuse the Jun-1→deadline window from `isCutWatch()` in
   `src/utils/hero-resolver.ts:742`). Marked players get a visible badge and an
   owner-orderable priority.
2. **"What happens if you do nothing" preview** — the load-bearing UX. Run
   `selectAutoCuts` client-side against the current roster + marked list and
   show exactly which players will be cut at the deadline, labeled *marked* vs
   *last added*. This makes the fallback behavior legible before it's
   irreversible.
3. Countdown to the deadline, reusing the CutWatch hero's date math.

No new page → no `page-directory.json` entry needed. A What's New `new-feature`
entry (with screenshot) is required at ship time; it's an owner tool, so ask
whether it's hero-worthy (likely `excludeFromHero: true` — the CutWatch hero
already owns this real estate in August).

## Execution — scheduled job

**`scripts/apply-august-cuts.mjs`** + **`.github/workflows/apply-august-cuts.yml`**,
modeled directly on `apply-pending-contracts.{mjs,yml}` (the existing
"deadline-executing MFL write job" — every pattern below is already proven there):

- `TZ: America/Los_Angeles` on the workflow; cron every 15 minutes during August
  only (`*/15 * * 8 *` UTC is fine — the in-script gate does the real work; no
  GitHub `vars.*` feature gate per CLAUDE.md).
- **In-script date gate:** fire only when `now >= getAugustCutdownDate(year)`
  AND a Redis one-shot flag `autocut:executed:{year}` is unset; set the flag
  after a successful run. Never early (same philosophy as
  `roger-reminder-window.mjs`), naturally idempotent, and self-healing if a
  scheduled run is missed.
- **`--dry-run` flag + `workflow_dispatch` boolean input defaulting to `true`**,
  exactly like `apply-pending-contracts.yml:24-29` — manual runs are safe by
  default, scheduled runs are live.
- Per-franchise flow: fetch live roster (`getRosters`) → run `selectAutoCuts`
  → execute each cut → **re-read roster to verify** → next franchise. Refuse to
  act on a franchise if the roster read looks degraded/empty (same guard as
  `cut-player.ts:121-151`), and never cut a roster below 22. Treat
  "player already gone" as success (409-tolerant, like the KeeperPlanner batch
  loop at `src/components/afl-fantasy/KeeperPlanner.astro:662-714`).
- **Beware the stale-rosters window:** MFL's `rosters` endpoint can return stale
  data for recent drops in the offseason
  (`docs/claude/insights/domains/mfl-api.md:188-232`) — cross-check
  `transactions` when verifying, and don't double-cut on a stale read.
- **Report:** write a per-run JSON report (who was cut, why, failures), emit
  `::notice::`/`::warning::` annotations, open a GH issue on any failure
  (pattern in `schefter-scan.yml:30-105`), and hand Schefter a cutdown-recap
  hook (optional, phase 2).

## Phase 0 — the one thing that must be verified first

**How does a headless job cut players it doesn't own?** The production cut path
(`src/pages/api/cut-player.ts`) deliberately uses MFL's `add_drop` **page
handler** with the *owner's* cookie, because the documented `fcfsWaiver` import
rejects drops while a roster is over-limit — the exact state this feature
exists to fix. The job has commissioner credentials (Actions secrets
`MFL_USER_ID` / `MFL_IS_COMMISH`, used by `apply-pending-contracts.mjs`), and
commissioner impersonation via `FRANCHISE_ID` is documented for import types
(`docs/claude/insights/domains/mfl-api.md:493-557`) — but **`add_drop` is a page
handler, not a documented import, so commissioner-for-franchise support is
unverified.**

Spike (mfl-api-expert / qa-api-debugger, against the live league while stakes
are zero):

1. Can the commissioner POST `add_drop` with `FRANCHISE_ID` (www49 host, both
   commissioner cookies) and drop a player from another franchise's over-limit
   roster? → If yes, the whole design above works as written. Document the
   verified form fields in `docs/claude/insights/domains/mfl-api.md`.
2. If no: test the commissioner roster-management page handlers as alternates.
3. Hard fallback if nothing works headless: semi-automated mode — the job
   computes every team's cut plan and posts it; owners get a one-click
   "execute my cut plan" batch button (owner-cookie, sequential
   `/api/cut-player` calls — the proven KeeperPlanner pattern), and the
   commissioner runs a same-button sweep for absentee owners from the admin UI.
   The cut-list UI and selection logic are identical in both worlds, so Phase 0
   doesn't block Phases 1–2.

## Build phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | MFL commissioner `add_drop` impersonation spike; write up in insights doc | — |
| 1 | `august-cut-selection.ts` + unit tests; `autocut` KV store + API route | — |
| 2 | Rosters-page UI: toggles, priority ordering, do-nothing preview, countdown | 1 |
| 3 | `apply-august-cuts.mjs` + workflow (dry-run default), report artifact | 0, 1 |
| 4 | Roger/GroupMe pre-deadline touches ("N teams over, M players auto-cut in 48h") + Schefter recap post; What's New entry | 3 |

## Tests

- `tests/august-cut-selection.test.ts` — the ordering contract: marked-first in
  owner order; newest-acquisition fallback; no-acquisition-record = oldest;
  under-limit → zero cuts; marked-but-departed players skipped; taxi/IR
  excluded; never cuts below 22. Pure function, exhaustive cases.
- Date-gate test — never fires before 8:45pm PT on the 3rd Sunday; fires on
  late/catch-up runs; one-shot flag prevents re-execution.
- Script-level dry-run test asserting no MFL write is attempted with
  `--dry-run` (grep-sentinel style like `tests/schefter-quiet-day.test.ts` or a
  fetch-mock).
- League-literal guard already enforces registry usage — import league config
  from `src/config/leagues-data.mjs` in the script, never `'13522'` inline.

## Decisions made (flag if you disagree)

1. **Marked players are cut only to reach 22**, never unconditionally. "Mark to
   cut first" reads as priority ordering, not a standing drop order.
2. **Fallback ordering is acquisition-timestamp descending** ("last in, first
   out"), from the current-year transactions feed; long-held players without a
   record are safest.
3. **Taxi and IR players are untouchable** by the automation — the 22 limit is
   active-roster only.
4. **The job runs once, at/after the deadline** (with catch-up), not
   continuously — owners keep full control until 8:45pm PT.
5. **Every team over the limit is in scope** — no opt-in. The cutdown is a
   league rule; the cut list is how an owner controls *which* players go, not
   *whether* cuts happen.
