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

## 2026-08-15 - BOTH Leagues Play Double-Headers; "Last 3 Games" and "Last 3 Weeks" Are Not the Same Window

**Context:** `rollingRecord` took the last 3 GAMES off the H2H list. The
composite's form half is rolling-3-WEEK PPG (`rollingAvgPF`), which reads one
score per week.

**Insight:** a double-header week lists a franchise twice, against two different
opponents, with the SAME weekly score counted in both games. In 2025 the AFL
plays them in weeks 1, 2 and 13 — and **TheLeague plays them in weeks 1, 2, 3
and 13.** Assuming a 16-team league is one-game-a-week is wrong, and it was
wrong in this repo's own commit message before the feed was actually checked:

```js
// weeks where a franchise appears more than once
const ids = matchups.flatMap(m => m.franchise.map(f => f.id));
ids.filter((v, i) => ids.indexOf(v) !== i);
```

A last-3-GAMES window silently drops a real game whenever it reaches into one of
those weeks, while the PPG printed beside it still counts it. `rollingRecord`
now windows by the last N weeks the franchise actually played (distinct weeks
with a scored game, so byes don't consume the window) and reports
`gamesCounted`, so it reads "2-2 over their last 4".

**It only bites when the window reaches a double-header**, which is why it hid:
in TheLeague's Week 16 issue exactly two of sixteen franchises change (0009 and
0007, both idle in week 15, so their last three PLAYED weeks reach back to the
week-13 double-header). Everyone else is unaffected, and no ranking moves at
all — the composite never used the record. `tests/pecking-order-rolling-record.test.ts`
pins those two franchises against the committed feed.

**The lesson that generalizes:** "output is unchanged for the other league" is
not established by diffing the ranks. The record lives in the blurb text, and
the first check only compared rank/composite/PPG — which genuinely were
identical — so the change looked inert. Diff the field you actually changed.

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

**Every list read out of a raw feed needs `asArray`.** MFL collapses a
one-element list to a bare object, so a week with a single matchup arrives as
`matchup: {...}`. `data/afl-fantasy/mfl-feeds/2012/weekly-results-raw.json` has
one, and it crashed the generator outright (`.map is not a function`) on any
backfill run that touched 2012 — a hard failure, not a data-quality wobble. The
committed current-year feeds all happen to have multi-matchup weeks, which is
why nothing caught it until an old year was tried.

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
