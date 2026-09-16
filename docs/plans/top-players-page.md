# Top Players — plan

**Status:** planned, not started
**Route:** `/top-players` (both leagues)
**Branch:** `claude/top-players-page-plan-0yx6od`

A stats-first leaderboard: every player who scored in this league's scoring
system, ranked by fantasy points, with each player's weekly score line, total,
average and rank-within-position. It is the *results* counterpart to
`/players` (Free Agents), which is an *availability* tool.

---

## Decisions (locked with Brandon, 2026-09-16)

| Question | Decision |
|---|---|
| Population | **Every scoring player** — rostered and free agents alike |
| Weekly layout | **Summary row + inline expand** (Total / Avg / G in the row; week strip on expand) |
| Reuse depth | **Share the small pieces now, extract the table later** — no churn in `players.astro` yet |
| Season scope | **Current season only for v1.** Career deferred (see "Deferred") |
| Positions | **All three**: position filter, position-rank column, and a per-position leaderboard view |
| Leagues | **Both from day one** — one shared component, thin wrapper per league |
| Entry point | **The Tuesday recap hero** on both homepages links here. The recap-column branch is removed, not kept as a fallback |
| Landing state | **Single-week ranking** — `?week=N` re-ranks the table by that week's points |
| Changelog hero | **No.** The staged change carries `heroWorthy: false` |

> **Two different "heroes" in this plan.** The **recap hero** is the homepage
> card that casts the week's top scorer (Caleb Williams in week 1) — it is this
> page's main entry point, §5. The **changelog hero** is whether Monday's
> What's New article gets promoted on the homepage — that one is a **no**.
> They are unrelated; do not let a skim merge them.

---

## 1. The data gap — this is the load-bearing part

The weekly scores this page needs **do not exist in the repo today** for the
population Brandon chose. Read this before writing any UI.

### What we have

| Feed | Covers | Shape |
|---|---|---|
| `mfl-feeds/<yr>/weekly-results-raw.json` | **rostered players only** — built from each week's matchup franchise rosters | per week, per franchise, per player |
| `mfl-feeds/<yr>/playerScores.json` | full pool, **one week only** (`W` defaults to current) | flat `playerScore[]` |
| `mfl-feeds/<yr>/playerScores-ytd.json` | stale 197-byte stub — the fetch entry was removed | effectively empty |

`docs/claude/insights/domains/mfl-api.md` § *2026-08-10* records this exact
finding from the keeper report card:

> `weekly-results-raw.json` records a player's score only for weeks he sat on
> some roster, so the free-agent pool is structurally invisible in it — you
> cannot compute replacement level, positional scarcity, or "best available"
> from that feed no matter how you slice it.

So: a top-players list built on `weekly-results-raw` silently omits every
player nobody rostered. At thin positions that is most of the position.

### What we add

A new per-week, full-pool feed, fetched the same way `weeklyResults` already is
in `scripts/fetch-mfl-feeds.mjs` (the 17-call loop at ~line 970):

```
TYPE=playerScores&L=<leagueId>&W=<n>&JSON=1    for n in startWeek..endWeek
```

written as `mfl-feeds/<yr>/player-scores-weekly.json` — an array of the
per-week payloads, same container shape as `weekly-results-raw.json`.

Rules this fetch must follow, all of them already learned here:

- **Week range comes from `league.json`, never a constant.** That feed carries
  `startWeek` (1), `endWeek` (17) and `lastRegularSeasonWeek` (14) per league
  and per year. Do not hardcode 17 or 18; `weekly-results-raw`'s hardcoded
  17-loop is the thing not to copy.
- **Daily-only, like `weeklyResults`.** It joins `dailyOnlyKeys`; the 5-minute
  live refresh re-fetches only the **current** week and merges it into the
  committed array. MFL fills a week's scores as games finalize, so a finished
  week is stable and the live week is not — the identical reasoning is already
  written out above the `skipDailyFeeds` branch.
- **Guard the parser against MFL's HTTP-200 error bodies.** `writeOut` already
  has the error-payload guard; the deleted `playerScores-ytd` entry also
  refused zero-row payloads. Keep both — a rejected request must not overwrite
  a good committed week.
- **Polite delay between calls** (`await delay(1200)`), same as the weeklyResults loop.
- **Totals are the sum of the weeks, not a separate `W=YTD` fetch.** YTD has no
  games-played field (noted in the same insight), so it can't be normalised to
  a rate anyway, and a second source invites the two disagreeing. One source.

