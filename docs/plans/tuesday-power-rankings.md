# Tuesday Power Rankings — Weekly Article

## Context

Brandon wants a single weekly article — published every **Tuesday morning** during the season — that combines:

- **Power Rankings** (idea #6) — Schefter-voiced rankings of all 16 franchises with one-line takes per team, auto-generated from results + cap health + roster age + recent form.
- **Weekly Awards** (idea #7) — Stat of the Week, Bench Blunder, Trade of the Week, Cut of Shame, Heater, Cooler, etc.
- **Standings snapshot** — current divisional + all-play standings at the top.

This becomes the canonical "what happened last week, where do we stand, who's hot, who's not" page that owners read with their morning coffee on Tuesday.

## Why Tuesday?

- Sunday/Monday games complete by Monday night
- Score corrections and stat fixes settle by Tuesday morning
- Wednesday is roster-decision day for many owners (waivers, lineup tinkering ahead of TNF)
- Gives the article a 24-hour reading window before the next news cycle

## Routes

- `/theleague/power-rankings` — current week (defaults to most recent published)
- `/theleague/power-rankings/[year]/[week]` — permalink to historical issues
- Index: `/theleague/power-rankings` shows the latest plus a list of prior issues

Re-use the Schefter feed pattern — each issue is a JSON document on disk that the page reads.

## Data shape

`data/theleague/power-rankings/<year>-<week>.json`:

```json
{
  "year": 2026,
  "week": 5,
  "publishedAt": "2026-10-07T07:00:00-07:00",
  "headline": "Pigskins surge to #1, Vitside collapses",
  "lede": "One paragraph in Schefter's voice setting up the week.",
  "rankings": [
    {
      "rank": 1,
      "franchiseId": "0001",
      "previousRank": 3,
      "trend": "up",
      "blurb": "Three straight wins by 30+. The schedule eases. They're locked in.",
      "metrics": {
        "weekScore": 142.5,
        "regSeason": "4-1",
        "ppg": 128.4,
        "capHealth": "tight"
      }
    }
  ],
  "awards": {
    "statOfWeek":    { "franchiseId": "0008", "title": "Stat of the Week", "blurb": "..." },
    "benchBlunder":  { "franchiseId": "0014", "title": "Bench Blunder of the Week", "blurb": "..." },
    "tradeOfWeek":   { "franchiseId": "0011", "title": "Trade of the Week", "blurb": "..." },
    "cutOfShame":    { "franchiseId": "0006", "title": "Cut of Shame", "blurb": "..." },
    "heaterOfWeek":  { "franchiseId": "0007", "title": "Heater (Hot Streak)", "blurb": "..." },
    "coolerOfWeek":  { "franchiseId": "0015", "title": "Cooler (Cold Streak)", "blurb": "..." },
    "matchupOfWeek": { "title": "Matchup of the Week", "homeId": "0010", "awayId": "0012", "blurb": "..." }
  },
  "standings": {
    "divisions": [
      { "name": "Northwest", "teams": [/* franchiseId, w, l, ppg */] }
    ],
    "allPlay":   [/* same shape, sorted by all-play */]
  }
}
```

## Generation pipeline

`scripts/generate-power-rankings.mjs`:

1. **Inputs** — for the target `<year, week>`:
   - `data/theleague/mfl-feeds/<year>/weekly-results.json` (scores)
   - `data/theleague/mfl-feeds/<year>/weekly-results-raw.json` (matchup pairings — for matchup of the week, biggest blowout)
   - `data/theleague/mfl-feeds/<year>/standings.json` (records + all-play)
   - `data/theleague/mfl-feeds/<year>/transactions.json` (cuts, trades for award detection)
   - `data/theleague/derived/franchise-history.json` (career context for blurbs)
   - `data/theleague/mfl-player-salaries-<year>.json` (cap health, bench-blunder detection)
   - Live odds + projections if available for matchup-of-the-week pick

2. **Power ranking algorithm** — composite score per franchise:
   - 50%: rolling-3-week average points-for
   - 25%: record above .500
   - 15%: all-play % (luck-adjusted strength)
   - 10%: roster health (cap headroom + injury list)
   - Sort descending; record `previousRank` from the prior week's published JSON for trend arrows.

3. **Award detection** — deterministic signals from feeds:
   - **Stat of the Week**: highest single-game score across all 16 franchises this week
   - **Bench Blunder**: largest gap between (actual lineup score) and (optimal lineup) — needs `weekly-results-raw.json` `optimal` field which already exists
   - **Trade of the Week**: most lopsided trade (by salary delta + dynasty value) executed this week
   - **Cut of Shame**: highest-salary player cut to make a roster move (or biggest dead-money commit if accrued)
   - **Heater**: longest active winning streak with margin
   - **Cooler**: longest active losing streak; or biggest week-over-week ranking drop
   - **Matchup of the Week**: by current rankings (closest top-half matchup) — picked for the upcoming week

4. **Blurb generation** — call Claude API with system prompt that enforces the Schefter voice (mirror `data/schefter/league-lore.md`). Pass franchise context: career W-L, current streak, recent moves, roster age, cap health. Cap blurbs at one sentence each. Run a quality gate on the output (length, banned phrases, sanity check that no franchise name is invented).

5. **Output** — write JSON to `data/theleague/power-rankings/<year>-<week>.json` and append a Schefter feed post pointing at the article URL.

## Page

`src/pages/theleague/power-rankings/index.astro` (current week) and `[year]/[week].astro` (historical):

- **Hero** — issue headline, week number, published date, lede paragraph
- **Standings snapshot** — divisional table left, all-play table right
- **Power Rankings 1-16** — ordered cards with banner, rank number with trend arrow, one-sentence blurb, key metrics row. Click a card to jump to the franchise page.
- **Awards Grid** — 7 cards (Stat / Bench / Trade / Cut / Heater / Cooler / Matchup) with title, recipient banner + name, blurb.
- **Footer** — link to prior week, link to next-week stub if not yet published, "Sign up for GroupMe digest" CTA.

## Operational notes

- **GitHub Actions:** `.github/workflows/weekly-power-rankings.yml` — cron `0 14 * * 2` (UTC = 7 AM Pacific Tuesday) during NFL season. Runs `pnpm generate:power-rankings`, commits the new JSON to main, and posts a teaser to GroupMe via the existing schefter-groupme posting pattern.
- **Off-season:** skip generation. The cron can run year-round but `generate-power-rankings.mjs` should detect off-season weeks and exit cleanly.
- **Manual override:** `pnpm generate:power-rankings -- --year 2026 --week 5 --regenerate` for ad-hoc regens.

## GroupMe integration

When a new issue ships, post a digest to GroupMe:

> 🏈 **TheLeague Power Rankings — Week 5**
> #1 Pigskins (↑2) — *"Three straight wins by 30+."*
> 🏆 Stat of the Week: Bring The Pain dropped 178.4
> 💸 Cut of Shame: Music City eats $4.2M on a Day-1 cut
> Read the full breakdown ▸ https://www.theleague.us/power-rankings

## Phasing

| Phase | Scope | Effort |
|---|---|---|
| 1 | Generation script + JSON output + page renderer (no LLM blurbs yet — use templated strings). Manually triggered. | 1 day |
| 2 | Wire LLM blurbs through Claude API with quality gate. | 0.5 day |
| 3 | GH Action cron + GroupMe digest. | 0.5 day |
| 4 | Historical backfill — generate retroactive power rankings for past weeks of 2025+ (anything where we have all the source data). | 0.5 day |

## Open questions

- **Voice owner:** Claude Schefter (matches the existing news feed). Confirm with Brandon before shipping.
- **Tie-breakers in rankings:** if two teams have identical composite scores, rank by previous week's rank to minimize churn. OK?
- **Should award winners get a Schefter post too,** or only the article itself? Award posts could be too noisy.
- **Do we publish during playoff weeks** or pivot to bracket coverage? Probably the latter — playoff weeks get a "Bracket Watch" issue instead of standard rankings.
