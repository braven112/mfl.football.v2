# Standings order, AFL playoff brackets, and draft-order framing

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Standings order — MFL is the source of truth; "most PA" is decoupled

Two related rules, both from commissioner rulings in August 2026.

**1. Never re-sort MFL's standings rows.** MFL's `leagueStandings` export
returns rows in the league's OFFICIAL final order, with each league's
constitution tiebreaker chain already applied — including head-to-head, which
we cannot reproduce (the feed's `h2h*` columns only echo the overall record).
The first row of each division IS that division's winner. Every standings,
playoffs and homepage surface in BOTH leagues passes
`{ preserveFeedOrder: true }` to `src/utils/standings.ts`; the awards scripts
take `group[0]` in feed order. Homebrew tiebreakers miscredited 22 AFL and 10
TheLeague division titles before this rule existed. The proof that MFL is
applying the rulebook and we cannot is TheLeague's 2015 Central: two 15-3-0
teams with identical 4-2-0 division records, where MFL credited the team with
LOWER all-play and LOWER points because it swept the season series.
`divisionTiebreaker` in standings.ts now has no production callers.

**2. "Most Points Allowed" benefits the team — in BOTH directions.** The team
that gave up more points wins that tiebreaker step, meaning it gets both the
better standing and the better (earlier) draft pick. Those are opposite ends of
one ranking, so the step is deliberately **decoupled**: see
`PointsAllowedFavors` in `src/utils/afl-draft-utils.ts`
(`rankDivisionBlockWorstFirst` takes `'draft'` vs `'standings'`). Do not
"simplify" the two directions back into one — `tests/points-allowed-tiebreaker.test.ts`
has a guard for exactly that. The step has never actually decided a real
division title, so a regression here is invisible in the data.

Caveat worth remembering: because standings order now comes from MFL, rule 2
only governs OUR draft-order math. The live standings apply whatever MFL's
`OPP_PTS` setting does, which is a league-settings question, not a code one.

**3. Division alignment is per-season too — `resolveConfigForYear` is not
enough.** It resolves a franchise's historical name/icon/banner/conference but
NOT its `division`, and every standings surface groups on
`getTeamConfig().division`. Compose `applyHistoricalDivisions`
(`src/utils/historical-divisions.ts`) after it, passing that season's
`league.json`, or an archived year gets grouped by TODAY's map — which had 21 of
76 TheLeague division-seasons (every year 2007-2015) showing a different winner
than `franchise-history.json`, and invented divisions for 2007-2010 (the league
actually ran Pacific/Midwest/Central/Atlantic). The helper is fail-safe: a
missing or malformed feed leaves the config untouched.

**Division display names go through `divisionAliases`** (in
`theleague.config.json`, applied by both `applyHistoricalDivisions` and
`compute-franchise-history.mjs`). MFL's archives call the fourth division
"Eastern" from 2012 on; the league displays it as "East" (commissioner,
2026-08-11). Committed archive feeds keep saying "Eastern" even after MFL is
renamed, so this alias is permanent, not transitional. Anything keyed on a
division name — notably `DIVISION_BADGES` — keys the DISPLAY name only; retired
divisions (Pacific/Midwest/Atlantic) are intentionally unbadged so
`StandingsTable` falls back to a plain header.

**The AFL already had its own version of this** — do NOT port
`applyHistoricalDivisions` there. `src/utils/afl-structure.ts`
(`extractSeasonStructure` + `applySeasonStructure`) has resolved the AFL's
per-season divisions AND conferences from `league.json` for a while, which it
must: the AFL re-parented divisions, not just renamed them (2003-2012 ran SIX,
three per conference — North/Central/South American, East/West/Pacific
National). Every AFL surface that groups by division or conference has to
compose it after `resolveConfigForYear`, and
`tests/afl-structure.test.ts` greps both AFL pages to enforce that — a helper
existing is not the same as a page calling it, which is exactly how
`/afl-fantasy/playoffs` ended up seeding 12 conference-seasons differently than
`/afl-fantasy/standings` for the same year.

Two leagues, two helpers, on purpose: TheLeague has no conferences and needs
`divisionAliases`; the AFL has conferences and doesn't. Merging them would drag
each league's special case into the other.

Two traps this work surfaced, written up in full under `docs/claude/insights/`:
a missing `h2hwlt` column parses to `0-0-0` instead of erroring and silently
erased TheLeague's entire 2022 season (`domains/mfl-api.md`), and owner-scoped
attribution drops awards won under a slot's previous owner — which reads
exactly like "defunct franchise" and leads to the wrong fix
(`features/franchise-history.md`).


## AFL playoff brackets — reconstructed games, and ids that lie

MFL's `playoffBracket` export carries seeds only for 2003-2023 — no franchise
ids, no points — so `/afl-fantasy/playoffs` rendered "Bracket data not
available" for every season before 2024. The GAMES were never missing:
`schedule.json` has every playoff week fully scored.

- **`scripts/reconstruct-afl-playoff-brackets.mjs`** walks those weeks as a
  single-elimination tournament and writes
  `data/afl-fantasy/derived/reconstructed-playoff-brackets.json` in MFL's own
  `brackets` shape. The page consults it **only** when the committed feed has
  no games for a bracket — real MFL data always wins. 20 seasons recovered,
  every declared postseason bracket in each.
- **The standings do not always describe the field.** `championshipField` takes
  the top N of each conference in standings order, which is right for 17 of the
  19 seasons — but 2004 and 2011 ran six divisions into an eight-team bracket,
  so division winners took most of the slots and teams outside the top eight
  qualified ahead of better records. Seeded wrong, the walk finds two of its
  four opening games and bails. `searchChampionshipField` recovers the field by
  fingerprinting the bracket's shape against the schedule (pick `teams/2`
  opening games whose winners pair off into real games the next week, down to
  one) and accepting a candidate **only** if its final matches the champion AND
  runner-up on record. 2011 and 2004 are both recovered this way and verified
  game-for-game against MFL's own bracket pages — 2004 without ever seeing its
  championship bracket, because the NIT's 16 teams are the exact complement of
  the championship field.
  **2003 is permanently unrecoverable** — the league played that season on
  Yahoo and only standings were entered into MFL, so no game in any week has a
  score. Don't spend time on it, and don't ask for a screenshot: there is
  nothing behind it.
