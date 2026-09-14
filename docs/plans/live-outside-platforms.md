# `/live` — fantasy platforms that are not MFL

> Companion to `docs/plans/mfl-live-app.md` (the plan of record for the board
> itself). That plan answers "every league the signed-in MFL account is in".
> This one answers the question it does not: **the leagues you have somewhere
> other than MFL.** Scope decided with Brandon on 2026-09-14: `/live` only —
> not a general connected-accounts layer — and **Sleeper first, ESPN later**.

## Why this is written now, before it is built

Phase 2 of the board is the cross-league data layer, and its central move is
extracting the league-loop out of `assembleBoard` into a shared
`loadCrossLeagueSnapshot()`. **That extraction is the seam an outside platform
plugs into, and it is being written next.**

Every module the board reuses today is MFL-shaped end to end — `fetchMyLeagues`
(MFL `myleagues`), `buildBoardLeagues` (registry fold), `loadLeagueSnapshot` /
`readOutsideLiveSnapshot` (MFL hosts + the MFL owner cookie), `scoreLeague`.
If `loadCrossLeagueSnapshot()` is defined over MFL franchise ids, MFL player
ids and the MFL session cookie, adding Sleeper afterwards is a rewrite of the
function every board calls. If it is defined over a source-agnostic matchup
shape, Sleeper is an adapter behind it.

So the cost of this document is one paragraph in phase 2's signature. The cost
of skipping it is paid later, in the one file `/broadcast` and `/live` share.

## The contract

`loadCrossLeagueSnapshot()` should take a list of **sources**, not a list of
MFL leagues. A source answers three questions and nothing else:

| Question | Shape |
|---|---|
| Which leagues is this identity in? | `{ id, name, platform, franchiseName, artwork? }[]` |
| What are my matchups in league X, week W? | both sides' totals, yet-to-play, starters |
| Is any of it live right now? | `hasLiveSignal` — never inferred from a zeros payload |

MFL is then one source (the existing modules, unchanged, wrapped), Sleeper is a
second, and ESPN is a third whenever it arrives. Two rules the shape must carry
rather than leave to callers:

- **`platform` is part of a league's identity, not decoration.** Ids collide
  across platforms exactly the way franchise `0001` collides across leagues —
  the mistake this repo has already made twice (the board's Redis keys, the
  rankings buckets). Key on `platform + leagueId` from the first line.
- **A source that fails degrades to "unavailable", never to zeros.** Already
  the rule for MFL (`hasLiveSignal`, decision 8 in the parent plan); an outside
  platform makes it load-bearing, because a Sleeper outage must not render as
  every Sleeper matchup tied 0-0 on a Sunday.

## Sleeper — the whole integration

Chosen first because it needs **no key, no OAuth and no stored credential**.
Public read-only REST, and the expensive half is already solved in this repo.

### The calls

```
GET api.sleeper.app/v1/user/<username>              → user_id
GET api.sleeper.app/v1/user/<user_id>/leagues/nfl/<season>
GET api.sleeper.app/v1/league/<id>/rosters          → roster_id → owner, players
GET api.sleeper.app/v1/league/<id>/users            → display names, avatars
GET api.sleeper.app/v1/league/<id>/matchups/<week>  → points, players_points
```

`matchups/<week>` carries per-roster `points` and per-player `players_points`
and updates during games, which is the exact payload the compact row wants
(both totals, expand for starters). No scraping, no HTML.

### Identity — the one new stored field

Sleeper has no link to an MFL account, so the owner supplies a username once,
in `/live/settings`. Store the resolved `user_id`, not the username: usernames
are mutable, the id is not.

**Key it on the MFL account (`user.id`), not on league + franchise.** This is
deliberately unlike every other Redis key in the repo, and it follows the
parent plan's own rule — *read the MFL cookie (`user.id`), never
`user.leagueId`*. The board is account-scoped; the session's league is one of N
and has no claim on which Sleeper account the person owns.

### Player ids — already solved, do not re-solve

`scripts/fetch-ranking-sources.mjs` already pulls `players/nfl` (the 5 MB map)
and matches Sleeper ids to MFL ids at build time, once, rather than in every
visitor's browser. The board reuses that artifact.

Inherit the live-scoring rule while doing it: **a Sleeper id and an MFL id are
both plain digits**, so a bad join resolves the wrong person instead of
failing. Match through the built map or not at all — never by coercing ids.

### Artwork

Sleeper serves team avatars on `sleepercdn.com`, which the repo already uses
for player thumbs. The parent plan's NFL-nickname fallback (decision 13)
applies unchanged when a team has no avatar.

### Fan-out and cadence

Sleeper's limit is generous (roughly 1k requests/minute per IP) but the board's
"all leagues on" default is what makes fan-out real — see the parent plan's
Fan-out section. Per league per poll it is ONE `matchups/<week>` call; rosters
and users are per-league constants for the week and belong in the same cache
tier as the MFL league feeds, not in the poll.

Cadence comes from `shouldPollLive(nflSlate, isLive)` like everything else on
this board. Do not add a second poller, and do not let a Sleeper hint decide
whether to poll at all.

## ESPN — deferred, and why

Not a rejection; a sequencing call. ESPN's fantasy API is already reachable
from this repo (`lm-api-reads.fantasy.espn.com`, used at build time for the
ESPN and ESPN Superflex ranking sources), and a **public** league needs no auth
at all:

```
GET lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/<year>
    /segments/0/leagues/<id>?view=mMatchupScore&view=mTeam&view=mRoster
```

Three things make it the second integration rather than the first:

1. **Most leagues are private**, and a private league needs the owner's
   `espn_s2` + `SWID` cookies. There is no OAuth, and no un-authed "list my
   leagues" endpoint — so ESPN cannot copy Sleeper's "give us a username"
   onboarding.
2. **Storing `espn_s2` is storing a live session credential** for someone's
   third-party account. That is a security decision with its own review, not a
   feature toggle. This repo already ships the mechanism that would capture it
   painlessly — the Import Rankings bookmarklets — which is an argument for
   doing it well later, not quickly now.
3. **The API is undocumented and unversioned.** It changed hosts in 2024 and
   its `view` parameters move. It needs the degrade-to-unavailable path above
   to be real and tested before it is the thing being tested.

Revisit once Sleeper has survived a live Sunday and the source contract has
stopped moving.

## Not in scope

**Yahoo** (sanctioned OAuth2, heavier than both, and no owner has asked),
**Fleaflicker** (public read API, negligible audience), **NFL.com and CBS**
(effectively closed). Named here so the next person does not re-research them.

## Open

1. **Where the Sleeper username is entered.** `/live/settings` exists for
   league toggles; is a linked-accounts block the right neighbour, or does that
   pull the settings page toward being the connected-accounts layer this scope
   deliberately said no to?
2. **Multi-season.** Sleeper leagues chain year to year (`previous_league_id`).
   The board only wants the current season, but the fetch should record which
   season it asked for rather than assuming.
3. **What a Sleeper-only owner sees.** Today `/live` requires an MFL session to
   exist at all. Someone with three Sleeper leagues and no MFL account is a
   coherent user of this board and cannot sign in. Out of scope for v1, worth
   naming before the sign-in flow calcifies.
