# Splitting the Roster Page

Plan of record for decomposing `src/pages/theleague/rosters.astro`.

**Goals, in the order they decide trade-offs:**

1. **Maintenance** — the file is the largest in the repo and the hardest to
   change safely.
2. **Reliability** — it carries 54% of the repo's type errors, has shipped a
   whole-page crash, and has almost no test coverage.
3. **Speed of checking another owner's roster** — the primary read-path use of
   the page, and the thing it is currently worst at.
4. **Reuse** — three leagues render a roster; today one page does it in
   12k lines and the others re-implement pieces.

`docs/claude/insights/features/type-error-remediation.md` is the companion doc:
it already concluded that typing this file is the wrong move and **"splitting it
is, and a split subsumes the type work entirely."** This is that split.

---

## Measured state (2026-08-27, dev server render, franchise 0001 authenticated)

Everything below is measured, not estimated. Re-measure before trusting it.

### The file

| Region | Lines | |
|---|---:|---|
| Frontmatter (SSR data assembly) | 2,057 | |
| Template markup | ~850 | |
| `<style>` (scoped) | 2,304 | |
| **One inline `<script>`** | **7,081** | `initRosterPage` alone is ~6,400 of them |
| Small trailing scripts | ~200 | |
| **Total** | **12,491** | 496 KB |

`astro check`: **1,042 errors — 54% of the repo's 1,913**, 493 of them
implicit-`any`. The file OOMs the checker at the default heap.

### What the page ships on one request

| | Size | |
|---|---:|---|
| **Total HTML** | **14.08 MB** | |
| `#roster-config` JSON | 10.37 MB | 74% of the page |
| ↳ `seasons` | 8,379 KB | **20 seasons × 16 teams = 320 team-seasons** |
| ↳ `adjustmentsBySeason` | 1,574 KB | byte-identical to `seasons[y].salaryAdjustments`, all 20 |
| ↳ `initialSeasonData` | 557 KB | byte-identical to `seasons[defaultSeason]` |
| ↳ `initialTeamData` | 35 KB | byte-identical to `seasons[ds].teams[dt]` |
| `#weekly-player-results` | 0.71 MB | |

**To look at one roster, the browser downloads 320.** That is the headline
finding, and it is the direct cause of goal 3 being unmet: team switching feels
instant *once the page is up*, because everything is already in memory — the
cost was all paid up front, before first paint.

**2.13 MB of the 10.37 MB is provable duplication** — not "similar", byte-identical,
verified across all 20 seasons.

### Dead code the parity harness surfaced

`renderSummary()` (63 lines, 8 arguments) and two `updateView()` assignments
write into elements that **do not exist** in the rendered HTML:
`summaryCap`, `summaryPlayers`, `summaryOpen`, `practiceCount`, `injuredCount`,
`rosterMetadata`, `rosterCountLabel`. Confirmed against the served page, not
just the source.

### Coverage

Two roster-named test files exist (`current-roster-sample`, `roster-move-parse`),
neither of which exercises the page. The page's actual output — produced by 7k
lines of imperative DOM mutation after hydration — had **no test at all**.

---

## Phase 0 — Parity harness *(prerequisite for every other phase)*

`scripts/roster-parity-check.mjs` drives a real browser against a real dev
server, walks a matrix of (season, team) selections, and fingerprints what the
user actually sees: every roster row's every cell, the cap/dead-money footers,
the bucket subtotals, year totals, cap space, team identity.

```bash
JWT_SECRET=x pnpm dev --port 4399 &
node scripts/roster-parity-check.mjs --all-teams --seasons 2026,2025,2013,2007 --out before.json
# ...refactor...
node scripts/roster-parity-check.mjs --all-teams --seasons 2026,2025,2013,2007 --out after.json
node scripts/roster-parity-check.mjs --compare before.json after.json
```

64 renders in ~23s; 29,472 captured leaf values, 88% non-empty.

It fingerprints **rendered output, never the config payload** — deliberately, so
it stays valid across changes to how data reaches the client. Those are exactly
the changes it has to police. It also reports payload size and fails on any new
page error.

This is the only thing that makes the rest of the plan safe. Run it before and
after every phase.

---

## Phase 1 — Delete the duplicated payload

**2.13 MB, zero behavior change, zero risk.**