Cost: ~17 extra calls per league per day, inside a job that already makes 17.

### Derived payload — do NOT glob this from the page

Follow `scripts/compute-afl-free-agents.mjs` exactly. That script exists
because an SSR page that eager-globs multi-year feeds bundles them into the
shared `_render` serverless function, which already runs near Vercel's 250 MB
limit. `/top-players` is SSR for the same apex-rewrite reason `/players` is.

```
scripts/compute-top-players.mjs  →  data/<league>/derived/top-players.json
```

Reads: `player-scores-weekly.json`, `players.json`, `rosters.json`,
`league.json`, `nflSchedule.json`, and (TheLeague only)
`fantasyPointsAllowed.json`. Emits finished rows — id, name, position, NFL
team, weeks[], total, avg, games, posRank, overallRank, owner(s) — plus the
week range and a `generatedAt`. Wired into `scripts/prebuild.mjs` with
`previewSkip: true`, alongside `compute:afl-free-agents`.

Writes go through the repo's canonical JSON writer (sorted keys, stable array
order) — MFL returns arrays nondeterministically and a plain `writeFileSync`
regrows `.git`. See `docs/claude/rules/storage-and-build.md`.

---

## 2. What we reuse

Already shared, drop straight in:

| Piece | Path | Note |
|---|---|---|
| `PlayerDetailsModal` | `src/components/theleague/PlayerDetailsModal.astro` | **already used by both leagues** — `afl-fantasy/players.astro` imports it from the theleague dir |
| `buildPlayerCellHTML` / `escapeHtml` | `src/utils/player-cell-html.ts` | the headshot + name + team + logo cell |
| `initPlayerModalTrigger` | `src/utils/player-modal-trigger.ts` | click-to-open wiring |
| `player-cell.css` | `src/styles/player-cell.css` | |
| `PlayerActionModal` | `src/components/shared/PlayerActionModal.astro` | the ⋮ action sheet |
| `WatchListBridge` | `src/components/shared/WatchListBridge.astro` | watch toggles |
| avatar colour helpers | `src/utils/nfl-team-colors.ts` | `getPlayerAvatarBackground` et al. |
| `positionOrder`, logo handlers | `src/constants/roster-constants.ts` | `['QB','RB','WR','TE','PK','DEF']` |

Deliberately **not** touched in v1: `src/pages/theleague/players.astro` (4,731
lines) and `src/pages/afl-fantasy/players.astro` (2,695). They are a forked
sibling pair pinned in `tests/fixtures/page-fork-baseline.json`. Extracting
their table is the right long-term move and is written up under "Deferred" —
doing it inside this feature would put a 7,400-line refactor on the critical
path of a new page.

---

## 3. Files

```
NEW  scripts/compute-top-players.mjs                       # derived payload, both leagues
NEW  src/utils/top-players.ts                              # row types + rank/aggregate helpers (shared w/ script)
NEW  src/components/shared/top-players/TopPlayersPage.astro  # the whole page, league-agnostic
NEW  src/components/shared/top-players/top-players.client.ts # sort / filter / expand
NEW  src/pages/theleague/top-players.astro                 # thin wrapper (<80 lines)
NEW  src/pages/afl-fantasy/top-players.astro               # thin wrapper (<80 lines)
NEW  tests/top-players-data.test.ts                        # payload shape + rank invariants
NEW  tests/top-players-clientrouter.test.ts                # lifecycle guard

EDIT scripts/fetch-mfl-feeds.mjs                           # + per-week playerScores loop
EDIT scripts/prebuild.mjs                                  # + compute:top-players
EDIT package.json                                          # + compute:top-players script
EDIT src/data/page-directory.json                          # + entry, 10+ tags
EDIT src/config/nav-config.json                            # + nav item AND routeEquivalence entry
EDIT src/pages/theleague/stats.astro                       # + a section for the new subcategory
EDIT src/data/weekly-changelog-staging.json                # + one-line staged change
EDIT src/utils/hero-recap-destination.ts                   # /top-players?week=N; drop the article branch
EDIT tests/hero-recap-destination.test.ts                  # asserts the exact objects, both leagues
EDIT src/pages/afl-fantasy/index.astro                     # drop the now-unused posts argument
EDIT src/utils/afl-hero-resolver.ts                        # drop the now-unused posts argument
EDIT src/components/theleague/season-heroes/RecapCompositeHero.astro  # drop the isArticle ternary + feed load
EDIT .claude/hooks/path-guard.json                         # route the new files to a guard suite
```

