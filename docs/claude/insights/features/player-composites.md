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

## Casting Rules (Brandon, 2026-07-04 — binding; feature rule revised 2026-07-06)

- **What's New heroes show the FEATURE ITSELF** (Brandon, 2026-07-06,
  superseding the rookie rule): the entry's screenshot in a browser frame
  (light/dark capture pair, `-dark` suffix). A player is cast ONLY when the
  entry names one via `heroPlayerId` (`castFeaturedModel`, descriptor from
  `heroPlayerDescriptor`, default "Featured") — players show up when they're
  being talked about, never as stand-ins. Rookies no longer model "new".
  Art precedence: `heroArt` → featured player → screenshot → league logo
  silhouette. The screenshot is hidden on mobile (unreadable at phone width
  = decoration) — the logo silhouette stands in there.
- **Roster-action heroes (tags, cuts, contracts) cast a player from the
  signed-in owner's team** (the suggested candidate); guests get a relevant
  player from someone's team.
- **Every hero casts a semantically relevant player** — the actual player in a
  breaking story, never a random star for decoration.
- All casting goes through `src/utils/hero-casting.ts` — rotating casters are
  deterministic per PT day (stable SSR, daily rotation); `castFeaturedModel`
  and `castArticleModel` are deterministic by id. `castRookieModel` survives
  for season-reset heroes only (AFL `afl-new-season-starts`); the enhancement
  caster was removed with the feature-rule revision.
- Bug-fix rollups and screenshot-less entries → no player, league logo
  silhouette (`.fch__logo-art` / `.fch__shot-logo`, light/dark asset pair).

## Shipped Use Cases

1. **Fresh What's New homepage hero (first shipped)** —
   `src/components/theleague/FeatureCompositeHero.astro`, rendered by
   `SeasonDailyHero` when `phase === 'offseason-fallback'` and
   `fallbackHero.source === 'feature'` (index.astro passes `featureModel`,
   cast only from the entry's `heroPlayerId`; without one the hero shows the
   entry's screenshot). NOT integrated on the Schefter feed — Brandon
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
   - new-season → `castRookieModel`; feature → `castFeaturedModel` from the
     entry's `heroPlayerId` ONLY (no headliner fallback — the feature's own
     screenshot is the art, rendered by `AflEventHero`'s browser frame from
     `EventHeroView.screenshot`; the random `player` webp remains the last
     resort for capture-less entries).
   Everything else falls back to the franchise-headliner pool, then to the
   legacy webp art (`model: null`). Data plumbing: the `offseason-hero-data.ts`
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
- Built while the composite engine was still branch-only (worktree stacked on
  `mystifying-bun`); the base landed on `main` mid-session via #346, and this
  work was rebased onto `main` after — the engine IS on main now.

## Tagged-showcase panels — the tag board (shipped 2026-07-06)

7. **Tagged-showcase hero (Feb 15 → auction start)** —
   `src/components/theleague/TaggedShowcaseCompositeHero.astro`: the UDFA board's
   twin, one team-gradient panel per franchise-tagged player. Same trading-card
   panels, same eight-cast / four-show spare-swap resilience script, same
   theme-aware green band (light `--color-surface` band by default, dark
   `#0b0e12` under `:global(html.dark)`). Router (`SeasonDailyHero`) renders the
   composite when `showcasePanels.length >= 2`, else the legacy
   `TaggedPlayerShowcaseHero` (which also owns the no-tags empty state).

   **What's different from UDFA (deliberate):**
   - **Watermark is the FRANCHISE crest, not the NFL team logo.** A franchise
     tag is a fantasy-team story, so the tagging team's mark sits behind the
     player. `franchiseCrest` (the config `icon` src) is passed per panel;
     `.tsh__crest` renders it `object-fit: contain` at ~0.16 opacity. NFL colors
     still drive the gradient/glow (`getNflTeamColors(normalizeTeamCode(...))`).
   - Chip is `{franchiseName} · {position}` (franchise short name via
     `chooseTeamName(..., 'short')`), not a rank. A green "Tagged" pill sits
     top-right on every panel.

   **Casting** — `castShowcasePanels(candidates, players, count=8, descriptor='Tagged')`
   in `hero-casting.ts` returns `PanelModel[]` (`HeroModel` + `franchiseId`).
   DETERMINISTIC, no daily rotation — the tag list is the tag list, rendered in
   filed order (every tagged player is the story, not a rotating pick). Drops
   DEF and MFL-JPG-only players like the other casters.

   **The headshot trap that shaped the whole design:**
   `taggedShowcaseProps.taggedPlayers[].headshot` is a **Sleeper CDN JPG**
   (`sleepercdn.com/.../thumb/{id}.jpg`) — a baked-background photo that
   `isCompositable` rejects. So the panels CANNOT reuse the props' headshot;
   casting must resolve each player through `getPlayerMap` (ESPN cutout) exactly
   like every other composite. `index.astro` builds candidates as
   `{playerId, franchiseId}` from the props, casts through `hpPlayerIdentityMap`,
   then re-attaches the franchise chip name + crest by looking up `franchiseId`
   in `teamConfigs` (league config). The tagging franchise metadata lives in the
   props; the compositable face lives in the player map — join them in the page.

   **Wiring re-integration:** a prior implementation existed on
   `claude/vigorous-montalcini-ccb1a0` but was based far behind main. Brought the
   NEW component + `castShowcasePanels` wholesale; re-applied the four wiring
   edits (import, prop, destructure, route) onto main's current
   `index.astro`/`SeasonDailyHero.astro`. The old branch's component used the NFL
   logo watermark and a fixed dark band — updated to the franchise crest + the
   current theme-aware band. Verified via `?testDate=2026-02-20` seed (six
   `FRANCHISE_TAG` txns) in light + dark + mobile; seed reverted with
   `git checkout`.

