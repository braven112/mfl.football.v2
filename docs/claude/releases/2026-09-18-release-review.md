# Release review — 2026-09-18

**Verdict: GO**

**Range:** `3a6fc0b266..7f35c78fe3` — 15 commits, 114 files, +38,821/−4,254
**Run at:** 2026-09-17 23:40 PT (the promotion itself is blocked until the
Thursday-night NFL blackout clears — see *Promotion timing* below).

## Features on the train

| PR | What |
|---|---|
| #1143 | Top Players — full-pool weekly scoring; the Tuesday recap hero lands on it |
| #1144 | Announce a column only once it is live on the site |
| #1145 | TheLeague's waiver-day composite hero, via a league-neutral `LeagueCompositeHero` |
| #1149 | The homepage news card promotes the latest article, in both leagues |
| #1151 | Front Office hub — shared analytics, contract actions and cap planning, both leagues |
| #1162 | Live-scoring "yet to play" split per team with colour dots |
| #1163 | Say "to play" on the live-scoring card, like every other surface |

Also in range, from tonight's repair rather than a feature PR: `d7b0b61` (the
main→staging merge-down resolution), `3878727` (recomputed top-players
payloads) and `b92d127` (`/promote` skill directions).

## Blocks promotion

None.

## Stored-shape compatibility

**Nothing in this range touches shared storage.** Checked explicitly, because
staging and production share one Upstash database and staging runs a week
ahead:

- No new or changed API routes in range.
- No changed file imports any of the 11 storage modules except
  `src/pages/theleague/rosters.astro`, whose storage imports are untouched by
  the diff — its change is a pure extraction of inline helpers into
  `src/utils/contract-actions-client.ts`.
- `submitStagedActions` (new) posts through the existing `submitDeclaration`
  path to an unchanged endpoint.
- The one storage-shaped grep hit, `owners-poll-close-${year}-${week}`, is a
  `postId` for the NEW announce queue — which is FILE-backed
  (`.schefter-announce-queue.json`, `scripts/lib/announce-queue.mjs:27`),
  scoped to a single CI job run. Not Redis.

## Build rehearsal

`PREBUILD_FULL=1 pnpm prebuild` — **25 steps, no failures, 35s.**

Required, because the range touches nine files under `scripts/`. Result: **no
compute script in the range changes its output.** The whole derived chain
(`franchise-history`, `owner-tenures`, `season-ledger`,
`player-identity-union`, `schedule-strength`, `playoff-performance`) moved only
its `generatedAt` stamp — canonical-write behaving exactly as designed.

The larger diffs the run produced (`ranking-sources/2027.json`, the NFL and
college dark-logo manifests, `record-book.json`) come from live-fetch
generators OUTSIDE the range, and the logo manifests were partly degraded by
sandbox 404s. **All rehearsal output was reverted** rather than committed — a
partial derived-chain commit is the failure CLAUDE.md warns about.

## Fix before promotion

None. Every candidate either changes rendered output on promotion week or is a
guard gap, and both belong below.

## Follow-up filed

- **`docs/claude/followups/2026-09-18-front-office-money-formatting.md`** —
  #1151 landed four compact-money spellings, all reachable from one page, with
  disagreeing precision and sub-million tiers (`$1.50M` vs `$1.5M`;
  `$250,000` vs `$250K`), while `src/utils/formatters.ts:102` already exports
  `formatCompactNumber`. Separately, `ScenarioBar`'s client-side `short` is a
  deliberate byte-identical mirror of `CapProjectionTable`'s server-side
  `moneyShort` — documented in a comment, pinned by no test, and wrong the
  moment either drifts. Deferred because unifying changes rendering; the guard
  test is the safe half and can land alone.
- **`docs/claude/followups/2026-09-18-full-pool-weekly-scores-duplication.md`** —
  two independently built full-pool weekly-score feeds are now both live
  (`player-scores-weekly.json` for Top Players, `playerScores-by-week.json` for
  the player modal, rosters, players and projected-free-agents).
  `scripts/fetch-mfl-feeds.mjs` runs both per-week loops every sync. Each is
  pinned by a guard test that greps for its own `writeOut`, so neither could be
  dropped on merge day.

## Ratchets

| Baseline | Before | After | Why |
|---|---|---|---|
| `typecheck-baseline.json` | 1434 | 1425 | Re-measured on the merge-down per CLAUDE.md rule 6 — staging said 1429, main said 1434, neither was measured against the merged tree. −9 is staging's own queued work, which main had not seen. |
| `page-fork-baseline.json` | 21 | 21 | Unchanged. Notable: Top Players added a route in BOTH leagues without growing this, using the thin-wrapper + shared-component shape. |
| `clientrouter-init-baseline.json` | 15 | 15 | Unchanged. |

## Visual diffs (they land at the promotion)

The range touches the story import closure — `.github/workflows/chromatic.yml`,
`chromatic.config.json`, `scripts/chromatic-story-deps.mjs` — and adds four
stories: `LeagueCompositeHero.stories.ts`,
`LeagueCompositeHeroArticle.stories.ts` and two fixtures. Expect a batch, and
attribute it to **#1149 and #1145** (the `LeagueCompositeHero` extraction —
`ArticleHero.astro` lost 646 lines to it). `/promote` step 5b dispatches the
capture on `staging` so the diffs land *pending* for review rather than being
auto-accepted on main.

## Checked, nothing found

- **Sibling drift** — 61 twin rows; 4 "UNCHANGED", all cleared on reading.
  `afl-fantasy/index.astro` vs `theleague/index.astro`: both leagues have the
  news card, TheLeague resolves it inside `ArticleHero.astro:75`, the AFL in
  page frontmatter, both through the same shared `pickLatestArticle` and both
  bounded to the same 7 days. `theleague/rosters.astro` vs the AFL's: the AFL
  has `contracts: false`, so there is nothing to mirror.
- **Efficiency** — ZERO new `client:` directives across every new component in
  the range. Both Top Players routes are `prerender = false` with the heavy
  read done at build time in `scripts/compute-top-players.mjs`, which is the
  documented shape for an SSR page that would otherwise bundle the feeds into
  `_render`.
- **Reuse** — `rosters.astro` moved −117/+49 the RIGHT way this week, replacing
  inline contract helpers with imports from the new shared module.

## One thing this pass could not run

`scripts/gemini-ask.mjs` is unavailable in this environment (`spawnSync gemini
ENOENT` — neither installed CLI is present), so the step-2 duplication sweep
was done by targeted grep over the 11 new source files instead of by asking a
model to compare them against all 380 utils. That is a narrower net: it found
the money-formatting cluster, but a semantic duplicate under a different name
could have been missed.

## Promotion timing

`/promote` remains blocked at step 3 until the blackout clears —
`scripts/release-blackout.mjs` exits 1 for Thursday 2026-09-17, an NFL week
start. Friday or Saturday morning PT is clear of the routine Thu/Sat/Sun/Mon
game days. Confirm TheLeague's own draft date is not within a day; it lives in
the league-events registry and is the one blackout rule the script cannot check.