The thin-wrapper shape is `src/pages/theleague/division-strength.astro`. Each
wrapper holds **only** the auth gate, the league's static data import, and
`<TopPlayersPage …/>`. Both must stay under 80 lines or
`tests/page-fork-ratchet.test.ts` scores them as a new fork and fails the
build. The redirect and the data import stay in the route because a static
import specifier can't be a runtime variable and `Astro.redirect()` only
redirects from a page — returning it from a component renders a blank 200.

---

## 4. UI spec

### Views

The three position answers resolve into one control, a view selector:

- **Leaderboards (default)** — a section per position (`positionOrder`), top 10
  each, compact. Answers "who's hot at every position" at a glance.
- **Overall** — one table, all positions, ranked 1..N, with a **Pos Rank**
  column (`QB1`, `RB5`, `WR12`).
- **QB / RB / WR / TE / PK / DEF** — the full sortable table filtered to that
  position, rank renumbered within it.

The AFL adds IDP positions only if its `league.json` roster slots carry them —
read the feed, don't assume.

### Season vs. week — the URL is the state

Two modes, one table:

- **Season (default, no param).** Ranked by total points. This is `/top-players`.
- **Week (`?week=N`).** The table re-ranks by **week N's** points alone — week
  N's highest scorers, league-wide. Rank, Total and Avg collapse to that week's
  score; the expand still shows the full season strip with week N marked.

A week selector in the header switches between them and rewrites the URL
(`history.replaceState`) so the state is always shareable — which is the whole
point, because §5's hero link is exactly this URL.

Rules for the param:

- **Validate against the completed weeks in the payload.** A `?week=` that is
  out of range, unscored, or not a number degrades to the **season view**, never
  to an empty table. `?week=0` is season.
- **Re-read it on every `astro:page-load`**, never captured at module scope.
  One shared component means one module instance surviving a cross-league
  navigation, and the league switcher is one click away on the shared host.
- The param is a **view**, not an input to a fetch — no auth, no server trust
  question. It only picks which number in an already-rendered row to sort on.

### The row

| Rank | Player | Pos | Team | Owner | G | Total | Avg | Best | Last 3 | ▸ |

- **Owner** is a **list**, not a scalar. AFL is `duplicatePlayers: true` — the
  same NFL player is routinely rostered in both conferences. Use
  `ownersForPlayer` from `src/utils/afl-conference-rosters.mjs`; a
  `franchiseId ===` compare is the exact shape that put a rival's player on
  someone's own homepage (see `insights/features/player-composites.md`).
  Unrostered → "Free agent".
- **G** counts weeks the player actually scored. A week MFL has listed but not
  yet scored is `null`, **not zero** — scoring it zero is how a modal read
  "0.0 — 3 GAMES — 0.0 PER GAME" for a player who had scored 2.60
  (`weekly-player-results.ts` carries the comment). `Avg = total / G`.
- Sortable on every numeric column; default sort Total desc.

### The expand

Clicking ▸ reveals an inline week strip inside the row: one cell per week from
`startWeek` to `endWeek`, each showing points + opponent, with `BYE` and `—`
(did not score) distinguished from `0.0` (played, scored nothing). Best week
highlighted.

TheLeague additionally shows opponent rank-vs-position from
`fantasyPointsAllowed.json`. **The AFL has no `fantasyPointsAllowed.json`
feed** — that column is absent there, gated on the data being present rather
than on a league check.

The ⋮ kebab still opens `PlayerActionModal`, and the player name still opens
`PlayerDetailsModal`, so nothing on this page re-implements player detail.

---

## 5. The Tuesday recap hero is the entry point

The homepage **recap hero** in both leagues casts the week's top scorer —
Caleb Williams in week 1 — via `getWeeklyTopScorerCandidates`
(`src/utils/offseason-hero-data.ts`). Its CTA is resolved by
`src/utils/hero-recap-destination.ts`, today as: Schefter's recap column if one
exists for the week, else `/<league>/live-scoring?week=N`, else `/<league>/news`.