- **The bracket shape is era-dependent.** 2003-2017 bracket "1" IS the 8-team
  field; 2018+ it is only the 2-team final fed by separate AL/NL brackets.
  Seeding the modern shape with the old assumption produced the wrong 2019
  champion during development. `describePlayoffShape` handles this.
  **This rule is not only about rendering a bracket — it decides who "made the
  playoffs".** `compute-franchise-history.mjs` read participants straight out of
  `brackets['1']` and so reported a two-team playoff field for 2018-2025,
  surfacing as four or five berths a year in a league that has seeded exactly
  EIGHT every season since 2003. It survived eight seasons because the
  fallbacks kept the output plausible: the standings-seeding inference sized
  itself off the same bracket (`teamsInvolved: 2`), and a belt-and-suspenders
  pass added the division winners plus champion and runner-up. Every playoff
  appearance in the repo — division report, `franchise-history`,
  owner tenures, badges — came from that one id.
  `src/utils/playoff-entry-brackets.mjs` now owns the question for both
  leagues: the AFL resolves ENTRY brackets by name and start week
  (championship-side title brackets opening in the first postseason week —
  bracket 1 alone through 2017, AL + NL from 2018), TheLeague answers `['1']`
  directly because a week rule would sweep in its Toilet Bowl Challenge, a full
  7-team tournament starting the same week as the championship.
  `tests/playoff-field-size.test.ts` is the guard, and it is a conservation law
  rather than a policy claim: berths in the season ledger must equal the field
  MFL's own bracket metadata declares, season by season, in both leagues. A
  league that genuinely changes its playoff size stays green.
