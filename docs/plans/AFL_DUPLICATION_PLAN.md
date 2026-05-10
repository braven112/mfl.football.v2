# AFL Duplication Plan

Plan for bringing the AFL Fantasy league (MFL `19621`) up to feature parity
with TheLeague (MFL `13522`) on this Astro app, while accommodating the rule
deltas between the two leagues and an eventual move of AFL to its own domain
(`afl-fantasy.com`).

Branch: `claude/plan-afl-version-mjyIK`.

---

## 0. Decisions locked in

| Question | Decision |
|---|---|
| Headline rule deltas | Two parallel competitions: **(a)** standard H2H regular season → playoffs (2 divisions per conference) and **(b)** all-play side competition that drives Premier ↔ D-League promotion/relegation. No salary cap; no contracts; **7-player keeper** model (vs TheLeague's contract dynasty); different scoring/lineup; different draft format (auction vs snake / rookie pool differs) |
| Plan scope | Full feature-by-feature map of every `/theleague/*` page and subsystem |
| URL strategy | Stay at `/afl-fantasy/*` short-term; architect so middleware can flip AFL to root on `afl-fantasy.com` later (mirroring how `theleague.us` strips `/theleague/`) |
| Plan location | This file, `docs/plans/AFL_DUPLICATION_PLAN.md` |

---

## 1. Current state inventory

### Already built for AFL

- **League context** (`src/utils/league-context.ts`): `getLeagueContext(url)` returns `{leagueId, name, slug, dataPath}` for both leagues. Cross-league franchise map covers 7 owners with teams in both.
- **Config** (`data/afl-fantasy/afl.config.json`): full team list with `tier: "Premier League" | "D-League"`, conferences (`'00'` = AL, `'01'` = NL — baseball-style branding), divisions (North/South/East/West), abbrevs, aliases, icon/banner URLs.
- **Salary data** (`src/data/afl-fantasy/`): `mfl-player-salaries-2007..2025.json`, `mfl-salary-averages-2007..2025.json`. (Useful as historical record even though AFL has no salary cap going forward.)
- **CSS skin**: `src/assets/css/src/afl_main.scss`, `_variables-afl.scss`; `build-styles.mjs` already loops both leagues.
- **Asset pipeline**: `sync-afl-assets.mjs`, `sync-afl-asset-urls.mjs`, `watch-afl-assets.mjs`. Assets in `public/assets/afl/{banners,icons,group-me}`.
- **All-play computation library**: `src/utils/standings.ts` (602 lines). `calculateAllPlayFromWeekly(results, cutoffWeek)` plus `getDivisionStandings`, `getConferenceStandings`, `getAllPlayStandings`, `getTierAllPlayStandings`. Tiebreaker chain: all-play → PF → PWR → VP → PA. `PREMIER_LEAGUE_CUTOFF_WEEK = 17` is hardcoded in the standings page (move to config).
- **Standings page shipped** (`src/pages/afl-fantasy/standings.astro`, 925 lines). Three views via `?view=`:
  - `division` — standings within each division, defending-champion badges (hardcoded by-year map).
  - `league` (Playoff) — AL + NL conference standings (top 4 advance) + an **NIT / Secondary Playoffs** table for seeds 5-12 ranked by Power Rank.
  - `all_play` (Premier League) — Premier League and D-League side-by-side tier tables, plus a **Promotion/Relegation playoff** sub-table where Premier ranks 9-10 + D-League ranks 3-4 compete for the 2 spots that stay/move up to Premier next year.
- **Playoffs page shipped** (`src/pages/afl-fantasy/playoffs.astro`, 2,743 lines). **Four-bracket structure**, not one:
  1. Bracket 1: Overall Championship (AL/NL conference winners).
  2. Bracket 2: AL Conference, seeds 1-4.
  3. Bracket 3: NL Conference, seeds 1-4.
  4. Brackets 6-9: NIT / "Toilet Bowl" — non-playoff teams seeded 1-N by Power Rank.
  
  Reads MFL `playoff-brackets.json` feed for live bracket data; auto-selects which bracket to show based on the viewer's preferred team cookie.
- **Other pages**: 8 total stubs in `src/pages/afl-fantasy/` (`assets`, `draft-predictor` — 424 lines, `icons` — 709 lines, `index`, `news`, `rosters` — 524 lines, `test-cookie`).
- **Schefter (partial)**: `scripts/schefter-scan.mjs` already branches on `league.slug === 'afl'` in feed/post-history paths and team-icon resolution. Several flows are still TheLeague-only by guard (`Ask Roger`, certain rumor phases).
- **Season state**: `src/data/mfl-season-state-afl.json`.
- **MFL feeds**: `src/data/mfl-feeds/afl/2025/` (only `salaryAdjustments.json` so far). The standings/playoffs pages currently read from `data/afl-fantasy/mfl-feeds/<year>/{standings,weekly-results,playoff-brackets}.json` — different path shape than the TheLeague feed location, worth normalizing.
- **Type hints** for AFL in `src/types/{nav,schefter,standings}.ts`.
- **Cross-league** primitives: `setAFLPreference`, `getAFLPreference`, `resolveAFLTeamSelection`, `getAFLTeamData` already in `src/utils/team-preferences.ts`.

### Not yet built for AFL

- AFL-specific resolved events / calendar (TheLeague has draft + auction reminders firing through Roger → GroupMe).
- AFL Schefter feed JSON (file exists at `src/data/afl-fantasy/schefter-feed.json` but never written by a workflow).
- No AFL-targeted GitHub workflows. All `schefter-*.yml` hardcode `13522`.
- No AFL `theleague.config.json` analog at `src/data/` — current AFL config lives at `data/afl-fantasy/afl.config.json`. (Inconsistent with TheLeague's location.)
- No AFL middleware behavior. `src/middleware.ts` only knows the `theleague.us` host.
- ~42 of TheLeague's 50+ pages are missing on AFL.
- No AFL keeper-selection tool (this is the AFL analog of the contracts page).

---

## 2. Architectural foundation (Phase 0)

These changes pay off across all later phases. Land them first, in roughly this order, each in its own PR.

### 2.1 Single source of truth for league config

Today there are two patterns: TheLeague config at `src/data/theleague.config.json`, AFL config at `data/afl-fantasy/afl.config.json`. Unify:

- Move both to `src/data/<slug>/config.json` (or keep top-level `<slug>.config.json` — pick one and document in CLAUDE.md).
- Add a `getLeagueConfig(slug)` helper that imports the right JSON. All page code consumes through it.
- Extend `LeagueContext` interface with `tier`, `keeperCount`, `draftFormat`, `hasSalaryCap`, `hasContracts`, `hasPromotionRelegation` flags read from config — pages branch on these instead of `if (slug === 'theleague')`.

### 2.2 Generalize the layout

`src/layouts/TheLeagueLayout.astro` is used by AFL pages today (see `src/pages/afl-fantasy/index.astro:1`). Rename to `LeagueLayout.astro`, accept league context as a prop, and have it pick CSS bundle + nav from config. Keep a thin `TheLeagueLayout` re-export for now to avoid touching every TheLeague page in one PR.

### 2.3 Middleware: prepare for `afl-fantasy.com`

Generalize `src/middleware.ts`:

- Replace `THELEAGUE_HOSTS` constant with a host→slug map driven by config (`{'theleague.us': 'theleague', 'afl-fantasy.com': 'afl-fantasy'}`).
- Rewrite logic becomes: if the request host maps to a league slug, rewrite `/foo` → `/<slug>/foo` and set `hideLeaguePrefix`. Until afl-fantasy.com is wired up in DNS/Vercel, the AFL entry is dormant — but the code is ready.
- Update `SKIP_REWRITE_PREFIXES` to include both league prefixes (already does).

### 2.4 Schefter pipeline parameterization

`scripts/schefter-scan.mjs` already accepts a `league` arg in many places. Finish it:

- Promote the league config block at the top of the file (currently TheLeague-only at lines 42-46) into an array `LEAGUES = [theleague, afl]`. `runForLeague(league)` is the unit of work; `main()` iterates.
- Each TheLeague-only guard (`if (league.slug !== 'theleague') return`) becomes a config flag check (`if (!league.config.askRoger) return`). Configurable per league.
- Same treatment for `schefter-rumor-scan.mjs`, `schefter-articles.mjs`, `schefter-trade-speculation.mjs`, `roster-sync.mjs`, `sync-draft-pick-contracts.mjs`.

### 2.5 GitHub workflows: matrix instead of duplication

For every workflow that hardcodes `13522`, convert to a matrix:

```yaml
strategy:
  matrix:
    league: [theleague, afl]
```

Pass `${{ matrix.league }}` to the script. Cron stays the same. This avoids 8 net-new workflow files and keeps one place to edit cadence.

For workflows that should *not* run for AFL initially (e.g. roger-date-audit), gate inside the script via the config flags from §2.1, not by deleting the matrix entry.

### 2.6 Cross-league navigation primitive

Build a small `<LeagueSwitcher>` component that uses `getOtherLeagueFranchiseId` (already implemented) to deep-link from a TheLeague page to the equivalent AFL page when the viewer owns teams in both leagues. Drop it into the global header. Pays off immediately for the 7 dual-league owners.

### 2.7 All-play computation library — *already shipped*, harden

`src/utils/standings.ts` already implements `calculateAllPlayFromWeekly`, the tier-grouped standings, and the cutoff-week mechanic. Remaining cleanups (small):

- Add vitest coverage. Right now this math underpins the side game's outcome and has no tests — high-value, low-effort.
- Move `PREMIER_LEAGUE_CUTOFF_WEEK = 17` out of the standings page constant and into `data/afl-fantasy/afl.config.json` (under e.g. `tierCompetition.cutoffWeek`).
- Optional: precompute and cache `src/data/afl-fantasy/all-play-<year>.json` via a workflow so SSR doesn't recompute on every request. Skip if perf is fine.

---

## 3. Feature-by-feature map

Legend: **Dup** = duplicate as-is with AFL data swap. **Adapt** = page exists in concept but mechanics differ. **Skip** = does not apply to AFL. **New** = AFL-only.

| TheLeague page / area | Status | AFL treatment |
|---|---|---|
| `index.astro` (landing) | Adapt | Two hero modules: (a) division/playoff race (H2H), (b) tier race (all-play). Keeper-deadline countdown instead of franchise-tag deadline |
| `standings.astro` | **Shipped** | 925 lines, three views via `?view=`: `division`, `league` (AL/NL + NIT), `all_play` (Premier + D-League + 4-team promotion/relegation cutoff). Open follow-ups: (1) backfill `championsByYear` to be data-driven from `data/afl-fantasy/champions.json` (committed work, see §6 Phase 2); (2) `PREMIER_LEAGUE_CUTOFF_WEEK = 17` should move to config (§2.7); (3) the `?view=all_play` subtitle "Top 4 advance to playoffs • Bottom 2 relegated to D-League" is misleading — there are no Premier/D-League tier playoffs (the top 4 it refers to is the H2H AL/NL bracket the same teams happen to be in). Reword the subtitle |
| `rosters.astro` | Adapt | Drop salary/contract columns; add keeper-eligibility column (top 7 kept from prior season). Already partially done (524 lines) |
| `playoffs.astro` | **Shipped** | 2,743 lines, four brackets: (1) Overall Championship between conference winners, (2) AL Conference seeds 1-4, (3) NL Conference seeds 1-4, (6-9) NIT/Toilet Bowl seeds 5-12 by Power Rank. Reads MFL `playoff-brackets.json`. Auto-selects bracket from preferred team. **No Premier or D-League tier playoffs exist** — the only tier-related "playoff" is the 4-team all-play cutoff (Premier 9-10 + D-League 3-4) shown on the standings page, which isn't a true bracket of games |
| `<NIT / Secondary Playoffs>` (concept) | **Shipped** | College-NIT-style consolation bracket for seeds 5-12 across both conferences, ranked by Power Rank. Surfaces on standings (`?view=league`) and as brackets 6-9 on playoffs |
| `schedule` (implicit) | Adapt | Different starter slots; render lineup/scoring badges per league |
| `lineup.astro` | Adapt | Read lineup format from config (different starter counts) |
| `matchup-data.astro` / `matchup-preview-example.astro` | Adapt | Same — config-driven scoring |
| `news.astro` + `news/[id].astro` | Dup | Reads from `<league>/schefter-feed.json`. Already party-aware |
| `news/[id].astro` | Dup | Same |
| `schefter/style-book.astro` | Dup | Per-league voice notes (AFL deserves its own beat-reporter persona — see §4.2) |
| `schefter/thread/[id].astro` | Dup | Reads keyed feed |
| `schefter/tip.astro` | Dup | Uses POST to API; route is league-aware via referer/cookie |
| `activity.astro` | Dup | MFL transactions feed — leagueId param swap |
| `calendar.astro` | Adapt | AFL-specific event set: keeper deadline, auction date, **last week of all-play** (when relegation locks), playoff start. Build `src/data/afl-fantasy/league-events.json` analog and add to `compute-league-events.mjs` |
| `rules.astro` + `rules.html` | Adapt | AFL has its own constitution (already at `src/pages/afl-fantasy/docs/rules.html`). Wire it up |
| `rules-chat.astro` (Ask Roger) | Adapt | Reuse `/api/rules-qa.ts`, but inject AFL constitution + AFL date context. Keep date block separate from cached rules block (CLAUDE.md gotcha #1) |
| `calculator.astro` | Skip | No salary cap |
| `dead-money.astro` | Skip | No contracts |
| `salary.astro` / `salary-archive.astro` / `salary-history.astro` | Skip-with-archive | Hide live page; preserve `mfl-player-salaries-*.json` data files as historical record at `/afl-fantasy/historical-salaries` (legacy). Salary auctions still happen so a *current-season* auction-results page may still make sense (see §4.3) |
| `contracts.astro` / `contracts/manage.astro` / `contracts/franchise-tags.astro` / `contracts-backup.astro` | Skip | Replace entire contracts area with **Keepers** suite (§4.1) |
| `cr.astro` (cap report) | Skip | No cap |
| `draft-room.astro` | Adapt | Auction vs snake — different UI. If AFL is auction, mirror auction-predictor work but for AFL roster shape |
| `draft-predictor.astro` | Adapt | Already exists for AFL (424 lines) — review against AFL draft format |
| `mock-draft/index.astro` + `[sessionId].astro` | Adapt | If AFL is auction, mock-draft becomes mock-auction (different bid mechanics) |
| `import-rankings.astro` | Dup | Generic ranking import |
| `rookies-2026.astro` | Adapt | If AFL has separate rookie pool, page format differs |
| `projected-free-agents.astro` | Adapt | Means something different in a keeper league — "non-kept players" rather than "expiring contracts" |
| `power-rankings/index.astro` + `[year]/` | Dup-plus | Generated content is league-agnostic. For AFL, footnote each ranked team with their all-play record so subjective rankings sit next to the objective "side game" record |
| `mvp.astro` | Dup | Year + league scoping already supported elsewhere; replicate |
| `rivalries/index.astro` + `[pair].astro` | Dup | H2H history; data-driven |
| `franchises/index.astro` + `[id].astro` | Dup | Per-team profile; reads config |
| `players.astro` | Dup | Player search; cross-league filter would be a nice §5 add |
| `search.astro` | Dup | Site search across pages |
| `stats.astro` | Adapt | Scoring config differs; for AFL, surface H2H record and all-play record as separate first-class columns |
| `insights.astro` | Dup | Generated via roster/results |
| `whats-new/index.astro` + `[id].astro` | Dup | Changelog; could be one shared page or per-league. Default per-league |
| `suggestions.astro` | Dup | Form → email/issue. Just retitle |
| `trade-builder.astro` | Adapt | Strip cap impact; keep player-value model. Rename "Cap Impact" panel to "Keeper Impact" — does this trade hurt your top-7 next year? |
| `league-comparison.astro` | Adapt | Now actually means cross-league (TheLeague vs AFL). Repurpose, don't duplicate |
| `league-summary.astro` | Dup | League-level stats |
| `design-system.astro` | Dup (one file) | Already shared; just verify it picks AFL tokens when on `/afl-fantasy/` |
| `css-customization.astro` | Dup | Same |
| `templates.astro` | Dup | Same |
| `assets.astro` / `icons.astro` | Dup | Already done for AFL (485 + 709 lines) |
| `theleague.astro` | Skip | TheLeague-only branding page |
| `old-hp.astro` | Skip | Legacy |
| `login.astro` | Dup | MFL login is per-league; route `/afl-fantasy/login` against AFL leagueId |
| `admin/index.astro` + `admin/schefter.astro` | Dup | Commish dashboard; gate by AFL commissioner franchise ID |
| `about.astro` | Dup | League blurb from config |

### Subsystems (not single pages)

| Subsystem | Status | Notes |
|---|---|---|
| Roger reminder pipeline (`scripts/lib/roger-reminder-window.mjs`) | Adapt | Reusable as-is. AFL just feeds different events; gotchas in CLAUDE.md still apply |
| GroupMe integration | Dup | Per-league GroupMe webhook URL in env (already supported) |
| MFL feed fetching (`scripts/fetch-mfl-feeds.mjs`) | Dup | Already accepts leagueId. Just enable AFL nightly pull |
| Backfill historical feeds | Dup | Same |
| Roster sync workflow | Dup | Same |
| PartyKit (live updates) | Adapt | Keyed by league + leagueId; check `party/` for hardcoded IDs |
| Auth/cookie handling (`src/utils/team-preferences.ts`) | Dup | Already has AFL helpers (`setAFLPreference`) |

---

## 4. AFL-only new features

### 4.1 Keepers suite (replaces Contracts)

AFL is a 7-player keeper league. The contracts page in TheLeague is the strategic centerpiece — AFL's analog is the keeper page.

- `/afl-fantasy/keepers` — current keeper selections per franchise (reads MFL `keeperList`).
- `/afl-fantasy/keepers/manage` — for the logged-in franchise, drag-and-drop top-7 builder; warns if a player won't be available next season.
- `/afl-fantasy/keepers/history` — who kept whom by year. Useful for valuation context.

Data path: `src/data/afl-fantasy/keepers/<year>.json`. Fetch via MFL `keeperList` API.

### 4.2 All-play side competition + promotion/relegation tracker

This is a real second competition layered on top of H2H. Each week, every team's score is compared to every other team's score → all-play W/L for the week. Season totals determine who stays in / promotes to / relegates from Premier League.

**Tier mechanics, precise:**
- D-League #1 and #2 stay in D-League. Premier #1-#8 stay in Premier (auto-safe).
- The 4 bubble teams — Premier #9, Premier #10, D-League #3, D-League #4 — are ranked together by all-play record at season end. Top 2 of those 4 are in Premier next year; bottom 2 are in D-League next year.
- This is **not** a playoff in the football sense — there are no extra games. It's a final standings cut. The shipped UI calls it "Promotion/Relegation playoff" which is a stretch; consider renaming to "Promotion/Relegation cutoff" or "Premier League bubble" in copy.

**Already shipped on the standings page (`?view=all_play`):**
- Premier League and D-League side-by-side tier standings (`getTierAllPlayStandings`).
- All-play computation via `calculateAllPlayFromWeekly` with cutoff week.
- The 4-team bubble cutoff sub-table.

**What's left:**

1. **Tests** for the all-play math (§2.7).
2. **Move cutoff week to config** (§2.7).
3. **"If season ended today" projections** that account for unplayed weeks (current implementation is point-in-time).
4. **Historical tier movement timeline** per franchise — `src/data/afl-fantasy/tier-history.json`. New small page or section on franchise detail.
5. **Optional dedicated `/afl-fantasy/tiers` page** that's promotion/relegation-first (today the standings page is playoff-first with all-play as a tab). Decide whether to surface this as its own URL for permalinks/social shares, or keep everything on `standings`.
6. **Power-rankings annotation** — footnote each ranked team with their all-play record so subjective rankings sit next to the objective race.

**Not the same as power rankings.** Power rankings are subjective; all-play is a real W/L record with promotion/relegation stakes. Already correctly framed in the shipped UI.

### 4.3 Auction results / history

Even without an ongoing salary cap, auction night is a major event. A simple "what was paid for whom" archive:

- `/afl-fantasy/auction/<year>` — sortable table of every auction win.
- Reuses `mfl-player-salaries-*.json` data we already have.

### 4.4 AFL Schefter persona

The `schefter` agent in `.claude/agents/` is currently TheLeague-flavored. Add an AFL voice profile (different tone? — e.g. cricket-broadcaster-meets-Schefter, since AFL = American Football League name) and route posts through it when `league.slug === 'afl'`. Keeps the two leagues distinct in feed identity instead of feeling like a copy-paste.

---

## 5. Cross-league features (for the 7 dual-league owners)

`CROSS_LEAGUE_TEAM_MAP` is already in place. Build the surfaces:

1. **My Teams panel** — header dropdown shows both my teams when both cookies are set; click switches league context.
2. **Cross-league player ownership** — player profile shows "Owned by Pacific Pigskins in TheLeague + Smokane FC in AFL". Useful for trade negotiations.
3. **Combined activity feed** (opt-in) — single chronological view of transactions across both leagues for the dual-league subset.
4. **Comparative dashboard** — repurposed `league-comparison.astro`: side-by-side standings, my W-L in each, my keeper/contract status across both.

---

## 6. Phased rollout

Each phase is one or more PRs into `claude/plan-afl-version-mjyIK` (then merged to main).

### Phase 0 — Foundation (architecture only, ~1 week)
1. League config unification (§2.1). PR.
2. **Feed path normalization.** AFL feeds at `data/afl-fantasy/mfl-feeds/<year>/`, TheLeague feeds at `data/theleague/mfl-feeds/<year>/`. Pick one canonical layout (recommend `data/<slug>/mfl-feeds/<year>/`), migrate the other, update every `import.meta.glob` and script `path.join` reference. Land before §2.5 so the workflow matrix doesn't have to branch on path shape. PR.
3. `LeagueLayout` rename + prop-drive (§2.2). PR.
4. Middleware host map (§2.3). PR.
5. Schefter `runForLeague(league)` refactor (§2.4). PR.
6. Workflows matrix conversion (§2.5). PR.
7. `<LeagueSwitcher>` component (§2.6). PR.
8. All-play library hardening (§2.7) — small follow-ups, library itself already in `src/utils/standings.ts`. PR.

**Exit criteria:** every TheLeague page still renders identically; AFL stub pages still render; no behavior change visible to users.

### Phase 1 — Core read-only AFL pages (~1 week)

**Already shipped:** `standings` (925 lines), `playoffs` (2,743 lines), `rosters` (524 lines, partial), `draft-predictor` (424 lines), `assets` (485 lines), `icons` (709 lines), `index` (238 lines).

**Remaining:** `about`, `franchises/index` + `[id]`, `players`, `news` + `news/[id]`, `activity`, plus polish on the rosters page (drop salary/contract columns, add keeper-eligibility column).

Goal: a logged-out visitor to `/afl-fantasy` gets a usable experience.

### Phase 2 — AFL-specific mechanics (~1 week, smaller than originally scoped)
- Vitest coverage for `src/utils/standings.ts` all-play math (§2.7).
- Move `PREMIER_LEAGUE_CUTOFF_WEEK` to config (§2.7).
- **Backfill `championsByYear` (2003-present).** Build `data/afl-fantasy/championship-history.json` mirroring the existing `data/theleague/championship-history.json` shape (per-year `{champion, runnerUp, championName, runnerUpName}` franchise-id entries). Standings page reads from JSON; new years are data edits.
  - Source: MFL public API. **No auth needed** for historical reads.
  - **2020-present**: hit `TYPE=playoffBracket&BRACKET_ID=1` on the year's host. Final `playoffRound` entry has `franchise_id` + `points` for each side; higher score wins.
  - **2003-2019**: `playoffBracket` returns seeds only (no franchise winners) for those seasons — fall back to `TYPE=weeklyResults&W={championship_week}`, where the championship week is `startWeek + startWeekGames - 1` from `playoffBrackets` metadata.
  - **Per-year host + league ID mapping is already on disk**: `data/afl-fantasy/mfl-feeds/2024/league.json` → `league.history.league[]`. AFL had a different host *and* league ID every year from 2003-2015, then settled on `www44/L=19621` from 2016+. The script must respect this map; using `19621` for older years returns wrong data.
  - **Reusable code**: `scripts/compute-franchise-history.mjs` (specifically `getChampionshipResult()` at lines 181-227) already implements the bracket-walking logic for TheLeague and handles both array and object `playoffRound` shapes. Generalize it to take a `(slug, year)` argument and run for both leagues from the same script.
  - Same audit on TheLeague — verify its `championship-history.json` is current and complete.
- **Fix the bad 2011 AFL feed cache.** `data/afl-fantasy/mfl-feeds/2011/` was fetched with league ID `48815` (a TheLeague year ID). Correct AFL 2011 ID is `36377` on `www49`. Re-fetch and overwrite. Surface this as a check in the per-year fetch script so wrong-league regressions can't happen again.
- Reword the misleading `?view=all_play` subtitle on standings (§3 standings row follow-up #3).
- Rename "Promotion/Relegation playoff" copy on standings to "Promotion/Relegation cutoff" or similar — it's a final-standings cut, not a bracket of games.
- Tier-movement history page or franchise-detail section (§4.2 #4).
- "If season ended today" forecasts (§4.2 #3).
- Keepers suite (§4.1).
- Calendar with AFL events.
- Auction archive (§4.3).
- AFL `rules.astro` + Ask Roger wired to AFL constitution.

### Phase 3 — Schefter pipeline live for AFL (~3 days)
- AFL workflows running on cron, posting to AFL Schefter feed.
- AFL voice/persona in `schefter` agent (§4.4).
- AFL GroupMe wiring.

### Phase 4 — Draft + auction tools (~1-2 weeks)
- AFL `draft-predictor` review (already exists), `draft-room`/auction tool, `mock-draft` adaptation, `rookies-202X`, `projected-free-agents` repurposed for keeper context.

### Phase 5 — Long tail (~1 week)
- `power-rankings`, `mvp`, `rivalries`, `whats-new`, `insights`, `league-summary`, `stats`, `lineup`, `matchup-*`, `import-rankings`, `search`, `suggestions`, `trade-builder`, `admin`, `login`.
- These are mostly Dup or thin Adapt — should move quickly.

### Phase 6 — Cross-league surfaces (~3 days)
- `<LeagueSwitcher>` enhancements, My Teams panel, cross-league player ownership, combined activity, comparative dashboard.

### Phase 7 — Domain split (when ready)
- DNS/Vercel: point `afl-fantasy.com` at this app.
- Flip middleware host map entry from dormant to active.
- 301 redirects for any leaked `theleague.us/afl-fantasy/*` links.
- Per-domain OG images, sitemap, robots.

---

## 7. Risks & open questions

1. **Auction vs snake**: confirm AFL draft format. If auction, the draft tooling is heavier work than a "duplicate" because TheLeague's draft tool may not be auction-shaped. (The existing `draft-predictor.astro` for AFL suggests it's been thought about.)
2. **Lineup format**: confirm AFL starter slots and scoring. Drives stats/lineup/matchup pages.
3. **Keeper rules edge cases**: are kept players' MFL "salaries" set to anything special (e.g. round-based pricing)? This affects the keeper UI.
4. **Tier movement — confirmed.** No Premier or D-League playoffs. D-League #1, #2 stay in D-League. Premier #1-#8 are auto-safe. Premier #9, #10 + D-League #3, #4 are ranked together by all-play; top 2 are in Premier next year, bottom 2 in D-League. So 0-2 D-League teams promote per year (depending on how D3/D4 fare vs P9/P10). Re-confirm this matches written rules before any tooling depends on the cutoffs.
5. **`afl-fantasy.com` ownership**: do we own the domain? If not, factor acquisition into the Phase 7 timeline.
6. **Inconsistent config location**: TheLeague config is at `src/data/theleague.config.json`; AFL config is at `data/afl-fantasy/afl.config.json`. Phase 0 §2.1 must pick one and migrate the other.
7. **AFL voice/persona**: gut-check what AFL Schefter should sound like before Phase 3. Different enough from TheLeague Schefter to feel like its own beat, not so different it feels gimmicky.
8. **Roger for AFL**: is there an AFL "rules nag"-style commish persona, or is Ask Roger TheLeague-only forever? Currently the schefter-scan code says AFL has "its own commish and cadence" — clarify.
9. **Salary data utility**: AFL has 19 years of salary JSON. Is that auction-history data, or stale-from-when-AFL-had-cap data? Affects whether §4.3 is a backward-looking archive or rolling history.
10. ~~**Champions backfill source**~~ — answered. MFL's public API has it back to 2003 via `TYPE=playoffBracket` (2020+) and `TYPE=weeklyResults` (2003-2019). Per-year host/league-id mapping is in `data/afl-fantasy/mfl-feeds/2024/league.json`. Plan committed in Phase 2.

---

## 8. Definition of done

- A logged-out visitor can navigate `/afl-fantasy/*` and see a complete site analogous to `/theleague/*` (modulo Skip rows in §3).
- A logged-in AFL franchise can read rosters, news, standings, calendar, keepers, and submit lineup-equivalent actions if applicable.
- The Schefter feed posts AFL transactions on cron, identical cadence to TheLeague.
- All workflows run via matrix; deleting either league from the matrix deactivates that league cleanly.
- `afl-fantasy.com` is wired and the middleware serves the AFL site at root on that host (Phase 7).
- A dual-league owner can switch context with one click and see their roster/keepers in either league.

---

*Last updated: 2026-05-10. Updates to this plan should land on the same branch alongside the work that prompted them.*
