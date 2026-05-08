# Franchise History — Phases 2-5 Plan

## Context

Phase 1 (`/theleague/franchises` index + `/theleague/franchises/[id]` detail pages) shipped in PR #177 and PR #181. This doc captures everything that was deferred so a future session can resume cleanly without re-discovering the data shapes or design decisions.

## What's already built (don't redo)

- **Aggregation pipeline:** `scripts/compute-franchise-history.mjs` runs in prebuild (`pnpm compute:franchise-history`) and writes `data/theleague/derived/franchise-history.json`. It walks every year of MFL feeds 2007-present and emits per-franchise career stats, year-by-year tables, championships, division titles, MVPs, Jerry Jones, Brock Osweiler, single-game highlights, biggest blowouts, and **a full head-to-head ledger** (the data backbone Phase 2 needs).

- **Backfill workflow:** `.github/workflows/backfill-historical-feeds.yml` (manual `workflow_dispatch`) re-fetches gap years from MFL — already used to recover 2007, 2009, 2011 + schedule + per-week weeklyResults across the full 20-year history. Run it again whenever historical data drifts.

- **`scripts/backfill-historical-feeds.mjs`** — per-endpoint refetcher; picks any missing/invalid file per year and pulls it. Add `--force` to refetch everything.

- **Hand-curated `data/theleague/championship-history.json`** — covers 2007-2025 because MFL retired pre-2020 bracket winners. Aggregation prefers MFL when present, falls back to this file.

- **`src/data/theleague.config.json`** — every franchise's name, banner, division, color, full `history` array (including all the pre-2012 owner transitions we audited in PR #181), and `ownerHistory` for cross-franchise stints (currently just franchise 0011's 2010-2015 detour onto 0010).

- **`currentOwnerSince` inference** in the aggregation script — derives the current owner's first year from `ownerHistory` or by walking back the `history` array until names stop matching. Filters former-owner years out of every franchise page.

- **Detail page features:** hero with crown overlay for champions, badges bar, quick stats, biggest blowout / loss highlight cards, points-by-season bar chart, awards honor roll, era history with sticky-thead scrollable year-by-year tables, local icon resolver that maps row identity names to current franchise icons.

## Open data needs (block on Brandon)

| Need | Why | Format I'm expecting |
|---|---|---|
| **Owner names** — franchise → human name per era | Phase 2 rivalry pages will read better with names; Phase 3 badges like "Roger Tormentor" need to attach to humans | `data/theleague/owners.json` with `{ "0001": [{name, yearStart, yearEnd}], … }`. Same shape as `ownerHistory` but with human names. |
| **2007 / 2011 / 2024 / 2026 championship confirmations** | Have all years now from Brandon's audit; just need to keep championship-history.json fresh as new seasons end | Brandon updates the JSON manually each January after the title game |

If owner-name data shows up, the franchise pages should:
1. Show "Owned by Brandon · since 2010" on the hero
2. Tag each era card with the owner who held it
3. On the index "Former Identities" listing, append owner name (e.g. "Heavy Chevy *(Joe)* · 2020-2024")

## Phase 2: Rivalry pages

### Goal

Every pair of franchises gets a permanent URL with shared history. This is the highest-value follow-on because the data is already computed and sitting in `franchise-history.json`.

### Routes

- `/theleague/rivalries/[id1]-vs-[id2]` — H2H detail page. Canonical URL has the smaller franchise ID first. The reverse order should 301 to the canonical.
- `/theleague/rivalries/` — index showing the full 16×16 matrix.

### Detail page sections (in order)

1. **Hero** — both team banners side-by-side, all-time record between them ("Pigskins lead 17-12"), most-recent meeting, "intensity score" badge if any (computed from playoff meetings + lopsidedness).
2. **Year-by-year meetings table** — every game between the two: year, week, home/away, scores, winner, regular season vs playoffs flag.
3. **Highlights** — biggest blowout (largest margin in the rivalry), closest game, highest-scoring matchup, longest winning streak by either side.
4. **Playoff meetings** — separate sub-list (these usually carry the most lore).
5. **Trades between them** — every trade involving these two franchises, parsed from `transactions.json` for every year.
6. **Side-by-side badges** — both franchises' awards bars next to each other (visual comparison).

### Data dependencies

All already in `franchise-history.json`:

- `franchises[id].headToHead[opponentId]` → `{ wins, losses, ties }`
- For per-meeting detail, we need to walk `weekly-results-raw.json` per year and extract matchups where both `franchise.id` values are the rivalry pair. **This is one extra read in `compute-franchise-history.mjs`** — add a `franchises[id].matchupHistory[opponentId][]` array with `{ year, week, score, opponentScore, isPlayoff }` entries.
- Trades: parse `data/theleague/mfl-feeds/<year>/transactions.json` filtering by `type=TRADE` and the pair of franchise IDs.
- Playoff flag for matchups: cross-reference week number against playoff weeks (typically 15-17) — already detectable from `playoff-brackets.json`.

### Auto-detect "named" rivalries

On each franchise's detail page (Phase 1), surface the top 3-5 rivalries by:

- Number of playoff meetings (highest weight)
- Win-loss closeness (50/50 = high intensity)
- Total games played

Format as a "Rivals" carousel/strip linking into rivalry pages.

### Deliverables checklist

- [x] Add `matchupHistory` aggregation to `compute-franchise-history.mjs`
  — also added `trades[]`, `bothAttributed` flag, playoff-bracket tagging
  (champion + 3rd-place brackets) plus pre-2020 enrichment from
  `championship-history.json`, and a `playerNames` lookup pulled from each
  year's `players.json` so trade rosters are renderable without bundling
  ~2,700 players client-side.
- [x] Build `src/pages/theleague/rivalries/[pair].astro` (SSR; 301s the
  reverse-order slug to canonical smaller-first)
- [x] Build `src/pages/theleague/rivalries/index.astro` with hot-rivalries
  strip + the 16×16 mini-matrix (sticky row/col headers, intensity tinting,
  playoff dots)
- [x] Add "Top Rivals" section to franchise detail page linking into rivalry
  pages (top 5 by closeness × log(games + playoff-bonus))
- [x] Add nav link under League Reports (`Rivalries`, trophy icon)

### Open follow-ons for Phase 2.5

- Pre-2020 consolation/3rd-place enrichment is skipped because the
  hand-curated champ history doesn't carry the consolation opponent. If we
  add that to `championship-history.json` we can tag those games too.
- Trade asset display works for player IDs, current draft picks (`DP_*`),
  and future picks (`FP_*`). `BBID` and `CASH` codes render generic — fine
  for a v1 but worth grading once we see real auction-era trades.
- Owner names will improve all of this; the data is still gated on Brandon
  populating `data/theleague/owners.json` per the open-data needs section.

## Phase 3: Badge engine

### Goal

Declarative badge rules so new badges can be added without touching the franchise-page render code.

### Architecture

- `src/data/theleague/badges.ts` — array of badge definitions:
  ```ts
  type Badge = {
    id: string;
    name: string;
    description: string;
    icon: string;
    tier: 'career' | 'season' | 'game' | 'trade' | 'fun';
    test: (franchise: Franchise, history: FranchiseHistory) => Award[];
  };
  ```
- Each `test` function returns `Award[]` — possibly multiple awards (e.g. one per year qualifying).
- `compute-franchise-history.mjs` runs every badge against every franchise; writes results to `franchises[id].badges[]`.
- Detail page renders `franchises[id].badges` grouped by tier.

### Initial badge catalogue (from earlier doc planning)

**Career milestones:** Champion, Runner-Up (already shipped as awards), Playoff appearance count, 100/200/500 all-time wins, decade-long owner.

**Single-season:** Best regular-season record, highest scoring season, perfect division record, comeback (worst-to-first).

**Single-game:** Highest score ever (already in highlights), biggest blowout (already), biggest comeback, lowest winning score, weirdest game.

**Trades:** Trade Steal of the Year (post-hoc by VORP delta), Most Active Trader, Hoarder (no trades 2+ yrs).

**Draft/auction:** Best Draft Class (RoY-weighted), Auction Whale (most spent on a single player), Bust King.

