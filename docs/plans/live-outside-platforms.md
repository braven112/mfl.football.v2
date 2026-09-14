# `/live` — fantasy platforms that are not MFL

> Companion to `docs/plans/mfl-live-app.md` (the plan of record for the board
> itself). That plan answers "every league the signed-in MFL account is in".
> This one answers the question it does not: **the leagues you have somewhere
> other than MFL.** Scope decided with Brandon 2026-09-14: `/live` only, not a
> general connected-accounts layer.
>
> **Order: Yahoo, then Sleeper, then ESPN.** Yahoo is first because a real
> owner uses it — which outranks the fact that it is the most code of the
> three. An earlier draft of this doc put Yahoo out of scope for exactly the
> reason that no longer holds ("no owner has asked"), and that line is the one
> being corrected here.

## Why this is written before it is built

Phase 2 of the board is the cross-league data layer, and its central move is
extracting the league-loop out of `assembleBoard` into a shared
`loadCrossLeagueSnapshot()`. **That extraction is the seam an outside platform
plugs into, and it is being written next.**

Every module the board reuses today is MFL-shaped end to end — `fetchMyLeagues`
(MFL `myleagues`), `buildBoardLeagues` (registry fold), `loadLeagueSnapshot` /
`readOutsideLiveSnapshot` (MFL hosts + the MFL owner cookie), `scoreLeague`.
If `loadCrossLeagueSnapshot()` is defined over MFL franchise ids, MFL player
ids and the MFL session cookie, adding a platform afterwards is a rewrite of
the function every board calls. If it is defined over a source-agnostic
matchup shape, each platform is an adapter behind it.

The cost of this document is one paragraph in phase 2's signature. The cost of
skipping it is paid later, in the one file `/broadcast` and `/live` share.

## The contract

`loadCrossLeagueSnapshot()` takes a list of **sources**, not a list of MFL
leagues. A source answers three questions and nothing else:

| Question | Shape |
|---|---|
| Which leagues is this identity in? | `{ id, name, platform, franchiseName, artwork? }[]` |
| What are my matchups in league X, week W? | both sides' totals, yet-to-play, starters |
| Is any of it live right now? | `hasLiveSignal` — never inferred from a zeros payload |

MFL is then one source (the existing modules, unchanged, wrapped), Yahoo a
second, Sleeper a third, ESPN a fourth if it comes. Three rules the shape
carries rather than leaving to callers:

- **`platform` is part of a league's identity, not decoration.** Ids collide
  across platforms exactly the way franchise `0001` collides across leagues —
  the mistake this repo has already made twice (the board's Redis keys, the
  rankings buckets). Key on `platform + leagueId` from the first line.
- **A source that fails degrades to "unavailable", never to zeros.** Already
  the rule for MFL (`hasLiveSignal`, decision 8 in the parent plan); an outside
  platform makes it load-bearing, because one platform's outage must not render
  as every matchup on it tied 0-0 on a Sunday.
- **A source renders in ITS OWN ids.** Do not join an outside platform's
  players to MFL ids to draw a row. See "The join you do not need" below.

## Yahoo — first, and the repo's first OAuth

### What makes it different from the other two

Yahoo is the only one of the three with a **sanctioned, documented API**, and
the only one whose access the owner can revoke from their own account page.
That is why it is worth the extra code: ESPN's private-league path means
holding a scraped session cookie, and Yahoo's means holding a scoped grant the
user issued deliberately and can withdraw.

It is also **the first OAuth2 authorization-code flow in this repo.** Nothing
here does a token exchange today — MFL login posts credentials and keeps a
cookie, GroupMe uses a static token (its one "OAuth callback" mention just maps
a userId to a franchiseId). So this drop builds, from nothing:

- an authorize redirect and a `state` parameter that is verified on return
  (CSRF on the callback is not optional — the callback mints a stored grant);
- a callback route that exchanges the code and never renders the token;
- encrypted-at-rest refresh-token storage, server-side only;
- refresh-on-expiry, **single-flight** — access tokens last an hour, and a poll
  across N leagues must not fire N refreshes; Yahoo may also rotate the refresh
  token on use, so a concurrent refresh can invalidate its sibling.

None of that is exotic, but none of it exists to copy from, so it is the bulk
of the estimate — not the fetching.

### What is verified, and what is not

Checked live on 2026-09-14, so the plan is not resting on recollection:

