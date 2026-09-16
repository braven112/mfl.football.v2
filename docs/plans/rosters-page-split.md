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

## Status (2026-08-27)

| Phase | | Result |
|---|---|---|
| 0 — Parity harness | **done** | 64 renders in ~23s, 29k values + 3,879 image srcs |
| 1 — Delete duplicated payload | **done** | 10.37 MB → 8.26 MB |
| 2 — On-demand historical seasons | **done** | 8.26 MB → 1.17 MB |
| 3 — Onto the canonical shared modules | **done** | no new modules; age-utils/roster-utils/salary-calculations extended, 72 tests |
| 4 — Adopt canonical roster-constants | **done** | −7 type errors, fixed a UFA logo 404 |
| 5 — Extract the autocut client module | **not started** | see the note under that phase |
| 6 — Extract the rest of the client script | not started | |
| 7 — Extract the server frontmatter | not started | |
| 8 — Extract the styles | not started | |
| 9 — Share the roster core across leagues | not started | |

**Net so far, all verified render-identical across 64 (season, team) pairs:**

| | Before | After | |
|---|---:|---:|---|
| `#roster-config` | 10.29 MB | 1.12 MB | **−89.1%** |
| Page HTML | 14.52 MB | 4.89 MB | −66% |
| Gzipped (what travels) | 1.09 MB | 0.38 MB | −65% |
| `astro check` errors | 1912 | 1809 | **−103** |
| Roster unit tests | 0 | 77 | |

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

64 renders in ~23s; 29,472 captured leaf values (88% non-empty) plus 3,879
image srcs.

One trap, learned by hitting it: the harness must serve a **decodable**
placeholder for blocked external images. Headshots carry an inline onerror
cascade (ESPN NFL → ESPN college → MFL photo → placeholder) that reassigns
`this.src`, so an empty 200 fires that chain and makes the captured src a race
against how far it walked — which reported 291 phantom diffs between two
identical builds.

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

## Phase 2 — Load historical seasons on demand *(done)*

**8,379 KB → ~600 KB initial.**

**Correction, found in review:** this phase was designed around "season
switching must feel instant", and **there is no season picker.**
`rosterSeasonSelect` is a hidden input with no visible control bound to it and
nothing dispatching `change` on it, `seasonOptions` is never rendered, and so
`currentSeason` never leaves `defaultSeason` for a real visitor. The 19
historical seasons in the payload were not merely unused at first paint — they
were **unreachable**. That makes the cut more clearly correct than the original
rationale claimed, and it makes one part of the original design actively wrong:
an idle prefetch warmed all 18 frozen seasons after first paint, pulling back
7.09 MB to populate a cache nothing could read. The prefetch is gone.

What the phase actually is, stated honestly:

- The initial payload carries **only the live (non-frozen) seasons** — all 16
  teams of each. Switching between the 16 current rosters, the only switch a
  visitor can actually perform, is untouched: same in-memory data, same
  synchronous render.
- Frozen seasons move behind `GET /api/roster-season/[league]/[year]`, served
  from the same `roster-season-payloads.json` the page read inline before. The
  route resolves the league through the registry and discovers payload files by
  glob, so adding a league is a data-only change.
- **Nothing is fetched proactively.** A season is pulled only when something
  asks for it, which today means the parity harness and, later, a season picker
  if one ships. If one does, warm from *its* interaction — hover or open — never
  unconditionally on load.
- The switch is async on a cache miss, so it carries a monotonic request token:
  only the newest selection may commit. Without it two in-flight switches can
  resolve out of order and the slower one wins.

So the on-demand layer is groundwork, not a live feature. The user-visible value
of this phase is entirely the payload cut — and the harness pins that nothing
else moved.

## Phase 3 — Move the pure client logic onto the canonical modules *(done)*

**Correction, found in review:** this phase originally created three NEW
modules under `src/scripts/rosters/`. Every function in them already existed as
a shared, exported, typed module:

| What was written | What already existed |
|---|---|
| `roster-age.ts` | `src/utils/age-utils.ts` — all 5 functions, **line-identical** |
| `roster-rows.ts` | `src/utils/roster-utils.ts` — all 5, and it holds the *server* divider variant |
| `roster-cap-math.ts` | `src/utils/salary-calculations.ts` — `getCapPercent` and `calculateContractYearsMeta` identical |

