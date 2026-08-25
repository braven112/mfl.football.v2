# Type-Error Remediation

The repo carries a large, deliberately-ratcheted `astro check` error count.
This file is the plan of record: what the number is, which phases were done and
what each actually bought, and — more usefully — which remaining phases are
**deliberately not scheduled**, so a future session doesn't re-derive the same
conclusion from scratch or "helpfully" start sweeping.

The mechanics of the gate itself (how to run it, what to do when it fires) live
in `CLAUDE.md`'s Project basics. The individual gotchas found along the way are
dated entries in `docs/claude/insights/domains/frontend.md` — grep it for
`nameMedium`, `JSDoc Cast`, `Hoisted`, `auction-predictor`.

## 2026-08-25 - The rosters.astro Split, Slice 1: 1913 -> 1545

**Context:** The entry below recommended splitting `rosters.astro` rather than
sweeping it, and left the decision on whether to do so. It was done. This entry
records what the split actually bought, what it found, and where it stopped —
the entry below it is still accurate about method and is left intact.

**Where the number stands** (measured at the head of
`claude/type-error-remediation-mlhz6p`, `astro check --minimumSeverity error`):

| Bucket | Count | Was |
|---|---:|---:|
| **Total** | **1545** | 1913 |
| `src/pages/theleague/rosters.astro` | 675 | 1042 |
| rest of `src/` | 454 | 455 |
| `tests/` | 399 | 399 |
| `packages/` + `party/` | 17 | 17 |
| *implicit-`any` (7006/7053/7005/7034)* | *730* | *845* |

The whole −368 came out of one file. `rosters.astro` fell 35%, and is now 44%
of the total rather than 54%. It is 12,491 → 12,067 lines.

```
1913   before
- 29   dedup + contract-math extraction   -> 1884
- 18   live-odds / weeklyResults out of frontmatter -> 1866
-188   23 never[] row parameters          -> 1678
- 71   15 bare-{} map declarations        -> 1607
- 62   element query sites + window expandos -> 1545
```

**The split is real but partial, and the partial part is the important part.**
What came out cleanly was everything that did not close over `initRosterPage`'s
state: the contract math, the ESPN/Open-Meteo fetching, the MFL weeklyResults
fold. What did not come out is the ~6,900-line `initRosterPage` itself. Its two
big sections — August auto-cut (~2,500 lines) and Contract Demo (~470) — read
**128 distinct names from the enclosing closure** (`renderTableRows`,
`updateView`, `currentTeam`, `contractActions`, the whole CDM state block).
Extracting either means designing a context object and re-verifying in a real
browser, because that is exactly where the documented TDZ crash lived. Measured,
not guessed: the dependency count above is reproducible by diffing declared
against referenced identifiers over the section's line range.

**The finding that mattered more than the count: three fully-typed extractions
of this code already existed and had ZERO importers.**

- `src/utils/weather.ts` — `NFL_STADIUMS` byte-identical to the page's copy,
  same Open-Meteo call, same 26-entry WMO table (verified key by key).
- `src/utils/live-odds.ts` — a near-exact typed copy of the page's odds fold.
- `src/constants/roster-constants.ts` — the headshot and logo URL builders,
  which the page's script was already importing *other* symbols from while
  running its own untyped copies of these.

