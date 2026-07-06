# Composite Hero Migration — Rollout Tracker

Goal: migrate **every** homepage hero to the ESPN-headshot + team-color composite
treatment, both leagues. One background task per hero; each builds a
self-contained component (self-loads data, casts internally, internal legacy
fallback), verifies with a light+dark screenshot, and reports back. The
orchestrator does the central route wiring in `SeasonDailyHero.astro` /
`AflHero.astro` as each lands.

Decisions (Brandon, this session): **all hero groups**, **both leagues**,
**self-contained components + central wiring**, **personalized when signed in**.

## Conflict-avoidance contract (every task)
- No edits to shared files: `SeasonDailyHero.astro`, `index.astro`,
  `offseason-hero-data.ts`, `hero-casting.ts`, `hero-resolver.ts`.
- New helpers go in NEW co-located files (`src/utils/hero-data/<hero>-data.ts`)
  with fixture tests. Existing casters/helpers are import-only.
- Don't manage the dev server (running at :50557) or run the full suite.
- Verify via a TEMP isolated page (`ztest-<hero>.astro`) → screenshot → delete.

## Casting map (from investigation)
| Hero | Model | Data source | New helper |
|---|---|---|---|
| Draft (announced/live) + Draft-countdown | #1 rookie prospect; live = most-recent pick | `draftResults.json`, ADP | `getMostRecentDraftPick` |
| Champion-crowned | champion's top scorer in the title game | `getChampionshipResult` + `getWeekTopScorerCandidates` | `getChampionshipWeekTopScorer` |
| Tag-window | expiring-contract star (yours when signed in) | `rosters.json` contractYear==="4" | `getExpiringContractStars` |
| Standings slot | #1 team's headliner (yours when signed in) | `standings.json` + `getFranchiseHeadliners` | `getStandingsRanking` |
| Waiver-wire slot | top available FA add | `getAdpRankedIds`+`getRosteredPlayerIds`+`castTopFreeAgentModel` | none |
| Article slot | the article's own player | `schefter-feed.json` playerIds + `castStoryModel` | none (article-select helper) |
| Weekend-preview slot | marquee weekend star | `getMarqueeGameStars` | none |
| Trade-deadline (React) | biggest name on the block | `tradeBait-by-franchise.json` | `getTradeBlockStars` |
| LeagueEventHero/HeroBanner | relevant player per event, else logo | event → playerIds/ADP | TBD |
| LiveScoring/PlayoffBracket (React) | small player face (TBD) | live-scoring / bracket | TBD |

## Waves
- **Wave 1 (TheLeague, clean):** Draft, Champion, Tag, Standings, Waiver, Article, Weekend-preview.
- **Wave 2 (TheLeague, tricky):** LeagueEvent/HeroBanner events, TradeDeadline, LiveScoring/PlayoffBracket faces.
- **Wave 3 (AFL):** groundwork (league-aware `getPlayerMap`/data loaders reading `data/afl-fantasy/mfl-feeds/`), then AFL composites: conference-draft, champion-crowned, championship, keeper-deadline, + in-season slots. AFL has NO auction/tag/tagged/UDFA/cut-watch.

## AFL notes (from investigation)
- Separate resolver `src/utils/afl-hero-resolver.ts` + router `src/components/afl/AflHero.astro`.
- `offseason-hero-data.ts` + `getPlayerMap` are hardcoded to `data/theleague/` — need a league param before AFL composites can self-load AFL feeds.
- No global `html[data-league]` accent mechanism today; AFL components hardcode `var(--color-primary,#c41e3a)`. Composite heroes should accept accent via CSS var / prop.