## Player modal mini-hero bands (shipped 2026-07-06)

The three player modals (`PlayerDetailsModal`, `PlayerInjuryModal`,
`PlayerNewsModal`) replaced their plain headers with compact composite bands
— gradient + ghost wordmark + glow + cutout at modal-header height. What's
different from every other composite, and why:

- **These composites are painted CLIENT-SIDE, not SSR'd.** The modals are
  empty shells populated at open time via `window.openPlayer*Modal(data)`,
  so the band logic lives in a shared client util
  (`src/utils/player-modal-band.ts#applyPlayerModalBand` +
  `src/styles/player-modal-band.css`, `.pmb` prefix). It enforces the same
  three hard rules as the SSR casters (espncdn-only cutouts, DEF excluded,
  404 → gradient-only). `nfl-team-colors.ts` and `nfl-logo.ts` are safe to
  import from Astro `<script>` blocks — no node built-ins.
- **Re-open reset ordering matters.** Clear `pmb--no-cutout` and the
  cutout's `display` BEFORE setting `src`; `onerror` re-adds them. Done the
  other way, one 404'd player leaves every later player's cutout hidden.
- **The injury button rides the details modal's JSON.** Injury indicators
  render inside the `[data-player-modal]` name element (both the SSR
  PlayerCell path and `buildPlayerCellHTML`), so
  `btn.closest('[data-player-modal]')` recovers team/position/espnId for
  the band with zero new data attributes.
- **The row avatar's live `src` is the right compositability input.**
  rosters' `extractPlayerDataFromRow` reads `imgEl.src` — if PlayerCell's
  onerror already swapped it to the MFL JPG, the espncdn gate correctly
  falls back to gradient-only. Don't "fix" it to re-derive from espnId.
- **The band is dark in BOTH themes** (team colors are the surface), so
  there are no `html.dark` overrides — ink is always explicit white
  (the composite-gradient heading gotcha applies here too).
- `PlayerNewsModal` is currently orphaned (no page imports it) — it got the
  standard band for consistency but can't be browser-verified until a page
  mounts it.
- Injury modal note: the offseason feed has no `injuryStatus` players, so
  the click path can't be exercised live off-season — verify by calling
  `window.openPlayerInjuryModal({...})` with the enriched payload shape.
- **A team defense gets a FACE, not a bare crest (2026-07-07).** `DEF` is
  excluded from the generic cutout rule above, but `PlayerDetailsModal`
  now opts back in for team defenses: after `applyPlayerModalBand()` leaves
  the band gradient-only, it looks up `getDefSpotlightPlayer(teamCode)`
  (`src/data/theleague/def-spotlight-players.ts` — the top of the SAME ranked
  pool the Free Agents hero spotlight uses) and paints that defender's ESPN
  headshot as the cutout, with his name · position in the sub-line. Static on
  purpose — Brandon: the modal must NOT rotate faces the way the hero
  spotlight does; lead with the top defender and hold it. There's no timer to
  clear; the offensive path reclaims the cutout via `applyPlayerModalBand` on
  the next open. The cutout stays `aria-hidden` + `alt=""` (decorative) — the
  defender's name rides the sub-line as real text for screen readers.
- **`getDefSpotlightPlayers` key gotcha: Washington is `WAS`, not `WSH`.**
  The spotlight JSON is keyed by players.astro's `normalizeMflTeam` (GBP→GB,
  JAC→JAX, but Washington stays `WAS`). Both `nfl-logo.ts#normalizeTeamCode`
  AND the modal's inline normalizer map `WAS→WSH`, so looking the pool up by
  the normalized code silently misses Washington. Map `WSH→WAS` right before
  the lookup (`teamCode === 'WSH' ? 'WAS' : teamCode`). Every other team code
  matches between the two normalizations.

## Desktop `AflEventHero` cutout — WIDTH drives the scale, not max-height (2026-07-07)

Enlarging the `model` cutout on the AFL event hero ("make the player bigger,
head above the headline") is a two-line change on `.afl-event-hero__cutout`,
but which property to touch is non-obvious:

- The cutout is `object-fit: contain; object-position: bottom` over a
  **landscape** ESPN frame, so the RENDERED size is almost always
  width-bound: `width: clamp(230px, 34vw, 440px)` at desktop widths fits
  inside `max-height` with room to spare (measured 435×316 in a 384px-tall
  card). Bumping `max-height` alone does nothing — grow the **width clamp**
  to scale the player up.
- To let the head rise **above the vertically-centered headline**, set
  `max-height` > 100% (132%) so a taller-than-card cutout can extend past the
  top edge; the section's `overflow: hidden` trims the overshoot cleanly. The
  cutout stays `bottom: 0` anchored, so all the extra height goes upward.
- Push it flush to the right with a negative `right`
  (`clamp(-1rem, -0.5vw, 0.25rem)`) — the same `overflow: hidden` trims the
  overhang. Widen the parent `.afl-event-hero__model` box to match so it
  isn't the constraint.
- The `@media (max-width: 640px)` block hard-codes its own `width`/`right`,
  so desktop changes here don't touch mobile — verify the phone viewport
  separately (it reads the mobile override, not these clamps).

## Mobile cutout layout — portrait cover-crop, not width/height auto (2026-07-06)

Fixed on `FeatureCompositeHero` + `BreakingStoryHero`; the other composite
heroes' mobile blocks still use the old ghosted-overlap pattern and should
adopt this when touched.

- **ESPN `full` cutouts are LANDSCAPE frames (350×254) with the player
  centered.** On a phone card, `height: 90%; width: auto` makes the frame
  span nearly the whole card and parks the face mid-card — directly under
  the text. Don't size the element by the frame; size it as a **portrait box
  anchored bottom-right with a cover crop**:
  `width: 44%; height: 90%; right: 0; bottom: 0; object-fit: cover;
  object-position: 50% top;` — the face keeps its full height, the shoulders
  crop at the box edges.
- **Mask the crop line:** `mask-image: linear-gradient(90deg, transparent 0%,
  #000 22%)` (+ `-webkit-` prefix) fades the left edge into the gradient so
  no hard rectangle shows. With the mask doing the blending, drop the old
  `opacity: 0.4`-style ghosting — full opacity reads intentional.
- **Constrain the text column instead of letting it overlap:** cap
  `__content` at ~62% (66% under 400px, where the model box narrows to 38%).
  The cover crop means ceding width trims shoulder, not face size.
- Verified with Playwright at 412/360px, both themes. The sandbox blocks
  `espncdn.com` — route-fulfill the request with a synthetic 350×254
  transparent PNG (sharp + inline SVG) to test real geometry.

## Rendering BreakingStoryHero in dev (verification recipe, 2026-07-06)

Three traps, all hit in one session:

1. **Phase priority:** breaking-story is P0 but sits BELOW trade-deadline /
   championship / auction / draft windows — a `?testDate` in March (where all
   the real breaking posts live) renders the auction hero instead. Seed a
   clone of a real breaking post with a fresh timestamp into
   `schefter-feed.json` and use an offseason testDate; revert with
   `git checkout` after capture.
2. **The feed is a STATIC import in `index.astro`** (`import feedData from
   '...schefter-feed.json'`) — editing the JSON under a running dev server
   isn't reliably picked up (same Vite JSON-module caching as the playoff
   gotcha). Restart the dev server after seeding.