That is net-neutral on duplication — it took the copies out of the page and put
them in a new module — but the point of the phase is reuse, and a second
implementation is the opposite of that. It is also the same mistake Phase 4
catches for `roster-constants`. The three new modules are gone; the page now
imports the canonical ones.

`age-utils.ts` and `roster-utils.ts` turned out to have **zero importers** —
written and never wired up — which is why the duplication was invisible from the
page. They have a consumer now.

What each canonical module gained, all strictly additive so existing callers are
untouched (`salary-calculations` has 15):

- **`age-utils`** — an optional `now: Date` last argument on the four
  date-dependent functions. Without that seam none of it is testable, which is
  why it never was. Also drops two dead locals in `getAgeDistribution`.
- **`roster-utils`** — `order` / `readSalary` options on `sortByPosition`, and
  `dividerOnFirstRow` / `dividerEndOnLastRow` on `annotatePositionDividers`.
  Defaults reproduce the module's existing (server) behavior exactly.
- **`salary-calculations`** — an optional injected cap-inclusion table on
  `getCapPercent`; `normalizeBucket`; `calculateCapChargesWithActions` (the
  read-only `calculateCapCharges` with the page's *pending* state layered on:
  cuts, declarations, extension breakdowns, franchise tags); and
  `calculateBucketCaps` / `calculatePositionCaps` / `calculateCapEfficiency`,
  which were genuinely new.

**The divergence this surfaced is still open work.** The server and client
copies of `annotatePositionDividers` disagree on two flags — whether row 0 gets
a leading rule, and whether the last row ends its group — so SSR first paint and
the hydrated re-render draw different dividers. Both are preserved as options
and each call site passes what it did before, so nothing moved. Deciding which
is correct is a visual judgement someone should actually make.

72 unit tests now cover these, against the canonical modules.

## Phase 4 — Adopt the canonical `roster-constants` helpers *(done)*

`rosters.astro` already imported from `src/constants/roster-constants.ts` and
then redefined most of what it exports — `DEFAULT_HEADSHOT_URL` three separate
times in the one file. All verified byte-identical, then deleted in favor of the
canonical exports.

Two were not merely duplicated but worse:

- the local `getPlayerImageUrl` pinned photos to the league's own `mflHost`;
  `roster-constants` pins them to one verified photo host on purpose and
  documents why. Same value for TheLeague, so nothing moved — but the local copy
  was the exact mistake that comment warns against.
- the local `getNflLogoUrl` only caught codes *starting with* `FA`, so `UFA`
  produced `/assets/nfl-logos/UFA.svg` and 404'd. The canonical one normalizes
  the code first.

**Still open:** the same `player_photos_big_2014` pattern is duplicated across
7 other files (`players.astro`, `rookies-2026.astro`, `showcase.astro`,
`contracts/manage.astro`, `projected-free-agents.astro`,
`afl-fantasy/players.astro`, and `roster-constants` itself). They can all adopt
these exports; none were touched here because only the rosters page is covered
by the harness.

## Phase 5 — Extract the autocut / Cutdown Plan module *(next, but not overnight)*

~1,300 lines, behind a dynamic `import()` gated on `config.autocut`, so it stops
being parsed by the ~360 days a year and the every-visitor-who-isn't-an-owner
for whom it is inert.

**This is unblocked and it is the right next phase**, but it was deliberately
left for a session someone is watching. `august-roster-cuts.md` deferred it
"until after the August 2026 deadline passes, not before" — that deadline was
**Aug 16, 2026**, so the calendar gate is satisfied. The reason to still not do
it unattended is the other half of that note: *"the extraction risks
destabilizing it."*

Concretely, the risk is that the cut window being closed is exactly what makes
this code unverifiable right now. The parity harness cannot cover it — the panel
only renders for a logged-in owner, on their own team, inside an open cut window
— so an extraction tonight would be 1,300 lines of stateful code (save races,
encrypted credentials, real MFL writes) moved with no way to prove it still
works until June 2027. That is the wrong trade.

When picking it up: those lines reference ~50 closure variables from
`initRosterPage`. Thread them through one explicit context object rather than
per-symbol arguments, and exercise it with a forced-open cut window (a
`?testDate=` inside the June→August range) before trusting it.

