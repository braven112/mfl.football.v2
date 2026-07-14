# Standings Table Consolidation — Design Doc (Phase 6)

**Status:** Design only. No component/page code changes in this branch.
**Author:** refactor Phase 6 agent · **Reviewer:** Brandon
**Goal:** Collapse the overlapping standings-table components into ONE
config-driven, server-rendered component family. Zero client JS in the
detail tables (the current detail tables already ship zero JS; keep it that
way). Preserve every current visual and league-specific behavior.

---

## 1. Scope

### In scope — the "detail table" family (rendered on the two `/standings` pages)

| Component | LOC | League(s) | Where used |
|---|---|---|---|
| `StandingsTable.astro` | 748 | both | division view (TL + AFL), all-play view (TL) |
| `LeagueStandingsTable.astro` | 485 | TheLeague | league view (seeded, 16-team) |
| `ConferenceLeagueStandingsTable.astro` | 531 | AFL | league view (×2, one per conference) |
| `TierAllPlayStandingsTable.astro` | 586 | AFL | all-play view (per-tier + combined) |
| `ConferenceStandingsTable.astro` | 286 | — | **DEAD CODE — zero importers repo-wide** |

Total in-scope LOC: ~2,636 (2,350 excluding the dead file).

### Adjacent — compact/hero variants (design so the schema *can* absorb them; convert later)

| Component | LOC | Notes |
|---|---|---|
| `season-heroes/StandingsHero.astro` | 349 | homepage hero top-6, TL only, self-loads feed |
| `hp-sections/HpStandingsCompact.astro` | 395 | homepage compact, TL, in-season/offseason modes, self-loads feed |
| `afl/hp-sections/AflStandingsCompact.astro` | 464 | homepage compact, AFL tier-window, receives feed as prop |

Phase 4 may already be unifying the two compact cards. This design does **not**
depend on that outcome — the compact/hero conversions are a stretch goal (§5.6),
not the core deliverable.

### Explicitly OUT of scope

- **`LeagueSummaryTable.astro` (676 LOC).** Despite the name it is **not** a
  standings table. It is a multi-year metric matrix (`TeamSummary[]`, `years[]`,
  `CategoryDefinition[]`) with a **client-side `<script>`** doing category
  selection, per-column sorting, quartile heat-coloring, and sub-category pills.
  Different data domain, different interaction model, requires client JS. Folding
  it into the standings family would fight the "zero client JS" goal. Leave it
  alone. (Consumed only by `pages/theleague/league-summary.astro`.)
- The inline **NIT standings table** in `afl-fantasy/standings.astro` (lines
  ~324-371) and the **promo/reg** section below it. These are page-local one-offs
  reading derived arrays; optional cleanup, not required.

---

## 2. Current-state inventory (in-scope + hero/compact)

### 2.1 Data producers (all in `src/utils/standings.ts`)

Every detail table consumes `TeamStanding[]` (`src/types/standings.ts`), which
extends the raw `StandingsFranchise` MFL feed with `teamName`, `division`,
`teamIcon`, `teamBanner`, `seed?`. Producers:

- `getDivisionStandings(f, cfg)` → `{ name, teams }[]` — seeds injected from league standings.
- `getLeagueStandings(f, cfg)` → `TeamStanding[]` with `seed` (division winners take top seeds).
- `getAllPlayStandings(f, cfg, calc?)` → `TeamStanding[]` sorted by all-play pct.
- `getTierAllPlayStandings(f, cfg, calc?, tierMembership?)` → `{ tier, teams }[]`.
- `getConferenceStandings(f, cfg, code)` → `{ conference, divisionWinners, wildCards, allTeams }`
  — the tables use `.allTeams` (each row carries `conferenceSeed`).

The **row model is uniform** (`TeamStanding`); tables differ only in which
fields they render, how they seed/tier, and how they render the team cell.

### 2.2 Per-component detail

