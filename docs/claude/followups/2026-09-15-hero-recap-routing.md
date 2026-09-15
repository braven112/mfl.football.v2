---
slug: hero-recap-routing
status: open
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1085
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: the Tuesday recap hero pointed at the news feed and named the wrong week

## What broke

The Tuesday recap hero — the card headlined **"THE WEEK IN REVIEW."** — did not
link to a review, and named a week nobody had played. Reported on
`afl-fantasy.com` on Tue Sep 15 2026; present in both leagues, every Tuesday
in-season since the slot rotation shipped.

Two independent bugs on the same card:

1. **The CTA went nowhere useful.** The AFL's `slot:recap` hardcoded
   `/afl-fantasy/news` — the whole Schefter feed, 270 of whose 300 posts are
   external NFL wire items — and TheLeague's `RecapCompositeHero` sent "See the
   full week" to `/theleague/standings`, the race rather than the week.
2. **The week was wrong.** `getCurrentNFLWeek` rolls to the UPCOMING week on
   Tuesday, the exact morning the slot runs, so it read "Week 2 is in the books"
   while Week 1 was what had finished.

## What the hotfix did

Forward fix, not a revert. New `src/utils/hero-recap-destination.ts` owns the
answer for both leagues:

- the week comes from `getLatestScoredWeek` (the scores), not the calendar;
- the destination is Schefter's recap column for that week when one exists, else
  that week's own scoreboard at `/<league>/live-scoring?week=N`; only a season
  with nothing scored at all still falls through to the feed;
- the article is matched on the generated id (`sf_<year>_weekly_recap_w<NN>`),
  never on the headline.

Wired into `src/utils/afl-hero-resolver.ts` (both the `view` and the `content`
object — they both render), `src/pages/afl-fantasy/index.astro`,
`RecapCompositeHero.astro` and `RecapHero.astro`. Guard:
`tests/hero-recap-destination.test.ts` (15 tests), registered in the
`hero-composites` path-guard domain.

## Deferred items

- [x] **F1 — `getLatestScoredWeek` and `getCompletedWeek` are different derivations** — FIXED
  - Source: Claude review, `/code-review`
  - Where: `src/utils/hero-recap-destination.ts:99`,
    `src/utils/offseason-hero-data.ts:483`,
    `scripts/article-utils/week-resolver.mjs:53`
  - The hero asks `getLatestScoredWeek` (max week with ANY score row in MFL's
    `playerScores` feed, which is fetched with no `W=` and therefore holds
    whatever week MFL considers current). The article id was minted from
    `getCompletedWeek` (every franchise scored > 0, read from
    `weekly-results.json`). If MFL rolls `playerScores` to the new week before
    the Tuesday 6am PT recap cron, the id lookup misses the recap just written
    and the copy names the unplayed week again.
  - Why deferred: the two feeds currently agree (both say week 1 on Sep 15), the
    failure mode is a degraded scoreboard rather than a break, and
    `getLatestScoredWeek` was already the week source for this hero's wordmark
    and pill before this change — so it is pre-existing, not introduced.
  - Suggested fix: one derivation, shared between the hero and the generator.
    Probably `getCompletedWeek`'s "every franchise scored" rule, exposed from
    `src/`, with the generator importing it rather than keeping its own copy.
  - **NARROWED by the F3 removal, then FIXED (Sept 2026).** The id-lookup half
    died with the generator. The real half — `getLatestScoredWeek` reading a
    `playerScores` feed fetched with no `W=`, and so naming an unplayed week the
    moment MFL rolls it — is fixed by `getWeekInTheBooks`
    (`src/utils/offseason-hero-data.ts`), which caps the feed's week at the
    calendar's last completable week (`nflWeekFor - 1`). A CEILING, not a floor:
    the feed still decides, it just cannot run ahead of the games.
    `getLatestScoredWeek` is deliberately unchanged and still backs
    `getMarqueeGame` — "which game do I feature" is a different question from
    "which week is finished", and it is asked on days the cap would shift.
    Guard: `tests/offseason-hero-data.test.ts`, 6 cases including the rolled
    feed and the preseason read. The three recap call sites (`RecapHero`,
    `RecapCompositeHero`, the AFL homepage) now use it.

- [ ] **F2 — The AFL homepage resolves the recap season year differently from the rest of the page**
  - Source: Claude review, `/code-review`
  - Where: `src/pages/afl-fantasy/index.astro:193` (`getCurrentSeasonYear(effectiveDate)`)
    vs `resolveSeasonYearWithData()` defined ~20 lines below at `:215`
  - During the window where MFL has created the new season directory but not
    populated it, the recap resolves week 0 and degrades to the news feed while
    the rest of the page reads the walked-back year.
  - Why deferred: `resolveSeasonYearWithData` is declared after the hero block,
    so using it means reordering the page's frontmatter — more churn than a
    hotfix diff should carry, and the degradation is to the pre-existing
    behaviour rather than to something worse.