3. **The seeded post's player must composite from the pinned season year's
   map** (`getPlayerMap(getCurrentSeasonYear())` = 2025 locally). Some
   players lack `espn_id` in the 2025 feed (e.g. DeVonta Smith, 15282) even
   though the 2026 feed has it — `castStoryModel` rejects them and
   `hasBreakingStory` goes false with no error anywhere. Pick a post whose
   `playerIds[0]` has an `espn_id` in `data/theleague/mfl-feeds/2025/players.json`
   (George Kittle 13299 works). Also: the seed timestamp must be BEFORE the
   testDate — future posts are rejected.

## Per-post OG unfurl cards (shipped 2026-07-06)

8. **Schefter feed OG images** — `/api/og/schefter/<postId>.png`
   (`src/pages/api/og/schefter/[postId].png.ts` + `src/utils/schefter-og.ts`)
   renders the composite language as a real 1200×630 PNG via **satori +
   @resvg/resvg-js** (OG images can't be CSS). GroupMe deep links now carry
   `?post=<id>` (see `buildSpeculationDeepLink`) because unfurlers strip the
   `#post-<id>` fragment; the SSR news pages read the param and emit per-post
   `og:*` / `twitter:*` meta via the new `og` prop on `TheLeagueLayout`.
   - Composite when `playerIds[0]` resolves compositable (same DEF/espncdn
     gate); branded text-only card otherwise — every known post gets a PNG,
     unknown/malformed ids 404 (feed JSON is the allowlist).
   - Satori can't read woff2 — the UFC Sans TTFs in `src/assets/fonts/og/`
     were decompressed from the site's woff2 files (wawoff2), and they plus
     the logos/feeds are declared in the adapter's `includeFiles` because
     Vercel's file tracing can't follow dynamic `join()` fs reads.
   - The league crest SVGs rasterize with an empty banner under resvg — not
     a bug, the PWA icon PNGs have the same empty banner; it IS the mark.
   - ESPN fetch: 4s AbortController timeout, in-memory success-only cache,
     failure → text card. Response cached `max-age=86400, s-maxage=31536000,
     immutable` (Vercel edge cache resets on deploy = renderer-bug escape
     hatch).
   - Rumor-like posts title from the BODY (their headline is boilerplate
     "Schefter speculating…"), shared with the meta tags via
     `schefterPostOgText` in `src/utils/schefter-feed.ts`.
## Draft-room pick-reveal splash (shipped 2026-07-06)

8. **Pick-reveal splash (live + mock draft room)** —
   `src/components/theleague/draft-room/PickRevealSplash.tsx`, first REACT
   composite (the heroes are all Astro): "With the 1.03, the {franchise}
   select {player}" over a **franchise-brand** gradient (rookies rarely have
   an NFL team at draft time, so the drafting fantasy franchise tints the
   moment; NFL colors only as fallback — `resolveSplashColors`). Franchise
   crest watermark at the site-standard ~0.16 opacity, ghost pick-number
   wordmark, ESPN cutout bleeding from the bottom. Pure logic
   (`collectFreshPicks`, `isSplashCutoutEligible`) lives in
   `src/utils/pick-reveal.ts`, locked by `tests/pick-reveal.test.ts`.
   - **Trigger = diffing `state.picks`** (DraftRoom.tsx), which catches every
     path a pick lands: live polling, mock-socket pick events, own submission.
     Guards: first observation and slot-array-appears (mock session sync) are
     history not news; >3 fresh picks in one update is a rejoin catch-up —
     skip. Queue caps at 4 (drop oldest); one splash at a time, tap/Escape
     dismisses, `prefers-reduced-motion` gets a static card.
   - **404 cascade stays inside espncdn** — NFL cutout → college cutout →
     text-only. Never the MFL JPG (this differs from BoardCell's avatar
     cascade, which MAY fall to the JPG because it's not compositing).
   - Overlays `.dr-main` only (`position: absolute`), so the clock banner and
     its controls stay visible and clickable above the splash.
   - Franchise brand colors ride serialized `DraftRoomTeam.colorPrimary/
     Secondary` (via `getFranchiseBrand` in both pages) — do NOT import
     `franchise-brand.ts` into the island; it would ship the whole league
     config JSON to the client.
   - Found + fixed in passing: `.visually-hidden` has no SHARED utility —
     each consumer ships its own scoped rule, and DraftRoom didn't, so its
     aria-live pick announcement rendered as visible text whenever a pick
     landed (now scoped-fixed in draft-room.css; see the accessibility.md
     insight for the audit of other consumers).
   - Verified with Playwright fetch-interception against the dev server
     (empty a pick → refill it, or append a pick 52): the preview-panel
     screenshot tool ghosts the backdrop-filtered overlay — same artifact
     as the gray-frame finding above; trust `preview_inspect`/Playwright.

## Trade UI composites — first React-island integration (shipped 2026-07-06)

The trade builder's two moments got the split-panel treatment via
`src/components/theleague/trade-builder/TradeCompositeStrip.tsx` — a React
port of the MatchupSplitHero language (team gradient + glow + ghost logo
watermark + mirrored cutouts toward a center swap badge). First composite in
a `.tsx` island; the engine imports cleanly client-side because
`nfl-team-colors.ts` / `nfl-logo.ts` are pure TS with no `node:fs`.

- **PendingTradeCard** — compact strip between header and asset columns.
  Headline per side = `parseAssets(...).playerIds[0]` (received-side-first,
  same as the feed). Chips read "You receive" / "You give".
- **TradeConfirmationModal** — `size="tall"` full-bleed hero above the
  confirm content (`.tcm-hero`); chips are the franchise abbrevs. The close
  button needed `z-index: 5` and the right chip `right: 3rem` to coexist
  with the dark panels.
- **Gating is per side**: a DEF / draft-pick / MFL-JPG headline skips its
  side (two-panel → single-panel → nothing). `isCompositableTradePlayer`
  re-implements `isCompositable` client-side since `hero-casting.ts` is
  server-only (`getPlayerMap` → fs). The page already ships ESPN headshots +
  normalized `nflTeam` on `TradeBuilderPlayer`, so no new data plumbing.
- **Headline = first ASSET, not first roster player.** For the pending card
  that's `parseAssets(...).playerIds[0]` (the MFL asset string is already
  received-side-first). For the confirmation modal the headline is
  `teamAPlayers[0]`, but those arrays MUST be built in trade-add order —
  `state.teamA.playerIds.flatMap(id => resolve(id))`, NOT
  `teamA.players.filter(...)` (roster order), or a multi-player package
  headlines an arbitrary player (Codex/Copilot both caught this).