## Phase 6 — Extract the rest of the client script

1. **Contract Declaration Modal** (~3,000 lines) — the wizard, step by step.
2. **Demo/tutorial** (~400 lines) — behind a dynamic import too.

### Phase 6a — the CDM parity harness *(done, 2026-09-14)*

Phase 0 says it is "the only thing that makes the rest of the plan safe," and
it **does not cover the CDM** — grep `roster-parity-check.mjs` for `cdm`, there
are no hits. It fingerprints the roster table; the modal is behind owner auth,
an eligibility check and a click. So the wizard had no safety net at all, and
extracting it would have repeated the trade Phase 5 was deferred to avoid.

`scripts/cdm-parity-check.mjs` is that net. Measured, not estimated:

| | |
|---|---:|
| Eligible players on the owner's roster | 25 |
| Modals opened | 25/25 |
| Flow screens walked | 51 |
| Captured values | 4,409 |
| Diffs across two unchanged runs | **0** |

```bash
JWT_SECRET=x pnpm dev --port 4399 &
node scripts/cdm-parity-check.mjs --secret x --out before.json
# ...extract...
node scripts/cdm-parity-check.mjs --secret x --out after.json
node scripts/cdm-parity-check.mjs --compare before.json after.json
```

It captures what the modal RENDERS per player and per flow — identity band,
stepper, contract metrics, deadline, action options, year options, and the
tag / cut / extension panels with their real cap math (`$2.50M` dead money,
`50% dead money + 25% spread to next season`) — plus the submit button's label
and disabled state.

**It never writes.** The modal's submit is a real MFL write, so: submit is
never clicked; the flows that write on the first tap are never entered (Watch
is one-tap by design, IR and Trade write or navigate away); and every write
endpoint is aborted at the network layer regardless. `tests/cdm-parity-harness.test.ts`
pins all three, because "the harness doesn't write" is exactly the kind of
property that decays silently.

**What it does not cover, and what that means for the extraction:**

- **Submit itself.** Everything up to the write is pinned; the write is not.
  Post-extraction, one flow should be submitted by hand against a throwaway
  declaration before trusting it.
- **The autocut entanglement.** The CDM's "Mark for August auto-cut" toggle
  shares its save plumbing with the Cutdown Plan panel (`// ---- Save plumbing
  (shared by CDM toggle + panel Save)`, and `// ---- CDM action-option toggle`
  sits *inside* the autocut section). That seam is Phase 5 territory, which is
  deferred as unverifiable until the June 2027 cut window. Cut the CDM out
  *around* it — leave the autocut hooks as injected callbacks — rather than
  dragging Phase 5 along.
- **Closure surface.** The region (lines ~8029–9369) pulls ~30–40 symbols from
  `initRosterPage`, including two that mutate page state (`updateView`,
  `applyContractAction`). Same advice as Phase 5: one explicit context object,
  not per-symbol arguments.

### Phase 6.1 — the CDM, slice by slice

**Corrected scope, measured 2026-09-14:** the wizard is not one ~3,000-line
block. It is **~2,100 lines in three non-contiguous regions**, and the autocut
section sits *between* two of them:

| Region | Lines | What |
|---|---|---|
| A | 8029–9369 | open/close, year buttons, action options, trade sub-options, roster-move step |
| — | 9370–10868 | **autocut — Phase 5, does not move** |
| B | 10869–~11620 | the `goTo*` step functions, `executeCutPlayer`, the submit handler |
| C | 6538 | `extractPlayerDataFromRow` |

`getPlayerEligibility` (5477) and `applyContractAction` (5832) are already
outside `initRosterPage`. The autocut coupling is real and narrow: the CDM's
"Mark for August auto-cut" toggle shares save plumbing with the Cutdown Plan
panel, and `// ---- CDM action-option toggle` is *inside* the autocut section.
Cut around it; leave those as injected callbacks.

**Slice 1 — presentation primitives *(done)*.** `src/utils/cdm-ui.ts`:
`createActionOption`, `createYearButton`, `formatDraftLine`, `cdmAge`.

The seam is what a control LOOKS like versus what happens when you click it.
The shape moves; the handler stays with the state it mutates. So
`createYearButton` returns an unbound button and the ~40-line handler that
sets `cdmSelectedYears` and drives the stepper stays in the page until that
state moves with it.