**Quirky/fun:** Roger Tormentor (most rules questions — needs Roger usage data), Schefter Headlines (most posts about you — needs Schefter feed parsing), Underdog Slayer (beat #1 seed as low seed).

## Phase 4: Trade ledger + draft history per franchise

### Goal

Two new sections on each franchise detail page.

### Trade ledger

- [x] Walk `data/theleague/mfl-feeds/<year>/transactions.json` for every year,
  filter `type=TRADE` involving this franchise. **Already aggregated in
  Phase 2** as `franchises[id].trades[]` with bidirectional attribution.
- [x] Render a chronological list with each trade's date, partner franchise
  (linked → rivalry page), every asset sent/received. Grouped by year with
  the most recent year auto-expanded; older years collapsed via `<details>`.
  Lives between "Top Rivals" and "Points by Season" on the franchise detail
  page.
- [x] Asset formatter extracted to `src/utils/franchise-trade-asset.ts` and
  shared with the rivalries page (`formatTradeAsset`).
- Known data limitation (carried forward): trades from 2007-2010 render
  unresolved player codes as "Player #NNNN" because MFL's per-year
  `players.json` isn't available for those years. Fix would require a
  cross-year fallback to the most recent `players.json` that contains the
  ID — out of scope for the trade-ledger UI.

### Draft history

- Walk `data/theleague/mfl-feeds/<year>/draftResults.json` and `auctionResults.json` for every year.
- Render every pick the franchise made: round/pick number, player name, salary (if auction), career arc indicator (current contract status if still rostered).
- Useful sub-stat: best pick by VORP (cross-reference salary + scoring data we already have).

## Phase 5: Schefter milestone integration

### Goal

When a franchise crosses a badge threshold, auto-post to the Schefter feed.

### Hooks

- `compute-franchise-history.mjs` already runs in prebuild + after each backfill.
- Add a step that diffs the new `franchises[id].badges` against the previous run's snapshot. New badges → emit Schefter posts.
- Use the existing `scripts/schefter-scan.mjs` style — append to `src/data/theleague/schefter-feed.json`.
- Phrasing should match the existing voice (see `data/schefter/league-lore.md`). Examples:
  - First championship: "BRENNAN ROCKS. Pigskins lift the trophy for the first time in 19 years."
  - 5th title: "DYNASTY STATUS. Bring The Pain ties Dark Magicians for most all-time."

## Phase 1.5 (small wins, before Phase 2)

If we want quick wins before Phase 2:

- **Add owner-name overlays** once the data lands.
- **Render top 3 rivals** on each franchise detail page as a teaser, even before the rivalry pages exist (just shows the H2H record vs each top rival).
- **Fix the "Earlier eras" placeholder rendering** — currently shows "Earlier eras" for franchises with pre-config-history years even if those are filtered out. Should suppress the era card if `seasons.length === 0` (already handled, but verify).

## File / data inventory for the next session

```
scripts/
  compute-franchise-history.mjs        # main aggregation; extend for matchupHistory + badges
  backfill-historical-feeds.mjs        # one-shot historical fetcher
data/theleague/
  derived/franchise-history.json       # consumed by all franchise/rivalry pages
  championship-history.json            # hand-curated; update each January
  mfl-feeds/<year>/
    standings.json
    league.json                        # franchise → division mapping per year
    schedule.json                      # 2026+ matchup pairings (NEW from backfill)
    weekly-results.json                # scores per week
    weekly-results-raw.json            # full matchup pairings — KEY for Phase 2
    playoff-brackets.json              # 2020+ has winners; pre-2020 metadata only
    transactions.json                  # for Phase 4 trade ledger
    draftResults.json                  # for Phase 4 draft history
    auctionResults.json                # 2009+
src/
  pages/theleague/franchises/
    index.astro                        # 16-team grid
    [id].astro                         # per-franchise detail
  pages/theleague/rivalries/           # NEW (Phase 2)
    index.astro
    [pair].astro
  data/theleague.config.json           # franchise definitions (history + ownerHistory)
.github/workflows/
  backfill-historical-feeds.yml        # manual dispatch — runs the backfill on the cloud
```

## Tribal knowledge / gotchas

- **MFL retired old yearly leagues** — pre-2020 playoff brackets return metadata only. Backfilling beyond what we already have is a dead end without scraping the HTML pages directly.
- **`workflow_dispatch` UI requires the YAML on main** — the backfill workflow is on main; the scripts it calls live on the selected branch via the checkout step.
- **Config history `ownerEra`** field marks when same-owner re-renames should collapse into one display entry (e.g. franchise 0003 Poker→Generals→Poker pre-Maverick all share `ownerEra: 1`).
- **Same-name continuity** — when a config history entry shares a name with the current top-level, the `currentOwnerSince` walk-back consolidates them automatically. Don't add `ownerEra` for these.
- **Cross-franchise stints** — only franchise 0011 currently has `ownerHistory` (Midwestside owner held 0010 from 2010-2015). If another franchise's owner ever moved IDs, add an entry to that franchise's `ownerHistory` and the aggregation will follow.
- **20 years of weekly-results-raw is heavy** — the `data/theleague/derived/franchise-history.json` is ~1.5MB. If it grows unwieldy, split per-franchise into separate files with an index.
