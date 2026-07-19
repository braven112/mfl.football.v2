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

## Execution auth — owner-credential replay (NOT commissioner impersonation)

**Commissioner impersonation is ruled out.** TheLeague keeps `lockout: "Yes"`
year-round (`data/theleague/mfl-feeds/2026/league.json:119`), and MFL hard-fails
impersonation under lockout: `"Can not impersonate another franchise when
LOCKOUT is on."` — already hit and documented by the auto-taxi attempt
(`.github/workflows/sync-draft-pick-contracts.yml:7-13`). Turning lockout off
for the deadline is not on the table.

**Instead, the job replays each owner's own MFL session cookie.** Lockout
blocks the commissioner acting *as* a franchise; it does not block a franchise's
own moves. The pieces already exist:

- The session JWT stores the owner's raw `MFL_USER_ID` cookie as `authUser.id`
  (`src/pages/api/auth/login.ts:52-57`), and every owner-mode write today
  (`/api/cut-player`, IR, taxi, trades) already authenticates with it via
  `mflFetch({ mflUserCookie: user.id })`.
- The app already treats that cookie as valid for the full 90-day session
  (`src/utils/session.ts:59-68`) — an owner who logged in in June and cuts a
  player in August is replaying a 2-month-old cookie. Persisting it server-side
  adds custody, not a new validity assumption.

### Credential capture & custody

- **Capture:** store the owner's MFL cookie in Redis, keyed
  `autocut:cred:{franchiseId}` with a `capturedAt` timestamp, refreshed on
  (a) every login and (b) every cut-list save. Refresh-on-login maximizes
  coverage — the fallback ("cut last added") applies to owners who never open
  the cut-list UI, and their cuts can only execute if a cookie was captured
  sometime.
- **Save-time guarantee (step-up auth):** saving a cut list requires a
  credential that is *proven live right now*. The save route validates the
  session's MFL cookie with the cheap authenticated read before persisting; if
  the cookie is missing, stale (captured > 30 days ago), or fails validation,
  the route returns `{ requiresReauth: true }` and the UI opens an inline MFL
  re-login modal (username prefilled, posts to the existing `/api/auth/login`,
  which refreshes both the session and the stored credential), then retries
  the save. Result: every saved cut list carries a credential verified working
  at the moment of save — an owner cannot set cuts on a dead cookie. On
  success the UI confirms it: "Cuts locked in — credentials verified
  <date>". Owners with a recent, valid cookie never see the modal, so the
  friction lands only where it buys certainty.
- **Residual risk this does NOT cover:** an owner who changes their MFL
  password (or otherwise invalidates the cookie) *after* saving. Forcing
  re-login on every save wouldn't cover it either — only the pre-deadline
  revalidation runs catch it, which is why they stay in the plan even with
  step-up auth at save time.