| Claim | Status |
|---|---|
| Yahoo has no anonymous read | **Verified** — `GET /fantasy/v2/game/nfl` unauthenticated returns `401` |
| The API is current, not deprecated | **Verified** — Yahoo describes "real-time fantasy data … including leagues, teams, players, and matchups" |
| `users;use_login=1 … /leagues` is the "my leagues" resource | **Verified** — documented at `/fantasy/v2/users;use_login=1/games/leagues` |
| The scoreboard carries the numbers a live row needs | **Verified in the docs' own sample** — `<team_points><coverage_type>week</coverage_type><week>16</week><total>112.82</total></team_points>` and `<team_projected_points>…<total>108.87</total>` |
| Per-player points on a roster | **NOT confirmed.** `/fantasy/v2/team/{team_key}/roster;week={week}` documents players as a sub-resource but shows no sample with point fields. The expand payload is the one data question the docs do not close. |
| How fast points move during games | **NOT confirmed**, and not confirmable without a token |
| Getting access at all | **NOT confirmed — see below** |

### The real long pole is ACCESS, not code

This is the correction that matters most, and it invalidates the "register an
app in five minutes" assumption an earlier draft of this plan was built on.

Yahoo no longer hands out a fantasy API key self-serve. Their developer page
(checked 2026-09-14) describes three steps: **submit an application, await
review, receive access if approved.** No timeline and no approval bar are
published.

So the honest shape of this integration is not "N days of work". It is:

1. an application to Yahoo with an unknown review time and a non-zero chance
   of "no", which we do not control; then
2. work that is well understood, against documented fields.

Start (1) immediately and independently of any code — it costs nothing but a
form, and everything else is unblocked by it rather than the other way around.
Nothing should be built against Yahoo until access is granted.

### JSON is undocumented; XML is the published contract

`format=json` works and every third-party Yahoo client uses it. Yahoo does not
document it — the official docs are XML-only.

That inverts the earlier recommendation. The awkward collection-keyed-object
JSON is an **undocumented translation** of a documented XML contract, and
building the normalizer against the undocumented side means the shape can move
with no notice and no changelog. Prefer parsing the XML. Revisit only if a live
payload shows the XML is worse in some way the docs hide.

### Blocking prerequisite — an ops task, not a code one

Once access is approved, the app is registered with **Fantasy Sports — Read**
permission, yielding a client ID and secret. This cannot be done from the repo.

**The redirect URI is the constraint that shapes the deploy.** Yahoo requires a
fixed HTTPS callback, and Vercel preview URLs are per-deployment — so previews
can never be the callback host. The callback belongs on `staging.mfl.football`
(the apex still serves the unrelated 2018 page; see the parent plan's DNS
item), which means Yahoo can only be exercised end to end on staging, not on
the PR preview the rest of `/live` is reviewed on. Plan the phase accordingly:
the normalizer and the view model are testable on a preview, the connect flow
is not.

### The calls

Base `https://fantasysports.yahooapis.com/fantasy/v2/`, every request
`?format=json` and `Authorization: Bearer <access_token>`.

```
/users;use_login=1/games;game_keys=nfl/leagues     → their NFL leagues
/league/<league_key>/scoreboard;week=<W>           → matchups, team points, projected
/league/<league_key>/teams                         → names, logos, manager
/team/<team_key>/roster;week=<W>/players/stats     → starter-level points (on expand)
```

`game_keys=nfl` resolves to the current season without hardcoding a numeric
game id — which is also the right call for this repo, where a hardcoded season
key is a rollover bug waiting for Labor Day.

### The JSON shape is the actual work

Yahoo's API is XML-native and `format=json` is a mechanical translation of it.
Collections come back as **objects keyed `"0"`, `"1"`, … alongside a `count`
key**, and an entity's attributes arrive as an array of single-key objects
rather than one object. It is not a shape any consumer wants to touch directly.

So: one normalizer module, and it is the piece that earns unit tests. Record
real responses as fixtures rather than hand-writing them — the same discipline
`scripts/record-mfl-fixture.mjs` applies to MFL exports, for the same reason
(a hand-pasted fixture encodes what we *assumed* the shape was, which is
exactly the thing under test).

### The join you do not need

Unlike Sleeper, this repo has no Yahoo→MFL player id map, and **v1 should not
build one.** Yahoo returns names, positions, NFL teams, points and an
`image_url` per player — everything a matchup row draws. Joining to MFL ids
buys nothing for the board and walks straight into the live-scoring bug class,
where a college athlete id and an NFL one are both plain digits so a bad join
resolves the wrong person instead of failing.

