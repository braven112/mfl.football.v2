# Sunday Ticket — the multi-league "what to watch" board

Status: BUILT 2026-09-04 on branch `claude/sunday-ticket-matchup-preview-3025b7`
(phases 1–4 in one PR). Deviations from the plan below, each deliberate:

- **No `LineupGameStrip` on top.** `buildMatchupCards` needs the lineup
  page's whole world (throwback resolution, crest strokes, slot rules, scoring
  maps) — wiring it here would have forked ~100 lines of that assembly. The
  page carries a one-line "your week N" band (opponents from the schedule
  feed, links to /lineup and /live-scoring) instead.
- **Window "tabs" are jump links, not a script.** Both windows render; the
  Early/Late buttons are `<a href="#st-early">`. Zero client JS on the page,
  and no `is:inline` ClientRouter trap to guard.
- **`sunday-ticket-selection.ts` exists** because Chromatic's dependency
  guard treats everything a story can reach as a rendering file: the board
  components importing the chip helpers from `sunday-ticket-page.ts` pulled
  the page's fs / ESPN / registry graph (13 files) into the story. The pure
  helpers and `BoardLeague` live in the selection module; `formatKickoff`
  moved to the slate module; the page re-exports both for its own callers.
- **The cleanup stopped at the verified closure (28 files + both specs).**
  `mfl-matchup-api.ts` is live (real API routes import it). The rest of the
  spec's "task 1" web — `mock-matchup-data.ts`, `types/matchup-previews.ts`,
  `matchup-routing.ts`, `matchup-state-manager.ts`, `game-state-manager.ts`,
  `lineup-data-builder.ts`, `matchup-preview-utils.ts` and their tests — is
  referenced only by each other and by spec-era tests, and is a follow-up.
- **The What's New screenshot is a manual capture** (registered in
  `MANUAL_CAPTURE_ONLY`): the personalized board needs a signed-in owner, and
  the dev session carries no live MFL cookie, so the re-sign-in note is
  removed before the shot.

Goal: one pre-game page per league that answers "which four games do I put on
my Sunday Ticket multiview, and why" — for every league the signed-in owner
plays in, not just the one they are signed into. It replaces the abandoned
`.kiro/specs/dynamic-matchup-previews` and `owner-multi-league-dashboard`
specs, whose one unbuilt idea this is.

## Decisions (from Brandon, 2026-09-04)

| Question | Decision |
|---|---|
| Deliverable | A new page whose centerpiece is the 4-box multiview per Sunday window |
| Leagues | TheLeague + AFL routes, and BOTH show a combined board across every league the owner is in |
| Outside leagues | Included — any league `myleagues` returns for the signed-in MFL account |
| League list source | Fetched on visit with the session's MFL cookie, Redis-cached 1h |
| Default set | Every league on; per-league toggle chips, choice remembered per device |
| Cross-league ranking | Starter count first, summed projections as tiebreak; per-league points shown inside each box |
| Best Ball | On the board; no lineups, so every rostered player counts as a starter |
| Commentary | None. No blurbs, no LLM run. Prose stays in Schefter's Saturday article |
| Orphaned spec-era code | Delete in the same PR (see "Cleanup") |

Still open (cheap to flip, recommendation given):

| Question | Recommendation |
|---|---|
| URL | `/{league}/sunday-ticket`. The two dead hero CTAs point at `/theleague/matchups`; repoint them rather than adopt a name that describes a page we are not building |
| What's New hero | Ask at ship time — `/update-whats-new` prompts for it. It is a new page with a real screenshot, so it is eligible; not decided here |
| Non-Sunday-afternoon games | Show TNF / SNF / MNF / Saturday in a separate "Also this week" row, NOT inside the Sunday Ticket boxes — those games are not on Sunday Ticket, and the hero currently mislabels them |

## What already exists, and what is orphaned

