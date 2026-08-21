# Live scoring — ESPN game data and the ids that lie

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Live scoring — ESPN game data, and the ids that don't mean what they look like

The live-scoring page joins MFL fantasy points to real NFL game data from three
public ESPN endpoints (scoreboard / `summary` box score / core-API `plays`).
Parsers are pure and fixture-tested in `src/utils/espn-game-detail.ts`, fetching
lives in `src/pages/api/nfl-game-detail.ts`, and the derived view model is
`src/utils/live-scoring-view.ts`. ESPN is intermittently 403 from the sandbox,
which is exactly why the split exists — verify parsing offline against
`tests/fixtures/espn-*.json`, verify fetching on a preview.

- **MFL omits `espn_id` for real starters, so `nflEspnId` is MFL's id OR a
  generated backfill.** 23 of 976 skill players had none — including D'Andre
  Swift, Tony Pollard and three starting kickers — and a missing id doesn't
  fail, it silently drops the player out of every ESPN-backed surface (the AFL
  ticker credited "Tre Tucker 26 Yd pass from Geno Smith" to Geno Smith alone).
  `scripts/fetch-espn-athlete-ids.mjs` (prebuild + daily in roster-sync) writes
  `data/theleague/derived/espn-nfl-id-backfill.json`; `player-map.ts` uses it
  ONLY where MFL has no id of its own. Matching is deliberately conservative
  because a wrong id resolves a different athlete rather than failing: team
  rosters first (team + jersey confirm the name), then ESPN search filtered on
  the `~l:28~` NFL segment of the `uid` — that segment is the only thing
  separating the NFL Daniel Carlson from the Arkansas one. A player who has
  never been on an NFL roster has no NFL athlete id to find, and leaving him
  blank is correct; his only ESPN matches are other people (one was a Stony
  Brook BASKETBALL player). `tests/espn-athlete-id-coverage.test.ts` holds the
  line: 100% of rostered players in every league, 95% of the pool.
- **Join on `PlayerIdentity.nflEspnId`, server-side, and never ship an ESPN id
  to the client.** `PlayerMeta.espnId` can hold a COLLEGE athlete id, and
  college and NFL ids are both plain 4-7 digit numbers, so joining on it
  resolves a DIFFERENT athlete rather than failing (same trap as
  `docs/claude/insights/features/player-news.md`). The route translates every
  id to an MFL player id before the response boundary.
- **A play id is not an athlete id.** ESPN builds it by concatenating the event
  id with the play sequence, so it passes 12 digits partway through a normal
  game — `isValidEspnId`'s `\d{1,12}` cap silently dropped 5 of 8 scoring plays
  in the fixture. Don't widen that helper (it guards a real SSRF surface on the
  athlete-news URL path); play ids get their own check.
- **`sequenceNumber` orders plays WITHIN one game only.** Merging a 16-game
  slate on it interleaves quarters into a timeline that isn't one (a Q4 score
  landing between two Q3s — that shipped and was visible). Sort on the shared
  game clock: `comparePlaysChronologically` (period asc, clock DESC — an NFL
  clock counts down).
- **The two team-code normalizers pull in OPPOSITE directions.**
  `normalizeEspnTeamCode` folds WSH→WAS; `normalizeTeamCode` folds WAS→WSH and
  handles the legacy codes. `canonicalNflCode` composes them in that order so
  ESPN's own spellings round-trip to the form `PlayerIdentity.nflTeam` and the
  logo assets use. Comparing a raw ESPN abbreviation against `nflTeam` misses
  Washington and Jacksonville.
- **`isRedZone` belongs to the team WITH THE BALL, not to the game.** Gate on
  `situation.possession === player's nflTeam` (`isPlayerInRedZone`) or you flag
  a receiver while his team is on defense. Same gate for down & distance.
