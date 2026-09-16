---
slug: player-modal-week1-points
status: open
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1112
hotfix_sha: 3279521
followup_issue: 1115
followup_pr:
followup_session:
---

# Follow-up: the player modal showed a season of byes instead of week-1 points

## What broke

From the day the 2026 season opened (Sep 9), `PlayerDetailsModal`'s **Season
Results** table rendered all 17 weeks as `Bye` with `0.00` points, and the metric
card read `0.0 — 3 GAMES — 0.0 PER GAME`, for every player on TheLeague. Week 1
finalized Monday night Sep 14 and the site still showed 0.00 the next afternoon.

Two independent causes:

1. **MFL's `nflSchedule` export changes shape by date, not by request.** A W-less
   request returns the full season in the offseason and the **current week only**
   from week 1 onward. `nflSchedule.json` is that W-less request.
   `buildWeeklyPlayerResults` reads `fullNflSchedule.nflSchedule[]`, got nothing,
   and — treating "team not in this week's schedule" and "no schedule for this
   week" as the same thing — stamped `BYE` on every week. The modal renders a bye
   row *without its points*, so a real score was hidden rather than shown wrong.
2. **Unscored lineup rows counted as `0.00` games.** MFL lists a player in an
   upcoming week's lineup with no `score` key; `parseFloat(undefined)` → `NaN` →
   `0`. Every future week counted as a game played and pulled the per-game
   average to zero.

## What the hotfix did

Forward fix, no revert.

- `scripts/fetch-mfl-feeds.mjs` — new `nflSchedule-full` feed (`W=ALL`) fetched
  from `API_HOST` (`api.myfantasyleague.com`); the per-league `www##` hosts reject
  `W=ALL` with an error payload at HTTP 200. Kept as a **separate file** from
  `nflSchedule.json` because the kickoff hero, app badge, game-day alerts and
  Sunday Ticket all read the live current-week shape, and
  `tests/afl-hero-casting.test.ts` pins that.
- `scripts/fetch-mfl-feeds.mjs` — the current week's `weeklyResults` now refreshes
  on every live run (one request, merged on the week number MFL reports), with a
  guard that a week already carrying scores is never downgraded to one without.
- `src/utils/weekly-player-results.ts` — a week with no schedule loaded is
  UNKNOWN, never a bye; `buildScheduleMap` reads both payload shapes; an unscored
  lineup row is `null`, not `0`.
- `src/pages/theleague/{players,projected-free-agents,rosters}.astro` — prefer
  `nflSchedule-full.json`, fall back to `nflSchedule.json` (older seasons were
  synced in the offseason and carry the full shape there).
- `src/components/theleague/PlayerDetailsModal.astro` — "1 Game", not "1 Games".
- Both leagues' 2026 feeds re-synced so the fix landed with the deploy.
- `tests/weekly-player-results-schedule.test.ts` shipped **with** the fix, wired
  into `path-guard.json` for `mfl-weekly-results` and `storage-and-build`.
  Mutation-checked: 4 of its 6 tests fail against the old behavior.

## Deferred items

- [ ] **F1 — The AFL's player modal has no Season Results table at all**
  - Source: cross-cutting lens, step 5 (the user asked for both leagues)
  - Where: `src/pages/afl-fantasy/players.astro`,
    `src/pages/afl-fantasy/rosters.astro` — neither emits the
    `weekly-player-results` payload; only the three TheLeague pages do
    (`src/pages/theleague/players.astro:1185` and siblings)
  - Why deferred: this is a feature, not a fix. Two real obstacles: (a) the AFL
    free-agents page deliberately reads a precomputed snapshot from
    `scripts/compute-afl-free-agents.mjs` to keep the SSR bundle small — eager
    globs over `weekly-results-raw.json` + `players.json` are exactly what that
    refactor removed, so the payload has to be built into that snapshot
    (`compute-afl-free-agents.mjs:163` already reads `weekly-results-raw.json`);
    and (b) `WeekEntry.fn`/`.fi` are **singular**, but an AFL player is routinely
    rostered in both conferences, so a week has two owners. That needs a design
    call, not a guess. `data/afl-fantasy/mfl-feeds/2026/fantasyPointsAllowed.json`
    is also missing — the Avg/Rank columns would be blank until
    `scripts/fetch-fantasy-points-allowed.mjs` runs for the AFL.
  - Note: the AFL's *feeds* are fixed by this hotfix (both leagues' 2026
    `nflSchedule-full.json` and scored `weekly-results-raw.json` are committed),
    so F1 is purely the UI wiring.