What it found on the way, both the same class Phases 3 and 4 kept hitting:

- **Three byte-identical copies** of the year-button builder (8383, 8571,
  10929), one per flow. Now one.
- **A third copy of `age-utils`' `calculateAge`.** The CDM's version added two
  real guards the canonical one lacks — an unparseable birthdate and a future
  birthdate must both read as "no age" so the pill hides rather than rendering
  `NaN yrs` or `-1 yrs`. The module keeps the guards and delegates the
  arithmetic, rather than adding options to a function with 15 callers.

Verified: `cdm-parity-check` **0 diffs across 4,409 values**, roster harness
clean across 12 renders, `astro check` **1699 → 1693**. That −6 is the
mechanism this plan predicted — an exported function needs a signature.

Only the pure functions are unit-tested (`tests/cdm-ui.test.ts`). The suite
runs `environment: 'node'` with no DOM library, and the two DOM builders
already have better coverage than jsdom would give them: the parity harness
fingerprints what they render in a real browser, across every eligible player
and flow.

**Slice 2 — one state object *(done)*.** The blocker for moving any wizard
function was never the function; it was the **eight `let`s** it reads and
writes — `cdmPlayerData`, `cdmCurrentStep`, `cdmFlowType`, `cdmSelectedYears`,
`cdmSelectedSalary`, `cdmViaActionSelect`, `cdmSubmitType`, `cutConfirmed`.
A module cannot close over a `let` in the page. 165 references across three
regions, all inside `rosters.astro`, now read `cdmState.*`.

It retires a live hazard on the way: `cutConfirmed` was declared **~545 lines
below** `goToActionSelectStep`, which resets it. Legal, because a `let` in the
same function scope is initialized before any of those run — and the same
shape as the temporal-dead-zone read that took the whole page down in July
2026. The plan already claims extraction kills this bug class; this is one.

**Annotate the object, do not let it infer.** The first version measured
**+20** on the type ratchet. A bare `null` initializer on an object PROPERTY
infers the type `null` and does not widen, so every later
`cdmState.selectedYears = 2` is an error — where the eight `let`s it replaced
widened to `any` and hid it. Declaring the eight property types turned that
+20 into **−48** (1693 → 1645).

**The near-miss worth knowing about.** A `sed` over those 165 references also
rewrote the new object's own key, leaving `cdmState.cutConfirmed: false,`
inside the literal. The symptom: `/theleague/rosters` served the **404 page** —
no error in the dev server log, no overlay, no failing test. A whole page
silently stopped existing.

And **the check this doc recommends does not catch it.** Running the file
through `@astrojs/compiler` then esbuild reports OK, because a `<script>`
carrying any attribute is treated as `is:inline` and the compiler emits its
body as TEXT — esbuild is handed a module with the broken code inside a string
literal. That is why `tests/inline-script-syntax.test.ts` now pulls every
inline script body out of every `.astro` file and parses it on its own: 385
files, ~300ms, and it fails on exactly this. Use it, not the transform, when
editing an inline script.

**Slice 3 — the `goTo*` step transitions *(done)*.** `src/utils/cdm-steps.ts`
now owns all seven — `goToActionSelectStep`, `goToDeclareContractStep`,
`goToFranchiseTagStep2`, `goToTeamOptionStep2`, `goToRookieExtReview`,
`goToVetExtYearStep`, `goToCutStep2` — ~550 lines that sat on the far side of
the autocut section from the rest of the modal. 548 lines left the page for a
41-line factory call.

It exports `createCdmSteps(ctx)` rather than free functions, because these are
not pure: they read and write `cdmState`, drive DOM handles the page owns, and
call back into the parts of the modal that have not moved. The twenty-one
things they actually depend on are now a declared `CdmStepsContext` instead of
an implicit reach into a 12,000-line closure. Two entries are shaped
deliberately:

- **`setSelectedPlayer` is a setter, not a value.** The cut flow's "Simulate
  Cut" option *assigns* the page's `selectedPlayer`, and an assignment cannot
  cross a module boundary as a plain reference.