- **Never fabricate a clock.** The old `clockLabel()` divided MFL's
  `gameSecondsRemaining` by 900 and printed a confident "Q3 7:24" that was not
  the game clock and drifted all afternoon (the NFL clock stops; that number
  doesn't). With no ESPN game we now print the STATE and no numbers.
- **The scoring ticker is DERIVED, not accumulated.** `/api/nfl-game-detail`
  returns the whole slate's plays every poll, so `buildMoments` recomputing is
  idempotent — no seen-set to drift. It dedupes per `playId:franchiseId`, since
  a TD credits the scorer AND the kicker and an owner starting both saw the row
  twice.
- **Bench rows travel in their OWN map, never in `players` with a status flag.**
  Everything downstream reads `players` as "the rows that score this matchup":
  `computeTeam` sums each row's remaining projection into the team's projected
  final and counts it in "yet to play", `winProbability` follows from that, and
  `buildMoments` credits a scoring play to whoever is listed. A bench row in
  there inflates every projection and win-probability bar on the board with
  points that cannot be scored, and puts bench touchdowns in a matchup ticker.
  `/api/live-scoring` therefore returns a separate `bench` map and a caller has
  to opt in (`LiveScoringResponse.bench` → `LiveScoringData.bench` →
  `LiveScoringPageProps.initialBench`). A row MFL does not confirm as
  `nonstarter` is treated as a STARTER — dropping a real starter silently
  subtracts his points, which is far worse than one extra row. A franchise with
  no bench is ABSENT from the map, so the island renders no disclosure control
  rather than one that opens onto nothing.
- **`res.ok` is not "the data is good" on our OWN routes either.**
  `/api/live-scoring` answers 200 with `ok: false` and empty collections when
  the upstream MFL call fails, and `{}` is truthy — so `if (data.players)` is
  not a guard, it is always taken. Gating on it wiped every score and player row
  off a live board while the freshness pill still reported the poll healthy.
  Both halves gate on the flag: `assembleLiveScoringData` on
  `snapshot?.ok !== false`, the island's poller on `data.ok === false`.
- **DEF/ST gets no stat line, deliberately.** `boxscore.players` is athlete-keyed
  and MFL's 32 defenses carry no `espn_id`, so there is no join key even in
  principle. Deriving one from the opposing team's totals needs each league's
  DEF scoring rules, which we don't model — a plausible wrong number next to the
  real MFL score is worse than a blank.
- **The AFL rosters duplicate players, and that changes who a play belongs to.**
  With `duplicatePlayers: true` the same NFL player is started by two franchises
  at once — 85 of 131 starters in a real AFL week — so a `Map<playerId, fid>`
  keeps the last one written and drops the play from the other owner's ticker
  (41% of AFL scoring-play attributions: 202 rows collapse to 120). `buildMoments`
  therefore keys owners as `playerId -> fid[]`. The MATCHUP ticker then needs the
  opposite guard: it merges two franchises into one list, and in the AFL both
  sides can own the same play, so `selectMatchupMoments` dedupes per `playId` for
  rendering. Two different dedupes, both load-bearing — the first lets one TD
  reach two owners, the second stops the same line printing twice with no team
  attribution to tell it apart.
- **Two pollers on the page, not three.** `src/utils/live-poll-store.ts` holds a
  module-scope store that both islands (`LiveScoreboard`, `NflGamesStrip`)
  subscribe to via `src/hooks/useNfl*`; React state can't cross island roots but
  a shared module chunk can. It runs at the MINIMUM interval any subscriber
  asks, and a failed poll KEEPS the last good data while flipping `status` to
  `'error'` — "the feed says nothing" and "we couldn't reach the feed" stay
  separate all the way to the UI.
- **Fan-out is bounded and partial results are the point.** `mapWithConcurrency`
  (`src/utils/fan-out.ts`) + `Promise.allSettled` + a per-event TTL cache
  (25s live / 5min final, and a PARTIAL read is never cached). Both routes are
  `no-store`; a CDN copy of a live box score is wrong while looking live.

