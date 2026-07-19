# Story: August Roster Cuts Automation

Derived from the approved plan: `docs/features/august-roster-cuts-automation-plan.md`
(read it first — it is the source of truth for every rule below).

## User Story

As a **league owner**, I want to mark players for automatic cutting (and see
exactly what will be cut, with cap impact) so my roster reaches the 22-player
August limit without me babysitting the deadline.

As the **commissioner**, I want the deadline job to execute every over-limit
team's plan owner-mode (lockout stays on), self-heal on failure, and leave a
permanent audit trail I can review and pause.

## Acceptance Criteria

- [ ] Owner can mark/unmark players for auto-cut from the player detail modal
      on `/theleague/rosters` during the cut window; marked players show a
      badge with priority number on their roster row.
- [ ] Cutdown Plan panel shows the exact execution-order slate (marked first,
      then last-added fill), with salary / dead-cap / savings per row and
      totals, countdown, under-limit state, and unsaved-changes warning.
- [ ] Saving requires a live-verified MFL credential; stale/missing/invalid
      cookie → `requiresReauth` → inline re-login modal → retry save.
- [ ] "Cut marked players now" executes the marked list sequentially via
      `/api/cut-player` with progress + failure collection.
- [ ] `selectAutoCuts` implements: cut only to reach 22; marked (owner order)
      first; then newest FA/waiver/auction acquisitions (trades NEVER count as
      acquisitions); no-record = oldest; taxi/IR excluded; never below 22.
- [ ] `scripts/apply-august-cuts.mjs`: date gate (never early), kill-switch
      check, pre-execution snapshot before any MFL write, per-franchise
      done/failed hash with MAX_ATTEMPTS=3 retries, credential delete after
      verify, `--dry-run` / `--validate-only` / `--rehearse` modes, committed
      report `data/theleague/august-cuts/{year}-report.json`.
- [ ] Admin page `/theleague/admin/cutdown-report`: per-franchise marked list
      vs slate vs executed, manual-done checkboxes, pause/resume kill switch,
      attempt counts. Admin-gated + page-directory entry (visibility admin).
- [ ] Cut lists private pre-deadline (owner + commissioner only); shared
      GroupMe messaging counts-only.
- [ ] pnpm test passes; pnpm build succeeds.

## Technical Context

### Files to Create
- `src/utils/august-cut-selection.ts` — pure `selectAutoCuts` (import
  `TARGET_ACTIVE_COUNT` from `salary-calculations.ts`)
- `src/utils/autocut-storage.ts` — cut-list + encrypted credential store
  (`autocut:{fid}`, `autocut:cred:{fid}`, AES-GCM via `AUTOCUT_CRED_KEY` env)
- `src/pages/api/autocut-list.ts` — GET/POST, auth via `getAuthUser`,
  save-time live validation (`export?TYPE=myleagues&JSON=1` with the session
  cookie), `requiresReauth` response
- `scripts/apply-august-cuts.mjs` + `.github/workflows/apply-august-cuts.yml`
- `src/pages/theleague/admin/cutdown-report.astro` + kill-switch/manual-done
  API route(s)
- `tests/august-cut-selection.test.ts`, `tests/autocut-storage.test.ts`,
  `tests/apply-august-cuts.test.ts` (or equivalent split)

### Files to Modify
- `src/pages/api/auth/login.ts` — capture/refresh stored credential on login
- `src/pages/theleague/rosters.astro` — action-menu option (~L8691
  `populateCdmActionOptions`, cut option ~L8803), row badges, Cutdown Plan
  panel next to the cutdown MetricCard (~L2860), cut-now flow (mirror
  `executeCutPlayer` ~L9831 and KeeperPlanner loop)
- `src/data/page-directory.json` — admin page entry, 10+ tags
- `.github/workflows/mfl-integration-test.yml` — read-only cookie-replay check

### Data Sources
- Rosters/league: `data/theleague/mfl-feeds/{year}/rosters.json`, live
  `createMFLApiClient().getRosters()`; transactions:
  `data/theleague/mfl-feeds/{year}/transactions.json`
- Acquisition parsing: `src/utils/contract-eligibility.ts`
  (`parseTransactions`, `ACQUISITION_TYPES` — do NOT add TRADE)
- Year: `getCurrentLeagueYear()` (roster-management-shaped)
- Deadline: `getAugustCutdownDate(year)` in `contract-eligibility.ts:197`
- League constants: import from `src/config/leagues-data.mjs` / `leagues.ts`
  (league-literal-guard test enforces this)

### Existing Patterns to Reuse
- `src/pages/api/cut-player.ts` — add_drop mechanics, preflight, verification
- `src/utils/kv-franchise-store.ts` — franchise-keyed KV route pattern
- `src/pages/api/trades/drafts.ts` — auth'd CRUD route template
- `scripts/apply-pending-contracts.mjs` + `.yml` — deadline job + dry-run input
- `scripts/lib/redis.mjs` — raw Upstash REST for scripts
- `scripts/lib/roger-reminder-window.mjs` — never-early date semantics
- `src/components/afl-fantasy/KeeperPlanner.astro:662-714` — sequential cuts
- `src/utils/salary-calculations.ts` + CDM cut-cost copy — cap math
- `src/utils/mfl-fetch.ts` — redirect-safe MFL fetch (owner cookie)

## Design Requirements

- Editorial standard: section titles (uppercase + left-border), tabular-nums,
  design tokens with fallbacks; PlayerCell/buildPlayerCellHTML for players;
  `chooseTeamName()` for team names.
- Cutdown Plan panel: desktop = card beside the roster metrics; mobile =
  stacked, 640px breakpoint. Amber/warning accent for auto-cut.
- Rendering: rosters page is already its own strategy (extend in place);
  admin page = SSR (auth-gated, live Redis reads).
- A11y: action menu options keyboard-reachable; drag-reorder must have
  up/down button fallback; badges need text labels not color alone.

## Agent Sequence

Wave 1 (parallel): backend core (Phase 1) implementation agent;
frontend-ux-architect design spec.
Wave 2 (parallel): rosters UI agent (per spec); execution script + workflow
agent.
Wave 3: admin page agent; then qa-investigator + qa-api-debugger.
Wave 4: code-reviewer + astro-performance-expert + frontend-ux-architect
review; fix; test + build; What's New; insights.

## Done Definition
- [ ] All acceptance criteria met
- [ ] pnpm test passes / pnpm build succeeds
- [ ] No Critical review findings remain
- [ ] Insights documented; What's New entry (screenshot per repo rule)