- **404 handling is PER SIDE** (React state `leftFailed`/`rightFailed`): a
  single cutout error degrades to the single-panel layout — the same path as
  a DEF/pick headline — and only a both-sides failure hides the strip. The
  strip is additive over the text asset lists that always render, so nothing
  is lost either way.
- **Verify traps:** the preview-panel browser ran at a 0×0 viewport (lazy
  images never load, `vw` units collapse) — Playwright against the dev
  server is the reliable route, same as the What's New screenshot finding.
  Auth for the trade surfaces: set `JWT_SECRET` for the dev server, mint a
  token with `createSessionToken`'s HMAC shape, and add it as a cookie
  (document.cookie can't overwrite a stale HttpOnly `session_token` on
  localhost — use Playwright `addCookies` or a more-specific `Path=`).
  Stub `/api/trades/pending` with fixtures; the trade-alert bell modal
  auto-opens over the page when pending trades exist — dismiss it before
  clicking. NEVER click "Send Proposal" against real MFL; route-block
  `/api/trades/submit` in the script as a safety net.
## Player-of-the-game faceoffs — every matchup surface (shipped 2026-07-06)

The "split matchup card" future direction is built. MatchupSplitHero's split
panel is extracted into the shared **`FaceoffComposite.astro`**
(`src/components/theleague/`, `hero`/`card` sizes) — purely presentational;
callers cast both models and pick chip/tint/watermark per context. A 404'd
cutout goes `visibility: hidden` (the watermark + name plate keep the panel
honest — MatchupSplitHero's shipped behavior, not the whole-banner hide).

**Selection** — `scoreFaceoffSides` in `hero-casting.ts`: elects ONE stat
source with signal (>0) on **both** sides — projected → actual → salary
(recap/past-week contexts flip actual first) — then `castBestScoredModel`
picks each side (deterministic, compositable-only). One-sided signal never
elects a source: the starved side would "win" by id tie-break.

Three surfaces:
1. **MatchupPreviewHero** — every Sunday Ticket game card is a `card`-size
   faceoff of both NFL teams' top projected players (chips = team codes,
   NFL-logo watermarks); a game where either side fails to cast keeps the
   classic logo row. While here, two latent bugs fixed: the data year is now
   the **no-arg** `getCurrentSeasonYear()` (the arg form is the non-monotonic
   trap — a Nov `?testDate` resolved the NEXT season's folder), and the
   schedule read is dual-source (live `nflSchedule.matchup` first, else
   `fullNflSchedule` indexed by the projections week) like getMarqueeGame.
2. **lineup.astro** — the week's fantasy matchup above the lineup: your top
   starter vs the opponent's. Panels are FRANCHISE-branded (Brandon,
   2026-07-06): brand color tint + GroupMe crest watermark + franchise-name
   chip via getFranchiseBrand — the RecapCompositeHero convention — because
   the faceoff is about the fantasy matchup, not the players' NFL teams.
   Opponent id from a new
   `TYPE=schedule&W=` fetch; their starters from the weeklyResults YTD entry
   for that week, else their full roster (rosters fetch is now league-wide).
   Away/home orientation follows the schedule's `isHome`.
3. **matchup-data.astro** (debug page) — same treatment off the synced 2025
   feeds; archived projections are empty so the cascade lands on the
   completed week's actual points. (Also gained `<meta charset="utf-8">` —
   the bare page rendered "·" as mojibake.)

