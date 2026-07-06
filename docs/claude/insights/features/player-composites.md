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
| `src/components/theleague/*CompositeHero.astro` | Per-phase composite heroes; each owns its gradient + ghost wordmark + glow + headshot + chip. (An early single-banner prototype, `PlayerHeroComposite.astro`, was removed unused — the heroes don't share a base component.) |
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

6. **AFL homepage hero — full parity (2026-07-05)** — the AFL composites
   through the EXISTING unified `AflEventHero`, NOT per-phase components like
   TheLeague. `EventHeroView` gained an optional `model` field; the resolver
   stays fs-free — the homepage (`src/pages/afl-fantasy/index.astro`) attaches
   the model post-resolve via `castAflHeroModel`
   (`src/utils/afl-hero-casting.ts`). Casting map:
   - keeper deadline → `castRosterModel` over franchise headliners
     ("Keeper Cornerstone", owner-personalized)
   - AL/NL draft → `castTopFreeAgentModel` over AFL dynasty ADP
     ("Best Available" — AFL drafts rookies AND veterans, so best-available
     is the board's top, not a rookie)
   - trade window → NEW `getTradeBaitCandidates` ("On the Block"). Gotcha:
     the synced tradeBait.json is a FLAT ARRAY of player ids; ownership is
     derived from the rosters feed
   - season-start + game-day + live slots → `castRandomStarterModel` over
     `getKickoffGameCandidates` ("Kickoff Starter" / "In Action")
   - waivers → best available ("Top Target")
   - recap → NEW `getWeeklyTopScorerCandidates` + `castBestScoredModel`
     ("Top Scorer" — deterministic, no rotation; the week's top scorer IS
     the story)
   - standings slot → the standings leader's headliner ("Leading the Race";
     leader computed in index.astro from `h2hwlt`)
   - feature / new-season → `castRookieModel`.
   Everything falls back to the franchise-headliner pool, then to the legacy
   webp art (`model: null`). Data plumbing: the `offseason-hero-data.ts`
   helpers are now league-parameterized via the league registry `dataPath`
   (`CanonicalLeagueSlug` param, default `'theleague'` so TheLeague call
   sites are untouched). `getPlayerMap` stays theleague-sourced on purpose —
   MFL player ids are global.
   404 handling differs from the TheLeague heroes: `onerror` adds
   `.afl-event-hero--no-model` on the section, which hides cutout+caption
   and reveals a theme-paired AFL logo silhouette
   (`/assets/logos/afl-logo.svg` + `afl-logo-dark.svg`) — the flank never
   sits empty and the card text is unaffected.
   Bespoke phases (trade-deadline day, active playoffs, championship) never
   composite — their components own the visual.
   **Dead-projections gotcha (found by the verify sweep, fixed):** a league
   year whose projectedScores feed is empty (post-season Feb–May, before the
   AFL's June 1 rollover) plus salary-less rosters made
   `getFranchiseHeadliners`' old score→salary→lowest-id tie-break pick every
   franchise's team DEF (lowest MFL ids) — all rejected by `isCompositable`,
   so headliner-cast states silently fell back to the webp. Fix: headliners
   now EXCLUDE DEF outright and tie-break score→salary→dynasty-ADP-rank→id,
   so the pick stays a real headliner year-round. Regression-locked by
   `tests/afl-hero-casting.test.ts` against the frozen AFL 2025 feeds.

## In-season article hero — casts the graded player (2026-07-05, Brandon)

The Schefter article hero (`season-heroes/ArticleHero.astro`, also the Friday
`WeekendPreviewHero` which is a thin wrapper) now features **a player the
article actually highlights**, not a stock face. Two halves:

1. **Generator plumbing → `heroPlayerId`.** New optional field on
   `SchefterPost` (`src/types/schefter.ts`). The article generators pick it
   deterministically from the players they already grade — no AI, no random —
   via the shared `scripts/article-utils/hero-player.mjs#pickHeroPlayer`:
   - `waiver-pickups.mjs` → biggest single **bid**.
   - `weekend-preview.mjs` → highest **projected** rostered player (the marquee).
   - `pickHeroPlayer(candidates, playerMeta)` prefers non-DEF, then players with
     an `espn_id` (a real cutout), then highest score, ties → ascending id
     (stable). Falls through to the top-ranked player even when none are
     compositable, so `heroPlayerId` always names the genuinely-featured player
     and the hero degrades to the team logo rather than picking someone else.
   `buildPost` spreads `{ heroPlayerId, playerIds:[heroPlayerId] }` only when set.
   (Weekly recap = the sibling session's territory — "recap = week's top
   scorer" — left untouched here to avoid collision.)

2. **Render → `castArticleModel`.** New caster in `hero-casting.ts`:
   `castArticleModel(heroPlayerId, players, descriptor)` — **deterministic, no
   daily rotation** (the post already named its hero). Resolves the id through
   `getPlayerMap`; returns null (→ classic image/text card) only when the id is
   absent or unknown. Unlike the other casters it does NOT gate on
   compositability: a resolved DEF / no-cutout player still composites, with
   his **team logo as the art** (`heroModelHasCutout` decides cutout vs logo) —
   swapping in a different player's face would betray the story. ArticleHero
   renders the FeatureComposite language (team-gradient surface, team-color
   glow, ESPN cutout bleeding right, frosted `name · descriptor · pos · team`
   caption) when a model casts, else the original card — so **old posts with no
   `heroPlayerId` never regress**. Descriptor is derived from the article type
   (`Top Pickup` / `One to Watch` / `In the Spotlight`).

Traps hit:
- **404 fallback differs from the offseason heroes.** Those hide the whole
  banner on image error; the article hero instead swaps the cutout for the
  **team logo** (`.ahc__model-fallback`, `/assets/nfl-logos/{CODE}.svg`) — the
  card still carries text, so a missing photo shouldn't blank the flank.
- **Theme resolves via `html.dark`, not `prefers-color-scheme`** — the preview
  tool's `colorScheme` emulation does nothing; add the class (or set the cookie)
  to verify dark. Scoped-`<style>` `:global(html.dark)` is correct here.
- Worktree branched off `mystifying-bun` (#342 + the sibling's in-season hero
  infra) since none of the composite engine is on main yet.

## Future Directions (mocked, not built)

Breaking-story hero (48h window, high priority — playerIds plumbing already
done), cut-watch urgent hero (priciest cut candidate via `castRosterModel`),
tagged-showcase panels (per-tag team-gradient panels), split matchup card,
compact spotlight card. Mockups: scratchpad `hero-explorations.html` from the
2026-07-04 session. This work sits on the dark-mode branch
(claude/stoic-gauss-85d450 base).
