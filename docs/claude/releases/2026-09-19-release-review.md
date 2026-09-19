# Release review — 2026-09-19

**Verdict: GO**, conditional on the Chromatic capture below being dispatched on
`staging` and its diffs reviewed before the fast-forward. That is `/promote`
step 5b, and this range genuinely needs it — see *Visual diffs*.

**Range:** `072e7dac..1ee9a197` — 75 commits (26 non-merge), 90 files,
+12,028/−5,136
**Run at:** 2026-09-19 09:30 PT, on a Saturday promotion (see *Promotion timing*).

## Features on the train

One theme, one supporting PR:

| What |
|---|
| **Live scoring, unified onto one shared kit** — a canonical live model (`src/utils/live/`), thirteen `Lv*` leaf components, the board shell, the scoring-play ticker, the ESPN box-score line, the week picker and freshness pill, win-probability bars |
| The three league boards (TheLeague, AFL, Best Ball) and MFL Live re-pointed onto that kit; the old islands, the FLEX family and `live-scoring.css` deleted, with guards re-pointed rather than relaxed |
| #1170 — the MFL Live shell's nav behind one hamburger |
| #1171 — the shared app host installable; splash lists full-management leagues only, derived from the registry's `bestBall` flag |
| Colour correctness: team colours judged against the card they sit on, and a colour used as TEXT must clear WCAG rather than ΔE |

## Blocks promotion

**None.**

## Stored-shape compatibility

**Nothing in this range touches shared storage.** Checked explicitly, because
staging and production share one Upstash database while staging runs a week
ahead.

- A scan of the whole range for `kv` / `redis` / `Upstash` / `scopedKvKey` /
  `createKvFranchiseStore` / `hset` / `hget` / `lpush` / `sadd` / `setex`
  returned **zero** additions.
- The one new API route, `src/pages/api/league-board.ts` (96 lines), reads
  `getAuthUser` (session JWT only), is `prerender = false`, resolves its league
  through the registry (`getLeagueBySlug`, `leagueHasFeature`) and touches no
  store. Not LLM-backed, so the rate-limit rule does not apply.
- The registry change is purely additive: a new `liveScoringSample` feature
  flag, `true` for TheLeague and the AFL, `false` for Best Ball with its
  reasoning written in place. Gated through `leagueHasFeature`, which is the
  prescribed shape.

Current production can read everything this release writes, because it writes
nothing new.

## Build rehearsal

**Skipped, with cause.** The range touches exactly one file under
`scripts/` or `src/**/*.mjs`: `src/config/leagues-data.mjs`, and the whole of
its change is the additive `liveScoringSample` flag. `git grep` over
`scripts/` finds **zero** readers of that field — it is read only by
`LiveBoardPage.astro`, `leagues.ts`, the new API route and Best Ball's
live-scoring route, all render-time. No compute or fetch step branches on it,
so the pipeline cannot have changed its output.

Recorded honestly rather than claimed: a full `PREBUILD_FULL=1` run was not
executed. The 2026-09-18 rehearsal in this same sandbox degraded several
live-fetch generators with 404s, producing diffs that had to be reverted, and
there is no pipeline change here for it to exercise.

## Ratchets

Every one moved the right way or held.

| Baseline | Before | After | Why |
|---|---|---|---|
| `page-fork-baseline.json` | 21 | **20** | `live-scoring.astro` **left the list** — the fork was unified, not baselined. The three league routes are now 28/33/35-line thin wrappers over one shared component, with no `<script>` and no `client:` directive between them. |
| `typecheck-baseline.json` | 1425 | 1425 | Unchanged. No `ts(2307)` introduced. |
| `clientrouter-init-baseline.json` | 15 | 15 | Unchanged. |

The fork baseline shrinking is the headline. ~57,800 lines across 24 forked
siblings is the debt this ratchet tracks, and this release pays some of it down
instead of adding to it.

## Fix before promotion

- **Dispatch the Chromatic capture on `staging`.** See *Visual diffs*. This is
  the one item standing between this report and an unconditional GO, and it is
  a workflow dispatch, not a code change.

