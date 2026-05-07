# Schedule Strength Dashboard

## Context

Brandon wants a single page that shows **remaining-schedule difficulty for every franchise**, updated weekly. The point: see at a glance who has the easy run-in to the playoffs and who has a buzz-saw ahead of them. This is read-only analytics, not interactive — like the standings page, refreshes once per week.

## Route

`/theleague/schedule-strength` — single page, current season, current week.

Year selector for past seasons (read-only historical strength once known).

## Data sources

All on disk:

- `data/theleague/mfl-feeds/<year>/schedule.json` — per-week H2H pairings (just backfilled across all 20 years)
- `data/theleague/mfl-feeds/<year>/weekly-results.json` — completed weeks' actual scores
- `data/theleague/mfl-feeds/<year>/standings.json` — current records
- `data/theleague/derived/franchise-history.json` — multi-year ppg, optionally factor in opponent rolling form
- `data/theleague/mfl-feeds/<year>/projectedScores.json` — MFL projections (forward-looking)

## Three views to surface

### 1. Remaining-schedule strength (the headline)

For each franchise, compute the **average opponent strength** over their remaining weeks.

Opponent strength = composite of:
- 50% opponent's current points-per-game (this season)
- 25% opponent's all-play record (luck-adjusted)
- 25% opponent's last-3-week rolling ppg (recent form)

Output is a per-franchise score on a 0-100 scale (or rendered as a difficulty rating: ★ to ★★★★★). Rank franchises by remaining-schedule difficulty.

### 2. Past schedule strength (already-known)

Same composite but applied to the **already-played** weeks. Shows who had a friendly run-in vs who was in a meat grinder. This explains why a 3-5 team might actually be one of the better squads in the league.

### 3. Week-by-week heat map

Grid: 16 franchises × remaining weeks. Each cell = the opponent's difficulty rating for that week, color-coded green (easy) → red (brutal). Lets owners scan their own row to see which weeks to lock in their best lineups for.

## Page structure

```
Hero
  Title: "Schedule Strength · Week 5 · 2026"
  Subhead: How hard is the rest of the season for each team?

Section 1: "The Run-In" (remaining-schedule rankings)
  Table: rank | franchise | remaining ppg-avg | difficulty | trend (vs last week)
  Easy on top, brutal on bottom (or invert — TBD with Brandon)

Section 2: "What They've Been Through" (past-schedule strength)
  Same table shape, applied to weeks already played
  Highlight the 3 franchises with the biggest gap between their record and their schedule strength
    e.g. "Pigskins are 5-0 with the easiest schedule" or "Bring The Pain are 1-4 against the hardest"

Section 3: Week-by-week heat map
  16 rows × N columns (one per remaining week)
  Color: green (easy) → yellow → red (brutal)
  Click a cell → opponent's franchise page

Section 4: "Soft spots" — single-week heat map of league-average difficulty
  Identifies "trap weeks" where multiple top teams have hard matchups simultaneously
```

## Generation pipeline

`scripts/compute-schedule-strength.mjs` runs in prebuild + after each weekly roster sync:

1. Load schedule.json + standings.json + weekly-results.json for current year
2. For each franchise:
   - Get remaining weeks' opponents from schedule.json
   - Compute opponent composite strength (ppg + all-play + rolling form)
   - Average across remaining weeks → difficulty score
   - Same calculation for played weeks → past difficulty
   - Generate heat-map row of per-week difficulties
3. Write `data/theleague/derived/schedule-strength-<year>-<week>.json`
4. Page reads the latest file

## Cadence

- Update Tuesday morning (same as the weekly power rankings — both depend on settled stats)
- Backfill historical: for any past completed season, generate the final schedule-strength data once and cache forever

## Phasing

| Phase | Scope | Effort |
|---|---|---|
| 1 | Composite-strength algorithm + remaining-schedule ranked table (sections 1 + 2). | 1 day |
| 2 | Week-by-week heat map (section 3) | 0.5 day |
| 3 | Trap-week aggregate (section 4) + tooltip details | 0.5 day |
| 4 | Year selector + historical backfill | 0.5 day |

## Open questions

- **Is "difficulty" easy-on-top or hard-on-top?** UX-wise easy-on-top is more legible (the team in front is the cushy one). Hard-on-top reads more like a ranking.
- **Strength composite weights** — those are first-pass guesses. Worth tuning against historical seasons (does our model predict actual outcomes for 2025?).
- **How much does projection data help?** If MFL's projectedScores has next-week numbers, we could blend in projection-based strength too. Worth A/B testing.
- **Visibility:** public to all owners or admin-only? Probably public — competitive intel that owners can act on.
