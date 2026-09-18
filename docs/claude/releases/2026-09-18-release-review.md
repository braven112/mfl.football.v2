# Release review — 2026-09-18

**Verdict: GO**

**Range:** `3a6fc0b266..7f35c78fe3` — 15 commits, 114 files, +38,821/−4,254
**Reviewed at:** 2026-09-17 23:40 PT · **Promoted:** 2026-09-17 23:47 PT
**Promoted as:** `main` `3a6fc0b266` → `5dc25ad359` (clean fast-forward).
The blackout was OVERRIDDEN and the release tag did NOT push — see
*Promotion outcome* at the end, which is the authoritative record of what
actually shipped and what is still outstanding.

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

## Promotion outcome — promoted 2026-09-17 23:47 PT

Promoted the same night the review was written, not on the Friday this
document originally projected. What actually happened, including the two gates
that were not satisfied the normal way:

**Blackout (step 3) — OVERRIDDEN, explicitly, by Brandon.**
`scripts/release-blackout.mjs` exited 1: Thursday 2026-09-17 is an NFL week
start. The override was a deliberate call on the grounds that the blackout
guards AUTOMATED promotions and this one was being run by hand. Recorded here
because the skill requires the override be the user's, said out loud, and
reviewable afterwards.

Worth keeping for next time: the promotion ran at 23:47 PT, **13 minutes**
before the blackout would have cleared on its own. Waiting would have cost
nothing and needed no override.

Also correcting this document's own earlier line: Friday 2026-09-18 is clear
(exit 0), but **Saturday is NOT** — `Sat/Sun/Mon` are all game days in season.
The window was Friday or the following Tuesday, not "Friday or Saturday".

**Chromatic (step 5b) — NOT captured on `staging`.**
The session could not dispatch it (`403 Resource not accessible by
integration`), and Brandon took the capture manually. The promotion push
therefore fired Chromatic run 465 on `main`, which takes the
`--auto-accept-changes` branch of `chromatic.yml:552`. Anyone auditing this
week's visual baseline should know it may have been accepted without a human
diff review.

**Step 6 — clean fast-forward.** `main` `3a6fc0b266` → `5dc25ad359`, verified
`HEAD == origin/staging` exactly, no merge commit. 16 commits, 117 files,
+39,067/−4,254.

**The tag — FAILED, and this blocks step 8.**
`git push origin refs/tags/v2026.09.18` returned **HTTP 403** on five attempts
with backoff. Branch pushes from the same credentials succeed (`main` landed
two minutes earlier), so this is a tag-specific permission limit, not a network
fault. There is no MCP fallback — the GitHub tools expose only read operations
for tags and releases.

Consequence: `weekly-changelog-rollup.yml` fires on `push: tags: ['v*']`, so
**no What's New article and no `site-update` notification went out** with this
release. The 79 staged changes remain queued and valid — one `featured` entry
per league, zero untagged. The tag must be pushed by hand:

```bash
git tag -a v2026.09.18 5dc25ad359 -m "Release 2026-09-18"
git push origin v2026.09.18
```

One timing note: if the Monday 8pm PT cron fires first,
`scripts/changelog-rollup-gate.mjs` should make it yield while a release is
pending; if it does not, it burns `weekly-rollup-2026-09-21` on whatever is
queued and this release's entries roll to the following Monday.

**Step 7 — production verified up, on the new build.**

| Check | Result |
|---|---|
| `theleague.us` → `www.theleague.us` | 200, 290 KB, "Home" |
| `afl-fantasy.com` → `www.afl-fantasy.com` | 200, 293 KB, "AFL — American Football League" |
| `/top-players` (TheLeague) | 200, 553 KB, "Top Players · 2026" |
| `/top-players` (AFL) | 200, 579 KB, "Top Players · 2026" |
| `/front-office`, both leagues | 200 |
| `/no-such-page-xyz` | 404 |

`/top-players` is the load-bearing check: that route did not exist before this
release, so a 200 with rendered content proves the NEW build is serving rather
than the old one still answering. The 404 on a bogus path rules out the
`error-pages.md` failure mode where a missing `/500` route makes every SSR
crash render as the styled 404.

Two method notes for whoever runs step 7 next: both apexes 307 to `www`, so the
check needs `curl -L`; and `mfl.football` answers **406** to a non-browser
user-agent, which is UA filtering, not an outage — pass a browser UA.
