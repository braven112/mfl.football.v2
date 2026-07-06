# Player Composite Imagery

## Context

Approved photo direction for the whole site (2026-07-04): identifiable NFL action
photography is rights-managed (Getty/AP/Imagn), so player imagery is built as
**CSS composites over free ESPN CDN headshots** — transparent PNGs layered on
team-color gradients with ghost typography. No licensed photos, fully automatic
per player.

## Key Files

| File | Role |
|------|------|
| `src/components/shared/PlayerHeroComposite.astro` | The composite banner (gradient + ghost wordmark + glow + headshot + position chip) |
| `src/utils/nfl-team-colors.ts` | 32-team primary/secondary hex map (ESPN codes), nickname helper, `hexToRgba` |
| `src/components/shared/SchefterPostCard.astro` | First integration — breaking-tier feed posts |
| `scripts/schefter-scan.mjs` | Attaches `playerIds` on TRADE / AUCTION_WON / FREE_AGENT posts at generation time |

## Insights

- **Transparency is the load-bearing requirement.** ESPN headshots
  (`a.espncdn.com/i/headshots/nfl/players/full/{espnId}.png`) are transparent;
  the MFL fallback (`player_photos_big_2014/{id}_thumb.jpg`) has a baked-in
  background and ruins the composite. Gate rendering on
  `headshot.includes('espncdn.com')` — never composite an MFL JPG.
- **DEF "players" are logos, not people** — always exclude `position === 'DEF'`
  from composites.
- `getPlayerMap()` (src/utils/player-map.ts) is the one-stop resolver:
  MFL ID → name/position/nflTeam/espnId/headshot, cached per year. It reads
  theleague's players.json but MFL player IDs are global, so it resolves AFL
  posts' players too.
- **`playerIds[0]` is the featured player** — the feed card composites only the
  first ID. Trade posts order IDs received-side-first so `[0]` matches the
  headline player. If `[0]` is a DEF, the composite is skipped even when `[1]`
  is a star (accepted edge case).
- **Feed posts bake MFL "Last, First" display strings** into headline/body
  (e.g. "RB Pacheco, Isiah"). Historical backfill matched those exact strings
  against players.json — deterministic, no fuzzy matching. Older posts predate
  `tradeSignature`, so text matching is the only reliable route.
- **Breaking-tier only, on purpose.** Minor FA adds with hero banners would be
  noise; if everything is breaking news, nothing is.
- The composite hides itself on image 404 via inline
  `onerror="this.closest('.phc').style.display='none'"` — a gradient-only
  banner with no player reads as broken.