So the page was running untyped duplicates of code that sat typed and unused
next to it. The split consolidated rather than adding a fourth copy: two things
the page had that `live-odds.ts` lacked came across with it (the 6-second bound
on the weather backfill, and ESPN's `conditionId`). **Before extracting anything
out of a big file in this repo, grep `src/utils` for the function name first —
there is a real chance it is already there.**

**Yield, in the phase-4 sense.** Two divergences that only a merge surfaces:

1. **`annotatePositionDividers` disagrees with itself.** The frontmatter copy
   draws the position rule above the first row and not below the last; the
   client copy does the opposite. Every interaction (sort, team switch, season
   change) re-renders through the client path, so the rule visibly moves ends
   the first time an owner touches the table. NOT fixed — it is a rendering
   change, not a typing one. Whoever unifies these should take the client's
   semantics, because that is what the page becomes a moment after load.
2. **`getWeatherIcon` had no dome branch** in either of the page's two copies,
   while the page's own fetch emits `displayValue: 'Dome'`. Adopting
   `weather.ts` fixed it; a dome game now shows the stadium glyph in both SSR
   and the client re-render, where before both showed a thermometer.

**Method note, confirming the entry below.** The 5:96 ratio was not a fluke.
23 parameter annotations removed 188 errors (1:8), and 15 map declarations
removed 71 (1:5). Both classes were the same defect: `(rows = [])` types the
parameter `never[]`, and `const m = {}` pins the type to the empty literal.
Neither is an implicit-`any` — TS infers a *specific, useless* type, and every
read below fails separately. **These are the highest-yield fixes in the repo
and they are mechanical.** Find them with:

```bash
grep -nE '= \[\]\)|= \{\};' src/pages/theleague/rosters.astro
```

Types were traced to producers, per the guardrail: `RosterDisplayRow`
(`src/types/roster-display-row.ts`) mirrors the `playerObj` literal in
`scripts/lib/roster-season-payload.mjs` field for field; `ChartSlice` already
existed in `scripts/chart-utils.ts`; `SalaryAverages` came from
`contract-eligibility.ts`. The one place a shape genuinely is not knowable —
raw MFL feed bodies, which differ across seasons — the KEY type is pinned and
the value left loose, stated at the declaration.

**What is left in `rosters.astro` (675), and what to do about it:**

- **378 are implicit-`any`** (56% of the file). Still the lowest-value work in
  the repo; the entry below is still right that it should come out
  incidentally.
- **~89 `ts18047` + 51 `ts2531`** — null-safety *inside* rosters.astro. This
  class is at zero everywhere else and pinned there. Worth doing, because these
  are the errors that can represent a real crash.
- The rest is scattered.

**Two easy things deliberately left undone**, both of which would let the
ratchet gain a class floor — the mechanism the entry below explains is needed
because the total alone cannot protect a cleared class:

- **`Property 'x' does not exist on type 'HTMLElement'` is down to 17**, all
  outside rosters.astro: `PlayerDetailsModal.astro` (9), `mvp.astro` (6),
  `PlayerNewsModal.astro`, `salary-history.astro`. Fix at the query site
  (`document.getElementById(...) as HTMLButtonElement | null`), not per use —
  same fix as the already-pinned `Element` cluster.
- **`Property 'x' does not exist on type 'Window'` is down to 9**, same three
  files. `src/env.d.ts` is now where those expandos get declared.

Clearing either class is ~20 errors of work and buys a permanent floor.

**Evidence:** commits on `claude/type-error-remediation-mlhz6p`;
`src/utils/roster-contract-calcs.ts`, `src/utils/roster-weekly-scores.ts`,
`src/types/roster-display-row.ts`, the consolidated `src/utils/live-odds.ts`;
`tests/roster-contract-calcs.test.ts`, `tests/live-odds.test.ts`,
`tests/roster-weekly-scores.test.ts` (47 cases, where there were none).

## 2026-08-25 - State of Play, and What Not To Do Next

**Context:** Four merges (#599, #603, #606) took the count from 2318 to 1913.
Anyone picking this up next needs the numbers and, more importantly, the
reasoning behind stopping where we stopped.

**Where the number stands** (measured at `f072769`, `astro check
--minimumSeverity error`):

| Bucket | Count | |
|---|---:|---|
| **Total** | **1913** | pinned by `pnpm test:types` |
| `src/pages/theleague/rosters.astro` | 1042 | **54%** — one file |
| rest of `src/` | 455 | null-safety here is at **0** |
| `tests/` | 399 | |
| `packages/` + `party/` | 17 | |
| *implicit-`any` (7006/7053/7005/7034)* | *845* | *44% of the total; 493 of them in rosters.astro* |

**Lineage of the number.** Each step is a measured total, and they reconcile:

```
2318   main at 130824d, before any of this
-124   #599                       -> 2194
-100   #603 phase 1               -> 2094
-144   #603 phases 3+5            -> 1950
- 37   #606 phase 4 + class floors -> 1913
```

Separately, and NOT a term in that sum: main gained ~102 errors from PRs
#600/#601 while this work was in flight, and that rise is already inside the
2318 above. It is recorded only because the ratchet fired on a rebase because
of it — when that happens, measure whether the rise is yours before
re-baselining.

**Phases done, and what each was actually worth:**

Class counts and total deltas are different numbers — clearing a class also
stops downstream reads failing, so the total moves further than the class size.
Phases 3 and 5 cleared 140 class errors and moved the total 144; the extra four
are that cascade.

- **1 — untyped roots.** Total −100. A handful of values TS could not infer,
  each breaking every read below it. Two lineup pages went 39 → 0 apiece off
  one annotation each.
- **3 — the `Element` cluster.** 118 errors of that class. `querySelector`
  returns `Element`; typed at the query site, not per use. Surfaced two real
  defects.
- **5 — structural.** 22 errors (`ts5097` 14, `ts2440` 8). `.tsx` extension
  imports and `.astro` import-name collisions. Phases 3 and 5 shipped together:
  total −144.
- **4 — stale option shapes.** 40 errors of `ts(2353)`; total −37 for the PR,
  which also added the class floors. The only phase that found a correctness
  gap: the franchise-name redaction suite could not represent a `nameMedium`,
  so that sweep had no test behind it.
- **Class floors.** The ratchet asserted only on the total, so a regression in
  a cleared class could hide behind an improvement elsewhere and be reported as
  progress. Five classes are now pinned at zero independently.

**Insight — the errors are not independent, and that is the whole method.**
They cascade from a small number of untyped roots — a `new Map()` whose entries
TS cannot infer, or a `let x = {}`. Every downstream property read on that value
then fails separately and is counted separately.

Note which half does the damage: `JSON.parse` returns `any`, and reads on `any`
do not error at all. The root in `rosters.astro` was `let modalData = {}` — the
DECLARATION pins the type to the empty object, and assigning a `JSON.parse`
result to it afterwards does not widen it. Fix the declaration, not the parse.
A five-line probe was applied and the checker re-run: **96 errors removed.** Do
not estimate this ratio — measure it. Apply a candidate root fix, re-run, read
the delta. Nobody would have guessed 5:96.

**Recommendation — the two remaining phases should NOT be run as sweeps:**

- **`rosters.astro` (1042, 54%).** It is ~12k lines, OOMs the checker at the
  default heap, and has a documented TDZ crash
  (`features/august-roster-cuts.md`). Half its errors are implicit-`any`.
  Typing it does not make it maintainable — **splitting it does, and a split
  subsumes the type work entirely.** If the split is not on the roadmap,
  leaving it is now defensible: the gate stops it growing. If you do touch it,
  fix at query sites and never convert a hoisted `function` to an arrow.
- **Implicit-`any` (845, 44%).** Lowest value per hour in the repo, zero safety
  gain. Let it come out incidentally: a PR that touches a file annotates that
  file's callbacks, and `pnpm test:types` then FAILS on the improvement and
  names the new number. The baseline never lowers itself — that failure is the
  prompt to retighten it, in the same commit.

**The reframe that makes both of those safe:** before the gate existed, the
number mattered because it could grow unchecked; nothing consumed a type error,
which is how 2216 accumulated. Now it can only fall. Driving 1913 toward zero
is optional cleanup. The remaining *defects* were the point, and phases 3 and 4
found them.

**Guardrails, if you do pick this up:**

- Step the baseline down in the same commit — the ratchet fails on improvement
  by design, so leaving it is a broken build for the next person.
- `any` is not a fix. It removes the error and adds no safety, and it quietly
  games the gate. Where the shape is knowable, declare it; the audit's own
  probe used `any` only as a *measurement* and was reverted.
- Trace a type to its producer before inventing one. `rosters.astro`'s modal
  locals took `PlayerModalData` from `player-modal-trigger.ts`, not a new type.
- Expect phase-4-shaped work to surface failing tests. That is the yield, not a
  setback.

**Evidence:** `tests/typecheck-baseline.typecheck.ts` (both assertions),
`tests/fixtures/typecheck-baseline.json` (total + `clearedClasses`), the
`Type baseline` job in `.github/workflows/ci.yml`, and PRs #599, #603, #606.