**Watermark gotcha (franchise crests):** the lineup/showcase panels watermark
the FRANCHISE crest, which is a **raster** GroupMe avatar (often non-square),
while NFL-game panels watermark a square SVG logo. `FaceoffComposite`'s
`.foc__watermark` therefore sets `aspect-ratio: 1; object-fit: contain` so a
tall/wide crest centers in a square box without stretching — a bare `width:`
alone stretched the raster crest. One rule covers both asset types.

**Cutout sizing — height, not width, controls where the head lands (Brandon,
2026-07-07):** the `.foc__cutout` is `align-items: flex-end` (bottom-anchored),
so if you size it by `width:` the rendered height — and therefore how high the
head reaches — floats with each ESPN cutout's aspect ratio (some are portrait,
some near-square). To make "top of head clears the center VS badge" hold for
every player, the `card` variant sizes by `height:` with `width: auto`; the
panel `min-height` is kept just above the cutout height so the head sits near
the panel top (≈ above the vertically-centered VS). The final card values
Brandon tuned: cutout `clamp(115px, 13vw, 130px)`, panel `clamp(120px, 13vw,
160px)`. The `hero` variant is still width-sized (above the fold, single
instance, aspect ratio isn't a problem there).

**Live projected-points scoreboard (lineup.astro, shipped 2026-07-06):** the
faceoff band carries a two-total scoreboard instead of a static title. OUR
total sums the starting slots and **recomputes client-side** on every mutation
(`updateFaceoffTotal` is called from `updateSubmitBar`, the one funnel every
swap/optimal/clear/undo/draft-load already hits) — server and client sum the
SAME source (`projMap` ↔ `roster[].projection`) so the initial render matches
and no spurious bump fires. THEIR total is server-fixed: their recorded
starters' projections when the week is locked, else `bestLineupProjTotal`
(greedy fill of the 9 lineup slots by projection). Why greedy-optimal and not
their actual set lineup: **`TYPE=lineups` is auth-gated** (redirects
api→www→api in a loop for a read), so another franchise's set lineup for a
future week isn't publicly readable — best-by-projection is the honest proxy.
The band falls back to the players-of-the-game title when both totals are 0
(completed season, empty projections). `data-user-side` on the scoreboard tells
the client which total is ours; the accent color keys off it too.

Verify gotchas:
- Auth-gated pages: the dev server mints a RANDOM JWT secret per boot
  (`process.env.JWT_SECRET` unset locally; `.env` is NOT loaded into
  process.env), so you cannot forge a session cookie externally. Verified
  via a TEMPORARY `import.meta.env.DEV`-guarded route calling
  createSessionToken in-process — deleted before commit. Watch for
  duplicate `session_token` cookies shadowing the fresh one. For a
  screenshot, launch.json's `env.JWT_SECRET` + a Playwright cookie minted
  with that same secret works headlessly (the running dev server keeps the
  secret from its boot env even after you revert launch.json).
- MatchupPreviewHero can't render from committed data (live 2026 feed has
  projections but the grid is MatchupSplitHero's fallback; 2025 archive has
  no projections). Verified by seeding 2025 projectedScores from the wk-17
  box score + pointing SeasonDailyHero at the grid, then reverting both.
  JSON feeds are `await import`ed → seed changes need a server restart.

## Future Directions (mocked, not built)

Compact spotlight card. Mockups: scratchpad `hero-explorations.html` from
the 2026-07-04 session.

## heroArt override — when the image IS the story (2026-07-05, Brandon)

**Context:** The "Lost Archives" vintage-logo announcement was casting a rookie
(per the new-feature rule), but a story about recovered 2007 artwork should
show the artwork, not a player who wasn't alive for it.

**Insight:** What's New entries now take an optional `heroArt` field
(`{ src, caption, captionMeta }` — `HeroArt` in `src/types/whats-new.ts`)
that overrides player casting entirely. Amendment to the binding casting
rules: when a specific image is the story (a recovered logo, a trophy, an
artifact), the hero casts the artifact. The chain: JSON entry → both
`featureToHero()`s (hero-resolver.ts AND afl-hero-resolver.ts — two
independent implementations, keep in sync) → `HeroContent.heroArt` →
`FeatureCompositeHero` renders `.fch__art` full-opacity where the player
would stand, caption chip reused for provenance ("Circa 2007 · Recovered").
`index.astro` skips the featured-player cast (`castFeaturedModel` since the
2026-07-06 screenshot-first revision) when `fallbackHero.heroArt` is set —
don't burn casting work the component ignores.
**AFL limitation:** `AflEventHero` has no heroArt rendering — an AFL-tagged
heroArt entry shows its screenshot (or the player webp) instead of the
artwork. All heroArt entries are theleague-only today; add AFL support
before tagging one for both leagues.

**Gotcha:** the recovered vintage `*_icon_circle.png` buttons are all 100×100
(original MFL button size). Cap on-screen width at ~2× (200px) or they go
soft; `.fch__art` does this and says so in a comment.

**Recommendation:** Prefer `heroArt` over inventing new player-casting rules
whenever the announcement's subject is an image or object rather than a
feature people use.

## In-season daily composites — recap + matchup (shipped 2026-07-06)

The two remaining LEGACY in-season daily slots got composite treatments, each
self-loading and rendering its legacy hero as its own internal fallback (the
`RecapHero` / `MatchupPreviewHero` convention — SeasonDailyHero just swaps the
component; **no index.astro plumbing**, unlike the model-prop heroes):