- The preview-panel screenshot tool returned gray frames on the deeply-scrolled
  SSR feed; Playwright against the dev server captured fine (same finding as
  the What's New screenshot workflow in CLAUDE.md).

## Casting Rules (Brandon, 2026-07-04 — binding)

- **New features / What's New heroes cast a ROOKIE** — rookies represent "new."
- **Roster-action heroes (tags, cuts, contracts) cast a player from the
  signed-in owner's team** (the suggested candidate); guests get a relevant
  player from someone's team.
- **Every hero casts a semantically relevant player** — the actual player in a
  breaking story, never a random star for decoration.
- All casting goes through `src/utils/hero-casting.ts` (`castRookieModel`,
  `castEnhancementModel`, `castRosterModel`) — deterministic per PT day
  (stable SSR, daily rotation). Rookie = newest draft class ≤ the reference
  year present in the player map (`PlayerIdentity.draftYear`, added for this).
- **Per What's New category** (Brandon, 2026-07-04): new-page/new-feature →
  rookie (rostered-first; unrostered only when NO rookie is rostered);
  enhancement → rostered player in his first 5 NFL seasons (strict, no
  unrostered fallback; caption "Nth Year"); bug-fix → no player, league logo
  silhouette (`.fch__logo-art`, light/dark asset pair); league-event →
  relevant player (event-hero conversions pending). Category rides on
  `HeroContent.heroCategory`; the roster set unions salary data with
  `getRosteredPlayerIds()` (MFL rosters feed) so dev matches prod.

## Shipped Use Cases

1. **Fresh What's New homepage hero (first shipped)** —
   `src/components/theleague/FeatureCompositeHero.astro`, rendered by
   `SeasonDailyHero` when `phase === 'offseason-fallback'` and
   `fallbackHero.source === 'feature'` and a rookie model was cast
   (index.astro passes `featureModel`; casting failure falls back to the
   branded LeagueEventHero). NOT integrated on the Schefter feed — Brandon
   explicitly rejected feed-card composites (built, then reverted).
   Gotcha: set explicit `color` on text over the composite gradient — global
   heading rules (and `html.dark` accent overrides) restyle bare headings.
   The hero is theme-aware (light gradient by default, dark under `html.dark`)
   via `--fch-*` CSS vars; a What's New entry can force the dark treatment in
   light mode with `"heroTheme": "dark"` (plumbed WhatsNewEntry → HeroContent
   via `featureToHero`) — used when the dark card IS the story, e.g. the
   dark-mode launch entry. Hero copy (title/summary/CTA/date) is bottom-left,
   vertically centered; the model is named in a frosted caption bottom-right.

2. **Auction hero (March P0 window)** —
   `src/components/theleague/AuctionCompositeHero.astro`, rendered for
   `auction-preview`/`auction-live` when `castTopFreeAgentModel` resolves
   (index.astro passes `auctionModel`; legacy `AuctionHero` is the fallback,
   so its `randomHeroPlayer` decoration only survives as a defensive path).
   Model = highest-ranked AVAILABLE free agent by dynasty ADP
   (`getAdpRankedIds` in offseason-hero-data), top-5 daily rotation.
   Keeps the command-center essentials as a chip row (bid CTA + 4 links)
   instead of the shell's side panel. Amber money accent, theme-aware.
   Gotcha: deep FAs can have an `espn_id` whose headshot PNG still 404s
   (e.g. Robert Henry) — `onerror` swaps in the league-logo silhouette via
   `.ach--no-model` instead of leaving an empty flank. Can't be detected
   server-side without a HEAD request; deliberately not done in the SSR
   hot path.
   **Live state (Brandon, 2026-07-05):** the league logo IS the background
   art (`.ach__backdrop`, replaces the ghost AUCTION wordmark; the 404
   logo-art fallback is suppressed via `.ach--live` so logos never stack),
   and the model switches to **the player whose bid clock runs out first**
   (`castClosingAuctionModel` — min `anchorTimestamp` + MFL's 36h rule,
   falls through non-compositable players). Caption gains a gold high-bid
   line ("$760K high bid · ~14h left"); summary names the leading
   franchise. `loadActiveAuctions` now also runs during auction phases.
   ADP best-available remains the fallback when no auctions are live.

3. **Cut watch hero (Jun 1 → 3rd Sun Aug)** —
   `src/components/theleague/CutWatchCompositeHero.astro`, rendered for the
   `cut-watch` phase when `castRosterModel` resolves a bubble player from
   `cutWatchProps.overLimitTeams[].cutCandidates` (index.astro passes
   `cutWatchModel`; legacy CutWatchHero panel version is the fallback).
   First real use of the personalization rule: the signed-in owner's own
   suggested cut candidate models the hero (their chip reads "You +N");
   guests get a league-wide candidate. Keeps both tiers (blue planning /
   red urgency via `.cwh--urgent`), the personalized summary, a 3-metric
   row (teams over / cuts required / biggest contract at risk), and
   over-limit team chips via `chooseTeamName(…, 'short')`. Same
   headshot-404 → logo-silhouette fallback as the auction hero.

4. **Preseason/kickoff hero (FA close → NFL kickoff)** —
   `src/components/theleague/PreseasonCompositeHero.astro`. Casting rule
   (Brandon): the best (highest-projected) player STARTING IN THE EARLIEST
   GAME of the week — the season opener; signed-in owners with a player in
   that game see their own best player in it ("Your Kickoff Starter").
   Deterministic best via `castBestScoredModel` (no daily rotation).
   Data: new `nflSchedule` MFL feed (league-agnostic, added to
   fetch-mfl-feeds.mjs — current week's games + kickoff timestamps);
   `getKickoffGame` / `getKickoffGameCandidates` in offseason-hero-data.
   Summary names the opener matchup. Falls back to franchise headliners
   (`getFranchiseHeadliners`, top projected per franchise) when the
   schedule feed is missing, then to the legacy randomHeroPlayer hero.

5. **UDFA window hero (7 days after the rookie draft)** —
   `src/components/theleague/UdfaCompositeHero.astro`: FOUR side-by-side
   team-gradient panels (matchup-card style) showing the best rookies still
   on the board — `castRookiesOnBoard` walks dynasty ADP for unrostered
   current-class rookies. Green band underneath carries the pitch +
   Browse-free-agents CTA. Two Brandon requirements (2026-07-05):
   - **Team logo ALWAYS a background watermark** on every panel
     (`.udh__logo`, opacity ~0.16 behind the player), not just a 404
     fallback. A slow/missing photo never leaves an empty flank.
   - **404'd headshots must not cost a player.** The page casts EIGHT
     rookies (`count: 8`); four render, four are hidden spares. A post-load
     `<script>` (`settle()` on each cutout, re-runs on `astro:page-load`)
     keeps the first four whose photo actually loads, swaps spares in for
     404s, and renumbers the shown panels 1-4. Deep UDFA rookies with no
     ESPN photo (e.g. J'Mari Taylor, Robert Henry) get replaced by the next
     rookies down whose photos load. If <4 ever load, it shows the first
     four anyway (logos carry them).
   Router requires ≥2 resolvable rookies, else legacy UDFAHero (whose
   `randomHeroPlayer` decoration survives only as that fallback).

6. **Tagged Player Showcase hero (Feb 15 → auction start)** —
   `src/components/theleague/TaggedShowcaseCompositeHero.astro`: the UDFA board
   pattern pointed at the franchise tags. One team-gradient panel per tagged
   player (logo watermark + ESPN cutout), chipped with the tagging franchise's
   short name (`chooseTeamName(…, 'short')`) + position; green band reads
   "Franchise tags · {year}" / "{N} stars just came off the market". Same
   spare-swap script as UDFA (cast 8, show 4, swap 404s). Casting:
   `castShowcasePanels` (new `PanelModel` = `HeroModel` + `franchiseId`);
   index.astro pairs each panel's `franchiseId` with the short name. Router
   requires ≥2 resolvable panels, else the branded `TaggedPlayerShowcaseHero`.
   **Gotcha:** `enrichTaggedShowcase` builds `sleepercdn` thumbnails (baked
   backgrounds) for the legacy hero — the composite must re-resolve each player
   through `getPlayerMap` for the ESPN cutout, never reuse the prop headshot.

7. **Breaking-story hero (new high-priority state, <48h)** —
   `src/components/theleague/BreakingStoryHero.astro`: a fresh trade/auction
   bomb from the feed leads the homepage. Single composite (ghost team
   nickname, red BREAKING tag, relative-time eyebrow, headline + hot-take +
   "Read the full story" CTA — all from the post). Data:
   `getBreakingStoryPost` / pure `selectBreakingStory` (freshest breaking-tier
   post with `playerIds` within 48h); casting: `castStoryModel` (first
   compositable id — posts order received-side first). index.astro detects +
   casts the model BEFORE `resolveHeroState` and passes a boolean
   `hasBreakingStory` — **the resolver stays feed-free.**
   **Resolver placement:** the `breaking-story` P0 check sits below the
   "event happening now" states (trade-deadline, championship, auction, draft)
   and above regular-season non-live slots / playoffs / all offseason ambient
   states. **Critical guard:** it must NOT interrupt a live game, but
   `isGameLive` is a pure day/time window (Sun/Mon/Thu evenings) that returns
   true on OFFSEASON Sundays too — so defer only when
   `isGameLive(now) && (isRegularSeason(now) || isPlayoffPeriod(now))`. A bare
   `!isGameLive` guard silently kills the hero every summer Sunday.

8. **In-season daily-rotation composites** —
   - Recap slot → `season-heroes/RecapCompositeHero.astro`: the week's top
     ACTUAL scorer (`getWeekTopScorerCandidates` reads the highest week in the
     `playerScores` feed; `castBestScoredModel` picks the best compositable),
     points stat + rostering-franchise name; falls back to the article
     `RecapHero`.
   - Game-day-preview slot → `season-heroes/MatchupSplitHero.astro`: the
     marquee game (`getMarqueeGameStars` = the earliest game of the week, same
     spine as the kickoff hero) as a split matchup card — each side's top
     projected star on its team gradient, away cutout mirrored `scaleX(-1)`
     toward a center VS; falls back to `MatchupPreviewHero`.
   Both self-load feeds + cast internally (matching the other season heroes'
   convention). **testDate caveat:** `getCurrentSeasonYear` is env/rollover
   pinned and largely ignores the testDate (e.g. a 2026-10 testDate resolves
   season year 2027), so the phase (date-driven) and the data year (env-driven)
   can diverge — a recap slot can show with no top scorer because the resolved
   season's `playerScores` is empty. That's correct production behavior (the
   real season's feed fills weekly); it just means verifying these two against
   frozen/seeded data requires picking a testDate whose `getCurrentSeasonYear`
   lands on a populated feed year (2025-10-07 → season year 2026).

## Wave 2 — remaining offseason + in-season heroes (shipped)

Seven more heroes migrated via parallel background tasks (each a self-contained
component that self-loads + casts internally + falls back to its legacy hero;
new data helpers live in `src/utils/hero-data/<hero>-data.ts` with fixture
tests). All theme-aware, headshot-404 fallback, reduced-motion, tabular-nums —
mirroring `RecapCompositeHero`. Wired in `SeasonDailyHero.astro`.

| Component | Phase/slot | Model | New helper |
|---|---|---|---|
| `DraftCompositeHero` (`.dch`) | draft-announced/live | #1 rookie prospect (ADP); live = most-recent pick | `draft-hero-data.getMostRecentDraftPick` |
| `ChampionCompositeHero` (`.cch`) | champion-crowned | champion's title-game top scorer (gold accent) | `champion-hero-data.getChampionshipWeekTopScorer` |
| `TagWindowCompositeHero` (`.twh`) | tag-window | expiring-contract star (`contractYear==='4'`), yours when signed in | `tag-hero-data.getExpiringContractStars` |
| `StandingsCompositeHero` (`.sch`) | standings slot | #1 team's headliner (yours when signed in) | `standings-hero-data.getStandingsRanking` |
| `WaiverCompositeHero` (`.wch`) | waiver-wire slot | top available FA add (ADP) | none (composes `castTopFreeAgentModel`) |
| `ArticleCompositeHero` (`.ach-hero`) | article slot (waiver-pickup) | the article's own player (`playerIds`) | `article-hero-data.selectWaiverPickupArticle` |
| `WeekendPreviewCompositeHero` (`.wph`) | article slot (Friday) | marquee weekend star (single best of the opener) | none (reuses `getMarqueeGameStars`) |
| `TradeDeadlineCompositeHero` (`.tdch`) | trade-deadline (P0++) | biggest name on the block (proj), + live countdown chip | `trade-block-data.getTradeBlockStars` |
| `LeagueEventCompositeHero` (`.lech`) | offseason-fallback event | player per event accent→category (FA/rookie/marquee, else none) | `league-event-cast` (accent→strategy) |

Gotchas found:
- **Draft can't be triggered by `?testDate`** once the current league year's draft
  is complete (`isDraftHeroPeriod && !draftComplete` gates it) — verify via a
  temp isolated page or a year whose draft is in progress.
- **`getCurrentSeasonYear` is env/rollover-pinned** and largely ignores the
  testDate, so a slot hero's PHASE (date-driven) and DATA year (env-driven) can
  diverge; standings/recap degrade gracefully (rank instead of a bogus record).
- **Waiver/article can render faceless** when the top-ADP FA's or article
  player's ESPN photo 404s (server-undetectable) → league-logo silhouette
  (same as auction). A UDFA-style spare-swap client script is the optional fix.
- **Article composite** only lights up when a waiver-pickup post carries
  `playerIds`; otherwise it falls back to the legacy `ArticleHero`.
- **`LeagueEventView` has no category field** — the event→player mapping
  reverse-maps `eventView.accent` against `CATEGORY_ACCENT`. Only
  free-agency/draft/preseason accents cast a player; everything else (incl.
  bespoke feature/default accents) renders the branded `LeagueEventHero`. In
  practice the ambient phases blanket the calendar, so this fallback-of-a-
  fallback rarely renders — verify it via a temp isolated page, not a testDate.
- **Trade-deadline countdown uses the real client clock**, not the SSR
  `testDate` — so a testDate screenshot shows a nonsense "3157h left"; on the
  actual deadline day it reads a correct "Xh Ym". SSR only drives the casting.

Full migration program (both leagues, all waves) tracked in
[composite-hero-migration-rollout.md](composite-hero-migration-rollout.md).

## Playoff round heroes (shipped 2026-07-05)

The playoff standings slot is no longer one static bracket — it's **three
round-shaped composite heroes** that escalate as the bracket narrows. Which one
shows is chosen from bracket completion, not a hardcoded week:

| Round | Week | Component | Shape |
|-------|------|-----------|-------|
| Wild Card | 15 | `WildCardHero.astro` | 3 game cards (per-team projected total) + the round's **highest-projected team's** headliner as the crested composite |
| Semifinals | 16 | `SemifinalHero.astro` | one hero, **both games / four players** — two franchise-colored pairs split by a seam, a Proj/Record stat row under each |
| Championship | 17 | `ChampionshipHero.astro` | 2-up dark-gold spotlight + trophy + full comparison table (seed · record · points-for · proj) |

**Data layer** — `src/utils/hero-data/playoff-round-data.ts`:
- `assembleRoundView(bracketSummary, deps)` is **pure** (deps injected) — picks
  the current round (earliest round week with an unplayed game; else the final
  round lingers), classifies it by game count (3+ → wild-card, 2 → semifinals,
  1 → championship), resolves each team, and for wild-card selects the featured
  team (highest projected with a compositable headliner). 12 unit tests in
  `tests/playoff-round-data.test.ts`.
- `buildPlayoffRoundView(...)` is the SSR wrapper that gathers deps from the
  feeds/config. Projected total = each franchise's **top-9 rostered
  projections** (`getFranchiseProjectedTotals` in `offseason-hero-data.ts`,
  TheLeague starts 9); record + points-for from the standings feed.

**Wiring** — `index.astro` runs the bracket block for `phase === 'playoffs'`
**and** `phase === 'championship'` (standings slot), builds `roundView`, and
hangs it on `playoffProps.roundView`. `SeasonDailyHero` renders
`PlayoffRoundHero` (dispatcher) when the view is present, falling back to the
legacy `PlayoffBracketHero` list, then to `StandingsCompositeHero`.

**Styling** — one global sheet `src/styles/playoff-round-hero.css` (`--prh-*`
tokens, plain `html.dark`, never `:global()` since it's not a scoped block). The
composite panels + player cutouts are inherently dark in both themes; only the
outer chrome (surface, cards, stat rows, ink) re-tokenizes. The championship
keeps its dark-gold spotlight in **both** themes on purpose.

**Casting rule:** playoff teams are franchise-branded (crest + team color), never
NFL-logo'd — the hero is about the fantasy matchup, and the teams are rostered by
definition. Signed-in owner's game gets an accent ring; the featured wild-card
face is whoever projects highest that week (guests and owners see the same slate).

## Future Directions (mocked, not built)

Cut-watch urgent hero already ships (see #3); remaining mock ideas: compact
spotlight card, and a personalized matchup split (the user's own game rather
than the marquee). Mockups: scratchpad `hero-explorations.html` from the
2026-07-04 session. This work sits on the dark-mode branch
(claude/stoic-gauss-85d450 base).
