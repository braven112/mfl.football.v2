# MFL Live: Sleeper leagues

Plan of record. Phases 1-3 built Oct 2026 (`src/utils/sleeper/`).

## Goal

Someone signed in to MFL Live sees their Sleeper matchups on the same `/live`
board as their MFL leagues, with the same compact row, the expandable starter
list, the scoring ticker and the red-zone banner.

## How a user connects Sleeper

1. On `/live/settings`, the user types their **Sleeper username**. There's no
   password and no OAuth, because Sleeper's API is public and read-only.
2. We look it up (`GET /v1/user/{username}`), show the avatar and display name
   so they can confirm it's them, and save the Sleeper user id against their
   MFL account in Redis.
3. Their Sleeper NFL leagues for the season
   (`GET /v1/user/{id}/leagues/nfl/{season}`) then show up in the league
   toggles next to their MFL leagues, all on by default like everything else
   on the board.

Caveat: anyone can type anyone's username. That's fine here because Sleeper
league data is public anyway, and the board only reads it.

## How it fits the existing code

The board already reads every league through one shared module
(`src/utils/cross-league-live.ts`). Each league comes back as a `LiveSnapshot`:
scores, matchups, starters and bench per team. The plan is to add a second
source that produces that same shape from Sleeper, so the board, ticker and
red zone don't change.

| Piece | Today (MFL) | Sleeper version |
|---|---|---|
| League list | `fetchMyLeagues` / `buildBoardLeagues` | `GET /user/{id}/leagues/nfl/{season}`, folded into the same `BoardLeague` list and tagged `provider: 'sleeper'` |
| Live read | `readOutsideLiveSnapshot` (MFL `liveScoring`) | `GET /league/{id}/matchups/{week}`, which gives points per starter. Grouped by `matchup_id`, that turns into matchups |
| Team names | `readLeagueFranchiseMarks` | `GET /league/{id}/users` + `/rosters` give team names and avatars, cached an hour |
| "Which team is mine" | MFL franchise id | the roster whose `owner_id` (or `co_owners`) is the user's Sleeper id |
| Scoring | `scoreLeague` sums MFL's totals | Sleeper already computes the points, so we take its totals as they are and never re-score with our rules |
| Players | MFL player ids | mapped to MFL ids (see below) so the ticker, headshots and red zone work |

## The real work: matching Sleeper players to MFL players

Sleeper uses its own player ids. The ticker and red zone run on MFL ids
(translated from ESPN plays), so every Sleeper starter has to resolve to an MFL
player.

- **Primary join: the ESPN id.** Sleeper's player list (`/v1/players/nfl`, 5MB,
  meant to be fetched at most once a day) carries `espn_id`, and MFL's players
  feed carries `espn_id` too. Joining on that is exact.
- **Fallback: name + position + team**, using the existing
  `player-name-matching.ts` that already matches Sleeper rankings to MFL.
- **Team defenses** map by NFL team code.
- **A player we can't match still shows**, with his Sleeper name and points.
  He just can't trigger ticker or red-zone moments. Nothing gets dropped.
- Built once a day into a committed map (a prebuild/cron step), never fetched
  per poll.

The live-scoring rules doc's warning applies here: a college athlete id and an
NFL one are both plain digits, so a bad join resolves the wrong person instead
of failing. The map needs a guard test.

## Polling cost

Sleeper allows about 1,000 calls a minute per IP. One poll costs one
`matchups` call per Sleeper league. Names and the player map are cached. That
fits well inside the limit at our scale, and it uses the same fan-out limit and
"partial results, never blank the board" rules as MFL.

## Gaps vs. an MFL league

- **Projections and win probability.** Sleeper has no documented projections
  endpoint. There's an undocumented one the Sleeper app itself uses, but it can
  change without notice. See question 2.
- **"Yet to play".** Sleeper doesn't send it. We'd compute it from each
  starter's NFL team and the NFL scoreboard we already load.
- **Push alerts for close finishes** would work the same once the scores are in.

## Phases

1. Link a Sleeper username on settings and list the leagues (no scores yet).
2. Player id map + live scores on the board, with the failure badge per league.
3. Ticker and red zone for Sleeper starters (comes free once ids map).
4. Projections / win probability, if we go that way.

## Decisions (Brandon, 2026-10-17)

1. **Linking is a Sleeper username** typed on `/live/settings`. No sign-in.
   Stored in Redis under a hash of the viewer's MFL username, never under
   `user.id` (that is the MFL cookie, a credential).
2. **Live scores only.** No Sleeper projections, so a Sleeper matchup carries
   `noProjections` and draws no win-probability bar and no "proj" figures.

## As built

- The player join turned out to need a RotoWire rung: Sleeper leaves
  `espn_id` empty for many current starters (Ja'Marr Chase among them).
  Ladder: ESPN id (`nflEspnId` on the MFL side) → RotoWire id → unique
  name + position. Measured on 866 active, rostered Sleeper players: 175 by
  ESPN, 579 by RotoWire, 4 by name, 108 unmatched (mostly deep reserves).
- The 15 MB player list is fetched at most once a day and cached as a
  compact map in Redis (`live:sleeper:players:v1:<year>`).
- Sleeper league ids are prefixed `sl-` on the board.
- A Sleeper panel has no league-board link and no stat sheet (both read MFL).
- Only the MFL Live board and its settings page read Sleeper. `/broadcast`,
  Sunday Ticket, standings and the league boards are untouched.
- **The phone app (2026-10-27).** The store board (`?source=mfl`) shows
  Sleeper leagues too. It may not read ESPN, so each starter's clock comes
  from MFL's `nflSchedule` export (`sleeper/store-clock.ts`, cached 30 s); a
  failed read marks the league unavailable rather than Final, same as a failed
  ESPN read on the web. Linking is still done on `/live/settings`: the link is
  keyed by the MFL account, so the app sees it. Commercial-use status of
  Sleeper's terms: `mfl-live-store-app.md` § Legal.

## Crowd player matching (Oct 2026)

Brandon: owners should be able to resolve their own unmatched players, and
those fixes should come back to everyone. Decisions, all three as recommended:

1. **Where:** a "Players we couldn't match" list on `/live/settings`
   (`#sleeper-fixes`), listing only the viewer's own rostered players. The
   board marks unmatched rows and each Sleeper panel links to the list.
2. **When a fix counts for everyone:** at once for the owner who made it; for
   everyone once **two** different owners pick the same MFL player, or the
   admin applies it.
3. **Admin page:** `/live/player-fixes`, gated like `/live/analytics`. Apply
   or reject any candidate. A rejection blocks that pick for that player and
   withdraws it from every voter.

Rules that are load-bearing (`src/utils/sleeper/player-fixes.ts`, pinned by
`tests/sleeper-player-fixes.test.ts`):

- A fix only FILLS a blank the join left. It can never re-point a match.
- One MFL account is one vote (`sleeperViewerKey`, the hashed username).
- Two candidates that each have agreement form a dispute, and neither applies
  until the admin settles it.
- An admin apply is never overturned by a count, only by an admin reject.
- Fixes are keyed by Sleeper player id, which is stable across seasons.