A join becomes necessary only if a later feature wants cross-platform identity
(watch-list crossover, "you own him in three leagues"). That is a separate
decision with its own doc.

### Storage and fan-out

Store the refresh token keyed on the **MFL account (`user.id`)**, not on league
+ franchise. Deliberately unlike every other Redis key in this repo, and it
follows the parent plan's own rule — *read the MFL cookie (`user.id`), never
`user.leagueId`*. The board is account-scoped; the session's league is one of N
and has no claim on which Yahoo account the person owns.

Per poll it is ONE `scoreboard` call per league. Teams and rosters are
per-league constants for the week and belong in the same cache tier as the MFL
league feeds, never in the poll. Cadence comes from
`shouldPollLive(nflSlate, isLive)` like everything else on this board — do not
add a second poller, and do not let an outside platform's hint decide whether
to poll at all.

## Sleeper — second, and much smaller

Kept in the plan because once the source contract exists, Sleeper is close to
free: public read-only REST, **no key, no OAuth, no stored credential.**

```
GET api.sleeper.app/v1/user/<username>              → user_id
GET api.sleeper.app/v1/user/<user_id>/leagues/nfl/<season>
GET api.sleeper.app/v1/league/<id>/rosters
GET api.sleeper.app/v1/league/<id>/users
GET api.sleeper.app/v1/league/<id>/matchups/<week>  → points, players_points
```

`matchups/<week>` carries per-roster `points` and per-player `players_points`,
live during games — the exact payload the compact row wants.

Identity is a username entered once in `/live/settings`; store the resolved
`user_id`, not the username (usernames are mutable, the id is not), on the same
account-scoped key as Yahoo's grant. No credential is involved, so no
encryption question.

Sleeper is also the one platform where a player-id join is already solved:
`scripts/fetch-ranking-sources.mjs` pulls `players/nfl` (the 5 MB map) and
matches Sleeper ids to MFL ids at build time, once. Reuse that artifact if a
join is ever wanted — and inherit the rule that both id spaces are plain
digits, so it is matched through the built map or not at all.

## ESPN — third, and conditionally

Its fantasy host is already reachable from this repo
(`lm-api-reads.fantasy.espn.com`, used at build time for the ESPN and ESPN
Superflex ranking sources), and a **public** league needs no auth:

```
GET lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/<year>
    /segments/0/leagues/<id>?view=mMatchupScore&view=mTeam&view=mRoster
```

Three things keep it last:

1. **Most leagues are private**, needing the owner's `espn_s2` + `SWID`
   cookies. There is no OAuth and no un-authed "list my leagues" endpoint, so
   ESPN cannot copy Sleeper's username onboarding or Yahoo's grant.
2. **Storing `espn_s2` is storing a live session credential** for a
   third-party account — a security review, not a feature toggle. The Import
   Rankings bookmarklets are the mechanism that would capture it painlessly,
   which argues for doing it well later rather than quickly now.
3. **The API is undocumented and unversioned.** It changed hosts in 2024 and
   its `view` parameters move; it needs the degrade-to-unavailable path to be
   real and tested before it is the thing being tested.

## Not in scope

**Fleaflicker** (public read API, negligible audience), **NFL.com and CBS**
(effectively closed). Named so the next person does not re-research them.

## Open

1. **Where a platform is connected.** `/live/settings` exists for league
   toggles; is a connected-accounts block the right neighbour, or does that
   pull the settings page toward being the layer this scope said no to?
2. **What a Yahoo-only owner sees.** `/live` requires an MFL session to exist
   at all. Someone with three Yahoo leagues and no MFL account is a coherent
   user of this board and cannot sign in. Out of scope for v1, worth naming
   before the sign-in flow calcifies — and more pressing now that the first
   integration is the one a non-MFL owner is most likely to arrive with.
3. **Revocation.** A refresh token can be withdrawn from Yahoo's side at any
   time. The board must show "reconnect Yahoo" rather than an error or an empty
   league list, and must not retry a revoked grant every poll.
4. **Multi-season.** Both Yahoo (`game_keys`) and Sleeper
   (`previous_league_id`) chain year to year. The board wants the current
   season only, but each fetch should record which season it asked for rather
   than assuming.
