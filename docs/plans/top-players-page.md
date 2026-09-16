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
EDIT src/data/weekly-changelog-staging.json                # + one-line staged change
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

## 5. Repo rules this must obey

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
   `new-page`, so it needs `featured: true` for its league and a screenshot —
   and **hero eligibility is a human call**: ask Brandon for `heroWorthy`
   rather than deciding.
7. **Type baseline.** `pnpm test:types` fails if the count moves in *either*
   direction. Re-measure and retighten after.
8. **Guard test.** Wire the new files into `.claude/hooks/path-guard.json` so
   the suite runs on every edit in this territory;
   `tests/path-guard-map.test.ts` fails on a glob that matches nothing.

---

## 6. Phases

**Phase 1 — data.** Add the per-week `playerScores` loop to
`fetch-mfl-feeds.mjs` (week range from `league.json`, daily-only, live-week
merge, error-body guard). Run it once against both leagues, commit the feeds,
eyeball week 1 against the known top scorers. *Nothing renders yet; this is
the phase that can't be faked.*

**Phase 2 — derived payload.** `scripts/compute-top-players.mjs` + prebuild
wiring + `tests/top-players-data.test.ts` pinning: totals equal the sum of
weeks, `G` excludes unscored weeks, posRank is dense and gapless within a
position, every row's owner list is consistent with `rosters.json`, and the
free-agent pool is non-empty (the invariant the keeper card lacked).

**Phase 3 — shared component.** `TopPlayersPage.astro` + client script,
reusing the pieces in §2. Overall view first, then the position filter and the
leaderboards view, then the row expand.

**Phase 4 — routes.** Both thin wrappers, auth gates in the routes, page
directory entry. Verify the fork ratchet still passes and `/rollover-check`
reports the right year at all six boundaries.

**Phase 5 — polish.** Mobile (the table is the risk — the summary row is
deliberately narrow so the week detail can live in the expand), dark mode
tokens, empty state before week 1 of a season, changelog + screenshot.

---

## 7. Deferred, on purpose

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
- **Best Ball.** Draft-only, no live MFL syncing
  (`docs/claude/rules/best-ball.md`), so there is no scoring data behind a
  leaderboard there.
