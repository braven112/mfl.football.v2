# Schedule construction and the annual audit

Both leagues state the same scheduling goals, and both have broken them in a
way nothing caught. Read this before touching `scripts/generate-schedule.mjs`,
`src/utils/schedule-plan.mjs`, `src/utils/schedule-rules.mjs`,
`src/utils/schedule-builder.mjs`, or `tests/schedule-optimization.test.ts`.

## The goals

1. Doubleheaders must not land on an NFL bye week.
2. Doubleheaders split as evenly as possible between the start and end.
3. Division games avoid NFL bye weeks whenever possible.

Goal 1 outranks goal 2. Goal 3 is a **maximize**, not a must.

These are **goals, not guarantees**, and the distinction is load-bearing: the
league does not control the NFL's bye calendar, so the same goal is trivial in
one season and unreachable in the next. A goal list with no per-season outcome
reads as a schedule repeatedly breaking its promises, which is backwards.

Three files, and they do different jobs:

| File | Job | Varies by |
|---|---|---|
| `src/utils/schedule-constraints.mjs` | the ranked goal list | season only |
| `src/utils/schedule-goals.mjs` | scoring a season against it | league AND season |
| `src/utils/schedule-builder.mjs` | actually drawing a schedule | nothing — always current |

**The goal list is identical for every league.** Only outcomes differ. An early
version branched goal 2's text on whether the league plays a cross-conference
round, which quietly made the two leagues' scorecards incomparable; format
specifics belong in the verdict, which is per-league by nature.

**A goal may carry `since: <season>`, and that gates DOCUMENTATION only.** A
reveal page is a record of a draw that already happened, so rendering today's
list against it backdates every goal added since — the light-bye-week goal
shipped in Aug 2026 and immediately appeared under the 2026 reveal's heading
"the rules this draw had to satisfy", beside a draw that predates it and does
not satisfy it. The schedule was right; the page was wrong. `scheduleConstraints({season})`
returns what was in force, `upcomingConstraints({season})` returns what came
later so the page can say so. `buildWeekPlan` is NOT season-gated — it draws
schedules and should draw the best one we currently know how to make. Keeping
rule vintages out of the algorithm is the point.

**Verdicts are scored once, at lock time, and stored in the reveal**
(`summary` siblings `goals` / `notYetAdopted`). Re-deriving on read would let a
season's verdict change silently every time a goal is added.

Statuses are `met`, `partial` (as far as the calendar allowed), `blocked` (not
attainable this year), and `optimised` — the last for soft objective terms with
no pass mark. `optimised` is not a cop-out: inventing a threshold for
"doubleheader opponents are balanced in strength" would make the scorecard a
worse document than reporting the spread.

**Adding a goal is one entry plus a `since` year plus a scorer.** Do not
renumber — rank is positional and derived. `tests/schedule-goals.test.ts` fails
if a goal has no scorer, including one whose `since` has not arrived yet, so the
season it first applies to cannot throw at lock time.

### The ranking, and the one decision still open

Set by the commissioner in Aug 2026, in his words:

1-2. **The format.** Note goal 1 is "the same number of games ACROSS THE
SEASON", not one per week — doubleheaders break per-week uniformity by design,
and the staggered last resort below breaks it per franchise.
3. **No doubleheader on a bye week.** The top goal and the enabling one: "if
   it's possible to be true then we do it and other rules fall in place."
4. **Doubleheaders split, and every franchise gets one after Week 8.** The
   after-Week-8 clause is new and is the half with teeth — the back end of the
   season decides seeding.
5. **Division games off bye weeks, to the format's ceiling.**
6. **The forced ones backfill onto the lightest bye weeks.**
7. **Rematch gap** — DEMOTED from a hard rule to a goal below 5 and 6.
   "Division games off byes is more important than this but this is ideal."
8-10. Bye luck, opponent strength, worst-week/finale.
11. **Home/away — cosmetic.** "It has no bearing on games." True: there is no
    home-field advantage in fantasy.

**A trade you might expect here does not exist.** Ranking 5 above 7 sounds like
it should let the planner break the rematch gap to get more division games off
byes. It cannot: the COUNT of bye-week division games is invariant across every
legal draw (all 336 for the AFL in 2026 — see the frontier above), because it
falls out of how many bye-free slots the format leaves. The rematch bound
constrains only goal 6, which bye WEEKS the forced ones land on.

So the open decision is narrow: may the planner widen past `MIN_REMATCH_GAP` to
reach a lighter bye week? For AFL 2026 that would buy 8 NFL teams out → 6, at a
rematch floor of 1 (rivals in Weeks 4 and 5). The ranking says yes; the bound is
still in place pending confirmation, because `scoreSeason` has no rematch term
and would not steer away from the worst case on its own.