- **Custody rules:** encrypt at rest (AES-GCM, key derived from a dedicated env
  secret — not `JWT_SECRET`, so rotating one doesn't torch the other); never
  log it, never include it in any API response; the execution job deletes each
  franchise's credential after its cuts verify; a cleanup pass deletes all
  `autocut:cred:*` keys after the deadline regardless.
- **Disclosure:** the cut-list UI states plainly that saving authorizes the
  site to execute cuts as you at the deadline. Refresh-on-login should be
  mentioned in the What's New entry announcing the feature.
- **Validation:** a cookie is checked with a cheap authenticated read
  (`export?TYPE=myleagues&JSON=1` — returns `{"leagues":{}}` when the cookie is
  dead, per `docs/claude/insights/domains/mfl-api.md`) at capture time and again
  by the pre-deadline dry runs (below).

### Coverage gap — owners with no valid stored cookie

An owner who hasn't logged in within cookie lifetime has no replayable
credential. Handling:

1. Pre-deadline dry runs at T-7d and T-2d validate every over-limit franchise's
   stored cookie and post a GroupMe nag (via the existing Roger touch
   machinery) naming teams that need to log in once — logging in is the fix.
2. Any franchise still uncovered at execution time is skipped, listed in the
   run report, and left for the commissioner to cut manually in the MFL UI.
   (Whether MFL's commissioner *roster tools* — as opposed to impersonation —
   can drop players under lockout is worth a one-off manual check in the MFL
   web UI, but it's a manual-fallback nicety, not a dependency.)

## Cut-selection algorithm (the core logic)

New pure module `src/utils/august-cut-selection.ts`:

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

- Acquisition ordering: the typed transaction parser in
  `src/utils/contract-eligibility.ts` (`parseTransactions`,
  `findAcquisitionTransaction`, `ACQUISITION_TYPES`); `getRecentPickups()` in
  `src/utils/offseason-hero-data.ts:795` is the simpler prior art.
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
  at `src/pages/api/autocut-list.ts`. (The credential-refresh hook makes this
  route slightly custom — copy the factory pattern rather than instantiating it
  if the hook doesn't fit.)
- **Payload:** `{ year: number, playerIds: string[], updatedAt: string }` —
  `playerIds` is ordered (cut priority). Store the league year so a stale list
  from last August is ignored, not silently executed.
- The scheduled job reads these keys directly through `scripts/lib/redis.mjs`
  (raw Upstash REST — the `.ts` storage utils gate on `process.env.VERCEL`,
  which is unset in Actions runners; see `scripts/apply-pending-contracts.mjs:12-21`).

## UI — how an owner chooses cuts and sees their slate

All on the owner's own-team view in `src/pages/theleague/rosters.astro`,
visible only during the cut window (reuse the Jun-1→deadline window from
`isCutWatch()` in `src/utils/hero-resolver.ts:742`). Two surfaces:

### Choosing: "Mark for auto-cut" in the player action menu

The page already has the interaction: click a player → detail modal → action
options ("Cut Player", IR, taxi, trade block — `populateCdmActionOptions`,
`rosters.astro` ~L8691, cut option at ~L8803). Add one option during the cut
window:

- **"Mark for August auto-cut"** — desc: "Cut automatically at the deadline if
  you're over 22". Toggles to **"Unmark auto-cut"** when already marked.
  Unlike "Cut Player" (immediate, irreversible), marking is instant, free, and
  reversible until 8:45pm PT on deadline day.
- Marked players get a persistent **badge on their roster row** (e.g., an
  amber scissors chip "AUTO-CUT #2") so the slate is visible at a glance while
  scanning the roster table, not just inside the panel.

### Seeing the slate: the "Cutdown Plan" panel

A card next to the existing "Must cut N players by cutdown" MetricCard
(~L2860), showing the owner exactly what the deadline job will do to *their*
team. Contents:

1. **Status line:** active-roster count vs 22, cuts required, countdown to the
   deadline ("27 active · 5 cuts needed · deadline in 12 days").
2. **The slate, in execution order** — the same `selectAutoCuts` function the
   job runs, executed client-side against the live roster + marked list, so
   the preview and reality cannot drift:
   - Marked players first, drag-to-reorder priority (1, 2, 3…), labeled
     **Marked by you**.
   - If marks don't cover the overage, the remainder is filled with
     **Auto-selected (last added)** rows — each showing its acquisition date
     ("added Jul 12") and a hint: "mark other players to protect this one".
   - Players below the cut line are simply not shown — the panel lists only
     who goes.
3. **Save button** → step-up auth flow when the credential isn't verifiably
   live; on success the panel header flips to a confirmed state: "✓ Cuts
   locked in — credentials verified Aug 3. You can change this list until
   Aug 16, 8:45 PM PT."
4. **Under-limit state:** at ≤22 active the panel collapses to "You're at the
   limit — nothing will be cut. Your N marked players are safe unless you go
   back over." (Decision 2: marks are priority, not a standing drop order.)
5. **Unsaved-marks nudge:** marks staged but not yet saved show a sticky
   "unsaved plan" warning, since only a saved list (with its verified
   credential) is executable.

The slate is also surfaced passively where owners already look: the T-7d/T-2d
GroupMe touches say "your plan: 3 marked + 2 auto-selected — review at
/theleague/rosters", and the CutWatch hero deep-links to the panel.

The owner UI adds no new page → no `page-directory.json` entry for it (the
commissioner audit page below does need one). A What's New `new-feature`
entry (with screenshot) is required at ship time; it's an owner tool, so ask
whether it's hero-worthy (likely `excludeFromHero: true` — the CutWatch hero
already owns this real estate in August).

## Execution — scheduled job

**`scripts/apply-august-cuts.mjs`** + **`.github/workflows/apply-august-cuts.yml`**,
modeled on `apply-pending-contracts.{mjs,yml}` (the existing "deadline-executing
MFL write job"):

- `TZ: America/Los_Angeles` on the workflow; cron every 15 minutes during August
  only (`*/15 * * 8 *` UTC is fine — the in-script gate does the real work; no
  GitHub `vars.*` feature gate per CLAUDE.md).
- **In-script date gate:** fire only when `now >= getAugustCutdownDate(year)`
  AND a Redis one-shot flag `autocut:executed:{year}` is unset; set the flag
  after a successful run. Never early (same philosophy as
  `roger-reminder-window.mjs`), naturally idempotent, and self-healing if a
  scheduled run is missed. The same script with `--validate-only` powers the
  T-7d/T-2d credential-check dry runs.
- **`--dry-run` flag + `workflow_dispatch` boolean input defaulting to `true`**,
  exactly like `apply-pending-contracts.yml:24-29` — manual runs are safe by
  default, scheduled runs are live.
- Per-franchise flow: fetch live roster (`getRosters`) → run `selectAutoCuts`
  → execute each cut **with that owner's stored cookie** → re-read roster to
  verify → delete the credential → next franchise. Refuse to act on a franchise
  if the roster read looks degraded/empty (same guard as
  `cut-player.ts:121-151`), and never cut a roster below 22. Treat
  "player already gone" as success (409-tolerant, like the KeeperPlanner batch
  loop at `src/components/afl-fantasy/KeeperPlanner.astro:662-714`).
- **Cut mechanics:** the same `add_drop` page-handler POST `/api/cut-player`
  uses (form fields at `cut-player.ts:165-174`), owner-mode, **never sending
  `FRANCHISE_ID`** — sending it on an owner request trips the
  lockout-impersonation check and silently no-ops
  (`docs/claude/insights/features/roster-actions.md:19`). Two implementation
  options: (a) port the add_drop POST + `mflFetch` redirect-cookie handling
  into the script, or (b) keep the script a thin orchestrator that calls a new
  internal admin API route on the deployed site per franchise, reusing
  `cut-player.ts`'s code path wholesale. Prefer (b) — one credential access
  point, zero logic duplication — unless serverless timeouts bite
  (mitigate: one invocation per franchise).
- **Beware the stale-rosters window:** MFL's `rosters` endpoint can return stale
  data for recent drops in the offseason
  (`docs/claude/insights/domains/mfl-api.md:188-232`) — cross-check
  `transactions` when verifying, and don't double-cut on a stale read.
- **Pre-execution snapshot (audit trail — see next section):** before the
  first cut is attempted, write `autocut:snapshot:{year}` capturing every
  franchise's saved cut list and computed slate. Execution results are
  appended per franchise as the run proceeds. Cut lists (`autocut:{fid}`) are
  **never deleted** by the job — only credentials are.
- **Report:** write a per-run JSON report (who was cut, why, which franchises
  were skipped for missing credentials, failures), emit
  `::notice::`/`::warning::` annotations, open a GH issue on any failure
  (pattern in `schefter-scan.yml:30-105`) linking to the commissioner audit
  page, and hand Schefter a cutdown-recap hook (optional, phase 2).

## Commissioner audit trail — selections survive any failure

Requirement: if execution errors (partially or completely), the commissioner
must be able to see exactly who each owner had slated, after the deadline, and
finish the job manually in the MFL UI.

- **Selections are durable by design.** Owner cut lists live at
  `autocut:{franchiseId}` and are retained after execution (successful or
  not) until the next league year's window opens. The post-run cleanup pass
  deletes *credentials only*.
- **Snapshot before the first write.** The job's first act (after the date
  gate passes, before any MFL call) is to freeze `autocut:snapshot:{year}`:
  for every over-limit franchise — the owner's saved marked list (with
  priority order and `updatedAt`), the roster state at execution time, and the
  full computed slate with per-player reasons (`marked` / `last-added` +
  acquisition date). A crash on franchise 1 still leaves all 16 plans
  readable. Execution outcomes (`cut-verified` / `failed: <error>` /
  `skipped: no-credential`) are appended to the snapshot per franchise as the
  run proceeds.
- **Durable copy in the repo.** After the run (success or failure), the
  workflow commits the snapshot as
  `data/theleague/august-cuts/{year}-report.json` using the existing
  commit-back pattern (`scripts/commit-feed-and-push.mjs`, as in
  `schefter-scan.yml`). Redis is the live copy; the committed file is the
  permanent record that survives key expiry and makes year-over-year audits
  trivial.
- **Admin page: `/theleague/admin/cutdown-report`.** Commissioner-gated
  (`isCommissionerOrAdmin`), reads the snapshot (Redis, falling back to the
  committed file). One card per franchise: owner's marked list vs computed
  slate vs what actually executed, with failures highlighted and a per-player
  "done manually" checkbox (stored back to the snapshot) so the commissioner
  can track manual cleanup to completion. New page → needs a
  `page-directory.json` entry with `visibility: "admin"`.
- **Failure paging:** any failed or skipped franchise triggers the GH issue
  (already in the report step) *and* a commissioner-only notification listing
  the affected teams and linking the admin page.

## Phase 0 — verification spike (small, owner-mode)

The commissioner question is settled (blocked by lockout). What remains to
verify, with a throwaway test cut while stakes are zero:

1. **Headless cookie replay works:** a stored `MFL_USER_ID` cookie, replayed
   from a script/Actions context (not a browser), successfully drops a player
   via `add_drop` on an over-limit roster. (Expected yes — `/api/cut-player`
   is exactly this from a serverless context — but prove it from script land.)
2. **Cookie longevity:** confirm a weeks-old cookie still authenticates
   (validate with `export?TYPE=myleagues&JSON=1`), and document observed
   lifetime in `docs/claude/insights/domains/mfl-api.md`.
3. **Manual-fallback check:** in the MFL web UI as commissioner, can the
   commissioner roster tools drop a player with lockout on? Informs the
   stragglers plan; nothing depends on it.

## Build phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Owner-cookie replay spike from script context; longevity check; insights write-up | — |
| 1 | `august-cut-selection.ts` + unit tests; `autocut` KV store + API route with save-time validation + `requiresReauth` step-up; credential capture on login + save (encrypted) | — |
| 2 | Rosters-page UI: toggles, priority ordering, do-nothing preview, countdown | 1 |
| 3 | `apply-august-cuts.mjs` + workflow (dry-run default), `--validate-only` mode, pre-execution snapshot, committed report, credential cleanup | 0, 1 |
| 4 | Commissioner audit page `/theleague/admin/cutdown-report` + page-directory entry (admin) + failure notification | 3 |
| 5 | Roger/GroupMe touches: T-7d/T-2d "log in so your cuts can run" nags + post-cut recap; What's New entry | 3 |

## Tests

- `tests/august-cut-selection.test.ts` — the ordering contract: marked-first in
  owner order; newest-acquisition fallback; no-acquisition-record = oldest;
  under-limit → zero cuts; marked-but-departed players skipped; taxi/IR
  excluded; never cuts below 22. Pure function, exhaustive cases.
- Date-gate test — never fires before 8:45pm PT on the 3rd Sunday; fires on
  late/catch-up runs; one-shot flag prevents re-execution.
- Credential custody tests — encryption round-trip; the API route never echoes
  the credential; execution deletes it.
- Step-up auth tests — save with a missing/stale/invalid credential returns
  `requiresReauth` and persists nothing; save after re-login persists list +
  refreshed credential atomically.
- Audit-trail tests — the snapshot is written before any MFL call (a mocked
  first-cut failure must still leave a complete snapshot of all franchises'
  slates); execution never deletes `autocut:{fid}` lists; per-franchise
  outcomes append correctly.
- Script-level dry-run test asserting no MFL write is attempted with
  `--dry-run` (grep-sentinel style like `tests/schefter-quiet-day.test.ts` or a
  fetch-mock).
- League-literal guard already enforces registry usage — import league config
  from `src/config/leagues-data.mjs` in the script, never `'13522'` inline.

## Decisions made (flag if you disagree)

1. **Execution runs owner-mode with stored session cookies** — commissioner
   impersonation is impossible with lockout on, and lockout stays on.
2. **Marked players are cut only to reach 22**, never unconditionally. "Mark to
   cut first" reads as priority ordering, not a standing drop order.
3. **Fallback ordering is acquisition-timestamp descending** ("last in, first
   out"), from the current-year transactions feed; long-held players without a
   record are safest.
4. **Taxi and IR players are untouchable** by the automation — the 22 limit is
   active-roster only.
5. **The job runs once, at/after the deadline** (with catch-up), not
   continuously — owners keep full control until 8:45pm PT.
6. **Every team over the limit is in scope** — no opt-in; cookies are captured
   at login (with disclosure) so coverage isn't limited to owners who used the
   cut-list UI. Franchises with no valid credential are skipped, reported, and
   nagged beforehand.
7. **Saving a cut list requires a live-verified credential** (step-up re-login
   when the session's cookie is missing, > 30 days old, or fails a live
   validation check) — validation-first rather than forcing password re-entry
   on every save, since a cookie proven live at save time gives the same
   guarantee with less friction. The 30-day threshold is a tunable constant.
8. **Selections outlive execution.** Cut lists are never deleted by the job
   (credentials are), a full snapshot of every plan is frozen before the first
   MFL write, and the snapshot is committed to the repo — so any error leaves
   the commissioner a complete, permanent record of who each owner had slated,
   viewable on the admin audit page.