- **Third place comes from the bracket that DECIDES third place**, resolved by
  name via `getThirdPlaceBracketId`. `getChampionshipResult` hardcoded
  `brackets['2']` — the sibling of the bug above, in the next function down, and
  it survived that fix by a week. For the AFL from 2018 bracket 2 is
  `AL Championship`, a conference semifinal whose winner always goes on to win
  or lose the final, so the caller's champion/runner-up branches claimed the row
  first and **third place was recorded in 0 of the AFL's 23 seasons**. The era
  map: 2004-2017 it is bracket 2, the 6-team `AFL Losers Bracket` /
  `AFL Consolation Bracket`, whose FINAL winner is third; 2018+ it is bracket 4,
  `AFL 3rd Place Game`. 2006 declares two candidates and the earlier-starting
  one decides.
  Recovering it needed the reconstruction as well as the rename: MFL's AFL
  export carries franchise ids only from 2024, and `championship-history.json`
  has no `thirdPlace` key at all. 22 seasons recovered.
  **TheLeague answers `['2']` directly and must never get the AFL's shape rule**
  — its `The Loser's Bracket` starts in week 14, EARLIER than
  `The Consolation Bracket` in week 16, and is the fifth-place bracket (MFL
  renamed the pair `5th Place Bracket` / `3rd Place Bracket` in 2025, which is
  how we know). It resolves in only 3 of 19 seasons because bracket 2 is absent
  from the committed feed for the rest — a data ceiling, not a bug.
  The guard is the invariant whose violation IS the bug: a third-place finisher
  lost before the final, so a value equal to the champion or runner-up is proof
  the wrong bracket was read. `resolveThirdPlace` discards it and
  `tests/playoff-field-size.test.ts` asserts it never happens.
- **Archived schedules contain rounds that aren't valid rounds.** 2012 week 14
  has an outright `0023 vs 0023` bye row; 2014 and 2015 NIT week 14 each carry
  a stray matchup pairing two teams already scheduled that week. `pruneRound`
  drops them — without it, 2012 rendered five quarterfinals, one of them a team
  playing itself.
- **Bracket ids do not mean the same thing across seasons.** The NIT is bracket
  3 in 2005, 4 in 2006, 5 in 2007-2017 and 6 from 2018 on; ids 2/3 are the
  AL/NL brackets only in the modern era (in 2005 they're the AFL Losers Bracket
  and the NIT). Classify with `src/utils/afl-bracket-kind.mjs`, never with an id
  range — the page's old hardcoded `winners = 1-5 / NIT = 6-9` split filed every
  pre-2018 NIT under the Championship tab and left the NIT tab empty.
  `tests/afl-bracket-kind.test.ts` runs the classifier over every committed feed
  and greps the page to stop an id list creeping back in. That grep covers the
  PAGE only, which is how `compute-franchise-history.mjs` kept its hardcoded
  `brackets['1']` for eight seasons after this rule was written — when you fix
  an id-keyed reader, audit every OTHER consumer of the same feed in the same
  pass, because the one you already fixed is the one you will think of.
- **The consolation/placement brackets are solved, not seeded.** Their fields
  are made of losers, so `reconstructConsolation` walks forward consuming the
  games the championship and NIT walks left behind: an open bracket first claims
  any game involving a team it still has alive (this is how late entrants join —
  the AFL Consolation Bracket is 4 quarterfinal losers in week 15 plus the 2
  semifinal losers in week 16), then whatever remains is grouped by how deep its
  teams got in the primary bracket and handed to the brackets starting that
  week, deepest run to the lowest bracket id. That last rule is load-bearing:
  2005 week 17 starts three different 1-game brackets at once and only
  elimination depth tells them apart, and they award different draft picks.
  The correctness proof is that **every scored game in the playoff weeks lands
  in exactly one bracket** — `tests/afl-reconstructed-brackets.test.ts` asserts
  it, so a mis-assignment surfaces as a leftover rather than as a plausible
  wrong bracket.