### Ranked AND weighted

Rank alone is lexicographic — goal 5 beats goal 6 by any margin, however small
the gain or large the loss. That is right for `format` and `hard` (those carry
`weight: null` and are never traded) and wrong below them, where the trades are
real: giving up a little rematch gap for a much lighter bye week is a good deal
and the reverse is not.

| Goal | Weight |
|---|---|
| division games off byes | 100 |
| lightest bye weeks | 70 |
| rematch gap | 55 |
| bye luck | 45 |
| opponent strength | 20 |
| worst week / finale | 15 |
| home/away (cosmetic) | 5 |

Only ratios matter, which is what lets home/away at 5 behave as intended beside
100. **`scoreSeason` already trades by weight and its terms are the tail of this
list; the week-plan goals above them are still lexicographic inside
`buildWeekPlan`.** A test pins that the annealer's weights stay in the same
ORDER as the goal weights, so the optimiser cannot chase a different priority
order than the page publishes. Making the week plan itself weighted is the
outstanding piece.

### Two goals are not fully implemented

### Starter-aware exposure — BUILT (Aug 2026)

`src/utils/starter-exposure.mjs`. Exposure is counted over each roster's
projected starting nine (league's own `league.starters` limits, ranked by a
composite of the built-in ADP sources with roster salary as the tiebreak for
unranked deep bench), not the whole roster.

**Why it was needed, in one number.** Whole-roster counting saturates in The
League: only 10% of its (team, bye-week) slots have a clean roster, and Weeks
8, 11 and 13 have ZERO clean teams. An optimiser cannot steer by a signal that
says every week is bad. Starter counting takes that to 41%.

**It is a no-op for the AFL, by construction and on purpose.** The AFL reveals
before its draft, so a roster is 7 keepers — fewer than the 9 starter slots — so
every player is a starter and the model returns exactly what the roster count
returned (46% either way). `projectedStarters` returns the whole roster when it
cannot fill the slots, which is why this needs no per-league branch.
`tests/starter-exposure.test.ts` pins that equality; if it ever breaks, the
model has started inventing a lineup.

### The per-game rivalry term — BUILT (Aug 2026)

`scoreSeason` gains `divisionByeCost`: starters missing, summed over both sides,
for DIVISION games only.

This is the term that makes the schedule pick a week for a particular *matchup*
rather than for the league as a whole. `byeDifferential` cannot do it — it only
cares that the two sides are equally hurt, so two rivals both missing three
starters scores *perfectly* on it, and that is precisely the game nobody wants
to play.

Its weight is derived from the published goal weights
(`goalWeight('light-bye-weeks') / goalWeight('bye-luck')` = 70/45) rather than
hand-tuned, so the optimiser cannot rank it differently from what the page says.

Measured on 2026, old system vs new:

| | AFL | The League |
|---|---|---|
| rivalry games with both rosters whole | 94/120 → **99/120** | 42/48 → **44/48** |
| starters missing across rivalry games | 58 → **40** (−31%) | 9 → 9 |
| min rematch gap | 8 → 7 | 9 → 9 |
| season net bye spread | 2 → 4 | 12 → **2** |

The League gains little on the rivalry metric because it had almost nothing to
gain — 42 of its 48 rivalry games were already clean once measured by starters.
The AFL's net-bye-spread regression (2 → 4) is the trade the ranking sanctions:
light-bye-weeks outweighs bye-luck 70 to 45.

**Note both leagues still play their division games in the same weeks.** This
step buys the pairing freedom that already existed — which RIVAL meets which in
which division-round week — and nothing more. Letting different teams play
division games in different weeks needs the edge-colouring rewrite below.

### The 16-season backtest — what it found

`node scripts/backtest-schedule.mjs` replays the planner against every NFL bye
calendar we hold and scores each result against the goals. Calendars are
backfilled from MFL's `nflByeWeeks` export from **2011** (they only went back to
2022 before), and league/rosters/players feeds exist for the same span.

**Do this before touching the objective.** The 2011-2020 calendars are the
OPPOSITE SHAPE to recent ones — byes mostly start in Week 4 and are done by
Week 11-13, where 2021-2026 run Weeks 5/6-14 — and 2017 carries a **Week 1**
bye. Tuning against recent seasons alone proves nothing.

Five real defects, all of which had been sitting in code that passed its tests:

