# Release review — 2026-09-16

**Verdict: GO** — opened NO-GO on a broken merge-down; that has since been
resolved and pushed, and `main` is now contained in `staging`. `/promote` step 2
passes. Nothing else in the range blocks.

Both states are kept below rather than overwritten: what blocked, and what
cleared it.

This is the **first** run of this gate and the first promotion the release train
has ever attempted, so the range is ~3 weeks of accumulation rather than one.

**Range:** `origin/main...origin/staging` (`3c13e65` … `3c5b50f5`) — 313 files,
+40,846 / −8,737, 92 new files, ~15 feature PRs.

**Features on the train** (largest first):

- **MFL Live** — a league-agnostic scoring board at `mfl.football/live`, with its
  own app shell, two React islands and two API routes (#1078, #1105)
- **Front Office hub** — a shared hub plus the Contract Declaration Modal lifted
  out of `rosters.astro` (#1063, #1127, #1132, #1133)
- **Sign in and come back where you were going** — one sign-in URL builder
  replacing three disagreeing copies (#1104)
- **Snap counts** — new weekly pipeline and the GP / Snaps / Snap% columns (#1123)
- **Season points on Free Agents and both roster pages**, off MFL's YTD feed
  rather than a weekly sum (#1129, #1134)
- Throwback era picker on `/preferences` (#1130); AFL recap week scoping (#1095,
  #1102); keeper card layout (#1128); auction view window (#1111)

---

## Blocks promotion — RESOLVED 2026-09-16

**1. Merge-down was broken — `staging` is 17 commits behind `main`.**

`staging-merge-down.yml` run #59 (and every run since `366ae27`, 2026-09-15
17:09) failed with content conflicts in three files:

- `src/pages/theleague/rosters.astro`
- `src/pages/theleague/players.astro`
- `src/pages/theleague/front-office/projected-free-agents.astro`

Cause: the week-1 points hotfixes went straight to `main` (#1112, #1118, #1120,
#1122, #1126) while the same three pages were being reworked on `staging`
(#1129, #1134). Both sides changed the same season-resolution code. This is
class 4 in CLAUDE.md — integrate the intent, not a side-pick.

`/promote` step 2 refuses this by design, and the skill is explicit that it is
**not** to be resolved inside the promotion. It has to be resolved on a branch
and pushed to `staging` first.

Note `rosters.astro` is the 12.5k-line page: `scripts/roster-parity-check.mjs`
must run before **and** after, per `docs/plans/rosters-page-split.md`.

**Shorter path: fix, not pull.** Pulling #1129/#1134 off the train would not
help — the conflict is against hotfixes that are already in production, so the
same merge has to happen either way.

### How it was cleared

Branched off `staging`, merged `origin/main`, resolved, validated, pushed —
`staging` is now `0e7d1d4c`, which contains `main` at `3c13e65d`.

**Seven conflicts, not the three the workflow log printed.**

| File | Class | Resolution |
|---|---|---|
| `theleague/players.astro` | 4 | staging's `statsSeasonYear` / `seasonWeeklyData` **+** main's `nflScheduleFullModules ?? nflScheduleModules` fallback |
| `front-office/projected-free-agents.astro` | 4 | the same, plus main's path rename into `front-office/` |
| `theleague/rosters.astro` | 4 | staging's `modalWeeklyResultsRaw` and its pinning comment **+** main's `nflSchedule-full.json ?? nflSchedule.json` |
| `.claude/hooks/path-guard.json` | 5 | main's richer notes; both sides' `tests` arrays **unioned**, so all four newly-registered guards survive |
| `insights/domains/deployment.md`, `frontend.md` | 5 | both sides' journal entries kept |
| `weekly-changelog-staging.json` | 3-ish | merged entry-by-entry on RAW TEXT, 57 + 4 = 61 entries, +32 lines and no reflow — #1133 records that this file must be appended rather than re-serialized, because its escaping is mixed and a dump manufactures the next conflict |

Taking main's side verbatim on any of the three code files would have broken the
build: staging had renamed `lastSeasonYear` / `lastYearData` out of existence.
This is CLAUDE.md class 4 exactly — keep main's structural change, re-apply the
branch's behavioral change on top.

**One semantic conflict git could not see.** Main added
`tests/schefter-once-per-season-dedupe.test.ts`, whose `WEEK_SCOPED` list names
`weekly-recap`; staging deleted `scripts/article-types/weekly-recap.mjs` in
#1088. Neither diff touched the other's file, so both merged clean and the
result failed twice. Fixed by dropping the name, with the reason inline — the
list is a completeness guard over what is on disk, so a name with no module
behind it is a permanent red rather than a check.

**Validation**

- **Roster parity** (`scripts/roster-parity-check.mjs`, before and after, 12
  renders × 3 seasons × 4 teams): **426 value diffs, 423 of them `"-"` → a real
  number, and ZERO regressions** — nothing went value → `"-"`, nothing changed
  value → different value. The other three are noise: client config +2,731
  bytes and two console errors swapping arrival order.

  Cause traced rather than assumed: every diff is in columns 5/6/8 (Trend, Avg,
  Total) and only on LIVE seasons. Staging's committed
  `data/theleague/mfl-feeds/2026/weekly-results-raw.json` was 157,986 bytes with
  no scores; main's week-1 backfill makes it 278,696. 2024 is unchanged because
  it is a frozen season served from the committed payloads file. So the merge
  *restores* data staging was missing — which is what merging main down is for.
- **`pnpm test:unit`**: 495 files, **12,049 passed, 0 failed**, 3 skipped.
- **`pnpm test:types`**: passes at **1438**. The ratchet fails in either
  direction, so this is a real re-measure per CLAUDE.md class 6 — main's 17
  commits neither added nor cleared a type error against staging's number, so
  no retighten was needed.

## Stored-shape compatibility

**Clean — nothing in range touches Redis.** A grep over the whole diff for
`kv` / `redis` / `Upstash` / `scopedKvKey` / `createKvFranchiseStore` / `.hset` /
`.hget` / `.lpush` / `.sadd` returns zero added call sites.

The one new stored value is a **cookie**, not a key: `MFL_LIVE_LEAGUE_COOKIE`,
written by `src/pages/api/live-leagues.ts:75`. New name, nothing on `main` reads
it, and it is written from an API route rather than a component — so it clears
both the compatibility question and the `Astro.cookies.set()` boundary rule.

## Build rehearsal

`PREBUILD_FULL=1 pnpm prebuild` against `staging`'s tree: **exit 0, 41s, all 21
steps green.** Failures inside it are all pre-existing and handled: MFL's 2027
ADP / playerRanks 404 (that league year does not exist yet, warned and omitted),
ESPN's 2028 draft date 404 (keeps the existing value), 5 of 32 NFL dark logos
404 (falls back to the ESPN CDN swap).

**One derived file genuinely changes shape**, which is what this step exists to
catch: `data/theleague/derived/roster-season-payloads.json` gains **30,571
lines** — a new `totalSeason` field per frozen-season row. The rest of the
derived chain (`franchise-history`, `owner-tenures`, `season-ledger`,
`record-book`, `player-identity-union`) diffs by `generatedAt` alone.

Not blocking: #1134 made this call deliberately and documented it — frozen
seasons render `"-"` rather than `undefined` when the field is absent, and the
rehearsal confirms the regenerated values *are* `"-"`, so regenerating adds
30k lines of no information. Recorded here because the committed copy and
production's post-promotion prebuild output will disagree from Tuesday onward,
and the next person to diff that file should know why.

## Fix before promotion

None. Nothing cheap and local survived verification.

## Follow-up filed

None new — the two that this range would have produced were **already filed
inside it**, by `/live`'s own per-PR quality pass:

- `docs/claude/followups/2026-09-16-normalize-name-copies.md` — five
  `normalizeName` copies that do not agree (`rankings-parser.ts:30`,
  `scripts/lib/snap-counts.mjs:70`, `fetch-espn-college-ids.mjs:50`,
  `schefter-trade-speculation.mjs:289`, +1). P3, open.
- `docs/claude/followups/2026-09-16-league-planner-two-destinations.md` —
  already `status: shipped`.

Two smaller leads from the efficiency pass, worth a look but not worth a brief:
`afl-fantasy/rosters.astro` grew +382 lines in the same release that shrank its
TheLeague sibling by 1,405, and `front-office-planner-data.ts` /
`front-office-keeper-data.ts` request-time cost was not examined.

## Ratchets

| Baseline | Before | After | Why |
|---|---|---|---|
| `typecheck-baseline.json` | 1716 | **1438** | −278. Phase 6.1 of the rosters split: ~1,500 lines of Contract Declaration Modal left the page for `cdm-wizard.ts` / `cdm-ui.ts`, and an exported function needs a signature. Retightened, not left slack. Correct direction. |
| `page-fork-baseline.json` | 25 routes | **25 routes** | Net zero. `trade-builder.astro` → `front-office/trade-builder.astro` is the same fork under the hub's path, not a new one. |
| `clientrouter-init-baseline.json` | 17 files | **15 files** | `calculator.astro` and `dead-money.astro` fixed and removed. Correct direction. |

No ratchet moved the wrong way.

## Checked, nothing found

- **Sibling drift** — 173 changed files, 234 twin rows, 7 `UNCHANGED`. All 7
  judged correctly unchanged: each is a league-specific surface the twin does
  not have (AFL keepers / trade-builder, TheLeague front-office, Best Ball being
  draft-only). **0 twins need the same fix.** No second-order "unify this pair"
  signal either.
- **Cross-feature duplication** — the two strongest leads both came back clean
  and, notably, *self-documented*:
  - `login-redirect.ts` / `mfl-login-redirect.ts` / `signin-resume.ts` are three
    layers, not three copies. `signin-resume.ts` imports `loginUrlFor`;
    `login-redirect.ts:110-126` explains in the file why the app-host validator
    is deliberately NOT merged (it is dependency-free on purpose), and
    `login-redirect.ts` itself *collapsed* three prior copies.
  - `stats-season.mjs` / `snap-count-season.mjs` — `resolveStatsSeasonYear` is a
    re-export of `kickedOffSeason`, not a second implementation. One season
    boundary, two names, deliberately.
- **Boundary re-growth** — no new inline `buildAttributor`, no unscoped
  `scopedKvKey`, no hand-built origin+path concatenation, no inline
  `=== 'both'` bypassing `leaguesForStagedChange()`. Every `leagueUrl()` hit in
  the diff is a call site, not a reimplementation.
- **Efficiency** — both new islands are `client:load` and both are correct
  (single-island routes, `MflLiveBoard` self-polls at 25s/90s). All four new
  routes are correctly `prerender = false`. The Front Office hub ships **zero**
  `client:*` directives. No page gained a second or third hydration root. The
  CDM extraction is bundle-neutral (same code, moved). `pnpm check:bundle --src`
  passes: 14.0 MB / 50 MB.
- **League registry** — no new `'13522'` / `'19621'` literals outside the
  allowlist.

## Not run, and why

- **Duplication sweep via `scripts/gemini-ask.mjs`** — the `gemini` CLI is not
  installed in this container (`spawnSync gemini ENOENT`). The sweep was done by
  hand instead, targeted at the three name-based leads above. Lower coverage
  than explore mode; stated rather than hidden.
- **`scripts/guard-gap.mjs`** — reports 100% of prose lines as unguarded rules
  (209/209 on `schefter.md`), which is not credible against ~228 guard suites,
  so its output was discarded rather than used to manufacture findings. A
  weaker check was substituted: every commit in range that edited a rules doc
  also touched `tests/`.

---

## Release-train gaps, separate from this range

Neither blocks the promotion, but both are first-run-only and both are live
foot-guns on Tuesday. From `docs/plans/staging-release-process.md`, build order
items 8 and 9:

1. **The What's New rollup fires ahead of the promotion.** *(Pre-fix snapshot —
   resolved; see above. The diagnosis here is also wrong in an instructive way:
   the cron reads MAIN's queue, so it could not have announced an unpromoted
   feature. The real defect was the opposite one.)*
   `weekly-changelog-rollup.yml` is `0 4 * * 2` — Monday 9pm PT — while the
   promotion is Tuesday morning. It publishes the article and pushes the
   `site-update` notification, so owners get told to go look at features that
   are not live yet. The plan's own recommendation is to trigger it *from* the
   promotion rather than shift the cron, "so the ordering is structural rather
   than two schedules that happen to agree." There are currently **40 staged
   changes** queued (2 featured, one per league — correct), which is itself a
   sign the rollup has not been draining.
2. **Branch protection on `staging` was never wired.** The CI triggers exist
   (`ci.yml` and `codeql.yml` are both `[main, staging]`); the required-status-
   checks setting is a GitHub settings change nobody has made. "A train that can
   be pushed to directly isn't a train."

## Blackout, for the record

`scripts/release-blackout.mjs`: Tue 2026-09-15 clear, **Wed 2026-09-16 clear**,
**Thu 2026-09-17 blacked out** (NFL week start). The manual gap the script
cannot check — TheLeague's own draft date, which lives in the league-events
registry rather than an `.mjs` — still needs a human look before `/promote`.

## What remains before `/promote`

The gate is GO. The promotion itself still owes its own steps, and two of them
are not mechanical:

1. **CI green on `staging`'s exact tip** (`/promote` step 4) — pin the query to
   `0e7d1d4c`, not to the branch. A green run from an older commit is not this
   check.
2. **Chromatic on `staging` BEFORE the fast-forward** (`/promote` step 5b).
   `gh workflow run chromatic.yml --ref staging`, then review and accept the
   batch in the Chromatic UI. This is the one path where the `main` push's
   `--auto-accept-changes` could bless an unreviewed visual change, and this
   range touches a lot of rendering. Expect a large batch: it is three weeks,
   not one.
3. **TheLeague's draft date** — the one blackout the script cannot read.
4. ~~**The What's New rollup ordering**~~ — **resolved after this review was
   written.** The rollup now fires on the release tag `/promote` pushes, with
   the Monday cron kept as a floor behind a stand-down gate. The section below
   is the PRE-FIX snapshot and is kept as the record of what the review found,
   not as an outstanding item; `docs/plans/staging-release-process.md` carries
   the current design, including the correction that this was a LATE
   announcement rather than an early one.