**Change: `/<league>/top-players?week=N` becomes the destination.** The card is
about a player, so it lands on players.

The **weekly recap column is being removed** in a separate session, so the
article branch goes with it rather than being preserved. That is not a
judgement call here — it is already dead code in practice: F3 of
`docs/claude/followups/2026-09-15-hero-recap-routing.md` records that no weekly
recap has generated for either league all 2026 season (both
`weekly-results.json` files carry zero scores for every week, so `getCompletedWeek`
returns 0 and the Tuesday cron skips silently), and that "the article branch of
the hotfix is currently unreachable."

So the resolver collapses to two cases:

```
resolveRecapDestination({ league, seasonYear, completedWeek })
  week > 0 → { week, href: '/<league>/top-players?week=N',
               label: "See the week's top scorers" }
  week = 0 → { week: 0, href: '/<league>/news', label: 'Read the latest' }
```

What that deletes, all of it now unreachable:

- `findWeeklyRecapPost` and `weeklyRecapPostId` — the id-matching pair whose
  only consumer was the article branch.
- the `isArticle` flag on `RecapDestination`, and the `recap.isArticle` ternary
  at `RecapCompositeHero.astro:106` that picked the button label off it.
- the `posts` input to `ResolveRecapDestinationInput`, and the feed-loading each
  call site did only to supply it — `RecapCompositeHero.astro`,
  `src/pages/afl-fantasy/index.astro`, `src/utils/afl-hero-resolver.ts`.
- the `isArticle: true` assertions in `tests/hero-recap-destination.test.ts`.

**Scope boundary:** this plan removes the hero's *dependency* on the recap
column. Deleting `scripts/article-types/weekly-recap.mjs`, its cron entry and
its `relatedLinks` belongs to the session that owns that decision — the two
should not race each other in the same files. If that lands first, this section
is unaffected; if this lands first, the article type is simply orphaned rather
than broken. Coordinate on order, not on content.

Load-bearing details:

- **The week is the one in the BOOKS.** `completedWeek` comes from
  `getLatestScoredWeek`, never `getCurrentNFLWeek` / `nflWeekFor` — the latter
  rolls to the *upcoming* week on **Tuesday morning, the exact morning this
  slot runs**. On Tue Sep 15 2026 it answered 2 while week 1 was what had just
  finished, and the hero read "Week 2 is in the books" over games nobody had
  played. That trap is already written up as rule 1 at the top of
  `hero-recap-destination.ts`; the link inherits it, because a hero pointing at
  `?week=2` on Tuesday lands the reader on an empty week.
- **Query strings are a supported shape here.** `routeExists` strips the query
  before resolving — `/theleague/trade-builder?b=0012` is an explicitly tested
  case in `tests/article-links.test.ts`. Nothing needs loosening.
- **Both leagues, one resolver.** Three call sites:
  `src/components/theleague/season-heroes/RecapCompositeHero.astro`,
  `src/pages/afl-fantasy/index.astro`, and `src/utils/afl-hero-resolver.ts`.
  Changing the resolver changes all three — that is the point, and it is also
  why `tests/hero-recap-destination.test.ts` (204 lines, asserts the exact
  returned objects for both leagues) must be updated in the same commit.
- **Week 0 still falls through to `/news`.** A season with nothing scored has
  no week to rank; `?week=0` is not a destination.

### The hero and the page will sometimes disagree — on purpose

`getWeeklyTopScorerCandidates` filters to **rostered players only**
(`franchiseIds.length === 0 → continue`) and reads the one-week
`playerScores.json`. The page is **full-pool**. So if a free agent outscores
everyone in a week, the hero casts the top *rostered* scorer and the page's
week view is led by someone else.

That is correct, not a bug, and the plan keeps it: the hero renders its
subject's franchise colours, crest and accent
(`hero-franchise-accent.ts`, `hero-crest.ts`) — a free agent has no franchise
to key any of that off. The hero answers "whose player went off this week";
the page answers "who went off this week". Write that into the module comment
so the next person doesn't "fix" the filter.

Note also that ownership is a **list** — `getWeeklyTopScorerCandidates` already
uses `getOwnersByPlayer`, because an AFL player is routinely rostered in both
conferences and a `franchiseId ===` compare is what put a rival's player on
someone's own homepage.

---

## 6. Repo rules this must obey

Each of these is a bug that shipped here before.

