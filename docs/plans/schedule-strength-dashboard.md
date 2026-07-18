# Schedule Strength — "The Gauntlet" (Schefter weekly column + dashboard)

**Status:** planned, not yet implemented. Augmented 2026-07-18 with the
Schefter-column framing after Brandon's review. Decisions locked in:

- **Surface:** weekly Schefter *article* in the feed **plus** a persistent
  dashboard page per league. Article carries the narrative + key tables and
  links to the dashboard for the full heat map and history.
- **Cadence:** article publishes **Wednesday** (currently an empty slot in
  Schefter's content calendar), with a same-day GroupMe promo per league.
- **Scope:** **both leagues at full parity from day one** (TheLeague + AFL
  Fantasy). Requires closing the AFL schedule-feed gap (see Data sources).
- **Hero:** NOT hero-worthy. The launch What's New entry sets
  `excludeFromHero: true`; the weekly GroupMe promo is the marketing channel.

## Context

Brandon wants remaining-schedule difficulty for every franchise, updated
weekly — who has the easy run-in to the playoffs, who has a buzz-saw ahead.
Reframed: this is a **recurring column that Claude Schefter writes each
week** ("The Gauntlet"), not just a static analytics page. Schefter's
narrative voice sells the numbers; the dashboard holds the full data.

## Branding

Working title: **"The Gauntlet"** — a named, numbered weekly column
("The Gauntlet · Week 5"). A recognizable masthead gives the GroupMe promo
something to hype week over week. (Name is Brandon-approvable; the code
should keep the column name in one constant so it's a one-line rename.)

## Routes

- `/theleague/schedule-strength` and `/afl-fantasy/schedule-strength` —
  persistent dashboards, current season + week, with year selector for
  completed seasons (read-only historical strength).
- Weekly article renders through the existing feed article route
  (`/theleague/news/<id>`, AFL equivalent) via `type: "article"` posts in
  the schefter feed — same mechanism as trade-grades articles.

## Data sources

All on disk, per league (`data/<league>/mfl-feeds/<year>/`):

- `schedule.json` — per-week H2H pairings
- `weekly-results.json` — completed weeks' actual scores
- `standings.json` — current records, points-for
- `projectedScores.json` — MFL projections (forward-looking, optional blend)
- `data/theleague/derived/franchise-history.json` — multi-year ppg context

**AFL gap (launch blocker):** `data/afl-fantasy/mfl-feeds/2026/` has
`standings.json` but **no `schedule.json`**. Phase 0 adds schedule to the
AFL feed sync. League constants come from the registry
(`src/config/leagues-data.mjs`) — no hardcoded ids/paths, per CLAUDE.md.

## Composite-strength algorithm (shared with power rankings)

Opponent strength = composite of:
- 50% opponent's current points-per-game (this season)
- 25% opponent's all-play record (luck-adjusted)
- 25% opponent's last-3-week rolling ppg (recent form)

`scripts/generate-power-rankings.mjs` already computes rolling-3-week PF,
record, and all-play. **Extract that math into a shared lib**
(`scripts/lib/team-strength.mjs`) consumed by both power rankings and the
schedule-strength generator — do not duplicate it.

Output: per-franchise 0–100 difficulty score (rendered as ★–★★★★★),
ranked **hard-on-top** — it reads as a ranking, which fits the Schefter
column framing ("who's walking into the gauntlet").

## Weekly article (the Schefter deliverable)

Slots into the existing weekly-articles pipeline
(`scripts/schefter-weekly-articles.mjs` + `.github/workflows/schefter-articles.yml`)
as a sixth article type: `schedule-strength`.

Pipeline per league: load data → **fact sheet** → AI voice pass
(`scripts/article-utils/ai-client.mjs`) → validate → `appendToFeed`
(`scripts/article-utils/feed-writer.mjs`). Week resolution via
`scripts/article-utils/week-resolver.mjs`.

**Article = narrative + structured data.** The AI writes the lede and 2–3
storylines; tables/heat map render from structured JSON sections on the
post (same pattern as the trade-grades `grades[]` array). Numbers are
computed, never LLM-generated — validation checks the prose references
real teams and doesn't contradict the fact sheet.

**Fact-sheet narrative hooks** (computed, so the voice pass has concrete,
verifiable material every week):
- **Schedule luck callout:** biggest gap between record and past-schedule
  difficulty ("Pigskins are 5-0 with the easiest schedule").
- **Trap week:** the upcoming week where the most top teams face hard
  matchups simultaneously.
- **Biggest riser / faller:** largest week-over-week difficulty-rank moves.
- Top-line stat for the GroupMe tease (cushiest run-in or hardest gauntlet).

## GroupMe promo (once per week, per league)

Fires right after the Wednesday article lands, using
`scripts/lib/groupme.mjs#postToGroupMe` with the existing per-league bots
(`GROUPME_SCHEFTER_BOT_ID` / `GROUPME_AFL_SCHEFTER_BOT_ID` — mapping
pattern in `scripts/schefter-announce.mjs`).

Format: **tease one finding, don't summarize** — the single spiciest stat
plus the article link. e.g. "Nobody has a softer run-in than the Pigskins.
The Gauntlet, Week 5, is live → <link>". One message per league to its own
bot; skip the promo entirely if the article didn't generate (never post a
dead link).

## Dashboard page structure

```
Hero
  Title: "The Gauntlet · Week 5 · 2026"
  Subhead: How hard is the rest of the season for each team?

Section 1: "The Run-In" (remaining-schedule rankings)
  Table: rank | franchise | remaining ppg-avg | difficulty bar | trend vs last week
  Hard-on-top (ranking framing)

Section 2: "What They've Been Through" (past-schedule strength)
  Same table shape for played weeks
  Schedule-luck highlight: 3 biggest record-vs-difficulty gaps
  Optional: small SVG scatter — record vs past schedule strength

Section 3: Week-by-week heat map
  N franchises × remaining weeks, green (easy) → red (brutal)
  Click a cell → opponent's franchise page

Section 4: "Trap weeks" — league-average difficulty per upcoming week
```

**Visuals are hand-rolled SVG/CSS** — no chart library exists in the repo
and none should be added for this. Heat map is a CSS grid; difficulty bars
are inline SVG/divs; trend arrows are glyphs. Consult the `dataviz` skill
before building the charts. Must work in light + dark themes.

## Generation pipeline

`scripts/compute-schedule-strength.mjs` (both leagues) runs in prebuild +
Wednesday cron:

1. Load schedule/standings/weekly-results for the current year.
2. Per franchise: remaining opponents → composite strength (shared lib) →
   averaged difficulty score; same for played weeks; heat-map row.
3. Write `data/<league>/derived/schedule-strength-<year>-<week>.json`
   (keep prior weeks — the trend column and riser/faller hooks diff
   against last week's file).
4. Dashboard reads the latest file; article fact sheet reads the same file
   (single source of truth — article and page can never disagree).

Historical backfill: for completed seasons, generate final data once and
cache forever (year selector reads these).

## Cadence

- Compute + article + GroupMo promo: **Wednesday** (stats settled Tuesday;
  Wednesday is an empty slot — recap/power-rankings own Tuesday).
- Cron lives in `.github/workflows/schefter-articles.yml` alongside the
  other article types. No GitHub Actions feature-gate vars (CLAUDE.md rule) —
  gate with a `const` in the script if needed.

## Phasing

| Phase | Scope | Effort |
|---|---|---|
| 0 | AFL feed sync: add `schedule.json` for AFL 2026. Extract shared `team-strength.mjs` from power-rankings math. | 0.5 day |
| 1 | `compute-schedule-strength.mjs` for both leagues + derived JSON + tests for the composite. | 1 day |
| 2 | Dashboard pages (sections 1+2, tables + difficulty bars) for both leagues. | 1 day |
| 3 | Heat map (section 3) + trap weeks (section 4). | 0.5 day |
| 4 | Article type `schedule-strength` in the weekly pipeline: fact sheet, voice pass, validation, feed write — both leagues. | 1 day |
| 5 | Wednesday cron + GroupMe promo per league. | 0.5 day |
| 6 | Year selector + historical backfill. | 0.5 day |

## Launch checklist (repo requirements)

- `src/data/page-directory.json` entries for **both** league pages
  (10+ tags each; `tests/page-directory-data.test.ts` enforces).
- What's New entry (`src/data/whats-new.json`, top of array) with
  screenshot, editorial voice, and **`excludeFromHero: true`** (decided —
  no hero).
- League-literal guard: all league constants via the registry
  (`tests/league-literal-guard.test.ts` will catch violations).
- Test date-dependent behavior with `?testDate=YYYY-MM-DD`, and use
  `getCurrentSeasonYear()` (results-shaped, not roster-shaped).

## Resolved questions (was "Open questions")

- **Easy-on-top or hard-on-top?** Hard-on-top — it's a ranking, and the
  column framing is "who faces the gauntlet".
- **Visibility:** public to all owners — competitive intel is the point.
- **Surface / cadence / AFL scope / hero:** see decisions at top.

## Still open (tune during build, not blockers)

- Composite weights are first-pass guesses — worth backtesting against a
  completed season (does the model's "hard schedule" correlate with actual
  losses?).
- Whether to blend `projectedScores.json` into forward-looking strength.
- Column name "The Gauntlet" — Brandon can veto/rename (single constant).