**StandingsTable.astro** — the most overloaded. `view: 'division' | 'league' | 'all_play'`.
- Props: `teams, view, showDivisionHeader?, divisionName?, conferenceId?, defendingChampion?, defendingChampionYear?, defendingChampionLogo?, divisionBadge?, year?, preferredTeamId?, rosterBaseUrl?, franchiseBaseUrl?`.
- Team cell: **banner** image (`teamBanner`), with text fallback when banner is the historical placeholder. Link target = `franchiseBaseUrl/{id}` OR `rosterBaseUrl?franchise={id}`.
- Columns by view:
  - `division`: Seed(PlayoffBadge) · Team · Overall(h2hwlt) · PCT(h2hpct) · **GB(computed)** · **Strk** · Div(divwlt) · PF · PA
  - `all_play`: Seed(PlayoffBadge) · Team · Record(all_play_wlt/derived) · PCT(all_play_pct) · PF · PA · PWR · VP
  - `league`: gray seed pill · Team · Record · PCT · PF · PA · PWR · VP
- Two header styles: branded compass-badge header (`divisionBadge` set) and plain division header (conference logo + name). Defending-champion sub-line.
- `deriveAllPlayWLT()` reconstructs record from pct (240 games ≤2020, 255 ≥2021).
- **League styling hooks:** `:global(html.dark[data-league="afl"])` overrides at
  lines **345** (whole-card red/conference-blue glow) and **456** (champion
  subtitle → trophy gold). Conference blue injected via inline
  `--division-accent` (`conferenceId === '01'`). The `league` view branch is
  **not referenced by current call sites** (TL uses `LeagueStandingsTable`, AFL
  uses `ConferenceLeagueStandingsTable`) — confirm at review (open question 1).