1. **`doubleheaderCount` and `endWindow` were modern constants.** 3 for the AFL,
   4 for The League, `[12, 13, 14]` for both — correct only for a 14-week season
   with today's divisions. Every season from 2011 to 2020 ran THIRTEEN weeks,
   and 2011-12 had six four-team divisions, so the planner threw "week plan does
   not fit" on ten AFL and six League seasons. Both are now DERIVED
   (`roundsRequired`), which is what they always should have been — the count is
   arithmetic: rounds minus weeks.
2. **A format-pinned doubleheader week was not exempt from the bye rule.** The
   AFL's Week 1 must hold the cross-conference round plus a division round; 2017
   put a bye in Week 1, so `chooseDoubleheaderWeeks` skipped it and the planner
   threw rather than scheduling the season. The format outranks the
   no-doubleheader-on-a-bye goal, so the week is now taken via `required` and the
   scorecard reports the goal failed. **A season with a flagged problem beats no
   season.**
3. **Fewer bye-free weeks than required doubleheaders was fatal.** Six League
   seasons need five doubleheaders and have only four bye-free weeks. Now the
   lightest bye weeks are taken as a last resort, same principle as (2).
4. **The scorecard mis-attributed problems.** Scorers read `problems.length` as
   "is anything wrong", so 2017's single Week 1 doubleheader problem also failed
   one-game-per-week and opponent-counts, neither of which it violated.
   `problemGoal()` now routes each problem to its own goal.
5. **Two guard assertions were properties of 2022-2026, not of the scheduler.**
   Both passed for years because every calendar they had seen was bye-free
   through Week 4:
   - "as many division rounds in bye-free weeks as the block can hold" ignored
     that Week 1's cross-conference round CONSUMES one of those clean slots.
   - "rivalry games stay out of the season's worst bye week" cannot hold when
     the worst week falls inside a leg's block and the block has no
     interdivision round to trade for it (2014, Week 4, six teams out).

Results after the fixes — 16 seasons planned, 2 unplannable:

| | AFL | The League |
|---|---|---|
| seasons planned | 14 of 16 | 16 of 16 |
| structural goals (1-2) | all met | all met |
| no doubleheader on a bye | 13 met, **1 failed (2017)** | 10 met, **6 failed** |
| doubleheader split + Wk 8 | 5 met, 8 partial, **1 failed (2021)** | 4 met, 11 partial, **1 failed (2021)** |
| rematch gap | 16 met | 16 met |

2011 and 2012 AFL cannot be planned at all: they ran six four-team divisions,
three per conference, and `nonDivisionRounds` assumes exactly TWO divisions per
conference for its bipartite construction. Documented as a bound rather than
fixed — the league has not had that structure since 2012, and the harness
reports it loudly rather than silently mis-scheduling.

**2021 is the year the escape hatch was needed, and the backtest found it
independently.** Its byes run Weeks 6-14, so Weeks 1-5 are the only clean weeks
in the season and no league-wide doubleheader can be placed after Week 8 without
landing on a bye. Both leagues fail goal 4 that year and the planner correctly
prefers failing it to failing goal 3. That is exactly the season a commissioner
staggers doubleheaders franchise by franchise.

### Still to build: mixed rounds

Every round today is PURE — 13 of 14 AFL weeks are single-type — because
`materialise` builds them from structured pieces (circle-method within a
division, complete-bipartite between). Those constructions can only emit pure
rounds, and `buildWeekPlan` then labels each slot by type.

A perfect matching does not have to be pure. `{n1-n2, n3-n4, s1-s2, s5-s6,
n5-s3, n6-s4}` is a legal round with two North internal games, two South
internal and two cross — some teams play a rival that week, others do not. That
is the whole ask, and it needs:

1. **State becomes an assignment of each required game to a round**, not
   `{teamOrder, legOrder, interSlotOrder}`. This is edge-colouring: colours are
   rounds, a proper colouring is a valid season.
2. **Kempe-chain moves.** Pick two rounds; their union is disjoint even cycles
   (every team has degree 2); swap colours along one cycle. Both stay perfect
   matchings. Seed from today's construction — Δ-regular graphs are not always
   Δ-edge-colourable in general, so starting from a known-good colouring
   matters.
3. **Hard goals move from structure into move filters.** The two-leg block
   currently gives the rematch gap, the stretch run and the finale for free,
   which is why the annealer only carries fairness. A free colouring guarantees
   none of them.
4. **`buildWeekPlan` largely dies** — its job is labelling slots by round type,
   and round types stop existing. `chooseDoubleheaderWeeks` survives.
5. **Most of `tests/schedule-week-plan.test.ts` dies with it.** Replace with
   outcome assertions against the goal scorecard, which is why the scorecard
   was worth building first: it becomes the acceptance gate.