## Follow-up filed

None new from this pass. The range itself filed two, both already on the shelf:

- `docs/claude/followups/2026-09-19-full-management-league-derivation.md`
- `docs/claude/followups/2026-09-19-navdrawer-roving-tabindex-trap.md`

## Visual diffs — a real gap this week

Four files **inside the Chromatic story import closure** changed *after* the
last successful capture (PR run #490, `2fda2080`, 2026-09-19 00:46):

```
src/components/shared/live/LvMatchupCard.tsx
src/components/shared/live/LvMatchupDetail.tsx
src/styles/live.css
src/utils/live/model.ts
```

**Why they were never captured, and it is structural:** `chromatic.yml`'s PR
trigger is `pull_request: branches: [main]`, but `/live` opens its PRs into
**`staging`**. So the PR trigger never fires for the staging train. The `push`
trigger is `branches: [main]` and runs `--auto-accept-changes` — meaning these
four files' rendering changes would be blessed as the new baseline with nobody
looking. That is precisely the "visual test that certifies the bug" failure
`chromatic.yml`'s own header exists to prevent.

`gh workflow run chromatic.yml --ref staging` (the workflow does declare
`workflow_dispatch`) runs plain `chromatic`, leaving diffs **pending** for a
human to accept or reject. Attribution for the batch: everything visual in this
range belongs to the live-kit unification, so expect the `Lv*` stories and
`LiveKit` to move together.

This is worth recording as more than a one-week nuisance: **the staging train
has no visual gate at all** under the current triggers. Adding `staging` to
either trigger, or making `/promote` step 5b unconditional, is the durable fix.

## Checked, nothing found

- **Cross-feature duplication.** The prime candidate was the new
  `src/utils/live/nfl-logo-url.ts` against the existing `src/utils/nfl-logo.ts`.
  Read both: **not a duplicate.** The new helper *imports* `normalizeTeamCode`
  from the existing util and deliberately returns a LOCAL `/assets/nfl-logos/`
  path rather than `getNFLTeamLogo`'s ESPN CDN URL, because the dark-mode swap
  in `nfl-logo-dark-css.ts` is keyed on `src` — a CDN URL would be correct in
  light and invisible in dark — and because a cross-origin fetch at capture
  time has already failed a Chromatic build. The reasoning is in its docstring.
- **Reuse missed.** The eight new `src/utils/live/` modules are separated by
  role (model, read, projections, moments, surface, league-board,
  from-mfl-live, logo url) and the kit's components share one answer each
  rather than a copy per component.
- **Sibling drift.** Not applicable in the usual direction this week: the
  release REMOVES a fork rather than landing on one side of one. All three
  league live-scoring routes are thin wrappers over the same component, so the
  `data-league` init-gate hazard is gone outright — which CLAUDE.md names as the
  better fix when it is available.
- **Altitude.** This range is a consolidation, not an accretion: three live
  implementations collapse to one kit, and `LiveScoreboard.tsx`,
  `MflLiveBoard.tsx` and `live-scoring.css` are deleted rather than left beside
  their replacement.
- **CI.** Green on the exact promotion SHA `1ee9a197` (run #1808), not merely on
  the branch.

## Promotion timing

This is a **Saturday** promotion, which the blackout script blocked until today.
Brandon's call, made explicitly: the NFL plays no Saturday games for most of the
season, so the rule taxed ~13 clear Saturdays a year to protect the two or three
late-season slates. Saturday is now out of `ROUTINE_GAME_WEEKDAYS`
(`scripts/release-blackout.mjs`), with the uncovered gap — week-15-onward
Saturdays and the wild-card Saturday, neither of which is a week start —
documented in the code and pinned by its guard test.

Today is Week 2, so there are no NFL games regardless. The residual risk is not
the calendar: it is that a ground-up live-scoring rewrite lands the day before
Sunday's slate, which is the surface and the day it matters most. Watch
`/live-scoring` and `/broadcast` on both leagues tomorrow morning, and remember
the rollback path is promoting the previous Vercel deployment, not a revert.