**Never read a finishing position out of `bracketWinnerTitle`.** The AFL wrote
custom bracket titles for years ("#1 Pick in 2nd Round", "*NIT 3rd Place or 6th
Place"), and MFL renders a custom title as a placement it does not mean — which
is why the league's own results page shows 2005's Da Dangsters in 2nd when they
finished 3rd (they won the AFL Losers Bracket; 2nd is the title-game loser).
Only the games are trustworthy. A guard test greps the reconstruction script for
`bracketWinnerTitle` to keep it out.

Champions are pinned in `tests/afl-reconstructed-brackets.test.ts` against
three independent sources that agree: `championship-history.json`, the awards
ledger, and the commissioner's own confirmation of the 2005-2008 results. A
reconstruction that looks plausible and is wrong is the failure mode here, so
add fixture pins rather than loosening assertions.


## Draft order framing — "predictor" in-season, "official" after playoffs

Both leagues' draft order stops being a prediction the moment its deciding
games finish, and every surface that names or links the order must match
the phase — "Draft Predictor / projected" during the regular season,
"Draft Order / official" once it's locked. The phase is always data-driven
from the parsed playoff brackets (falls back to "projected" if any bracket
result can't be resolved):

- **AFL:** projected (season underway) → official once the NIT wraps (both
  conference champions + all 5 NIT bonus positions; `isDraftOrderFinal` in
  `src/utils/afl-draft-utils.ts`) → drafted once the late-August conference
  drafts are conducted (shared `isDraftConducted`, which handles the AFL's
  two-element `draftUnit` array). `afl-fantasy/draft-predictor.astro`
  switches its title/subtitle/badge on the phase.
- **TheLeague:** three phases, because the rookie draft happens mid-spring:
  projected (season underway) → official (champion + all 3 toilet bowl comp
  slots settled, draft not yet held) → drafted (picks made; back to
  predictor framing for the next cycle at Labor Day). Sources of truth:
  `isLeagueDraftOrderFinal` + `isDraftConducted` in `src/utils/draft-utils.ts`;
  `theleague/draft-predictor.astro` switches on them. In the drafted phase
  the "final" view must render the as-drafted results, never the
  `futureDraftPicks` merge — that snapshot freezes pre-draft and misses
  later pick trades.

Surfaces that only ever render in one phase can hardcode that phase's
framing: the AL/NL draft heroes (`afl-hero-resolver.ts`) and the NFL-draft /
rookie-draft heroes (`league-event-hero-view.ts`) only appear in offseason
windows where the order is official, so they say "View Draft Order", never
"predictor". Static copy (nav, page directory, Roger's prompt/seeds) should
stay phase-neutral or state both phases.


## MFL's board does not preserve who earned a slot

`draftResults.json` is the only place traded picks show up — and that is
exactly why it cannot tell you a franchise's **earned** draft position. MFL
seeds a fresh board straight from the official order, then *reassigns* a slot
to the new owner when the pick is traded. The earned position is overwritten,
not annotated. Proof in the archive: on the 2025 AFL board two franchises hold
two round-1 picks and two hold none, and the only trace of who originally owned
them is a `comments` string (`[Pick traded from Smokane FC.]`) that MFL does
not write until the pick is actually *made*.

So anything showing "your draft slot" needs both sources, and must not
substitute one for the other:

- **Earned/base slot** → `calculateAFLDraftOrder` over the prior season's
  standings. Trade-independent by construction.
- **Picks actually held** → the board's `draftPick[].franchise`.

`src/utils/afl-draft-slot.ts` does exactly this for the homepage spotlight
tile, and `tests/afl-draft-slot.test.ts` pins the property that makes the base
slot trustworthy: on an untraded board, our standings-derived order must
reproduce MFL's seeding pick for pick across all 24 franchises. A drift in the
tiebreaker chain surfaces there as a phantom "you traded this pick" asterisk.

Two smaller traps in the same feed:

- Take the draft year's standings from `draftYear - 1`, not
  `getCurrentSeasonYear()`. They agree all offseason, but after Labor Day
  `getCurrentSeasonYear()` names a season whose standings are still all zeros.
- Completion is **per conference**. The AFL's board is two `draftUnit` entries
  (`CONFERENCE00` / `CONFERENCE01`) that finish a day apart, so a flattened
  "is the draft done" check keeps AL owners in draft mode while the NL picks.

## AFL has no keeper construct — don't build a metric on one

The offseason auction wipes every roster, so MFL stores nothing keeper-shaped
for the AFL; `afl-keepers-storage.ts` is a private per-owner scratchpad in
Redis, not league state. A "keepers protected" count therefore measures whether
someone opened a planning page. The MFL roster feed is no better: preseason it
holds exactly `keepers` players for **all 24 franchises**, so any tile built on
it reads "7 of 7" league-wide. The AFL homepage shipped that tile for months
rendering a bare `—`; it is now the calendar-rotating spotlight in
`src/utils/afl-team-spotlight.ts`.
