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

Redis is the live lock; `data/<league>/schedule-release/<year>.json` is the
committed archive, written FROM the API's response so the two can never
disagree. Generating the archive separately would produce a different schedule
from the one the league was shown. `getRelease` reads Redis first, archive
second — the archive covers eviction, Redis-less environments, and past seasons.

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
