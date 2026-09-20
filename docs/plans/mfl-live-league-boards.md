# MFL Live — full-league boards (`/live/league/<mflId>`)

> Plan of record. Decisions below were made with Brandon on 2026-09-20.
> Parent plan: `docs/plans/mfl-live-app.md`. Sibling data-layer rules:
> `docs/claude/rules/live-scoring.md`.

## What it is

Today `/live` shows **your** matchup in each of your leagues. This adds one
link per league panel — the league's name becomes the link — that opens
**`/live/league/<mflLeagueId>`**: every matchup in that league, scoring live,
in MFL Live's own chrome.

It works for **every** league on the board, the ones this site runs and the
ones it does not. That is the whole point: the leagues MFL Live exists to
cover are the outside ones, and those have no full-league board anywhere on
this site today.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Which leagues get the link | **All of them** — registry and outside alike | "See the full league" has to be true for every row, or the link is a tease on the rows that need it most. |
| 2 | Where it lands | **New `/live/league/<mflId>`, in the MFL Live shell** | One board for every league. Bouncing ours out to `/theleague/live-scoring` would change chrome mid-session and still leave outside leagues unserved. The per-league pages stay exactly as they are. |
| 3 | What it shows | **Matchup cards only, tap to expand** | Identical to `/live`, just every pairing instead of yours. Reuses `LvMatchupCard` / `LvMatchupDetail` unchanged. Cheapest first paint on a phone. |
| 4 | The affordance | **The league name in the panel header is the link** | No new chrome, a big thumb target, and it reads naturally. `/live` is the only surface that renders that header (`multiLeague`), so nothing else grows a link. |

## What already exists — this is mostly wiring, not building

Four pieces of the feature are already written and in production. Finding
this out is why the plan is short.

- **The canonical model was designed for exactly this board.**
  `LiveMatchup.viewerSide` is `0 | 1 | null` and its own comment says "on a
  league board most matchups are nobody's". `LvMatchupCard` already gates
  "YOUR MATCHUP" on `viewerSide !== null`, and `orderPanelMatchups` already
  leads with the viewer's matchups, promotes the closest game when there are
  none, and sorts the rest by live margin with a stable tiebreak. **No new UI
  component, and no change to an existing one beyond the link itself.**
- **`buildBoardFromSnapshot` (`src/utils/live/read.ts`) already builds a
  WHOLE league's board.** Every pairing, every franchise, the identity
  ladder, the bench split, per-theme colour vars, the four honest statuses.
  The league pages and the offseason replay both go through it.
- **The data for an outside league is already fetched.**
  `readOutsideLiveSnapshot` returns every franchise's scores, starters, bench
  and pairings; `assembleMflLiveBoard` deliberately throws most of it away
  ("ONLY the franchises the viewer has a stake in") to keep the per-poll
  fan-out down. A full-league page simply stops discarding it.
- **Franchise names for an outside league already have a reader.**
  `readLeagueFranchiseNames` (`broadcast-live-source.ts`), hour-cached in
  process, which is what `/live/settings` already uses to name rows.

## The one real change: un-hardcode the registry from the board builder

`buildBoardFromSnapshot` takes a `CanonicalLeagueSlug` and reaches the
registry four times — `getLeagueBySlug` (id + name), `getLeagueTeamBrands`
(names), `resolveFranchiseIdentity({ leagueSlug })` (rung 1 crests) and
`surfaceForLeague`. An outside league has none of that, and today the
function answers `unavailable` for one.

**Generalize it; do not fork it.** This repo's forked-sibling history is the
argument (~57,800 lines across 24 forked routes), and a second board builder
would drift from this one on exactly the things that are subtle here — the
bench split, the four statuses, the per-theme grounds.

The shape: replace the bare `slug` input with the league identity the caller
already holds, which is `BoardLeague` in all but name.

```ts
interface BuildBoardInput {
  league: { id: string; name: string; slug: CanonicalLeagueSlug | null };
  /** Franchise names when the registry has no brands — outside leagues. */
  franchiseNames?: Record<string, string>;
  // … everything else unchanged
}
```

- `slug === null` → skip `getLeagueTeamBrands`, use `franchiseNames`, and
  call `resolveFranchiseIdentity` **without** `leagueSlug`, which drops it to
  the NFL-fallback and text rungs. That is precisely what `/live` already
  does for these leagues, so the marks match between the two screens.