- **`executeCutPlayer` goes through `ctx`, not the destructure.** It is
  declared *below* the factory call in the page, so destructuring it when the
  factory runs would capture `undefined`. Called through `ctx` at click time it
  resolves exactly as the page's own forward reference did.

**The ratchet caught a real thing, and it was not the total.** The first
measurement failed the *clearedClasses* guard, not the count:
`nullSafetyOutsideRosters` came back from 0 to **34**, every one in the new
module. They are not new bugs — the page's inline script is not strictly
checked, so 31 `document.getElementById('cdm-x').style` dereferences had been
unguarded since the wizard was written and only became *visible* once they
lived in a `.ts`. Fixed at the guard: a `cdmNode(id)` helper narrows the type
**without** adding `?.`, on purpose — every one of those ids is static markup
in `ContractDeclarationModal.astro`, and turning a missing node into a silent
no-op trades a loud `TypeError` for a half-painted wizard screen, which is
strictly worse to debug. Where the original *did* guard (the stepper dots, the
type badge, the review panel) the `if (…)` is still there. The module
typechecks clean under full `--strict`; the page dropped **1645 → 1564**.

**What was deliberately NOT done.** The "Step 2 of 2" stepper block — six
`getElementById` calls and the same eight class toggles — is repeated almost
verbatim in five of the seven, and `goToCutStep2`'s copy *differs*: it never
hides dot 3 or line 2. Unifying that is a **behavior** question, not a move, so
it is not in the same commit. It is now a 550-line module where it can be
cleaned up against unit tests instead of a page where it cannot.

**Harness gotcha found here:** `roster-parity-check.mjs` picks "first 4 teams +
owner team" by default, and *which* teams that is drifted between two runs
minutes apart (0012 → 0009), producing six phantom "present only in" diffs.
Pin the set with `--teams` when comparing across a change, or the comparison is
not apples-to-apples.

**Slice 4 — the rest of the modal *(done)*.** `openDeclarationModal`,
`closeDeclarationModal`, `updateProjectionTable`, `updateCapImpact`,
`buildVetExtYearButtons`, `makeCdmActionBtn` and `populateCdmActionOptions` —
741 more lines — moved into the **same factory** as the step transitions, which
is why `cdm-steps.ts` is now **`src/utils/cdm-wizard.ts`**.

Merging rather than adding a second module is the point. A separate
`cdm-panel.ts` would have had to be wired *mutually* with the steps module
(`populateCdmActionOptions` calls `goToDeclareContractStep`;
`goToActionSelectStep` calls `populateCdmActionOptions`), threaded through the
page in both directions. In one factory they are ordinary sibling closures, and
**six entries left the context object** instead of joining it. `let
cdmDeadlineInterval` came along too — every read and write of it was inside the
region, so it is now module-local rather than a page `let`.

Four things worth knowing:

- **`capLimit` and `salaryYears` were real name errors waiting to happen.**
  Both are destructured off `config` a thousand lines up in the page, and the
  modal read them as free variables. In a module they simply do not resolve, so
  they now cross explicitly.
- **Two page `let`s cross as getters**, not values: `currentTeam` (the team
  switcher reassigns it) and `lastViewContext` (a re-render does). Captured once
  at wiring time, the cap-impact table would price against whichever team was
  open when the page booted.
- **The autocut seam held.** `isAutocutOwnView`, `getMarkedOnRoster`,
  `computeAutocutSlate` and `toggleAutocutMark` are injected callbacks, so
  Phase 5's 1,300 unverifiable lines stayed where they are.
- **`cdmAge` shadowed itself.** The age-pill block declared `const cdmAge =
  cdmCalcAge(data.birthdate)` — fine in the page, where the import was named
  `cdmCalcAge`, and a TDZ self-reference the moment the module imports the real
  name. It is `playerAgeYears` now. Worth remembering for the remaining slice:
  a page-level *alias* can be hiding a collision that only appears on the way
  out.

Type baseline **1564 → 1480**; the module typechecks clean under full
`--strict`. `tests/franchise-band-brand.test.ts` needed following, not
weakening: it asserted `rosters.astro` itself contains the
`applyPlayerModalBand(… 'cdm-band')` call. It now pairs each opener with the
file that paints its band, and keeps the "no old avatar chip" half pointed at
the page.