1. **`season-heroes/RecapCompositeHero.astro`** (Tuesday-AM `recap` slot) —
   casts the week's top ACTUAL scorer via `getWeeklyTopScorerCandidates(year)` +
   `castBestScoredModel(..., 'Top Scorer')`. Branded by the **rostering
   franchise** (crest + `getFranchiseBrand().color`, `.name` for the owner
   line), not the NFL team — the week's top score belongs to a fantasy team.
   Week number from the new `getLatestScoredWeek`. Falls back to `RecapHero`.

2. **`season-heroes/MatchupSplitHero.astro`** (Sat/Sun `game-day-preview`) —
   split panel of the marquee game's two stars via `getMarqueeGameStars(year, league, referenceDate)`
   + `castBestScoredModel` per side. NFL-team-tinted (`getNflTeamColors` →
   dark→team gradient), away cutout mirrored (`scaleX(-1)`) toward a center VS,
   logo watermark behind each. Mirrors the playoff `SemifinalHero` split spine
   but tints by NFL team, not franchise. Falls back to `MatchupPreviewHero`.

**The data trap that shaped the design (worth the tax):** the DATA year is
**no-arg `getCurrentSeasonYear()`** (env-pinned to the last completed season, =
2025 locally), NOT `getCurrentSeasonYear(testDate)` (non-monotonic — see the
playoff gotcha). But a completed season's feeds are HALF-emptied post-rollover:

| Feed | Live year (2026) | Completed year (2025) |
|------|------------------|------------------------|
| `playerScores.json` | week 0, empty (recap dead) | week 17, real (recap works) |
| `nflSchedule.json` | `nflSchedule.matchup` (current week) | ONLY `fullNflSchedule` (no current-week matchup) |
| `projectedScores.json` | real (616 players) | EMPTY (`{id:"",score:""}`) |

So neither year satisfies both heroes off one code path. `getMarqueeGameStars`
is therefore **dual-source and self-healing**, and this is the load-bearing bit:
- **Schedule:** `getMarqueeGame` reads `nflSchedule.matchup` (live) first; when
  absent (completed season) it falls back to `fullNflSchedule.nflSchedule`,
  picking the **latest scored week** (`getLatestScoredWeek`) so recap + preview
  share one week, then that week's earliest kickoff.
- **Scoring:** `getGameScoreMap` uses `projectedScores` (a true pre-game
  preview) when any projection is > 0, else the completed week's ACTUAL box
  score. So 2025 resolves DAL @ WAS (Dak Prescott vs Croskey-Merritt) from real
  week-17 points; production (2026 in-season) uses live projections. The
  fallback branches NEVER fire in production (live feed + live projections both
  present), so prod behavior is unchanged — the fallbacks are purely for
  completed-season data (verification + defensive if projections ever lag).
- `getKickoffGame` was refactored to share a `matchupToKickoffGame(m)` helper
  with the new `getMarqueeGame`; both AFL + preseason callers unaffected
  (`normalizeTeamCode` maps WAS→**WSH**, the ESPN code — assert on WSH in tests).

**Verify:** phase machine keys off `?testDate` (recap = **Tue <2pm PT**,
matchup = **Sat all-day**; see `getDailySlot`), data stays pinned to 2025.
`?testDate=2025-11-04T09:00` → recap composite; `?testDate=2025-11-08` → matchup
split. Both verified light/dark + mobile, no h-overflow. Tests in
`tests/offseason-hero-data.test.ts` (getLatestScoredWeek, getMarqueeGameStars,
top-scorer cast) against frozen 2025.