- `panel.registered` becomes `slug !== null` instead of the literal `true`.
- `surface` stays **`mfl`** for both, because the ground belongs to the
  SURFACE and not to the matchup's league (`live/surface.ts` says so, and
  seven TheLeague franchises are `#181818` — resolved against the wrong
  ground they are a black shape on a black card).
- Existing callers pass `league: getLeagueBySlug(slug)` and are otherwise
  untouched.

## Route and poll

**`src/pages/live/league/[id].astro`** — `prerender = false`.

1. `getAuthUser`; signed out gets the same intro/CTA shell `/live` renders,
   never a bounce.
2. `discoverBoardLeagues(user)` and **find `[id]` in that list**. The URL
   param is *a check against what the session may see, never an input* — the
   same rule `leaguesParam` already carries. No match → 404, not an empty
   board.
3. Assemble **in process**. Never fetch our own API to render ourselves: a
   request blocked at the edge never reaches the route, which is how
   2026-09-09 printed "Scores will appear here when games begin" over a live
   slate.
4. Render `<LiveBoard client:load … />` with one panel, `viewerFirst`, and
   the canonical shape (no `pollShape` adapter needed — this path emits the
   canonical model directly).

**Poll:** extend **`/api/league-board`** to accept `?mfl=<leagueId>` beside
its existing `?league=<slug>`, sharing one assembler. A second poll route
would be the second implementation of the same answer. Same rules it already
keeps: `no-store`, 200 with `ok: false` on failure so the island keeps its
last good payload rather than blanking a live screen.

**Week:** `?week=` honoured, resolver result never clamped up to 1 — MFL
serves no live scoring before the Week 1 Thursday, and clamping is what turns
that gap into a mystery failure against a healthy league.

**Back:** a link to `/live`, since this is a drill-down and the shell's
hamburger does not know where you came from.

## The link

`LiveBoard.tsx` renders the panel header as
`{multiLeague && <h2 className="lv-panel__name">{panel.leagueName}</h2>}`.

Add an **optional `panelHref?: (panel: LivePanel) => string | null` prop** and
wrap the heading in an `<a>` when it returns one. `/live` passes
`` (p) => `/live/league/${p.leagueId}` ``; every other caller passes nothing
and renders exactly what it renders today. A hardcoded href inside the shared
kit would put the link on the single-league boards too, where it points at
the page you are already on.

The heading needs a real tap target (≥44px) and a visible focus ring — it is
the only way into this page.

## Cost

Per poll of the new page: **one** league's `liveScoring` + its projections
(already `PROJECTION_TTL_MS`-cached) + the shared ESPN work. The MFL half is
*smaller* than `/live`'s, because it is one league rather than all of them.

What grows is per-league work, not per-request work: identity resolution and
totals for 12–16 franchises instead of 2. That is CPU on rows already in the
payload, and `getLeagueTeamBrands` is called once per league rather than once
per franchise — keep it that way.

## Honest states, unchanged

The four statuses already exist and must all reach this page: `ok`,
`no-matchup`, `not-played`, `unavailable`. On a league board `no-matchup`
means the **league** has no pairings this week, which is a different sentence
from `/live`'s "you have no matchup" — `LvEmptyState`'s copy takes the league
name it is already passed. And an unplayed week is a well-formed payload of
zeros, so `hasLiveSignal` is what stops it printing as a real 0-0.

## Guards

- `tests/live-league-board.test.ts` — an outside league (no slug, no brands)
  builds a board with every pairing, `viewerSide` set on the viewer's and
  `null` on the rest; the identity ladder lands on NFL/text rungs; bench rows
  never reach `players`.
- Extend `tests/live-surface-grounds.test.ts`'s reach: a registry league
  rendered on this page resolves against the **mfl** ground, not its own.
- A route guard: `/live/league/<id>` for a league not in the session's
  `myleagues` answers 404.
- Wire all of it into `.claude/hooks/path-guard.json` under the live domain.

## Out of scope (deliberately)

Standings, a league-wide top-scorers strip, and anything that needs a second
MFL fetch per league. Decision 3 is cards only; those are a follow-up if the
page earns it.

## Ship

Changelog: one staged line in `src/data/weekly-changelog-staging.json`,
`league: "both"`, type `new-feature`. **Hero worthiness is Brandon's call**,
per CLAUDE.md — ask, never decide.