1. **Two clocks.** This page is results-shaped → `getCurrentSeasonYear()`.
   **But an MFL feed directory is keyed by the LEAGUE year**
   (`getCurrentLeagueYear()`), which rolls Feb 14 (June 1 for the AFL), not at
   Labor Day. Between those two dates the clocks disagree and a
   season-year lookup reads a stale directory or misses it entirely — both
   homepages shipped that bug picking the waiver calendar. The derived script
   resolves the directory by league year and stamps the **season** year into
   the payload; the page reads the stamped year and never re-derives a path.
   Verify with `/rollover-check` before shipping.
2. **Season window, not "the feeds have a completed week."** Feb → Labor Day
   resolves to *last* season, whose feeds are complete by definition, so a
   "has completed weeks" guard fires all preseason. Gate the fetch loop on
   `isSeasonWindowOpen` (`src/utils/pecking-order-season-window.mjs`).
3. **No league literals.** Ids, slugs, hosts and data paths come from
   `src/config/leagues-data.mjs`. `tests/league-literal-guard.test.ts` scans
   `src/`, `scripts/` and `.github/workflows/`.
4. **ClientRouter lifecycle.** Init on `astro:page-load`, never
   `DOMContentLoaded`; no module-scope DOM capture; re-read the league per
   load from a `data-league` attribute on a node the swap replaced — never a
   `window` global (that was the Sept 2026 lineup outage) and never a value
   captured at module load. One shared component means one module instance
   surviving a cross-league navigation, which on the shared host is one click
   away via the nav's league switcher.
5. **Page directory.** Add the entry or the page is invisible to site search:
   `id`, `title`, `description`, `path`, `icon`, `category` (`reports`),
   `subcategory` (`team-comparisons` or a new one), `visibility`, `popularity`,
   and **10+ tags** written generously — "top players, leaderboard, points,
   scoring, weekly scores, stats, best players, rankings, position rank, ppg,
   fantasy points, season stats".
6. **Changelog.** Stage one line (≤200 visible chars) in
   `src/data/weekly-changelog-staging.json` with `league: "both"`. This is a
   `new-page`, so it needs `featured: true` for its league and a screenshot.
   **`heroWorthy: false`** — decided 2026-09-16, no homepage promotion for the
   What's New article. (Unrelated to the recap hero in §5, which does link
   here.)
7. **Type baseline.** `pnpm test:types` fails if the count moves in *either*
   direction. Re-measure and retighten after.
8. **Guard test.** Wire the new files into `.claude/hooks/path-guard.json` so
   the suite runs on every edit in this territory;
   `tests/path-guard-map.test.ts` fails on a glob that matches nothing.
9. **Nav is a SECOND registry, and `page-directory.json` is not it.**
   `src/config/nav-config.json` needs two separate additions:
   - an item under the right `sections[].items[]` (no `leagueOnly`, since both
     leagues get the page — contrast `/players`, which is listed **twice** with
     `leagueOnly: "theleague"` and `leagueOnly: "afl"` because its two copies
     carry different descriptions);
   - a `routeEquivalence` entry (`"/top-players": "/top-players"`). That map
     feeds `getEquivalentRoute` → `buildSwitchUrl` (`src/utils/nav-utils.ts:507`),
     which is what the nav's league switcher uses to land you on the *same*
     page in the other league.

   **Note what that second entry does to rule 4.** Adding it is what makes
   `/theleague/top-players` → `/afl-fantasy/top-players` a one-click,
   same-origin navigation — i.e. a ClientRouter *swap*, not a fresh document.
   The `data-league` gate is therefore load-bearing from the moment this entry
   exists, not a theoretical precaution.
10. **The `/stats` hub renders by `subcategory`, and none of the five existing
   sections fits.** `src/pages/theleague/stats.astro` groups on a hardcoded
   `SECTIONS` list — `team-comparisons`, `league-history`, `salary-analytics`,
   `awards`, `free-agency`. A page-directory entry with no `subcategory` (or an
   unlisted one) is simply absent from the hub. Add a **`player-stats`** section
   to that list and tag the entry with it; otherwise the page is reachable only
   from nav and search. This is also the natural home for `/mvp` later.
