# Release review — 2026-09-16

**Verdict: NO-GO** — `staging` does not contain `main`, because
`.github/workflows/staging-merge-down.yml` is failing on three code conflicts.
`/promote` step 2 will refuse, correctly. Nothing else in the range blocks.

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

## Blocks promotion

**1. Merge-down is broken — `staging` is 17 commits behind `main`.**

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

1. **The What's New rollup fires ahead of the promotion.**
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

## What clears the NO-GO

One thing: land the merge-down. Cut a branch from `staging`, `git merge
origin/main`, resolve the three conflicts by intent (both sides changed season
resolution on the same pages), run `scripts/roster-parity-check.mjs` before and
after, `pnpm test:unit`, re-measure `pnpm test:types`, push to `staging`. Then
re-run step 2 — `git merge-base --is-ancestor origin/main origin/staging` — and
this review's verdict becomes GO.
