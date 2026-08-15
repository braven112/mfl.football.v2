# The Pecking Order Insights

Feature knowledge for the Tuesday-morning power-rankings column
(`/theleague/pecking-order`, `/afl-fantasy/pecking-order`). Launched for
TheLeague August 2026; ported to the AFL 2026-08-15.

---

## 2026-08-15 - The AI Response Is Keyed by franchiseId, and the Fact Sheet Never Carried One — Every Blurb Silently Fell Back

**Context:** `applyAIVoice` maps the model's `blurbs` object onto the rankings
by `franchiseId`. The fact sheet's rankings table listed rank, team NAME,
trend and metrics — no ids anywhere — while the user prompt asked for
`{"<franchiseId>": "..."}`. The model had no way to know what a franchiseId
looked like, so it keyed by team name, every lookup missed, and every row kept
its templated blurb.

**Why it went unnoticed for the whole launch:** the failure is invisible from
every angle you'd normally check. `applyAIVoice` only records a `fails` entry
when a blurb EXISTS and fails validation; a MISSING key just increments
`fallback` silently. The headline, lede and award blurbs all landed (they're
keyed by fixed names, not ids), so the page looked AI-written at a glance. The
run log said `blurbs=0/16`, which reads like a quality-gate rejection rather
than a key mismatch, and `voiceMode` still flipped to... no, it stayed
`templated` — which is the one true signal, and it's in the JSON, not on the
page. Both committed TheLeague issues shipped with robotic blurbs
("2-1 over their last 3 at 144.8 PPG.") until this was found while porting.

**Fix:** every rankings row now ends with `blurb key: <franchiseId>`, the
allowed-tokens block prefixes each franchise with `[<fid>]`, and the prompt
says a key that isn't one of those strings is discarded. Both leagues now come
back 16/16 and 24/24.

**Rule:** when an LLM response is keyed by an identifier, that identifier must
appear in the prompt next to the thing it identifies. And when a per-item AI
result falls back item-by-item, count the misses AND the missing — a `0/N`
with an empty fails list means the keys never matched, not that the writing was
bad.

---

## 2026-08-15 - The AFL Plays Double-Headers; "Last 3 Games" and "Last 3 Weeks" Are Not the Same Window

**Context:** `rollingRecord` took the last 3 GAMES off the H2H list. The
composite's form half is rolling-3-WEEK PPG (`rollingAvgPF`), which reads one
score per week.

**Insight:** AFL weeks 1, 2 and 13 of 2025 are double-headers — 24 matchup
entries for 24 teams, each team appearing twice against two different
opponents, with the SAME weekly score counted in both games. A last-3-games
window there covers about a week and a half while the PPG printed beside it
covers three weeks, so the card's own two numbers describe different stretches.
TheLeague plays once a week, so the bug is invisible on that side.

`rollingRecord` now windows by the last N weeks the franchise actually played
(distinct weeks with a scored game, so byes and feed gaps don't consume the
window) and reports `gamesCounted` — a double-header reads "3-1 over their last
4" instead of dropping a game. For a one-game-a-week league the two definitions
are identical, which is the regression check: TheLeague's ranks and metrics are
byte-identical before and after.

**Watch for this anywhere else a window is expressed in games:** the AFL's
schedule shape makes "last N games" and "last N weeks" diverge without warning.

---

## 2026-08-15 - Next Week's Matchup Needs schedule.json; Everything Else Can Come From weekly-results-raw

**Context:** The generator originally read `schedule.json` for both the L3
record and Matchup of the Week. AFL feed years before 2026 have no
`schedule.json` at all — it was only fetched for leagues that had been
backfilled (see the fetch-mfl-feeds comment), so `data/afl-fantasy/mfl-feeds/2025/`
has none while 2026 does.

**Insight:** `weekly-results-raw.json` carries the full pairing shape
(`matchup[].franchise[] { id, score, opt_pts, isHome }`) for every week already
played, in every league-year on disk. `buildPairings(schedule, rawWeekly)`
merges both — raw first, schedule overwriting where present — which makes the
last-N-weeks record work on any season we have, while Matchup of the Week (the
only forward-looking consumer, it needs week+1) still requires schedule.json
and simply returns null without it. The award is nullable and the page filters
nulls, so a league missing the feed loses one card instead of failing.

**Rule for backfilling a historical issue:** the standings feed on disk is the
season's FINAL standings, not the standings as of the target week, so an
archived issue's all-play % is end-of-season. That's fine for a live Tuesday
run (the feed is current) and worth knowing before reading too much into a
seeded issue's numbers.

---

## 2026-08-15 - Porting the Column to a Second League: What Was Actually League-Specific

The math (`lib/pecking-order-math.mjs`) was genuinely league-agnostic as
advertised. Three things were not, and all three were in places the original
"the page component is league-agnostic already" note didn't cover:

- **The component imported `theleague.config.json` directly** and hardcoded
  `/theleague/franchises/<fid>` links. Now `src/components/shared/PeckingOrderIssue.astro`
  with a `league` navSlug prop, config picked from a map, and franchise hrefs
  through `getLeaguePrefix` + `resolveLeaguePath` (so an apex host gets the bare
  path instead of a 301 hop).
- **Field size was baked into copy**, not just layout: the section's aria-label
  said "1-16", the fact sheet said "16 dynasty franchises", the prompt demanded
  "ALL 16 franchiseIds". The AFL has 24. All three now derive from
  `issue.rankings.length`.
- **Divisions assumed a flat league.** The AFL's four divisions sit under two
  conferences, so standings blocks carry an optional `conference` label
  (resolved from the config's `conferences[].divisions`) and the heading renders
  "American League · North". TheLeague emits no `conference` key at all, so its
  headings are untouched.

The generator reads TODAY's config regardless of `--year`, which is right for
the Tuesday run (always the season in progress) and a known limitation when
backfilling: a seeded old season gets current names, icons and division
alignment. The per-season overlays that would fix it (`resolveConfigForYear` +
`applySeasonStructure` — the AFL has re-parented divisions between conferences,
not just renamed them) are page-side TypeScript and are the work to do if this
column ever backfills seasons in bulk.

**Also league-specific and easy to miss:** the GroupMe bot env var
(`GROUPME_AFL_SCHEFTER_BOT_ID`), and the announcement URL, which must go
through `leagueUrl(league, '/pecking-order')` rather than
`leagueOrigin() + path`.