11. **Do not add `prerender = true`.** `astro.config.ts` sets `output: 'server'`,
   so SSR is the default and nothing needs declaring. A prerendered target is a
   static CDN file with no SSR route, which 404s the apex-domain rewrite — the
   reasoning is written out at the top of `src/pages/afl-fantasy/players.astro`.
12. **No service-worker work.** `public/sw.js` precaches only `OFFLINE_URL`;
   there is no per-route list to add to. Checked, not assumed.

---

## 7. Scale, and what the live probes settled

**The table is small.** Week 1 2026 returns **484 rows** per league from
`playerScores`, of which **369** (TheLeague) and **337** (AFL) scored above
zero. A season's union of anyone who scored at least one week lands in the high
hundreds, not thousands. That means a plain client-side sorted table with
expandable rows is fine — **no virtualization, no pagination, no server-side
sort.** Do not build for a scale this does not have.

### Probed live 2026-09-16 — all settled, nothing deferred

`insights/domains/mfl-api.md` says MFL egress is proxy-blocked from Claude Code
web sessions (`CONNECT tunnel failed, response 403`). **That is stale** — it was
recorded 2026-08-10 against `www44.myfantasyleague.com`. A `TYPE=league` request
to `www49` returns **HTTP 200 in 0.58s**. Re-probe rather than inheriting the
note; the questions below were answered by actually asking MFL.

**1. The premise holds — `playerScores` really does see free agents.** Week 1
2026, TheLeague:

| | count |
|---|---|
| scoring rows in `playerScores` | 484 |
| players on some roster (`rosters.json`) | 394 |
| scoring **and** rostered | 321 |
| **scoring, on nobody's roster** | **163** |

A third of the week's scoring pool is invisible to `weekly-results-raw.json`.
That is the number that justifies the whole new feed; it is no longer an
inference from the keeper-card insight.

**2. 484 is the real pool, not a `COUNT` cap.** `W=1&COUNT=2000` returns the
same 484 rows with the same leaders. No pagination to handle.

**3. `W=<n>` works for a completed past week.** 2025 `W=5` returns 426 scored
rows. The loop is sound.

Two payload shapes the parser must handle, both seen live:

- **An unscored week returns one EMPTY object — not an error, not an empty
  array.** Today `W=2` (week 2 opens Sep 17) answers
  `{"isAvailable":"1","id":"","score":"","week":"2"}`: a single row with blank
  id and score, at HTTP 200. That is the same shape as the stale
  `playerScores-ytd.json` stub. **Reject it** — a row with no id is not data,
  and writing it would blank a good committed week. This is exactly the
  zero-row guard the deleted YTD entry carried; keep it.
- **`isAvailable` is tempting and wrong for ownership.** Every row has it
  (`"0"` rostered, `"1"` available), which looks like a free rostered/FA flag.
  It reflects availability **now**, not during the week fetched — on a 2025 W=5
  row it describes today's rosters. It also cannot express the AFL, where a
  player is rostered per-conference. Derive ownership from `rosters.json` as
  planned; treat `isAvailable` as decoration.

**4. The re-run is a zero-byte diff.** Settled by running the real fetch twice:
the second run logs `Unchanged player-scores-weekly; leaving …  untouched`.
`writeOut` → `writeJsonIfChanged` (`scripts/lib/canonical-json.mjs`) already
canonicalises MFL's nondeterministic array order, so nothing extra was needed —
but this is the check that had to happen before the cron touched a ~1 MB per
league per season file (60,724 bytes for week 1 alone, ~4× `weekly-results-raw.json`).
A plain `writeFileSync` + byte diff is what regrew `.git` to 7 GB once already
(`docs/claude/rules/storage-and-build.md`).

**5. The week range really is per-league.** `league.json` gives TheLeague
**1–17** and the AFL **1–18**. Hardcoding 17 — as the weeklyResults loop above
does — would have silently dropped the AFL's last week. This is the rule paying
for itself on its first use, not a hypothetical.

**Playoff weeks count.** `league.json` carries `lastRegularSeasonWeek: 14` and
`endWeek: 17`, so weeks 15–17 are the fantasy playoffs. Player scores exist for
them regardless of whose fantasy team is still alive, so the season total spans
`startWeek..endWeek` and does not stop at 14. Mark 15–17 in the week selector
so a reader knows why the field thins.

---

## 8. Phases

