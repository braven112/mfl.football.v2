# Schedule Strength ("The Gauntlet") Insights

Feature knowledge for the weekly Schefter schedule-strength column + dashboards
(`/theleague/schedule-strength`, `/afl-fantasy/schedule-strength`), built July 2026.

---

## 2026-07-18 - Architecture: One Derived File Is the Single Source of Truth

**Context:** The feature has three surfaces — two dashboard pages, the weekly
Schefter article (feed post + `/news/[id]` render), and the GroupMe promo —
that must never disagree on the numbers.

**Insight:** Everything renders from
`data/<league>/derived/schedule-strength-<year>-w<NN>.json`, written by
`scripts/compute-schedule-strength.mjs` (Wednesday cron inside
`.github/workflows/schefter-articles.yml`, plus prebuild). The article type
(`scripts/article-types/schedule-strength.mjs`) builds its fact sheet FROM the
derived file (`requiredData: []` — it skips the runner's generic feed loaders),
the LLM only adds voice, and the article page re-renders the tables from the
same file via a `scheduleStrength: { year, week }` pointer on the post. Never
compute schedule-strength numbers in a second place.

**Week semantics gotcha:** the weekly-articles runner passes `week` = last
COMPLETED week; the Gauntlet issue is named for the UPCOMING week. The article
module maps `week → week + 1` (`gauntletWeek`) to find the derived file. The
compute script writes at `completedWeek + 1` — except for PAST seasons, where
it forces `maxScheduleWeek + 1` so the run-in is empty (weekly-results can
trail schedule.json: MFL bakes playoff pairings into the schedule without
recorded results, so "completedWeek + 1" on a finished season would show a
stale 8-team run-in).

## 2026-07-18 - Weekly Files Are Retained Forever; ALL Globs Are Lazy (Pruning Was Reverted)

**Insight:** An earlier revision pruned superseded weekly files to keep the
dashboards' eager glob small — the /live review caught that this deletes data
published articles still reference: every Gauntlet post carries
`scheduleStrength: { year, week }` and resolves its EXACT week's file, so
pruning silently stripped the tables out of every past article after seven
days (and a re-run in the same week lost its trend source). The resolution:
NO pruning ever, and no eager glob anywhere — the dashboards use
`resolveGauntletViewLazy` (picks the year from glob KEYS alone, imports one
file per request) and the article pages import only the pointed-at issue via
`GauntletArticleSection`. Retention costs repo bytes only (~17 files/season/
league at 15-40KB), never server-bundle bytes. If you ever reintroduce
cleanup, the invariant is: a derived file may only be deleted when no feed
post references its {year, week}. (The astro-performance review noted
`power-rankings` pages still eager-glob everything — candidate follow-up.)

## 2026-07-18 - Weekly-Articles Runner Is Now League-Parameterized

**Insight:** `scripts/schefter-weekly-articles.mjs` takes `--league theleague |
afl-fantasy` (default theleague — existing types unaffected).
`resolveDataDir`/`getFeedPath`/`loadTeams` in `article-utils/data-loaders.mjs`
take a league param, resolving via the leagues registry; the two feed paths
remain deliberately different (TheLeague `src/data/...`, AFL under its
dataPath). Article modules receive `{ league }` as an extra trailing arg on
`config.id`, `buildFactSheet`, and `buildPost` — old modules ignore it (JS
silently drops extra args). New optional hook: `buildGroupMePromo(post,
enrichment, { league })` — the runner posts it via the per-league Schefter bot
(`GROUPME_SCHEFTER_BOT_ID` / `GROUPME_AFL_SCHEFTER_BOT_ID`) ONLY when
`appendToFeed` returned true this run (no-double-ping rule, same as
schefter-announce). AFL articles render at `/afl-fantasy/news/[id]` — that
route was CREATED for this feature; before it, AFL feed article links 404'd.

## 2026-07-18 - getCompletedWeek's Default Threshold Is TheLeague-Shaped

**Insight:** `article-utils/week-resolver.mjs#getCompletedWeek(weeklyResults,
minScores = 16)` counts a week complete when ≥ minScores non-zero scores exist.
The default 16 matches TheLeague; AFL has 24 franchises, so callers that can
serve AFL must pass the league's franchise count or a partially-scored AFL week
(16-23 reporters) is misclassified as complete. The compute script passes
`config.teams.length`; the articles runner counts `standings.leagueStandings
.franchise.length` (fallback 16). Any new consumer should do the same.

## 2026-07-18 - schedule.json Is Now in the Regular Feed Sync (Was Backfill-Only)

**Insight:** Before this feature, `TYPE=schedule` (season H2H pairings) was
fetched ONLY by `backfill-historical-feeds.mjs`, so current-year
`schedule.json` existed only for leagues someone had backfilled — AFL 2026 had
none. `fetch-mfl-feeds.mjs` now fetches it every sync. Note the sandbox
network policy blocks myfantasyleague.com (CONNECT 403), so a missing current
schedule can only be filled by the roster-sync GitHub Action, not from a dev
session; the compute script and the workflow both skip a league cleanly when
schedule.json is absent.

## 2026-07-18 - Shared Theme Class Instead of Component-Scoped Tokens

**Insight:** The `--gnt-*` custom-property set (difficulty ramp, table chrome)
lives in `src/styles/schedule-strength.css` on a `.gauntlet-theme` class — NOT
inside `GauntletDashboard.astro`'s scoped style — because the article pages
render `StrengthTable`/`ScheduleLuckCallout`/`TrapWeeksStrip` outside the
dashboard and still need the ramp + dark overrides. Any new surface reusing
these components must add `gauntlet-theme` to its wrapper. Ramp colors are
literals by design (gray tokens invert in dark mode); the s0/BYE ink is
gray-600-equivalent `#4b5563`, not gray-500 — gray-500 on `#f3f4f6` is 4.39:1,
below AA.

## 2026-07-18 - AFL Plays Extra Games MFL Doesn't Count — Grid Is Array-Valued, Records Come From Standings

**Insight:** AFL raw results contain weeks with 24 matchups for 24 teams (each
franchise plays TWO distinct opponents — e.g. 2025 weeks 1, 2, 13), and MFL's
official `h2hwlt` record EXCLUDES the extra games (17-game records despite
20 played). Nothing in schedule.json or weekly-results-raw flags which matchup
is the official one. Two consequences baked into the pipeline:
1. `buildOpponentGrid` maps week → opponent ARRAY (a scalar silently dropped
   half of AFL's double-header weeks: halved records, understated difficulty).
   Heat-map cells carry `opps[]` with a per-week averaged `difficulty`.
2. Displayed records parse standings `h2hwlt` (`parseH2hRecord`), falling back
   to score-derived computation only when standings are missing. Never
   recompute records from pairings for display — they won't match what owners
   see on MFL (verified: computed-from-pairings mismatched ALL 24 AFL teams).
Difficulty averages deliberately DO include the extra games — you still have
to beat that opponent that week.

Also: for past seasons whose `schedule.json` was never backfilled (AFL
2024/2025), `scheduleFromRawResults` rebuilds pairings from
weekly-results-raw — sufficient for a completed season (no future weeks).