**Playoff round models (the task's optional secondary): already done by #352** —
`SemifinalHero`/`WildCardHero`/`ChampionshipHero` already render player cutouts
via `getFranchiseCompositableHeadliners` → `playoff-round-data`. No work needed.

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
  team (highest projected with a compositable headliner). 14 unit tests in
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

**Three gotchas that ate a full session (worth the future-session tax):**
1. **Feeds that change under a running dev server: read with `fs.readFileSync`,
   not `await import()`.** Vite caches the JSON module and (in a worktree, where
   the file watcher is flaky) never invalidates it — the page silently serves a
   pre-edit copy across restarts *and* a `.vite` cache clear. Symptom here:
   `buildSeedMaps` saw `seedKeys: []` because the imported standings lacked the
   seeds that were on disk. The hero-data helpers already used `readJsonFile`
   (fs) and were always fresh; `index.astro`'s playoff block was the lone
   `await import` and the only stale reader. Match the fs pattern for any feed
   that a cron/sync (or a demo seed) rewrites.
2. **`getCurrentSeasonYear(referenceDate)` is NON-MONOTONIC across the Dec→Jan
   boundary** — it mixes the env-pinned real "now" with the arg, so a
   `?testDate` of Dec-21-2026 resolved to **2027** while Jan-4-2027 resolved to
   **2026**. That split the three playoff rounds across two season-year folders
   and only the championship (Jan) found the seeded data. For the playoff data
   loader use the **no-arg** `getCurrentSeasonYear()` (env-pinned, consistent
   for every request); the phase machine still keys off the testDate. Do NOT
   "fix" it to be testDate-aware.
3. **`buildSeedMaps` reads an explicit numeric `seed` field off each standings
   franchise**, and `championshipSeeds` only keeps `seed <= 7`. Historical
   seasons' standings feeds often lack `seed` entirely, so a bracket whose
   wild-card games reference `seed` refs resolves to `Seed N` placeholders while
   later rounds (real `franchise_id` refs) resolve fine. Seed as a JSON *number*
   (the map key is numeric; `ref.seed` is `toNumber`'d — a string key silently
   misses).

## Rookie showcase composite cards (shipped 2026-07-06)

8. **Top 50 rookie rankings card wall** —
   `src/pages/theleague/rookies-2026.astro` (Top 50 panel): the first
   composite use case that's a **retrofit onto an existing static/SSG data
   table**, not a hero. Every one of the 50 prospects gets a card
   (team-gradient stage, ESPN cutout, rank + DoT chip, name scrim, stat
   strip) — no rotation/casting-limit logic needed since the whole class
   ships at once. The original sortable table survives behind a
   Cards/Table toggle (`#view-cards`/`#view-table`, plain hidden-attribute
   swap); noscript shows the table only, same convention as every other
   composite page's no-JS fallback.

   **Drafted vs. undrafted is a data problem, not a display problem.**
   RSP source data is name-keyed, not MFL-ID-keyed, so the page builds a
   `normalizedName → PlayerIdentity` lookup from `getPlayerMap(year)`
   **filtered to `draftYear === String(year)`** before matching — without
   that filter a same-named veteran a few draft classes back can silently
   steal a rookie's card (team, colors, headshot all wrong). Even with an
   identity match, "drafted" is NOT `!!identity.nflTeam` — MFL's team code
   for an unsigned rookie is `'FA'`/`''`, which is falsy-adjacent but not
   guaranteed falsy, and normalizeTeamCode can return values that aren't
   real teams. The reliable gate is `normalizeTeamCode(team) in
   NFL_TEAM_COLORS` — if it's not a real key in the 32-team map, treat the
   player as undrafted and use the neutral gradient, full stop.

   **Headshot fallback here is NOT `buildHeadshotOnerror`.** That helper's
   cascade ends at the MFL JPG, which has a baked-in background and would
   silently break the "only composite transparent espncdn.com PNGs" rule
   from this doc's own Insights section. Built a narrower cascade instead:
   NFL espncdn URL → college espncdn URL (via a `data-fallback` attribute
   consumed once by `onerror`, so it doesn't loop) → an intentional
   initials-disc "no cutout" card state (`.rcc--no-cutout`) rather than any
   raster fallback. On the frozen 2026 pre-draft class this state hit 3 of
   50 prospects (no ESPN id at all, NFL or college) — expect a similar
   ~5-6% miss rate on future rookie classes before the college-ID backfill
   catches up.

   **`getOwnerByPlayer` had to be exported.** It existed in
   `offseason-hero-data.ts` as a module-private helper for hero casting;
   this page needed the same rostered-playerId → franchiseId map from a
   plain page frontmatter (no hero, no casting), so it's now exported
   alongside `getRosteredPlayerIds`. No behavior change, just visibility.

## Feature heroes show the feature — screenshot-first (2026-07-06, Brandon)

**Context:** "We currently use rookies for new features and it feels awkward."
Rookies-as-"new" put an unrelated face on every announcement. Revised rule:
the What's New hero shows the feature ITSELF — the entry's screenshot in a
browser frame — and casts a player only when the entry is about one.

**The mechanics:**

- `WhatsNewEntry.heroPlayerId` (+ optional `heroPlayerDescriptor`, default
  "Featured") names the player an entry is about. Plumbed through BOTH
  `featureToHero()`s → `HeroContent` → `castFeaturedModel()` (gated on
  `isCompositable`, so a cutout-less player falls back to the screenshot
  rather than rendering a broken composite).
- Screenshots are a light/dark THEME PAIR: `foo.webp` + `foo-dark.webp`,
  both written by `scripts/capture-whats-new-screenshots.mjs` (html.dark
  toggled between shots). The components swap them with CSS under
  `html.dark`; a 404 on the dark half falls back to the light capture via
  `onerror` (`.fch__shot--no-dark` / `.afl-event-hero__shot--no-dark`).
- Mobile (≤640px) hides the frame entirely — Brandon's call: a phone-width
  screenshot is an unreadable thumbnail — and the league-logo silhouette
  stands in (`.fch__shot-logo` / `.afl-event-hero__shot-logo` theme pairs).
- `castEnhancementModel` deleted; `castRookieModel` survives only for the
  AFL new-season reset. AFL feature states carry the screenshot on
  `EventHeroView.screenshot`; the AFL cast deliberately has NO headliner
  fallback for features (a fallback face would cover the screenshot).

## Saturated light-mode heroes flip the theme-paired assets too (2026-07-06, Brandon)

**Context:** the pale light-mode hero surfaces ("super light blue/green")
"didn't hit the same" as dark mode. Fix: light mode becomes a bold saturated
card that mirrors dark mode's drama — `FeatureCompositeHero` light
`--fch-surface` → `linear-gradient(115deg,#2563eb,#1c497c,#0f3057)` white ink;
`AflEventHero` light `--ev-surface` → solid navy `#002244` (= its own dark
mode), bright gold accent, red glow. See [[feedback_hero_light_mode_saturated]].

**The non-obvious gotcha:** these heroes carry theme-PAIRED foreground assets
authored for the OLD light-on-white surface — the logo silhouette
(`*__logo-art--light/--dark`, `*__shot-logo--light/--dark`) and the AFL
`ThemeImage` badge (`badge`/`badgeDark`). Their `--light` (dark-colored)
variant goes invisible once the light surface is dark. When you darken a
light surface, you MUST also point every paired asset at its `--dark` (white)
variant in BOTH themes — the html.dark-scoped display rules collapse to a
single always-dark rule, and the `--light` variant is retired. For the
`ThemeImage` badge, override `theme-image.css` from the component with a
class-prefixed `:global(.afl-event-hero .…__badge.theme-img--dark){display:block}`
(the hero-class prefix outranks `html.dark .theme-img--light`).

**Screenshots are the exception:** the `*__shot-img` light/dark capture pair
stays theme-matched — it's a self-contained browser frame (gray chrome, white
URL bar) that reads fine on any surface, so no override needed.

**Whole-family sweep (2026-07-07, Brandon).** The saturated treatment was then
applied to EVERY remaining composite hero, each mirroring its OWN dark-mode hue
(not all blue): `RecapCompositeHero`, `ArticleHero`, `CutWatchCompositeHero`
(blue + a `--urgent` red variant), `PreseasonCompositeHero` → deep league-blue
(`#2563eb → #1c497c → #0f3057`, same tokens as `.fch`); `AuctionCompositeHero`
→ amber (`#d97706 → #4a3410`); `BreakingStoryHero` → red (`#dc2626 → #5f1414`);
`ChampionCrownedHero` → bronze-gold (`#7c5510 → #2f2206`, pale-gold `#fde68a`
accent); `EventHeroShell` → solid TheLeague blue `#1c497c` (the flat-white ones
took the AflEventHero treatment — a SOLID `--surface` because the player photo
color-mixes its fade against it). Every league-logo silhouette / backdrop pair
was flipped to the white `--dark` variant in both themes; single colorful
franchise/team crests (Recap's `__crest`, Champion's `__bg-logo`) aren't a
theme pair — they only needed their watermark opacity bumped to the on-dark
value (Champion 0.5) so the now-dark surface reads consistently. Every hero's
own `:global(html.dark)` block was left untouched.

**Still unchanged:** the calendar event cards (What's Next, League Calendar) and
the bespoke AFL day-of heroes (`AflPlayoffsHero`, `AflChampionshipHero`,
`TradeDeadlineHero`).

## Dead Money Awards — franchise colors + legacy-player recovery (2026-07-06)

The Dead Money page (`src/pages/theleague/dead-money.astro`) composites every
award card (`DeadMoneyPlayerCard.astro`) and both shame banners
(`DeadMoneyComposite.astro`), not just the banner. Three learnings:

- **Legacy players resolve through a GLOBAL union map, not the season feed.**
  `getGlobalPlayerMap()` (src/utils/player-map.ts) unions every
  `data/theleague/mfl-feeds/<year>/players.json` into one MFL-id→identity
  lookup (later year wins). MFL ids are stable across seasons, so a 2009
  winner whose own year predates the feed archive (pre-2011 has no
  `players.json`) still gets an ESPN headshot from a later season he appears
  in. Measured recovery: ~0% (per-season) → 88% (union) across all cards.
  Any historical page (records, awards) that needs headshots for old players
  should use this, not `getPlayerMap(year)`.

- **The band wears the FANTASY franchise's colors, not the player's NFL team**
  (Brandon, 2026-07-06) — it's the owner's shame. Colors come from
  `theleague.config.json` `colorPrimary`/`colorSecondary` via
  `getFranchiseForYear`. History entries carry no per-era colors, so a
  rebranded franchise shows its CURRENT colors on old cards (accepted).

- **`pickBrandAccent(primary, secondary, fallback)`** (nfl-team-colors.ts)
  chooses the gradient hero. Many franchises run a near-black primary
  (`#181818`) with a vibrant secondary — a naive dark→primary gradient makes a
  flat black band. Rule: keep the primary when it's usable (chroma ≥ 25 AND
  luminance ≥ 40), else fall to the secondary, else keep primary (true
  black/white teams read dark). Over-bright heroes (yellow) are darkened so
  white text/cutout stay legible. Do NOT just pick "most chromatic" — that
  wrongly overrides a perfectly good dark-navy primary with a flashier
  secondary (Cowboy Up navy vs its red).

**The `/theleague/showcase` gallery is a hand-built facsimile, not the real
components.** `src/pages/theleague/showcase.astro` reproduces every composite
hero with its OWN markup and CSS (`.hcx__*` classes — e.g. `.hcx__model` for
the player cutout) rather than importing `*CompositeHero.astro`. So a styling
change to a real hero (the `.cwh__model` width clamp on `CutWatchCompositeHero`,
etc.) does NOT show up in the showcase, and vice-versa — the two drift silently.
When you resize/restyle a hero element, update the matching `.hcx__*` rule in
showcase.astro too, or the design gallery misrepresents the shipped component.
Also note the showcase casts its own demo players (Cut Watch → Bijan Robinson),
so it can't reproduce the live-data hero (Cut Watch on `index.astro` only
renders with real over-limit rosters) — verify the real component's computed
values, and use the showcase only as a proxy for the shared sizing math.