**Phase 1 — data.** Add the per-week `playerScores` loop to
`fetch-mfl-feeds.mjs` (week range from `league.json`, daily-only, live-week
merge, error-body guard). Run it once against both leagues, commit the feeds,
eyeball week 1 against the known top scorers, and confirm the one open item in
§7 — the zero-byte re-run diff — before letting the cron near it. *Nothing renders yet; this is the phase that can't be
faked.*

**Phase 2 — derived payload. ✅ DONE 2026-09-16.**
`scripts/compute-top-players.mjs` → `data/<league>/derived/top-players.json`
(167 KB each), wired into prebuild as `compute:top-players` /
`compute:top-players:afl` with `previewSkip: true`.
`tests/top-players-data.test.ts` pins 24 invariants: totals equal the sum of
weeks, `games` counts only weeks actually scored and drives `avg`/`best`,
ranks run 1..N by total desc, each position numbers 1..N with no gaps, every
owner list matches `rosters.json` **as a set**, the week range comes from each
league's `league.json`, `completedWeeks` exactly equals the weeks players
scored in, and the free-agent pool is non-empty — the invariant the keeper card
lacked. Registered as its own `top-players` path-guard domain.

Two things the run confirmed. Every scoring id resolved to a `players.json` row
(`unlabelled=0`), so the "drop what we cannot label" branch is a guard rather
than a live path. And re-running the script produces a **zero-byte diff**, so
the prebuild step will not churn `.git` — the sort is `total desc, name asc`
precisely so MFL's nondeterministic row order cannot leak into the output.

Week 1 sanity check, TheLeague: **Caleb Williams #1 (QB1, 41.26)** — the same
player the recap hero cast, which is the §5 link landing where it should.

**Phase 3 — shared component.** `TopPlayersPage.astro` + client script,
reusing the pieces in §2. Overall view first, then the position filter and the
leaderboards view, then the row expand.

**Phase 4 — routes.** Both thin wrappers, auth gates in the routes, page
directory entry. Verify the fork ratchet still passes and `/rollover-check`
reports the right year at all six boundaries.

**Phase 5 — the week view and the hero link.** `?week=N` mode plus the week
selector, then repoint `resolveRecapDestination` and update
`tests/hero-recap-destination.test.ts`. Do these together: the hero link is
only correct once the week view exists, and shipping the resolver change first
points both homepages at a param the page ignores. Check the Tuesday case
explicitly — render the homepage at a Tuesday with `?testDate=` and confirm the
href carries the **completed** week, not the upcoming one.

**Phase 6 — polish.** Mobile (the table is the risk — the summary row is
deliberately narrow so the week detail can live in the expand), dark mode
tokens, empty state before week 1 of a season, changelog + screenshot.

---

## 9. Deferred, on purpose

- **Career / all-time totals.** Needs full-pool weekly data for 2007–2026,
  which would be a one-time backfill of ~18 × 20 years × 2 leagues ≈ 700 MFL
  calls plus the committed weight. A cheaper interim exists — career points
  *while rostered in this league*, derivable free from the committed
  `weekly-results-raw.json` back to 2007 — and is worth revisiting once we see
  whether anyone uses the season view.
- **Unforking `players.astro`.** Build `TopPlayersPage`'s table deliberately
  generic (rows in, columns declared, no league-specific branching), then
  migrate Free Agents onto it and retighten
  `tests/fixtures/page-fork-baseline.json`. That removes ~5,000 duplicated
  lines and kills the cross-league init-gate hazard for that pair outright.
- **Projections alongside actuals.** `projectedScores.json` is already fetched
  per league; a "vs projection" column is cheap once the table exists.
- **A `/guides` page.** `src/data/guides.json` has exactly **one** entry
  (`sunday-ticket`), so guides are reserved for features a changelog line
  genuinely cannot carry. A sortable stats table probably is not one. Revisit
  only if the week view or the position modes need explaining.
- **A Schefter link, not asked for.** `DESTINATIONS` in
  `scripts/article-utils/article-links.mjs` is the registry Schefter columns
  link through, and `weekly-recap.mjs` already builds a "top scorers per team"
  fact sheet. Adding a `top-players` destination there would let the Tuesday
  column link here too. Cheap, but out of scope until asked — the hero in §5 is
  the entry point that was actually requested.
- **Best Ball.** Draft-only, no live MFL syncing
  (`docs/claude/rules/best-ball.md`), so there is no scoring data behind a
  leaderboard there.