- [ ] **F2 — `window._weeklyPlayerData` is cached across ClientRouter navigations and never keyed by league**
  - Source: Claude review, cross-league lens
  - Where: `src/components/theleague/PlayerDetailsModal.astro:1779-1787` —
    `if (!window._weeklyPlayerData) { … }` caches on first open and never
    re-reads
  - Why deferred: a genuine cross-league data leak but not the reported symptom,
    and it only manifests once F1 lands or on the shared host. Repro: on
    `mfl.football`, open TheLeague's Free Agents, open any player card, then use
    the nav's league switcher to the AFL and open a card there — the AFL page
    emits no `#weekly-player-results` element, so the modal keeps TheLeague's
    payload and would show TheLeague franchise badges for an AFL player (MFL
    player ids are global across leagues). This is the exact hazard CLAUDE.md's
    "forked page's `astro:page-load` init must NAME ITS LEAGUE" section describes,
    one layer up. Fix shape: key the cache by the payload element's own
    `data-league`, or just re-read the element on every open.

- [ ] **F3 — Whether MFL publishes live in-progress weekly scores is still unconfirmed**
  - Source: deferred at implementation
  - Where: `scripts/fetch-mfl-feeds.mjs` — the `else` branch of the
    `if (!skipDailyFeeds)` weekly-results block
  - Why deferred: not testable on Sep 15 (week 1 final, week 2 hadn't kicked off).
    The live refresh is correct either way — it strictly improves freshness — but
    the answer decides whether Season Results can update *during* games or only
    after a week finalizes, and therefore whether the 5-minute cadence is buying
    anything on a Sunday. Check during week 2 (starts Sep 17): fetch
    `api.myfantasyleague.com/2026/export?TYPE=weeklyResults&L=13522&JSON=1&W=2`
    mid-afternoon Sunday and look for `"score"` keys.

- [ ] **F4 — `nflSchedule.json` is a W-less request with no in-code note that its shape flips at week 1**
  - Source: Claude review
  - Where: `scripts/fetch-mfl-feeds.mjs` — the `nflSchedule` endpoint entry; and
    the consumers that read only the live shape,
    `src/utils/offseason-hero-data.ts:336` (`data?.nflSchedule?.matchup`) and
    `src/utils/app-badge.ts:65`
  - Why deferred: those two consumers *want* the current week, so they are
    correct today. But they will silently return nothing during the offseason,
    when the same file carries `fullNflSchedule` instead — the mirror image of
    the bug just fixed, on the other half of the calendar.
    `src/utils/sunday-ticket-slate.ts:209` and
    `src/components/theleague/season-heroes/MatchupPreviewHero.astro:68` already
    handle both shapes; these two do not. Worth a shared reader rather than a
    fifth hand-rolled shape check.

## Context to start cold

- **The root cause was NOT "the cron stopped running".** That was the first
  theory and it cost the most time. `weekly-results-raw.json` was being committed
  daily (9/14, 9/11, 9/10, 9/9, 9/8 …) and every one of those commits carried
  **zero** `"score"` keys, while the live export returned 618 for week 1. The
  explanation is that MFL populates a week's scores as its games finalize and the
  daily loop kept landing before that; the week-1 payload it kept fetching was
  the genuine pre-final shape (`result: "T"`, `spread: "0"`, players as
  `{id, status}` with no `score`).
- **Verification technique that settled it:** `for sha in $(git log --format=%H
  -12 -- <file>); do git show $sha:<file> | grep -c '"score"'; done` — score
  presence across commits, which separates "not fetched" from "fetched empty".
- **The `W=ALL` host trap is real and silent.** `www49` answers
  `TYPE=nflSchedule&W=ALL` with HTTP **200** and
  `{"error": {"$t": "Invalid request. This API request must go to
  api.myfantasyleague.com"}}`. `writeOut`'s error-payload guard catches it, so a
  wrong host shows up as "feed never updates", not as a failure.
- **Ruled out:** `MFL_HOST` being wrong (the api host 302s to `www49` and Node's
  fetch follows it fine), `VOLATILE_FEED_KEYS` stripping scores (it is only
  `['lastFetched']`), and `writeJsonIfChanged` having a shrink guard (it has
  none).
- **Weeks 1, 2, 3 and 12 have 16 matchups instead of 8** in TheLeague's 2026
  `weekly-results-raw.json` — those are the doubleheader weeks, not a bug. Don't
  "fix" it.
