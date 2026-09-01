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
| 3 — Extract pure client logic | **done** | 3 modules, 71 unit tests, −93 type errors |
| 4 — Adopt canonical roster-constants | **done** | −7 type errors, fixed a UFA logo 404 |
| 5 — Extract the autocut client module | **not started** | see the note under that phase |
| 6 — Extract the rest of the client script | not started | |
| 7 — Extract the server frontmatter | not started | |
| 8 — Extract the styles | not started | |
| 9 — Share the roster core across leagues | not started | |

**Net so far, all verified render-identical across 64 (season, team) pairs:**

| | Before | After | |
|---|---:|---:|---|
| `#roster-config` | 10.37 MB | 1.17 MB | **−88.7%** |
| Page HTML | 14.08 MB | 4.88 MB | −65.4% |
| Gzipped (what travels) | 1.25 MB | 0.45 MB | −63.7% |
| `astro check` errors | 1913 | 1813 | −100 |
| Roster unit tests | 0 | 76 | |

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

## Phase 3 — Extract the pure client logic *(done)*

Three modules under `src/scripts/rosters/`, 71 unit tests:

| Module | What moved |
|---|---|
| `roster-cap-math.ts` | cap charges, bucket/position caps, efficiency, contract-year totals |
| `roster-rows.ts` | position ranking, sorting, divider/stripe flags |
| `roster-age.ts` | age, averages by position, distribution buckets |

Everything they closed over — the cap-inclusion table, pending contract actions,
both declaration maps, the position order, "today" — is an explicit parameter
now. That is most of the value: these produce every number in the cap footer and
the bucket subtotals, and none of them could be exercised without a browser.

`roster-rows.ts` is shared by the frontmatter AND the client script, which had
duplicate copies that **had drifted**:

- `annotatePositionDividers`: the server drew a rule above row 0 and did not
  treat the last row as ending its group; the client did the opposite on both,
  so SSR first paint and the hydrated re-render disagreed.
- `sortByPosition`: the server ran salaries through `parseNumber`, the client
  did not.

Both differences are now options each call site passes, so extracting changed
nothing — but the divergence is visible in a signature instead of buried in a
second function body. **Deciding which variant is correct is still open work.**

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
