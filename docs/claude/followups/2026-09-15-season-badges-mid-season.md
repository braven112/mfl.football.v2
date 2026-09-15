---
slug: season-badges-mid-season
status: open
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1090
hotfix_sha: 8fda2d2
followup_issue: 1091
followup_pr:
followup_session:
---

# Follow-up: Schefter posted season honors after one week

## What broke

One week into 2026, theleague.us's Schefter feed carried three "Season honor"
milestone posts: Music City Mafia "closed 2026 at the bottom of the standings"
(Cellar Dweller), and Running down the Dream took the top seed and the scoring
title (Top of the Standings, League Scoring Champ). All three were computed off
the week-1 standings table.

## What the hotfix did

Forward fix, PR #1090.

- `scripts/compute-franchise-history.mjs:1427` — `yearSummaries[]` now carries
  `seasonComplete`, the same `isSeasonComplete` result
  (`scripts/lib/theleague-season-complete.mjs`) that already gated division
  titles and playoff appearances.
- `scripts/badges.mjs` — `buildBadgeContext` builds `ctx.incompleteYears`
  (explicit `seasonComplete: false` only); the scoring-champ and
  highest-scoring-season aggregates skip those years; `computeBadgesFor` drops
  every `tier: 'season'` award whose year is incomplete. Single-game records are
  intentionally NOT gated.
- Guard: `tests/badges-season-complete.test.ts` (fails without the fix).
- The live posts were never committed — see F2 — so no feed edit was needed:
  the post-merge production build regenerated the feed without them.

## Deferred items

- [ ] **F1 — `vercel-ignore-build` CLI guard exits 0 when argv[1] is a symlinked path**
  - Source: deferred at implementation (surfaced by the local pre-push hook)
  - Where: `scripts/vercel-ignore-build.mjs:135`, `tests/vercel-ignore-build.test.ts:175`
  - What: `import.meta.url` is the REAL path, `pathToFileURL(process.argv[1])`
    is not resolved. On macOS `tmpdir()` is `/var/…` → `/private/var/…`, so the
    CLI block is skipped and the script exits 0 (= IGNORE). The test fails on
    every Mac and forces `SKIP_PRE_PUSH_TESTS=1`; it passes on Linux CI and with
    a non-symlinked `TMPDIR`. Fix: compare against
    `pathToFileURL(realpathSync(process.argv[1]))`.
  - Why deferred: unrelated to the hotfix and harmless on Vercel (Linux, no
    symlink), but it is the one fail-CLOSED path in a fail-open script.

- [ ] **F2 — Milestone posts are emitted at production BUILD time, never committed**
  - Source: diagnosis during the hotfix
  - Where: `scripts/prebuild.mjs:45` (`compute:franchise-history`, full builds
    only) → `scripts/compute-franchise-history.mjs:1538-1582` (Phase 5 writes
    `src/data/theleague/schefter-feed.json`)
  - What: every production deploy recomputes history against freshly fetched
    feeds and prepends any new milestone posts to the deployed feed with the
    BUILD's timestamp. That is why the posts read "20m ago", were live on the
    site, and existed in no commit — git and production silently disagree on
    feed contents, and a bad post can only be removed by redeploying. Decide
    whether Phase 5 should run only in the nightly workflow
    (`schefter-trade-speculation.yml`, which commits) and be skipped in prebuild.
  - Why deferred: architectural, touches the prebuild pipeline; the badge gate
    alone removes today's symptom.

- [ ] **F3 — Post-merge advisory reviewer findings**
  - Source: CodeQL / Gemini / Copilot, not waited on at merge
  - Where: PR #1090 comments
  - Why deferred: `/hotfix` merges on Claude's review plus green CI.

## Context to start cold

- Reproduce the original bug by reverting `scripts/badges.mjs` and running
  `node scripts/compute-franchise-history.mjs`: it logs "emitted 3 new milestone
  post(s)" (`sf_milestone_0006-cellar-dweller-y2026`,
  `0016-best-record-y2026`, `0016-top-scorer-y2026`). With the fix: "no new
  badges — milestone diff empty". Revert the regenerated `data/` + feed files
  afterwards; the run rewrites them.
- The committed `franchise-history.json` on main never held 2026 awards — its
  last nightly commit predated week 1 — so the milestone diff will correctly
  fire these posts once the 2026 champion resolves in December.
- The AFL runs with `badges: false` / `milestonePosts: false`; no twin.
