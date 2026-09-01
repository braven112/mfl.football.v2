# Chromatic visual testing — cost and diagnosis

Operational rules live in `docs/claude/rules/storybook.md` (trigger model,
generated `paths:` / `externals`, TurboSnap). This file is the reasoning that
does not belong in a rules doc: how the cost bug hid for 117 builds, and the two
patterns worth reusing elsewhere.

## 2026-09-01 — the summary we built to avoid reading logs is what hid the answer

TurboSnap had never engaged. `.storybook/modes.ts`, `docs/claude/rules/storybook.md`
and the CI job summary all gave the same explanation — "Chromatic withholds it
until 10 builds have run from CI" — and all three were repeating one guess
written on day one and never re-checked. At build 117 it was still being printed
with full confidence.

Two hypotheses died before the real cause surfaced:

1. *The account tier withholds it.* Killed by the numbers: build #117, well past
   the 10-build warm-up, still `TurboSnap active: no`.
2. *`builder-vite` emits no stats file.* Plausible — TurboSnap needs
   `preview-stats.json` and the Vite path has historically needed a plugin.
   Killed by running it: `pnpm build:storybook:stats` writes the file with 119
   modules in the correct `{id, name, reasons}` shape.

The answer was in the Chromatic step log the whole time, four lines above the
summary everyone read instead:

```
⚠ TurboSnap disabled due to matching --externals
→ src/styles/accounting.css
→ src/styles/draft-broadcast.css
```

Our own `--externals "src/styles/**/*.css"` was switching it off, on almost
every build, over stylesheets that render into no story.

**The transferable part is the failure mode, not the flag.**
`scripts/chromatic-usage-summary.mjs` exists to put cost "where you already are"
so nobody has to open the raw log. It worked — and because it also carried a
hardcoded *explanation* for the `turboSnapEnabled: false` case, it replaced the
one line that would have solved this. A summary that reports a state is useful.
A summary that also asserts the *cause* of that state freezes a guess into
something that reads like a measurement. If a self-built reporter explains
*why*, the explanation needs the same re-verification as the code — or it should
point at the source log and say nothing more. That script now does the latter.

Corollary for any "feature X is not active" report: read the tool's own output
before theorizing. Two of us spent the diagnosis on the account and the builder
because the summary had already told us, authoritatively, where not to look.

## 2026-09-01 — a filter that must be tight AND complete, failing silently both ways

Chromatic has two path knobs that look alike and fail in opposite directions.
Getting one right by making it broad makes the other wrong.

| Knob | Too narrow | Too broad |
|---|---|---|
| workflow `paths:` | build never runs; regression ships and `--auto-accept-changes` on main **blesses it as the baseline** | wasted builds |
| `externals` | TurboSnap inherits a snapshot for a file it cannot trace; regression ships **green** | TurboSnap disabled entirely; every story at full price |

Neither failure is loud. Both produce a passing build. The instinct that keeps
you safe on one knob ("when unsure, include it") is what broke the other.

This is why both are generated from the real import graph
(`scripts/chromatic-story-deps.mjs`) rather than hand-maintained, and pinned by
`tests/chromatic-path-filter.test.ts` in both directions. When a constraint has
a silent failure on each side, a guard test is not optional bookkeeping — it is
the only thing that distinguishes "correct" from "passing".

One entry looks droppable and is not: `public/assets/fonts/**`. The story
stylesheets `@font-face` against it, so a re-subset font reflows every snapshot,
and no import links it into the graph. Found by grepping the CSS, not by
reasoning about it — the assets half of both lists is runtime URL strings and
cannot be derived.

## 2026-09-01 — build count, not diff size, was the actual bill

Over Aug 28-31: 60 builds x 160 snapshots ≈ 9,600 snapshots, about 2x the entire
5,000/month free plan in four days. 49 of the 60 were feature-branch pushes;
one branch spent 16 builds — half a month's plan — iterating on a single PR.

Worth holding onto when a per-unit cost looks like the problem: TurboSnap would
have cut cost *per build* ~5x, and it still would not have saved this month,
because the workflow fired on every push to every branch. Fix the trigger before
optimizing the unit. (Both were fixed here; the trigger was the larger lever by
far.)