**LeagueStandingsTable.astro** — TheLeague 16-team seeded table.
- Props: `teams, year?, preferredTeamId?, rosterBaseUrl?, franchiseBaseUrl?`.
- Columns: Seed(plain bold #) · Team(banner, **no text fallback** — blank cell when banner missing) · Overall · PCT · Div · Div PCT · All Play · PF · PWR · VP · PA.
- **Gotcha:** its `deriveAllPlayWLT` (line 28) lacks the `percentage <= 0`
  guard the other three copies have — see §2.3.1 and open question 8.
- Tiering by `seed`: `getRowColor` → division-winners(≤4) / wild-cards(≤7) / play-in(≤9) / toilet-bowl(≥10), with tier-boundary bottom borders. Fixed pastel bands, dark-mode translucent washes. Blue accent glow card.

**ConferenceLeagueStandingsTable.astro** — AFL per-conference full table.
- Props: `conferenceName, conferenceId?, teams, year?, preferredTeamId?, rosterBaseUrl?, divisionWinnerCount=2`.
- Columns: Seed(#conferenceSeed) · Team(banner) · Overall · PCT · Div · Div PCT · All Play · PF · PWR · VP · PA. (Same column *set* as LeagueStandingsTable, different seed field + header.)
- Tiering by `conferenceSeed`: division-winners(≤divisionWinnerCount) / wild-cards(≤4) / eliminated. Conference logo + accent-colored title (AL red / NL blue), red/blue card glow. Mobile hides Div PCT/PWR/PA.

**TierAllPlayStandingsTable.astro** — AFL all-play, grouped by tier.
- Props: `tierName, teams, year?, rosterBaseUrl?, promotionCutoff?`.
- Team cell: **icon** (not banner). Columns: Rank(circle badge) · Team · All-Play Record · **Prize**.
- **Formatter quirk:** its record cell suppresses the tie segment when ties
  are zero — `12-3`, not `12-3-0` (line 157). The other three tables always
  render `W-L-T`. Captured as `omitZeroTies` in the column schema (§3.1).
- Heavy rank-specific styling: gold/silver/bronze/playoff/relegation row classes, promotion/relegation arrows (⬆/⬇), prize map per tier, `promotionCutoff` for the 2017 "Founders Table". Red card glow.

**ConferenceStandingsTable.astro** — **DEAD.** Playoff-seeding layout (two
sub-sections: Division Winners + Wild Card; icon+division team cell;
Seed·Team·Record·PF·PA). Not imported anywhere (verified `grep` across `.astro`/
`.ts`/`.tsx`). **Delete during migration** — do not port.

**Hero/compact (self-contained, own row types, own feed loading):**
- `StandingsHero`: top-6 by wins, cols Rank·Team(color chip)·Record·PF·Strk, user pinned below with separator. Falls back to a stub if no games.
- `HpStandingsCompact`: in-season (playoff seeding via `getLeagueStandings`) vs offseason (cap-space sort); contextual window around user; cols #·Team·Record·PF·Cap.
- `AflStandingsCompact`: single-tier 5-row window centered on user, cutline row; cols #·Team·All-Play·PF.

### 2.3 What they share (the seam to exploit)

1. `parseWLT` + `deriveAllPlayWLT` + `safeParseFloat`/`safeParseInt`
   helpers copy-pasted across StandingsTable / LeagueStandingsTable /
   ConferenceLeagueStandingsTable / TierAllPlayStandingsTable. **Extract once —
   but note they are NOT byte-identical.** One real divergence:
   `LeagueStandingsTable.astro:28` guards only `isNaN(percentage)`, while the
   other three (`StandingsTable.astro:58`, `ConferenceLeagueStandingsTable.astro:55`,
   `TierAllPlayStandingsTable.astro:49`) also guard `|| percentage <= 0`.
   Consequence today: a team with `all_play_pct === "0"` and no `all_play_wlt`
   (pre-all-play-era feeds) renders **`0-240-0` / `0-255-0` in TL Playoff
   Standings** but **`N/A` everywhere else**. The shared helper adopts the
   guarded (`<= 0 → null → 'N/A'`) version — the unguarded one fabricates a
   season from missing data (the guarded files' own comments call this out).
   This is a deliberate, visible behavior change on TL `?view=league` for
   pre-2017 years and needs owner sign-off — see open question 8. Verification
   must exercise a zero-pct historical season explicitly (§5 matrix).
2. Identical preferred-team highlight CSS (green light / accent-glass dark),
   identical dark-card glow recipe, identical table/thead/td base styling,
   identical team-banner-link markup. **One stylesheet, tokenized.**
3. Same tier-band + tier-boundary mechanism (LeagueStandingsTable and
   ConferenceLeagueStandingsTable are the same table with a different seed field
   and tier thresholds).

---

## 3. Proposed unified API

One component: `src/components/theleague/standings/StandingsTable.astro`
(new folder; the old file is replaced). Column set, team-cell mode, tiering,
and header are all **data**, passed as a resolved config object. Page code keeps
building `TeamStanding[]` from the existing `standings.ts` producers — the
refactor is purely presentational.

### 3.1 TypeScript prop types

```ts
// src/components/theleague/standings/standings-table-config.ts
import type { TeamStanding } from '../../../types/standings';

/** Which prebuilt column a config references. Formatter/alignment live here,
 *  not at the call site. */
export type StandingsColumnKey =
  // The seed cell has THREE distinct renderings in the current code — one key
  // per rendering, because the `accent` prop cannot drive this and the two
  // seeded presets need different results:
  | 'seedPill'       // gray pill '#{seed}' (StandingsTable.astro:676-684 —
                     //   only the unused league-view branch; dies with open q.1)
  | 'seedPlain'      // plain bold '#{seed}' (LeagueStandingsTable.astro:421-425)
  | 'seedAccent'     // conference-colored '#{conferenceSeed}', AL red / NL blue
                     //   via --division-accent (ConferenceLeagueStandingsTable
                     //   .astro:372,376-380)
  | 'playoffBadge'   // <PlayoffBadge> (division/all-play StandingsTable style)
  | 'rankCircle'     // circular rank badge (tier table style)
  | 'team'           // team cell — render mode set by `teamCell` below
  | 'overallRecord'  // h2hwlt
  | 'overallPct'     // h2hpct (3dp)
  | 'divRecord'      // divwlt
  | 'divPct'         // divpct (3dp)
  | 'allPlayRecord'  // all_play_wlt or derived — see `omitZeroTies` below
  | 'allPlayPct'     // all_play_pct (3dp)
  | 'gamesBack'      // computed within-group GB (division only)
  | 'streak'         // strk
  | 'pf' | 'pa' | 'pwr' | 'vp'
  | 'prize';         // AFL tier prize + promo/reg arrow

export interface StandingsColumn {
  key: StandingsColumnKey;
  header: string;
  align?: 'left' | 'center' | 'right';   // default: left for team, center otherwise
  /** Hide below this breakpoint. 'sm' ≈ ≤767px. Maps to a utility class,
   *  not inline media queries, so the CSS stays static. */
  hideBelow?: 'sm';
  widthCh?: number;                       // optional fixed width hint
  /** allPlayRecord only. The tier table renders '12-3' when ties are zero
   *  (TierAllPlayStandingsTable.astro:157); the other three always render
   *  '12-3-0'. Set true in the tierAllPlay preset; default false. */
  omitZeroTies?: boolean;
}

export type TeamCellMode =
  | 'banner'   // <img class=team-banner> — missing-banner behavior is set by
               //   `teamCellFallback`, NOT baked into the mode (see below)
  | 'icon'     // square icon + name (tier table)
  | 'chip';    // color chip + name (hero/compact, stretch only)
// NOTE: no 'iconMeta' mode — it existed only in the dead
// ConferenceStandingsTable, which step 1 deletes. Don't port it.

/** What the 'banner' team cell renders when the banner is missing or is the
 *  HISTORICAL_TEAM_BANNER_FALLBACK placeholder. This is THREE-into-two
 *  current behaviors made explicit:
 *  - 'name'  → text-fallback span, always rendered alongside/instead of the
 *              banner (StandingsTable.astro:185,237)
 *  - 'blank' → banner only; empty cell when missing
 *              (LeagueStandingsTable.astro:104-130,
 *               ConferenceLeagueStandingsTable.astro:139-165)
 *  Preserve each call site's current value (see §4 mapping) — do NOT unify. */
export type TeamCellFallback = 'name' | 'blank';

/** Seed field + tier thresholds. Drives row band + boundary borders. */
export interface StandingsTiering {
  seedField: 'seed' | 'conferenceSeed';
  /** Ordered bands, top-to-bottom. `upTo` is inclusive max seed for the band;
   *  omit on the final band (catch-all). `boundary` draws the divider below. */
  bands: Array<{ name: 'division-winners' | 'wild-cards' | 'play-in'
                 | 'toilet-bowl' | 'eliminated';
                 upTo?: number; boundary?: boolean }>;
}

/** Defending-champion line. The two leagues render this in mutually exclusive
 *  ways today, so the schema must carry both:
 *  - TL brandedDivision: champion as a LOGO image on a white circle, no text
 *    (StandingsTable.astro:110-115) → set `logoSrc` (+ `name` for alt/title).
 *  - AFL plain division header: champion as TEXT — "{year} Division
 *    Champions: {name}" (StandingsTable.astro:135-137; the AFL call site
 *    passes no logo) → set `name` + `year`, leave `logoSrc` unset.
 *  Rendering rule: `logoSrc` present → logo treatment; otherwise text line. */
export interface DefendingChampion {
  name: string;
  year?: number;
  logoSrc?: string;
}

export interface StandingsHeader {
  kind: 'none' | 'division' | 'brandedDivision' | 'conference' | 'tier';
  title?: string;
  logoSrc?: string; logoDarkSrc?: string;   // ThemeImage pair
  /** Compass badge (brandedDivision). If `kind: 'brandedDivision'` but
   *  badgeSrc is undefined (historical division name missing from the
   *  divisionBadges map), the component MUST fall back to the plain
   *  'division' rendering — this preserves the current `hasBrandedHeader`
   *  guard (StandingsTable.astro:40,120), which already degrades exactly
   *  this way. Never render a broken <img>. */
  badgeSrc?: string;
  accentColor?: string; accentColorDark?: string; // conference title hue
  defendingChampion?: DefendingChampion;
  subtitle?: string;                          // generic extra line (rarely needed)
}

export interface StandingsTableProps {
  teams: TeamStanding[];
  columns: StandingsColumn[];
  teamCell: TeamCellMode;
  /** Required when teamCell === 'banner'; see TeamCellFallback. */
  teamCellFallback?: TeamCellFallback;
  tiering?: StandingsTiering;         // omit → no bands
  header?: StandingsHeader;           // omit → bare table
  year?: number;                      // for all-play derivation
  preferredTeamId?: string;
  /** Link builder for the team cell. */
  rosterBaseUrl?: string;
  franchiseBaseUrl?: string;
  /** AFL red/conference-blue card glow vs TheLeague blue. Replaces the
   *  data-league / conferenceId branches. */
  accent?: 'league-blue' | 'afl-red' | 'conference-blue';
  /** Tier-table extras (only read when a `prize`/`rankCircle` column present). */
  tierName?: string;
  promotionCutoff?: number;
}
```

Column formatting (record parsing, pct rounding, GB math, all-play derivation)
moves into a shared `standings-cells.ts` used by the component — the four
copy-pasted helpers collapse to one import.

### 3.2 Column presets

To keep call sites terse, export named presets from the config module:

```ts
export const COLUMNS = {
  division: [ /* playoffBadge, team, overallRecord, overallPct, gamesBack,
                 streak, divRecord, pf, pa */ ],
  leagueSeeded: [ /* seedPlain, team, overallRecord, overallPct, divRecord,
                    divPct, allPlayRecord, pf, pwr, vp, pa */ ],
  conferenceSeeded: [ /* seedAccent (reads conferenceSeed), team, overallRecord,
                        overallPct, divRecord, divPct(hideBelow:'sm'),
                        allPlayRecord, pf, pwr(hideBelow:'sm'), vp,
                        pa(hideBelow:'sm') — mobile hiding per
                        ConferenceLeagueStandingsTable.astro:524-529 */ ],
  allPlay: [ /* playoffBadge, team, allPlayRecord, allPlayPct, pf, pa, pwr, vp */ ],
  tierAllPlay: [ /* rankCircle, team, allPlayRecord{omitZeroTies:true}, prize */ ],
} satisfies Record<string, StandingsColumn[]>;

export const TIERING = {
  leagueSeed: { seedField: 'seed', bands: [
    { name: 'division-winners', upTo: 4, boundary: true },
    { name: 'wild-cards', upTo: 7, boundary: true },
    { name: 'play-in', upTo: 9, boundary: true },
    { name: 'toilet-bowl' } ] },
  conferenceSeed: (dwCount: number) => ({ seedField: 'conferenceSeed', bands: [
    { name: 'division-winners', upTo: dwCount, boundary: true },
    { name: 'wild-cards', upTo: 4, boundary: true },
    { name: 'eliminated' } ] }),
} as const;
```

---

## 4. How each current usage maps

| # | Current call site | New config |
|---|---|---|
| 1 | TL `standings.astro` division `<StandingsTable view="division">` | `columns=COLUMNS.division, teamCell='banner', teamCellFallback='name', header={brandedDivision, badgeSrc, defendingChampion:{name, logoSrc}}, accent='league-blue', franchiseBaseUrl` |
| 2 | TL `standings.astro` league `<LeagueStandingsTable>` | `columns=COLUMNS.leagueSeeded, teamCell='banner', teamCellFallback='blank', tiering=TIERING.leagueSeed, accent='league-blue'` |
| 3 | TL `standings.astro` all-play `<StandingsTable view="all_play">` | `columns=COLUMNS.allPlay, teamCell='banner', teamCellFallback='name', accent='league-blue'` |
| 4 | AFL `standings.astro` division `<StandingsTable view="division">` | `columns=COLUMNS.division, teamCell='banner', teamCellFallback='name', header={division, confLogo pair, defendingChampion:{name, year}}, accent='conference-blue'\|'afl-red', rosterBaseUrl` |
| 5 | AFL `standings.astro` league `<ConferenceLeagueStandingsTable>` ×2 | `columns=COLUMNS.conferenceSeeded, teamCell='banner', teamCellFallback='blank', tiering=TIERING.conferenceSeed(dw), header={conference}, accent per conf` |
| 6 | AFL `standings.astro` all-play tiers `<TierAllPlayStandingsTable>` | `columns=COLUMNS.tierAllPlay, teamCell='icon', header={tier}, tierName, accent='afl-red'` |
| 7 | AFL `standings.astro` combined all-play `<TierAllPlayStandingsTable promotionCutoff>` | same as #6 + `promotionCutoff` |
| — | (dead) `ConferenceStandingsTable` | delete |
| 8a-c | `StandingsHero` / `HpStandingsCompact` / `AflStandingsCompact` | stretch: `columns` presets `heroTop`, `compactCap`, `tierWindow`; add `chip` teamCell + compact density flag. Their feed-loading/windowing logic stays in the component or a small helper. |

`teamCellFallback` values above are load-bearing: usages 1/3/4 keep the
text-fallback span today; usages 2/5 render banner-only with a blank cell.
Converting 2/5 with `'name'` would newly show team-name text on historical
rows — a silent visual diff the snapshot gate (§5) must catch.

### 4.1 Before / after examples

**A. TheLeague division (usage #1)**

```astro
<!-- before -->
<StandingsTable teams={division.teams} view="division" showDivisionHeader
  divisionName={division.name} divisionBadge={divisionBadges[division.name]}
  defendingChampion={defendingChampions[division.name]?.name}
  defendingChampionLogo={defendingChampions[division.name]?.icon}
  defendingChampionYear={previousYear} year={selectedYear}
  preferredTeamId={yearPreferredTeamId} franchiseBaseUrl="/theleague/franchises" />

<!-- after -->
<StandingsTable teams={division.teams} columns={COLUMNS.division} teamCell="banner"
  teamCellFallback="name" accent="league-blue" year={selectedYear}
  preferredTeamId={yearPreferredTeamId} franchiseBaseUrl="/theleague/franchises"
  header={{ kind: 'brandedDivision', title: division.name,
            badgeSrc: divisionBadges[division.name],
            defendingChampion: defendingChampions[division.name] && {
              name: defendingChampions[division.name].name,
              year: previousYear,
              logoSrc: defendingChampions[division.name].icon, // logo treatment (TL)
            } }} />
```

**B. TheLeague league view (usage #2) — collapses a whole component**

```astro
<!-- before --> <LeagueStandingsTable teams={leagueStandings} year={selectedYear}
  preferredTeamId={yearPreferredTeamId} franchiseBaseUrl="/theleague/franchises" />
<!-- after -->  <StandingsTable teams={leagueStandings} columns={COLUMNS.leagueSeeded}
  teamCell="banner" teamCellFallback="blank" tiering={TIERING.leagueSeed}
  accent="league-blue" year={selectedYear} preferredTeamId={yearPreferredTeamId}
  franchiseBaseUrl="/theleague/franchises" />
```

**C. AFL conference league view (usage #5)**

```astro
<!-- before -->
<ConferenceLeagueStandingsTable conferenceName={confA.conference.name} conferenceId="00"
  teams={confA.allTeams} year={selectedYear} preferredTeamId={yearPreferredTeamId}
  rosterBaseUrl={`${baseUrl}/rosters`} divisionWinnerCount={confA.conference.divisions.length} />
<!-- after -->
<StandingsTable teams={confA.allTeams} columns={COLUMNS.conferenceSeeded} teamCell="banner"
  teamCellFallback="blank" tiering={TIERING.conferenceSeed(confA.conference.divisions.length)}
  accent="afl-red" year={selectedYear} preferredTeamId={yearPreferredTeamId}
  rosterBaseUrl={`${baseUrl}/rosters`}
  header={{ kind: 'conference', title: confA.conference.name, logoSrc: confALogo,
            logoDarkSrc: confALogoDark, accentColor: '#c41e3a', accentColorDark: '#f47a8f' }} />
```

---

## 5. Migration plan (lowest-risk first)

Convert one call site per PR-sized step; verify each before moving on. Both
leagues share the component, so **every step verifies both `/standings` pages**
even when only one league's call site changed.

0. **Scaffold + baseline, no call-site change.** Add `standings/` folder:
   shared `standings-cells.ts` (extracted helpers) + `standings-table-config.ts`
   (types + presets) + new `StandingsTable.astro`. Unit-test the cell helpers
   (record parse, all-play derivation at 240/255, **the zero-pct guard from
   §2.3.1 — including a `pct === "0"` case locking in `null`/`'N/A'`**, GB
   math). Helpers are lifted from the guarded variants; the one divergence is
   resolved per open question 8, not "verbatim" (there is no single verbatim).
   **Also capture the visual-regression baseline now, from unmodified
   `origin/main`:** Playwright screenshot snapshots across the matrix
   {TL, AFL} × {division, league, all_play} × {light, dark} × {desktop,
   ≤767px} × representative years {current, 2010 (AFL 6-division era),
   2016 (pre-all-play → exercises the zero-pct path), 2017 (Founders Table),
   2021 (255-game all-play)}. Every later step diffs against this baseline —
   manual side-by-side alone cannot catch the silent per-season diffs in
   findings §2.3.1 / teamCellFallback / omitZeroTies.
1. **Delete `ConferenceStandingsTable.astro`** (dead). Grep confirms zero
   importers. Zero visual risk.
2. **all-play views (usages #3, #6, #7)** — visually simplest, fewest columns.
   Convert TL all-play (StandingsTable→new) and AFL tier/combined all-play
   (TierAllPlayStandingsTable→new). Verify: TL `/standings?view=all_play`; AFL
   `/standings?view=all_play` current season (tiered) **and** a pre-2017 season
   (combined + Founders Table promotion arrows) and 2017 itself.
3. **league views (usages #2, #5)** — the tier-band tables. Convert
   LeagueStandingsTable + both ConferenceLeagueStandingsTable instances. Verify:
   TL `?view=league` (4 tier bands + boundaries + preferred-team highlight);
   AFL `?view=league` (both conferences, AL red / NL blue, division-winner
   counts for a 3-division historical season).
4. **division views (usages #1, #4)** — most header complexity (branded compass
   badge, defending champion logo-vs-text, conference logo). Convert last.
   Verify: TL division (branded header, champion **logo**, GB/Strk columns);
   AFL division (conference-logo header, champion **text** line, NL blue glow,
   mobile font-shrink — note the division view does NOT hide columns on
   mobile; `StandingsTable.astro:720-747` only shrinks fonts/padding. Column
   hiding exists only in the conference league view, verified in step 3).
5. **Delete the five old detail components** once no call site imports them.
   `grep` gate in CI/pre-push.
6. **(Stretch) hero + compact.** Only after the detail family is stable and
   Phase 4's compact merge has landed. Add `chip` teamCell + density flag +
   hero/compact column presets; keep feed-loading/windowing in the components.

**Verification per step:** run the step-0 snapshot suite against the baseline
(this is the gate — a pixel diff on any matrix cell blocks the step), then
manually load each named page in light **and** dark mode, desktop + ≤767px,
with and without a `?myteam=`/preferred team set (the highlight path). The
only *expected* diffs are the ones §7 pre-authorizes (open question 8's
zero-pct change, if approved); anything else is a regression.

---

## 6. Out of scope (explicit)

- `LeagueSummaryTable.astro` (client-JS metric matrix — different domain).
- The inline NIT + promo/reg blocks in the AFL standings page.
- Any change to `standings.ts` producers, tiebreaker logic, or `TeamStanding`.
- Draft-predictor / playoff-bracket components (not standings tables).
- New columns or new visual treatments — this is a **behavior-preserving**
  consolidation. If a discrepancy is found between two tables, match the current
  per-page behavior; do not "harmonize" silently.

---

## 7. Risks & open questions (for Brandon at review)

> **Review outcome (2026-07-14):** Brandon answered at review. All eight
> questions are resolved — decisions recorded inline below. The design is
> cleared for implementation.

1. **`StandingsTable`'s `league` view branch appears unused.** TheLeague routes
   its league view through `LeagueStandingsTable` and AFL through
   `ConferenceLeagueStandingsTable`. Confirm no season/edge path still renders
   `StandingsTable view="league"`.
   **✅ RESOLVED (by verification, 2026-07-14):** Brandon deferred to evidence.
   Repo-wide grep shows exactly three `<StandingsTable>` call sites
   (`theleague/standings.astro:188,213`, `afl-fantasy/standings.astro:275`),
   all `view="division"` or `view="all_play"`, none passing a dynamic view
   variable (AFL's `?view=` query param falls back to division). `view="league"`
   is dead — drop that column set.
2. **Banner vs icon team cell.** Full tables use `teamBanner` (wide art); the
   tier table uses square `teamIcon`.
   **✅ DECIDED: keep icons** in the AFL tier table — no visual change.
3. **`accent` model.** Today the AFL glow is driven by `data-league="afl"`
   `:global` selectors (StandingsTable:345) plus inline `--division-accent` for
   NL blue. Proposal replaces this with an explicit `accent` prop +
   `--division-accent` set by the component (`data-league` stays elsewhere).
   **✅ APPROVED.**
4. **Prize/promotion styling is very rank-specific** (gold/silver/bronze,
   ⬆/⬇ arrows, hard-coded prize dollar amounts per tier). Plan: keep it as
   tier-table-only logic gated behind the `prize`/`rankCircle` columns, not
   forced into the generic schema.
   **✅ APPROVED.**
5. **Compact/hero convergence.** Should the stretch goal (§5.6) be in *this*
   effort at all, or a separate follow-up once Phase 4's compact merge lands?
   **✅ DECIDED: separate follow-up.** §5.6 is out of scope for the
   implementation phase.
6. **Component location/name.**
   **✅ DECIDED:** Brandon only cares about the final state. Final component is
   `standings/StandingsTable.astro`; the implementer may use any temporary
   name during migration as long as that's where it ends up.
7. **Historical-season correctness.** The riskiest verification is old years
   (pre-2017 all-play derivation, 2003-2012 AFL 6-division/3-per-conference
   layout, 2017 Founders Table).
   **✅ DECIDED: maximum conservatism on historical rendering.** To be explicit
   (this confused at review): **no historical data, pages, or seasons are ever
   deleted** — step 5 deletes only the old *component files* once nothing
   imports them. Per Brandon's "don't delete older years stuff": the snapshot
   matrix is extended to cover every distinct historical era —
   {current, 2003, 2010, 2016, 2017, 2021} for both leagues — and step 5 (old
   component deletion) is gated on the full matrix passing with zero diffs.
   Any historical year that renders differently blocks deletion until resolved.
8. **`deriveAllPlayWLT` unification is a real behavior change (see §2.3.1).**
   `LeagueStandingsTable.astro:28` lacks the `percentage <= 0` guard the other
   three copies have, so TL Playoff Standings currently shows `0-240-0` for
   zero-pct historical teams where every other view shows `N/A`. The design
   adopts the guarded version everywhere (`N/A`), treating the unguarded copy
   as the bug — the guarded files' comments explicitly say deriving a record
   from a zero pct "would fabricate a season".
   **✅ APPROVED (Brandon, 2026-07-14):** unify on the guarded version — `N/A`
   everywhere. TL Playoff Standings changes for zero-pct historical rows; the
   step-0 snapshot suite locks the new behavior with an explicit
   `pct === "0"` case.