Headroom if built: 46% of the AFL's (team, bye-week) slots have a clean roster
and 41% of The League's, against the ~10 division rounds a season currently has
to work with.

- **Starter-aware bye exposure.** ~~Goal 6's second clause~~ SUPERSEDED — see
  above. Original note kept for the reasoning: Goal 6's second clause — "a bye week is only a
  problem for a game if one of those two teams is actually missing starters" —
  is not built. `byeExposure` counts the WHOLE roster, so a team losing two
  bench players scores the same as one losing two starters.

  **It matters far more in The League than the AFL, and not for the obvious
  reason.** The AFL reveals its schedule BEFORE its draft (release is Labor Day
  − 22, the NL draft is Labor Day − 8), so the only players on an AFL roster at
  that moment are keepers — which are by definition the important ones, making a
  whole-roster count already a fair read on starters. The League reveals June 1,
  after rosters are set and FULL, so its counts are diluted by deep bench players
  who would never start. Build it for The League first.

  The league feed has the starter requirements (`league.starters`: 9, with
  position limits), so the model is buildable; it needs a preseason value source
  to pick the starting nine (ADP from `data/ranking-sources/<year>.json` is the
  obvious candidate). Until then, NFL teams out is the proxy and the verdict
  says so.
- **Staggered doubleheaders.** The last resort under goal 3 is documented, not
  implemented — see below.

### Goal 3 has an escape hatch nothing else has

In a year when no league-wide week works the commissioner has **staggered
doubleheaders franchise by franchise** so each team plays its two games in a week its own
roster is whole. That breaks the round model this whole module is built on and
has to be hand-built, so it is a genuine last resort — and it is still better
than a doubleheader on a bye. Nothing here implements it; it is recorded so
nobody concludes the goal is unachievable when a season has no clean shared
week.

## The trap: bye weeks move, week numbers don't

**The late doubleheader week is not a constant.** It is whichever of Week 12 or
13 is bye-free that year, and that flips.

| Season | Bye-free late week | The League | AFL | |
|---|---|---|---|---|
| 2022 | 12 | 1,2,3,**12** | 1,2,3 | ok |
| 2023 | 12 | 1,2,3,**12** | 1,2,**12** | ok |
| 2024 | 13 | 1,2,3,**13** | 1,2,**13** | ok |
| 2025 | 13 | 1,2,3,**13** | 1,2,**13** | ok |
| 2026 | **12** | 1,2,3,**13** | 1,2,**13** | **both wrong** |

2026 copied 2025's week numbers. Four NFL teams (BAL, IND, LVR, NYJ) were out
in Week 13, and in a doubleheader that penalty is paid twice. Exposure ran 1 to
5 players per roster in The League — a 4-player swing decided by the calendar.

Same failure mode, second instance: the AFL's Week 1 cross-conference pairings
were last recomputed for **2024**. 2025 and 2026 are the same sheet.

`tests/schedule-optimization.test.ts` is the backstop for both. Run
`node scripts/fetch-nfl-bye-weeks.mjs` each spring so it has the new calendar.

## Rounds, not games

A season is a multigraph where every franchise has degree = games played. A
regular multigraph decomposes into perfect matchings, and one perfect matching
is exactly "one game for every franchise" — a **round**. A normal week is one
round; a doubleheader is two.

This is why re-timing works: move whole rounds and every matchup, home/away
side and opponent count survives. Move individual games and you break the
one-game-per-team invariant on the first move.

## Why "maximize bye-free division games" alone is a bad objective

It is the obvious objective and it produces a bad schedule. Measured on The
League 2026:

| | Current | Naive optimizer |
|---|---|---|
| Division pairs meeting ≤3 weeks apart | 0 of 24 | **16 of 24** |
| Minimum rematch gap | 9 weeks | **1 week** |
| Weeks containing a division game | 6 | **4** |

It stacks every rivalry round into Weeks 1–3, because those are bye-free and it
is paid per division game. A rematch seven days later is the same game twice —
same rosters, no new information. The division race is settled by Week 3 and
then ten weeks have no division game at all. Week 1, the highest-variance week
in fantasy, ends up carrying a third of the division race.

**Any new objective term needs a counterweight.** The audit pins the two that
matter: rivals never meet twice inside three weeks, and division games must use
the bye-free slots actually available (`divisionGameCeiling`).

## The AFL format pins the round set exactly

```
10 division rounds    double round-robin inside each 6-team division
 6 interdivision      6x6 against the other division in your conference
 1 cross-conference   Week 1
── 17 rounds, and 14 weeks + 3 doubleheaders = 17 slots
```