**Slice 5 — the submit path *(done)*. Phase 6.1 is complete.**
`executeCutPlayer`, `submitDeclaration`, the submit dispatcher and the modal's
close bindings. The wizard is whole in `src/utils/cdm-wizard.ts`; the page
keeps only the openers that call into it.

**The Escape listener was the one judgement call.** It is `document`-level and
the page re-added it on every `initRosterPage`, which stacks one handler per
navigation under the ClientRouter — CLAUDE.md's lifecycle rule, and the shape
five pages shipped as a bug in one week. The effect here was benign (closing a
closed modal is a no-op), but moving a known-wrong shape into a module is not
a move, so it is now a module-scoped handle that each init removes and re-adds.
Two casts were added and both are annotated as checker-only:
`(err as Error).message` on a catch the page read untyped, and
`clearInterval(x ?? undefined)` where the page passed a bare `let`.

Type baseline **1480 → 1448**. Across the four slices: **1699 → 1448**.

### How the submit path was actually verified

This doc used to say "submit a throwaway declaration by hand". Don't — and as
of today you cannot anyway. `scripts/cdm-parity-check.mjs --probe` drives
submit with `/api/contracts/declare` and `/api/cut-player` **fulfilled from a
canned response inside the browser**, so the request is fingerprinted and
dropped rather than sent. Neither the dev server nor MFL sees a write. It runs
twice, against a success and against a rejection, so the handler's catch branch
is covered. Result for this slice: **102 submits driven, 11,040 captured
values, zero diffs.**

Three things to know before trusting that mode again:

- **Run it twice against identical code first.** The first version of the probe
  read `sent[0]` before the fetch had been issued, and produced 60 scattered,
  direction-less diffs on `probes.*.request` — which reads exactly like a
  regression and was not one. It polls for the request now, and the
  self-consistency run is the check that would have caught it.
- **`/api/contracts/declare` is NOT covered, and cannot be today.** The only
  openers that reach it are `.yrs-chip--eligible` / `.yrs-chip--pending`, and
  no player on the current roster is in a declarable state — the page renders
  25 inert `.yrs-chip`s and zero eligible ones. Everything reachable from the
  action sheet applies LOCALLY (`applyContractAction`) and issues no request at
  all, which the probe records as `request: null` and would flag if that ever
  changed. Add the chip openers to `DIRECT_OPENERS` the moment a declaration
  window is open, and re-run this comparison against the current module.
- **The handler's own timers fight the harness.** The cut success path runs
  `setTimeout(() => location.reload(), 1500)`, which is why captures wait for a
  visible outcome rather than a fixed delay and navigations retry once.

### What is left in `rosters.astro` from the modal

The openers (`extractPlayerDataFromRow` and the four click bindings),
`showTradeSubOptions`, `goToRosterMoveStep` and `toggleCdmWatch`. Those last
three are not modal internals — they are the roster's own write actions that
the action sheet happens to surface, and they belong with the autocut work in
Phase 5 rather than with the wizard.

The module boundary also **fixes a bug class**: the July 2026 whole-page crash
was a temporal-dead-zone read inside one giant function body. Imports hoist;
that failure mode cannot survive extraction.

Note the read/write split this produces. Everything in 2–4 is *write* machinery
that only functions on your own team (`isOwnerViewingTeam`), yet it is parsed and
run by every visitor browsing someone else's roster. Getting it behind dynamic
imports is most of goal 3's remaining win after Phase 2.

## Phase 7 — Extract the server frontmatter

2,057 lines → a thin page frontmatter plus modules under `src/utils/rosters/`:
season payload assembly, eligibility/declaration wiring, autocut config, draft
assets, live odds + weather, owner activity. Each is a pure function of its
inputs and gets unit tests — which is also how the type errors come out, since
an exported function needs a signature.

Low runtime risk: same functions, same inputs, same outputs, no closures moved.

## Phase 8 — Extract the styles

2,304 scoped lines → `src/styles/rosters/*.css`. Mechanical, but verify scoping
first: rows are injected via `innerHTML` after hydration and therefore never
carry Astro's scope hash, so some of this block is already effectively global
and some is genuinely scoped. The harness does not check pixels — pair this
phase with screenshots.

## Phase 9 — Share the roster core across leagues

Only after the phases above. TheLeague, the AFL, and best-ball each render a roster; today
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