The old spec was built against `matchup-preview-example.astro`, deleted in
refactor phase 0 (#430). Most of its requirements were then built by other
features in a different style. What the new page reuses:

| Need | Reuse |
|---|---|
| Your fantasy matchup(s) on top, doubleheader-aware | `LineupGameStrip` + `buildMatchupCards` (`src/utils/lineup-matchup-cards.ts`) — already storied |
| Starters for a week, any league | `resolveWeekLineup` / `extractLineupStarters` (`src/utils/lineup-sources.ts`) |
| Player identity, NFL team, ESPN headshot | `getPlayerMap` — MFL player ids are global across leagues (`player-map.ts:238`) |
| NFL kickoffs (source of truth) | MFL `nflSchedule` feed, dual-source read as in `MatchupPreviewHero` |
| Real broadcast network per game | ESPN scoreboard payload the live board already polls; `/api/nfl-scoreboard` currently drops `competitions[].broadcasts[].names` |
| Live/pre/post state, hand-off | `getDailySlot` (`hero-resolver.ts`) — Sat + Sun-before-10am is `game-day-preview`, then `live-scoring` |
| MFL cookie round-trip | `mflFetch` (redirect-safe), `isMflCookieLive` in `api/autocut-list.ts` (to be lifted) |
| Cookie-backed TTL cache | `mfl-roster-cache.ts` pattern (sync refresh, in-process dedup) |

What the page does NOT rebuild, because it is already a page: live scores
(`/live-scoring`), lineup optimization and IR moves (`/lineup`,
`/api/move-to-ir`), injury news (Schefter feed), playoff brackets
(`/playoffs`).

### Cleanup — orphaned spec-era code (0 importers unless noted)

| Path | Lines | Note |
|---|---|---|
| `src/components/theleague/SundayTicketMultiView.astro` | 501 | superseded by this plan |
| `src/components/theleague/MatchupSelector.astro` | 489 | |
| `src/components/theleague/LineupAccordion.astro` | 654 | |
| `src/components/theleague/InjuryWarningSystem.astro` | 495 | only importer of `lineup-optimizer.ts` |
| `src/components/theleague/LiveModeToggle.astro` | 223 | |
| `src/components/theleague/EnhancedPlayerCard.astro`, `PlayerStatusDemo.astro` | — | import only each other; take `LineupOptimizationIndicator.astro`, `PlayerStatusIndicator.astro`, `InjuryManager.astro` with them once nothing live imports those (`PlayerInjuryModal` stays — `rosters.astro` uses it) |
| `src/utils/lineup-optimizer.ts`, `mfl-schedule-integration.ts`, `demo-mfl-schedule.ts`, `nfl-analysis.ts`, `timezone-utils.ts`, `demo-player-status-integration.ts` | ~1,500 | |
| `scripts/generate-matchup-nfl-blurbs.mjs`, `scripts/test-matchup-story-nfl.mjs`, `data/theleague/matchup-nfl-blurbs-*.json`, `data/theleague/test-matchup-story-nfl.json` | — | paid-API blurb generator hardcoded to two franchise pairs |
| `tests/sunday-ticket-game-count.test.ts`, `tests/time-slot-tab-separation.test.ts` | — | test a local COPY of the component's logic, not the component; replaced by tests against the real slate builder |
| `.kiro/specs/dynamic-matchup-previews/`, `.kiro/specs/owner-multi-league-dashboard/` | — | this doc is their replacement |

Deleting files under `src/` moves the `astro check` total — re-run
`pnpm test:types` and retighten `tests/fixtures/typecheck-baseline.json`.
`utils/nfl-matchups.ts` is NOT orphaned (`afl-fantasy/rosters.astro`) and
`espn-game-detail.ts` is live; leave both.

## Route map

```
src/pages/theleague/sunday-ticket.astro      thin route (<80 lines): auth read, registry lookup, one component
src/pages/afl-fantasy/sunday-ticket.astro    thin route
src/components/shared/sunday-ticket/SundayTicketPage.astro   the page body, league-neutral
```

`tests/page-fork-ratchet.test.ts` pins the thin-wrapper shape; the model is
`src/pages/theleague/division-strength.astro`. Neither route redirects an
unauthenticated visitor — the board degrades to the league-wide version
("most fantasy points on the field"), the same fallback `MatchupPreviewHero`
uses today. Best Ball gets no route: its nav is opt-in and it has no Sunday
to plan; it appears on the board as one of the owner's leagues instead.

Repoint both dead CTAs (`MatchupPreviewHero.astro:290`,
`MatchupSplitHero.astro` "Full preview") at the new route.

## Data flow (all server-side, per request)

1. **Who** — `getAuthUser()`. `user.id` IS the raw MFL cookie; it never
   reaches the client and is never written to a Redis key in the clear.
2. **Which leagues** — `fetchMyLeagues(user.id, year)` (new
   `src/utils/my-leagues.ts`, lifted from `autocut-list.ts`): one
   `export?TYPE=myleagues&JSON=1` call through `mflFetch`, accepting both the
   `myleagues.league` and `leagues.league` wrappers and the single-object
   collapse. Cached in Redis under `st:myleagues:<sha256(user.id)>` for 1h.
   **An empty list is a dead cookie, not "no leagues"** — render the
   league-wide board plus a re-sign-in prompt (same distinction
   `resolveLineupFillState` enforces). The response carries each league's
   `id`, `name`, `franchise_id`, `franchise_name` and host URL; the host is
   what outside-league exports must be sent to.
3. **Which week** — `getCurrentNFLWeek(now)`, `?week=` override like live
   scoring. Season year is the no-arg `getCurrentSeasonYear()` (the arg form
   is the non-monotonic `?testDate` trap recorded in `MatchupPreviewHero`);
   per-league roster year is `getLeagueYearForSlug` for registered leagues
   (the AFL rolls June 1, not Feb 14).
4. **Contributions** — for each league, `{ leagueId, leagueName,
   franchiseName, starters: [{ playerId, nflTeam, proj }] }`:
   - *Registered leagues* (registry match on MFL id): disk feeds under
     `data/<dataPath>/mfl-feeds/<year>/` via `loadRostersFeedFromDisk`,
     `loadWeeklyResultsFeedFromDisk`, `resolveWeekLineup`. No starters
     resolved yet → the whole roster, labelled as such. AFL: a player is
     routinely rostered in BOTH conferences (`duplicatePlayers: true`) — read
     only the owner's own franchise's roster, never "who owns this player".
     Best Ball: whole roster always (`bestBall: true`).
   - *Outside leagues*: three live exports with the cookie against the
     league's own host — `rosters&FRANCHISE=`, `weeklyResults&W=`,
     `projectedScores&W=` — cached `st:league:<id>:<year>:<week>` for 15 min
     (`mfl-roster-cache.ts` shape: sync refresh, in-process dedup, stale
     fallback). Private leagues answer an unauthenticated or throttled
     request with a well-formed EMPTY 200 (`mfl-api.md`, tradeBait entry), so
     check the payload's shape, never `res.ok`, and never cache an empty
     answer over a full one. Rate-limit the refresh:
     `checkRateLimit('sunday-ticket', franchiseId, 30, 60)`.
5. **NFL slate** — kickoffs from MFL `nflSchedule` (live `matchup` first,
   else the season archive indexed by week). Broadcast network from ESPN:
   add `broadcast?: string` to `NflGame` and parse
   `competitions[0].broadcasts[].names[0]` in `/api/nfl-scoreboard` — one
   field, `no-store` like the rest. Enrichment only; MFL stays the clock.
6. **Slate** — `buildSundayTicketSlate(input)` in
   `src/utils/sunday-ticket-slate.ts`, pure and league-agnostic:
   - windows: `early` (Sun ≤ 1:xx ET kickoff), `late` (Sun 4:xx ET),
     `other` (Thu/Sat/SNF/MNF — displayed, never boxed);
   - per game: starter count summed across ENABLED leagues, then Σ proj;
     per-league breakdown kept for the box body;
   - box rule: `min(N, 4)` games, `+ RedZone` when `N < 4`, one RedZone per
     window, a game with zero of your starters never fills a box;
   - no owner (or dead cookie): rank by league-wide projected points of the
     session's league, no "Personalized" chip.
   `tests/sunday-ticket-slate.test.ts` tests THIS function — the old tests
   tested a copy (the producer/consumer trap).
7. **Toggles** — chips are links carrying `?leagues=13522,19621`; the chosen
   set is remembered in a `st_leagues` cookie (the `team-preferences.ts`
   pattern) so the server renders the remembered set with no client-side
   redirect. The cookie is unscoped ON PURPOSE: the board is cross-league,
   and `rankings-scope.ts` exists to keep two leagues' data apart, which is
   the opposite of what this feature does.

No island. The page is pre-game: nothing on it changes between visits
faster than a page load, and once `getDailySlot().slot === 'live-scoring'`
a banner hands off to `/live-scoring` rather than duplicating the board.
Early/late tabs are a plain-JS `<script is:inline>` (Storybook Trap 3), with
both windows rendered so no-JS still shows everything.

## Components

```
src/components/shared/sunday-ticket/
  SundayTicketPage.astro     loads data (steps 1–5), calls the slate, lays out the page
  SundayTicketBoard.astro    props: { windows, leagues, personalized }  — chips + tabs + two grids
  SundayTicketWindow.astro   props: { window }                          — one 2×2 grid
  SundayTicketBox.astro      props: { box }                             — one game or RedZone
src/styles/sunday-ticket.css                                            — namespaced .st-*
```

Only `SundayTicketPage` touches feeds, auth or the clock; the three below it
are props-only so they story cleanly (the season heroes cannot, which is why
the hero is not the reusable unit — `storybook.md`, "Not every component can
have a story").

Visual language follows what the hero established, not the old spec:

- **Box** = NFL logos + codes header, kickoff in ET and PT, a network chip
  (`CBS` / `FOX` / `RedZone`), then your starters as headshot chips grouped
  by league with the league's mark and that league's projection. Saturated
  card in both themes (`feedback_hero_light_mode_saturated`), `html.dark`
  overrides, `--spacing-*` / `--container-max-width` tokens, no undefined
  `var(--x)` (design-token guard).
- **Personalized** chip when the board has an owner, exactly as the hero.
- **Your matchup(s)** on top via `LineupGameStrip` — for the SESSION league
  only, since `buildMatchupCards` needs that league's feeds and brand
  resolver; other leagues' matchups are the boxes' job.
- Empty states: no games (bye-less week / offseason) renders the
  live-scoring-style sample banner, not a blank grid.

## Storybook

`stories/shared/SundayTicketBoard.stories.ts` + `stories/fixtures/sunday-ticket.ts`:
four games; three + RedZone; one + RedZone; both windows populated; two
leagues on one game; league-wide (no owner). `themeModes` only — no league
token is read, so an AFL snapshot would be pixel-identical. Headshots as
inline data-URI literals (no `Buffer`, Trap 6); the standard four-team cast.

## Registry and housekeeping the old spec never mentioned

- `src/data/page-directory.json` entry, `category: popular`, 10+ tags
  (sunday ticket, multiview, what to watch, redzone, broadcast, channel,
  cbs, fox, kickoff, my players, other leagues, …).
- `src/data/whats-new.json` `new-page` entry: screenshot, inline
  league-neutral links (`/sunday-ticket`, `/live-scoring`, `/lineup`), hero
  eligibility asked at ship time.
- Add the page to `scripts/article-types/matchup-preview.mjs`'s
  `featureLink` plugs so Schefter's Saturday broadcast guide drives owners
  to it.
- `docs/claude/rules/` — if a rule ships (it will: "empty myleagues is a dead
  cookie"), it goes in a domain doc, not CLAUDE.md.

## Phases

1. **Slate + sources** — `sunday-ticket-slate.ts` with tests; `my-leagues.ts`;
   outside-league loader with cache + rate limit; `broadcast` on `NflGame`.
2. **Page** — the four components, styles, thin routes, tabs script,
   hand-off banner, CTA repoints, stories.
3. **Multi-league** — `myleagues` on visit, chips + cookie, per-league box
   bodies, dead-cookie prompt.
4. **Cleanup + registry** — delete the orphan table, retighten the typecheck
   baseline, page-directory, What's New, Schefter plug, this doc → SHIPPED.

One PR is fine if phases 1–3 land together; phase 4's deletions are
mechanical and review cleanly as their own commit inside it.

## Guard rails (each one a shipped bug elsewhere in this repo)

- Never write `'13522'` / `'19621'` / `'data/theleague'` — registry only
  (`tests/league-literal-guard.test.ts`).
- `leagueUrl()` for every absolute URL; never origin + path.
- `getCurrentSeasonYear()` for the week, per-league league-year for rosters.
- MFL collapses one-element arrays to a bare object — normalize every list.
- `res.ok` is not "the call worked"; empty is not absent for a private league.
- Never let a live MFL call be the only source for something synced to disk.
- `user.id` is a credential: never to the client, never a plain Redis key.
- `Astro.redirect()` only redirects from a PAGE — the routes own any gate.