## Reusable player-avatar team-color backdrop (2026-07-08)

The small circular player headshots in the player-cell lockup wear the **same
NFL-team gradient as the player modal band** — a deep-ink→team-primary
`linear-gradient(115deg, …)`. Single source of truth is
`getPlayerAvatarBackground(teamCode)` in `nfl-team-colors.ts` (mirrors the
base, no-accent stops from `applyPlayerModalBand`). Free agents / unknown codes
fall back to the league-neutral blue.

- **Distribution is a CSS custom property, not per-renderer color math.**
  `player-cell.css` reads `background: var(--player-avatar-bg, …gray)`. Each of
  the four avatar renderers just sets that one property from the shared helper:
  `PlayerCell.tsx`, `PlayerCell.astro`, `buildPlayerCellHTML()`
  (`player-cell-html.ts`), and the `players.astro` free-agent list. Adding a
  new touch point = set `--player-avatar-bg`, nothing else.
- **`players.astro` can't import at runtime** — its list renderer is an inline
  `define:vars` script. Pattern: precompute the full `{ code → gradient }` map
  in frontmatter (loop `NFL_TEAM_COLORS` keys through `getPlayerAvatarBackground`),
  pass it + a fallback via `define:vars`, and the client does a plain lookup. No
  `mixHex` duplicated in the browser.
- **DEF stays transparent.** DEF "players" render a team logo on a transparent
  chip (`.player-cell__avatar--def`), so the renderers skip setting the property
  for DEF — the `--def` rule's `background: transparent` wins anyway, but not
  setting it keeps intent clear.
- MFL-JPG headshots have baked backgrounds and cover the gradient (same as the
  modal); the color only shows through transparent ESPN cutouts. Accepted.
