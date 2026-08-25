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

**Lineage of the number.** `main` at `130824d` was 2318 on its own. PR #599
removed 124; phases 1/3/5 (#603) removed 244; phase 4 + class floors (#606)
removed 37. Main gained ~102 from PRs #600/#601 mid-flight — when the ratchet
fires after a rebase, check whether the rise is yours before re-baselining.

**Phases done, and what each was actually worth:**

- **1 — untyped roots (−100).** A handful of values TS could not infer, each
  breaking every read below it. Two lineup pages went 39 → 0 apiece off one
  annotation each.
- **3 — the `Element` cluster (−118).** `querySelector` returns `Element`;
  typed at the query site, not per use. Surfaced two real defects.
- **5 — structural (−22).** `.tsx` extension imports and `.astro` import-name
  collisions.
- **4 — stale option shapes, `ts(2353)` (−37).** The only phase that found a
  correctness gap: the franchise-name redaction suite could not represent a
  `nameMedium`, so that sweep had no test behind it.
- **Class floors.** The ratchet asserted only on the total, so a regression in
  a cleared class could hide behind an improvement elsewhere and be reported as
  progress. Five classes are now pinned at zero independently.

**Insight — the errors are not independent, and that is the whole method.**
They cascade from a small number of untyped roots: a `new Map()` whose entries
TS cannot infer, a `let x = {}`, a `JSON.parse` with nowhere to put a shape.
Every downstream property read then fails separately and is counted separately.
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
  gain. Let the ratchet absorb it — each PR that touches a file annotates that
  file's callbacks and the baseline steps down on its own.

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