- [x] **F3 — No weekly recap article has generated for either league all 2026
      season** — RESOLVED BY REMOVAL, Sept 2026.
  - Source: found during diagnosis, not a review finding
  - Was: both leagues' `weekly-results.json` carry **zero scores for every
    week**, so `getCompletedWeek` returned 0, `isRegularSeasonOrPlayoffs(0)` was
    false, and the Tuesday 6am PT cron skipped silently all season.
  - **Resolution: the column was removed, not repaired.** A recap article every
    week is not something owners wanted to read, so fixing the pipeline would
    have shipped an unwanted column rather than a missing one. Deleted:
    `scripts/article-types/weekly-recap.mjs`, the `0 13 * * 2` cron and the
    `weekly-recap` `workflow_dispatch` choice in
    `.github/workflows/schefter-articles.yml`, the `VALID_TYPES` entry in
    `scripts/schefter-weekly-articles.mjs`, and the `PUSH_ONLY_KINDS` entry in
    `scripts/lib/groupme-day-plan.mjs`.
  - **F1 and F4 die with it** — both were defects in the generator or in the id
    handshake with it. See their entries.
  - The hero is untouched and keeps working: with no recap in any feed,
    `resolveRecapDestination` always takes the `/<league>/live-scoring?week=N`
    branch, which is the destination the hotfix built. The article branch stays
    in the module, dormant, so a back-filled archive would still resolve.

- [x] **F4 — `buildPost` in weekly-recap.mjs ignores its own `{ league }` option**
      — MOOT IN ITS ORIGINAL FORM (file deleted); the audit it implied is DONE.
  - **The named file was deleted by the F3 removal (Sept 2026)**, so the specific
    defect below can no longer fire. Kept open for the last bullet only: the
    same hardcode may sit in other article types, and nothing has checked.
  - Source: Claude review (the blocking half was fixed; the root cause was not)
  - Where: `scripts/article-types/weekly-recap.mjs:270-271` (deleted)
  - It hardcodes `link: '/theleague/news/${articleId}'` and `league: 'theleague'`
    while the workflow runs the type for `--league afl-fantasy` too. The hotfix
    worked around it by CONSTRUCTING the href from the reader's league rather
    than trusting the post, but the post itself still lands in the AFL feed
    carrying a TheLeague link and a `league: 'theleague'` tag — which anything
    else reading the feed will believe.
  - Why deferred: the hero is immune now, and fixing the generator means checking
    every other article type for the same hardcode — wider than a hotfix diff.
  - **AUDIT DONE, AND IT WAS NOT JUST THIS ONE (Sept 2026).** Six other article
    types carried the identical hardcode — `championship-recap`, `draft-grades`,
    `matchup-preview`, `team-grades`, `waiver-pickups`, `weekend-preview` — each
    declaring `buildPost(aiOutput, enrichment, articleId)` with no `{ league }`
    parameter at all while `scripts/schefter-weekly-articles.mjs:239` passed one.
    All six now take `{ league = DEFAULT_LEAGUE_SLUG }` and build both the
    permalink and the feed tag from `LEAGUES[league].slug`, matching the pattern
    `cut-watch` and `schedule-strength` already used. `schedule-release` and
    `schedule-strength` were already correct. Guard:
    `tests/article-type-league-option.test.ts`.

## Context to start cold

**The Tuesday rollover is the load-bearing fact.** `nflWeekFor(2026, …)` returns
2 on Tue Sep 15 and Mon Sep 21, and 3 on Tue Sep 22 — it rolls on TUESDAY, not
at Thursday kickoff. Week starts for 2026 are Sep 9 / Sep 17 / Sep 24 / Oct 1.
Any hero, article or reminder that runs on a Tuesday and says "last week" has
this bug available to it; `getCurrentNFLWeek` is never the completed week on a
Tuesday. This is worth a guard test of its own, beyond the recap hero.

**Why the scoreboard and not the schedule page.** The user asked for a
"scores and schedule page" first. `/<league>/schedule` does carry final scores,
but it is a whole-SEASON grid with no week scoping and no per-week anchor, so
landing there on Tuesday shows a 17-week matrix rather than the week that just
ended. `/<league>/live-scoring?week=N` honours the `week` param
(`live-scoring.astro:62`), passes it through to MFL's `liveScoring` export, and
renders final scores per matchup. If someone later adds week anchors to the
schedule page, it becomes the better destination and this is a one-line change
in `hero-recap-destination.ts`.

**Two objects render, not one.** `resolveAflHeroState` returns both a `content`
(`HeroContent`) and a `view` (`EventHeroView`) for the regular-season slots, and
both carry a link and a week label. Fixing one and not the other leaves the old
behaviour live on whichever surface reads the other — worth remembering for any
future edit to an AFL slot.

**TheLeague needed no page change**, which looks like sibling drift and isn't:
its recap path is `SeasonDailyHero` → `RecapCompositeHero` → `RecapHero`, and
both components self-load their feed, whereas the AFL routes everything through
the resolver. `scripts/sibling-drift.mjs` flags `theleague/index.astro` as an
UNCHANGED twin; that was adjudicated, not missed.