Zero slack, so the week plan is forced (`AFL_WEEK_PLAN`), and it satisfies
everything at once: each division pair meets once early and once late with a
minimum 6-week gap; the last five weeks are a rivalry stretch run ending
all-division; division games take all 7 bye-free slots a franchise has. Week 11
— six NFL teams out, the heaviest of 2026 — deliberately gets an interdivision
round.

Because the structure guarantees the drama goals, the annealer optimizes **only
fairness**: bye differential, season-long net bye, doubleheader and late-season
opponent strength. Paying for drama again in the objective would only let the
search trade away fairness for something it already has.

**Home/away is a post-pass, not an annealed term.** The constructions are
systematically lopsided — `bipartiteRounds` puts one whole division on the road
for all six interdivision games — but which side is "home" constrains nothing
else, so `balanceHomeAway` fixes it exactly and cheaply at the end.

## Division-game ceiling — say it, or the number reads as failure

The AFL cannot put every division game in a bye-free week and no scheduler can
fix that. A franchise has 8 game slots across the bye-free weeks, one goes to
the cross-conference game, and it plays 10 division games. So **at least 36 of
120 division games are forced onto bye weeks by the format.** Always report
against `divisionGameCeiling`, never against zero.

The League has no such squeeze (ceiling 48 of 48) but deliberately spends one
round on a pure-division final week — the rivalry finish — which costs 8. Weeks
13 and 14 both carry byes in 2026, so "no division game on a bye" and "the
season ends on division games" cannot both hold. The league chose the finish.

**Say the count, not only the complement.** "84 of 84 possible" and "36 of 120
division games are on a bye" are the same schedule, and only the second one
answers the question owners actually ask. Reporting the bye-FREE count alone
reads as a clean sweep and invited exactly the wrong claim — that the AFL puts
no division game on a bye week. `divisionByeSplit`
(`src/utils/schedule-constraints.mjs`) computes both halves and, crucially,
splits the bye-week games into FORCED (the format left nowhere else) and
CHOSEN (a preference was spent). Those two are opposites and the same number
hides them: the AFL's 36 are all forced, The League's 8 are all chosen.

### The 36 do not move — only their severity does

Measured exhaustively over all 336 legal placements of the AFL's second
division leg in 2026 (the first leg and the cross-conference round fill Weeks
1-4 with no freedom left):

| leg-2 weeks | div games on byes | NFL teams out | best min gap | gap floor | last 5 wks w/ division |
|---|---|---|---|---|---|
| 5, 9, 12, 12, 14 | 36 (30%) | 6 | 4 | **1** | 2/5 |
| 9, 10, 12, 12, 14 | 36 (30%) | 8 | 8 | 5 | 3/5 |
| 9, 12, 12, 13, 14 | 36 (30%) | 8 | 8 | 5 | 3/5 |
| **10, 12, 12, 13, 14** | **36 (30%)** | **10** | **9** | **6** | **4/5** ← shipped |
| 11, 12, 12, 13, 14 | 36 (30%) | 12 | 10 | 7 | 4/5 |

