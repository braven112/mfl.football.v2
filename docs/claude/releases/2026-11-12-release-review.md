# Release review — 2026-11-12

**Verdict: GO** (promoted Thursday, inside a game-day blackout, on Brandon's explicit call)

**Range:** `976ccc8..e0e7ca9` — 6 merges, 91 files, +11,622/-125
**Features on the train:**
- #1711 — Chart-led Saturday Matchup Preview, standalone Playoff Odds page per league, odds on the standings Playoffs tab, Saturday lineup roll call (Sunday lineup reminders push-only)
- #1706 — Marquee weeks in the schedule maker: Week 1 title rematch, holiday rivals (AFL + TheLeague, from the 2027 draws), Schefter playoff-bubble callouts
- #1707 — Live scoring matchup detail: original projections under the score and on final player rows
- #1708 — Share Ask the History answers to the group chat as a portrait card
- #1709, #1710 — docs only

## Blackout
`scripts/release-blackout.mjs` reported Thursday 2026-11-12 as an NFL week start (DO NOT PROMOTE). Brandon was told and chose to release today anyway ("I want to do the release today. Right now"). Next clear days were Friday 11-13 and Tuesday 11-17.

## Blocks promotion
None.

## Stored-shape compatibility
One new Redis key: the Saturday roll call's dedupe key, `schefterKey(navSlug, 'lineup_check:saturday:<year>:w<week>')` (scripts/schefter-lineup-check.mjs). New, league-scoped, nothing on main reads it. #1707 is display-only. No other storage writes in range.

## Build rehearsal
New prebuild step `compute:playoff-odds` is `previewSkip`, so staging never ran it. Ran it on the staging tree: all four leagues `unchanged`, 5.5 s, no network. The rest of the range touches no prebuild step.

## Fix before promotion
None.

## Follow-up filed
None.

## Ratchets
No change to page-fork, typecheck or clientrouter baselines in range.

## Checked, nothing found
- Merge-down healthy (last 5 runs green); fast-forward OK.
- CI on staging tip `e0e7ca9`: Tests, Type baseline, Function size, Visual tests all green.
- Sibling drift: no twin pairs touched.
- Duplication: playoff-bubble.mjs (historical made/missed) and playoff-odds.mjs (simulation) are distinct; no overlap found by reading exported functions. gemini-ask unavailable in session (CLI missing), so this was a manual read only.
- Behavior note: the Saturday chat changes (roll call, chart-led preview) and push-only Sunday reminders run from main's workflows, so they take effect this weekend (Sat 11-14).

## Promotion
`git merge --ff-only origin/staging` → `main` at `e0e7ca9`. Rollback target: production deployment `dpl_53RVFkwgtRWtGcX6MKZvwMrUpYLQ` (`976ccc8`).