`adjustmentsBySeason`, `initialSeasonData`, and `initialTeamData` are dropped
from the config; the client reads the surviving copy out of `seasons`. The
values are byte-identical, so no consumer can tell the difference — and the
harness proves it.

Do this first: it is free, and it shrinks the surface every later phase moves.

## Phase 2 — Load historical seasons on demand

**8,379 KB → ~600 KB initial.**

The page embeds 20 seasons because season switching must feel instant. It does
not have to be paid for at first paint.

- The initial payload carries **only the current season** — all 16 teams of it.
  Switching between the 16 current rosters, which is the common action and the
  one goal 3 names, stays exactly as instant as it is today: same in-memory data,
  same synchronous render.
- Historical seasons move behind `GET /api/theleague/roster-season/[year]`,
  served from the same `roster-season-payloads.json` the page reads now.
- After first paint, an idle-time prefetch warms the remaining seasons in the
  background. By the time anyone opens the season picker, they are cached — so
  historical switching stays instant too, in practice.
- The season switch gets a real loading state for the cold-cache case, because
  `updateView()` becomes async on that one path.

This is the one phase with a genuine behavioral difference (a cold historical
season switch can now show a spinner). Everything else about the page is
unchanged, and the harness pins that.

## Phase 3 — Extract the server frontmatter

2,057 lines → a thin page frontmatter plus modules under `src/utils/rosters/`:
season payload assembly, eligibility/declaration wiring, autocut config, draft
assets, live odds + weather, owner activity. Each is a pure function of its
inputs and gets unit tests — which is also how the type errors come out, since
an exported function needs a signature.

Low runtime risk: same functions, same inputs, same outputs, no closures moved.

## Phase 4 — Extract the client script

7,081 lines → modules under `src/scripts/rosters/`, in ascending order of risk:

1. **Pure logic** — cap math, sorting, age distribution, formatters. Unit-testable
   with no DOM at all.
2. **Autocut / Cutdown Plan** (~1,300 lines). Already scheduled:
   `august-roster-cuts.md` deferred this explicitly **"until after the August
   2026 deadline passes, not before."** That deadline was **Aug 16, 2026** — it
   has passed, so this is now unblocked. It loads behind a dynamic `import()`
   gated on `config.autocut`, so it stops shipping to the ~360 days a year and
   the every-visitor-who-isn't-an-owner for whom it is inert.
3. **Contract Declaration Modal** (~3,000 lines) — the wizard, step by step.
4. **Demo/tutorial** (~400 lines) — behind a dynamic import too.

The module boundary also **fixes a bug class**: the July 2026 whole-page crash
was a temporal-dead-zone read inside one giant function body. Imports hoist;
that failure mode cannot survive extraction.

Note the read/write split this produces. Everything in 2–4 is *write* machinery
that only functions on your own team (`isOwnerViewingTeam`), yet it is parsed and
run by every visitor browsing someone else's roster. Getting it behind dynamic
imports is most of goal 3's remaining win after Phase 2.

## Phase 5 — Extract the styles

2,304 scoped lines → `src/styles/rosters/*.css`. Mechanical, but verify scoping
first: rows are injected via `innerHTML` after hydration and therefore never
carry Astro's scope hash, so some of this block is already effectively global
and some is genuinely scoped. The harness does not check pixels — pair this
phase with screenshots.

## Phase 6 — Share the roster core across leagues

Only after 1–5. TheLeague, the AFL, and best-ball each render a roster; today
they share `PlayerCell`, `roster-constants`, and college logos, and re-implement
the rest. Once the table, cap math, and row rendering are modules rather than
closures, the AFL page can consume them — that is goal 4, and it is a
*consequence* of the split rather than a phase that can be done before it.

---

## Rules for anyone continuing this

- **Run the harness before and after. Every phase.** It is the only proof that
  "it still works", and it takes 23 seconds.
- **Do not mix a behavior change into an extraction commit.** Extractions must
  diff clean against the harness. If a diff appears, it is a bug, not an
  improvement — that property is what makes the whole plan reviewable.
- **`any` is not a fix** (carried over from the type-error doc). Extraction that
  annotates with `any` buys nothing.
- Step `tests/fixtures/typecheck-baseline.json` down in the same commit that
  lowers the count — the ratchet fails on improvement by design.