Every row is 36. The count is invariant because only two bye-free slots survive
Week 4 (Week 12's doubleheader) and the second leg is five rounds — so three
land on byes no matter what. **Do not "optimise" the count; it is already the
floor.** What the placement buys is severity and rematch gap, and they trade
off monotonically: each 2 fewer NFL teams out during a division round costs
roughly a week of minimum rematch gap.

The cheap end of that trade is real — Week 9 for Week 10 saves 2 team-byes for
1 week of gap — and it was not taken, because it also drops the stretch run
from 4 of the last 5 weeks to 3. The expensive end is a trap: routing the leg
through Weeks 5 and 9 saves 4 team-byes but puts the gap FLOOR at 1, and
`validateSeason` does not check the rematch rule — only
`tests/schedule-optimization.test.ts` does, and the annealer has no gap term to
steer with. A draw that seats rivals in Weeks 4 and 5 would be generated,
scored as good, and caught only if someone ran the suite.

2026 realised a minimum gap of 8 (histogram 8×15, 9×21, 11×9, 12×15) against a
best-achievable 9 — the annealer optimises fairness, not gap, so it lands
inside the structural window rather than at its edge.

### The light-bye-week rule, and why the block had to be widened for it

Since Aug 2026 the forced rounds take the LIGHTEST bye weeks the rematch rule
lets them reach (`LIGHT_BYE_WEEK_MAX = 2` — the NFL never schedules a bye week
with fewer than two teams out, so two is the floor, not a preference).

The rule was unimplementable against the old late block and that is the part
worth remembering. `lateWeeks` was the SHORTEST SUFFIX holding the second leg,
grown by one week. In 2026 that spanned Weeks 10-14, so Week 9 — two teams out
— sat one week past the edge and was never a candidate. Nothing failed: "within
a block, division rounds take the cleanest weeks" was perfectly true, because
the block was too narrow to contain the better answer. **A locality property
cannot detect a bad locality.** The fix is to widen the window to every week
the guarantee allows and let `rankSlots` sort it; `tests/schedule-week-plan.test.ts`
now asserts against the weeks the gap rule ALLOWS, not the weeks the block
happens to span.

The widening is bounded by `MIN_REMATCH_GAP = 4` and by nothing else, in both
directions:

- **Too narrow** and light weeks stay unreachable — the bug above.
- **One week too wide** and a pair can be drawn into Weeks 4 and 5. A pair's
  gap is (leg-2 week − leg-1 week) and the worst case pairs the LAST first-leg
  week with the FIRST second-leg week, so the window start is exactly
  `end of early block + 4`. `scoreSeason` has no rematch term to steer with, so
  such a draw would be generated, scored as good, and caught only by the season
  audit.

Widening is free where it gains nothing: `rankSlots` breaks bye-count ties
toward the LATER week, so an equal-bye earlier week never displaces a later
one and the stretch run is only given up when a lighter week is bought with it.

What it actually bought, replayed over every season we hold a bye calendar for
(AFL; "teams out" = NFL teams on bye summed across the division rounds):

| Season | Teams out before → after | Bye-free rounds before → after | Light-week hit rate |
|---|---|---|---|
| 2022 | 10 → 10 | 7 → 7 | 1 of 3 |
| 2023 | 10 → **6** | 7 → **8** (ceiling) | 1 of 2 |
| 2024 | 14 → **6** | 7 → **8** (ceiling) | 1 of 2 |
| 2025 | 10 → 10 | 7 → 7 | 1 of 3 |
| 2026 | 10 → **8** | 7 → 7 | **2 of 3** |

Three of five seasons improve and 2024 more than halves. **The second column is
the surprise and it is not what the rule was for.** Widening the window also
reached the bye-free Week 8 that 2023 and 2024 have in mid-season, which the
shortest-suffix block could never touch — an older comment in
`tests/schedule-week-plan.test.ts` called that clean week permanently
unreachable and treated it as a fact about the format. It was a fact about the
block. Both seasons now hit the division-game ceiling outright.

2022 and 2025 do not move, correctly: neither has a lighter reachable week than
the ones already taken. The hit rate is REPORTED, never asserted — some seasons
have fewer light weeks than the format has forced rounds, and failing a build on
the NFL's bye calendar would be absurd. The asserted property is the optimality
one: no division round sits on a bye week heavier than one its block could
legally have used instead.

2026 is not re-drawn. Its schedule is locked, pasted into MFL and being played;
the rule applies from the next generation.

## Both leagues build constructively

The League ran `simple` while the two were compared, then adopted
`constructive` on the numbers. Simple moves the doubleheader and nothing else,
which fixes the rule violation but cannot reach the two measures that matter
most — and on The League's 2026 season it made one franchise's bye luck
actively worse (Mariachi Ninjas −4 → −8) because shuffling two weeks has no
way to compensate.

| The League 2026 | was live | simple | constructive |
|---|---|---|---|
| doubleheaders | 1,2,3,**13** | 1,2,3,12 | 1,2,3,12 |
| division games bye-free (of 48) | 32 | 40 | 40 |
| **season net bye spread** | **17** | 14 | **4** |
| mean \|bye diff\| per game | 1.07 | 0.95 | 0.73 |
| min rematch gap | 9 | 8 | 9 |
| **home games min–max** | 7–11 | 7–11 | **9–9** |
| doubleheader opponent balance (sd) | 3.14 | 3.43 | 2.26 |
| late-season SOS balance (sd) | 2.35 | 2.35 | 1.52 |
| weeks changed | — | 2 | 14 |

**Home/away is the one re-timing can never fix.** It moves whole rounds between
weeks and never changes which side is home, so a 7-to-11 spread survives every
simple repair. `balanceHomeAway` only exists on the constructive path.

`mode: 'simple'` stays reachable per call — `--mode=simple`, or the page's
Method selector — for a minimal in-season repair where re-drawing everyone's
calendar is not acceptable.

## MFL has no schedule write API

The full import list (`api_info?STATE=details`) is lineup, franchises,
calendarEvent, fcfsWaiver, waiverRequest, blindBidWaiverRequest, ir,
taxi_squad, tradeBait, tradeProposal, tradeResponse, draftResults, myDraftList,
pollVote, keepers, myWatchList, accounting, salaries, playerScoreAdjustment,
franchiseScoreAdjustment, survivorPoolPick. **No schedule or matchup type**;
`TYPE=schedule` is export-only and owner-gated.

Schedules are applied by hand: Commissioner → Setup → Schedule → the advanced
editor, which takes `WW,AAAA,HHHH` lines and **overwrites the entire fantasy
schedule**. The planner emits exactly that, every game, no diff.

### Where it runs

| | |
|---|---|
| Admin page | `/theleague/admin/schedule-builder`, `/afl-fantasy/admin/schedule-builder` |
| API | `src/pages/api/schedule-plan.ts` |
| CLI | `node scripts/generate-schedule.mjs --league=<slug>` |
| Planner (shared by all three) | `src/utils/schedule-plan.mjs` |

Feed access is **injected** into the planner (`readFeed`) rather than done
inside it, so the page and the CLI cannot drift into different answers. The
planner is pure: same feeds in, same schedule out, no clock and no filesystem.

The page reads committed feeds at request time. That works because
`scripts/lib/archived-feed-files.mjs` keeps the newest three seasons per league
inside the serverless function; `data/nfl/bye-weeks.json` is named in
`includeFiles` because the tracer cannot follow a `process.cwd()` join.

The API route repeats the page's auth gate. A page gate protects the page, not
the endpoint behind it — and both are scoped with `isAuthorizedForLeague`, so a
commissioner of one league cannot plan the other's schedule.

**Verify before pasting — there is no undo:**

```bash
node scripts/generate-schedule.mjs --league=afl-fantasy
node scripts/generate-schedule.mjs --league=theleague
SCHEDULE_AUDIT_ROOT=$(node scripts/stage-schedule-plan.mjs --print-root) \
  pnpm vitest run tests/schedule-optimization.test.ts
```

The CLI exits non-zero if `validateSeason` finds a problem, and the page
disables its copy button in the same case. Neither will hand over a schedule
that breaks a structural rule. It runs the *same* audit that guards the live
schedule against the candidate, rather than a second implementation that could
agree with the planner for the wrong reason.


## AFL cross-conference pairing

Each franchise plays the team that finished in the **same slot of its own
division** — division position, not conference position — in the paired
opposite-conference division. Reproduces **12 of 12** for 2022, 2023 and 2024.

The division pairing alternates: `North/East + South/West` one year,
`North/West + South/East` the next. Anchored on 2024 = North/East + South/West.

**Protected rivalry: Computer Jocks vs Jewpacabra.** Scheduled off-formula in
six straight seasons (2015–2020), lapsed 2021–2026, reinstated for 2026. It
outranks the positional formula. Locking a pair can orphan a franchise in each
conference — in an alternating year the pair may straddle two different
division pairings — so `buildCrossConferencePairs` matches leftovers across
conferences in finish order. It is the only pair ever protected across multiple
seasons; no other recurs off-formula more than twice.

## Bye exposure is computed from current rosters

Which in August is keepers only for the AFL. That is deliberate — it fixes the
part of bye exposure the schedule controls, and owners manage the rest of their
roster themselves. Rosters churn all season, so a post-draft re-run would give
a different, not obviously better, answer.


## Schedule Release Day

The annual reveal. `src/utils/schedule-release.mjs` owns the dates and the
marquee picks; `src/utils/schedule-release-store.ts` owns the lock.

| | Reveal | 2026 |
|---|---|---|
| The League | June 1 | Mon Jun 1 |
| AFL | the Sunday two weeks before its NL draft (Labor Day − 22 days) | Sun Aug 16 |

The AFL's date is derived twice over — Labor Day, then the NL draft eight days
before it, then two weeks before that. There was no shared Labor Day / AFL-draft
helper in code before this, only prose in the constitution.

**Neither date fires without the NFL bye calendar.** `releaseIsReady` checks the
data, not just the clock. Both reveals sit weeks after a normal mid-May NFL
release (May 11–15 across 2023–2026), but that release moved from April to May
once already, and a reveal without bye data would build a schedule against
nothing.

### Why the reveal is LOCKED

The optimiser is simulated annealing: generating twice gives two different
valid schedules. Without a lock, sixteen owners would see sixteen seasons and
the commissioner would paste one of them. `set(..., { nx: true })` — atomic
create-if-absent — is the whole mechanism. Two racing crons or a retry cannot
overwrite a reveal that already happened.

`data/<league>/schedule-release/<year>.json` is the lock — the committed file
itself, not a cache entry. `scripts/lock-schedule-release.mjs` refuses to write
one that already exists, so a retry or a second cron cannot overwrite a reveal
that already happened. It used to be a Redis `SET NX` behind a token-guarded
endpoint; that bought nothing and cost two things — this repo is PUBLIC, so the
shared secret became something to provision and rotate for an event that fires
once a year, and two stores meant two answers, with the page (Redis-first) and
Schefter (archive-only) able to disagree about what the schedule was. A commit
cannot be evicted, is reviewable in a diff, and there is exactly one of it.

### The plan on disk is not necessarily the season being played

Annealing again draws a DIFFERENT valid schedule. So the committed plan and the
schedule the commissioner actually pasted can be two complete strangers —
same rounds, same cross-conference pairs, not one week in common. It happened to
the AFL in 2026: the plan came from the CLI run in the PR, the paste came from a
later draw, and all fourteen weeks differed.

That is not cosmetic. `pasteHasLanded` compares the live schedule against the
reveal week for week, so a reveal locked from the wrong draw shows owners a
season nobody will play AND gates Schedule Release Day's column forever — it
waits for a match that can never arrive.

**Once a paste has landed, the reveal must be canonised from the live feed:**

```bash
node scripts/lock-schedule-release.mjs --league=<slug> --from-live            # no reveal yet
node scripts/lock-schedule-release.mjs --league=<slug> --from-live --relock   # replacing a wrong one
```

**`--relock` is not optional in the repair case.** The archive is the lock, so
an existing one normally ends the run before the mode is even consulted — and a
reveal built from the wrong draw is by definition a state where the archive
already exists. Without `--relock` the repair prints `[skip] already revealed`
and exits 0, which reads as success while the column stays deadlocked. It works
only alongside `--from-live`, on purpose: overwriting the lock with a fresh
*plan* would draw a new season, which is the exact thing the lock exists to
prevent. Adopting the season MFL is already running is not a redraw.

`--from-live` reads `mfl-feeds/<year>/schedule.json`, runs it through the same
`validateSeason` audit a generated plan gets (it refuses to lock a broken
season), and recomputes the summary and the marquee four from what is actually
there. It additionally requires **every** week 1..`lastRegularSeasonWeek` to be
present, which the plan path never had to check: `regularSeasonGames` drops an
empty week and `validateSeason` only walks the weeks it is handed, so a
half-applied paste passes every check it has — each franchise still loses the
same game, and a missing week with no division game in it is invisible to the
rivals test too. A 13-week AFL season audits clean and would lock as truth. On a league whose plan and paste agree it reproduces the plan-sourced
record byte for byte — weeks, MFL text, marquee, summary — which is what makes
it safe to reach for when you are not sure.

It is deliberately NOT the default, and the cron must never guess. Before the
paste, the live feed carries MFL's own schedule for the season, and nothing in
the data distinguishes "the commissioner pasted a different valid draw" from
"the commissioner has not pasted yet". Auto-preferring live would lock MFL's
default schedule as the reveal on every normal release day. The reveal record
carries `source: 'plan' | 'live'` so which one produced it is readable later.

### The chain

```
NFL releases its schedule (mid-May, date unknown)
  → daily cron refreshes data/nfl/bye-weeks.json
Release day, 9am PT — .github/workflows/schedule-release.yml
  → POSTs /api/schedule-release, which generates, validates and LOCKS
  → archives the response into the repo
Owners open /<league>/schedule-release
  → countdown before, then the same four marquee games for everyone
Commissioner pastes into MFL (no schedule write API — see above)
  → the feed cron picks the new schedule up
Daily 11am PT — the schedule-release article type
  → fires ONLY when the live schedule matches the locked reveal
```

**Schefter waits for the paste, not the clock.** Announcing a schedule nobody
can open yet, or analysing one that turned out not to be what got pasted, is
worse than announcing late. It also means each league announces on its own
schedule with no second date to maintain.

### The countdown decides nothing

It ticks in the browser, but once it hits zero the page asks the server every
15s rather than flipping itself. The reveal exists when the lock exists, not
when a laptop's clock says so.

### MFL calendar events cannot be named

`import?TYPE=calendarEvent` takes `L`, `EVENT_TYPE`, `START_TIME`, `END_TIME`,
`HAPPENS` — and no title or description. A CUSTOM event lands as an unlabeled
dated marker. `scripts/mfl-calendar-event.mjs` exists and works, but is
deliberately NOT wired into the cron: run it by hand once, look at what MFL
renders, and decide whether an unnamed marker is worth having.
