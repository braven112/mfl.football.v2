# Live Scoring Broadcast — the second-TV board

## Context

`/theleague/broadcast` + `/afl-fantasy/broadcast` (Sep 2026). A zero-input
display for a second television while the NFL games are on the first one. It
answers one question all afternoon — **is something happening to one of my
teams, in any league** — from ten feet, without being touched.

Neither page's variant: `/live-scoring` is one league's interactive board built
for a laptop, `/draft/broadcast` follows a draft. This follows a Sunday, across
every league the owner is in at once. It shares the DATA layer with live
scoring and the CHROME vocabulary with the draft board, and nothing else.

See `docs/plans/live-scoring-broadcast.md` for the decisions table and the
design spec.

## Key files

| File | Role |
|------|------|
| `src/utils/broadcast-moments.ts` | Pure: what earns a reveal, whose it is, staleness, the queue |
| `src/utils/broadcast-live-source.ts` | Per-league snapshot, matchup discovery, scoring, projections |
| `src/utils/broadcast-board.ts` | The ONE assembler — page and API route both call it |
| `src/utils/broadcast-layout.ts` | Pure: density tiers, the drop ladder, strip paging, the cell clock |
| `src/components/shared/live-broadcast/LiveBroadcast.tsx` | The island: poll, stage, rotation, drift |

## Read this, then grep

- **A projection belongs to a player IN A LEAGUE, not to a player.** The same
  back is worth different points under two rule sets, so a player-keyed map
  shared across a cross-league board cannot hold projections at all. They ride
  separately (`scoreLeague`'s `projections`), per league. The first cut
  hardcoded `projected: 0` in a shared `playerMeta`, which made every
  `projectedFinal` equal the live score and pinned every win-probability bar to
  a hard 100%/0% — `winProbability` takes a `remainingPoints <= 0` branch — at
  noon on a Sunday with the whole slate to play.
- **`toBroadcastPair` cannot make a colour visible.** It only ever DARKENS, so
  it makes a colour safe to write white text on and returns an already-dark one
  untouched. Seven of TheLeague's sixteen franchises are `#181818`, which is
  1.14:1 against this board's `#05070b` ground — so the takeover's whole
  mine-vs-theirs signal, a full-screen field of the club's colour, was a black
  rectangle. `ensureFieldOn` (`team-color-contrast.ts`) lifts a field until it
  separates from the GROUND while keeping white ink legible; there is a wide
  band between those two constraints. A mark on the header PANEL is a third
  question again — different surface, different answer (`ensureContrastOn`).
- **Doubleheaders come from the FEED, never the calendar.** MFL simply puts the
  franchise in two pairings. Verified live: 2026 week 1 in TheLeague has 16
  pairings for 16 franchises, every one playing twice against two distinct
  opponents. The calendar derivation is the thing this repo has got wrong twice.
- **ESPN's `statYardage` is big on plays that are not highlights.** In one real
  game the 40+ yard plays included a 58-yard MISSED field goal, a 48-yard miss
  and four kickoff returns. The big-play classifier takes a play-TYPE allowlist
  first and the distance second, or the board shouts "Missed 58 Yd FG Wide
  Left" at a room. `priority` is on every play and is `false` on all 193 — it is
  not ESPN's notability flag.
- **`parseScoringPlays` returns SCORING plays only.** A 57-yard catch that does
  not score, and every turnover, are invisible to it. `parseNotablePlays` reads
  the same already-fetched payload a second way rather than costing a second
  fetch.
- **`wallclock` is the only honest basis for staleness.** The game clock STOPS,
  so "Q1 11:49" is equally true five seconds and three hours after a play. A
  moment we cannot date is treated as STALE, never fresh: showing an undateable
  play full-screen risks revealing a first-quarter touchdown at 4pm, while
  dropping it costs one reveal of something the scoreboard already shows.
- **`occludes` is the layer model, and the draft board's is wrong here.** That
  board hides its idle layer whenever any stage exists. The lower third must
  COEXIST with the scoreboard — an opponent's score is not worth taking the
  board away for — so each stage declares `'none' | 'strip' | 'all'`. The
  red-zone banner sits ABOVE the stage layer: it is a persistent STATE, and as
  a stage it would be preempted by the next reveal and the drive would vanish
  for the fourteen seconds it most needs to be visible.
- **A transition never runs on mount.** The strip carried a correct-looking
  `transition: opacity` and hard-cut every twelve seconds, because only one page
  was ever mounted. The incoming page needs `@keyframes`; the outgoing one
  transitions. Both have to be mounted for a cross-fade to have something to
  fade from.
- **React treats `inert=""` as FALSE** and warns. The empty-string spelling
  silently never applied, leaving occluded layers in the a11y tree for the whole
  930ms `visibility` delay. `inert={hidden}`.
- **A page with no layout has no font.** Rendering the shared component bare
  dropped the board to the UA serif — which has no `tabular-nums`, so every
  score would jitter its column width on each tick — with no `lang`, no
  `<title>` and no viewport meta. The stylesheet's own comment claimed it
  "renders inside the league layout"; it did not.
- **The dim schedule has to sit INSIDE the contrast budget.** This surface
  spends most of its life at `--lbc-dim: 0.86` or `0.72`, so a token measured
  only at 1.0 is measured in a state the board is rarely in.
- **Burn-in drift must be a `transform` on the ROOT**, or it re-lays out the
  whole board every 90 seconds for eight hours. The counter-drift on the
  brightest glyphs has to be a RING sized to more than one stroke width — the
  first cut was a two-position square wave of ±0.15vh, about 3px against ~20px
  strokes, so the pixels it existed to protect never left their own stroke
  cores. Sub-perceptual and sub-protective is the wrong side of that trade.

## Two hazards that are not about this feature

- **`pnpm build` dirties 18 cron-owned data files in a sandbox.** Prebuild
  regenerates `nfl-dark-logos-manifest.json`, `college-dark-logos-manifest.json`
  and the derived `data/**` payloads, and the sandbox cannot reach the logo
  CDNs — so it writes manifests with entries MISSING. A `git add -A` after a
  build swept those into a commit here and broke two logo suites
  (`draft-broadcast-preflight`, `storybook-dark-logo-mirror`) in a way that
  looked like a code regression. Check `git status -- data/ src/data/` after any
  build, and take main's copy.
- **A scan-style guard must strip comments first.** Five of the first shell
  guards failed on the prose DOCUMENTING each trap — the CSS explaining why it
  carries no `html.dark`, the page explaining why it does not call
  `Astro.redirect()`. A guard that fails loudest on the file that documents
  itself best is worse than no guard.

## Sep 2026 — what the first cut got wrong about who scored

Three findings from the follow-up pass, all of the same shape: the board drew
the right thing for the wrong person, and every one of them looked plausible on
screen.

- **A team defense is a CLUB, not a person, so it has no ESPN athlete id and
  can never appear in `play.playerIds`.** Every defensive touchdown, takeaway
  and safety therefore produced no reveal at all — two of the four triggers
  this board was specified to have, silently doing nothing, with nothing in the
  logs and nothing missing from the screen to notice. Not a corner case: 32
  team defenses are rostered in TheLeague and 28 in the AFL (`position: 'Def'`,
  normalized to `'DEF'` by `player-map.ts`). A `Def` row must be joined by NFL
  TEAM, never by athlete.

  The join is `isTurnover`, and it is better than it looks: ESPN sets it
  exactly when `start.team !== end.team`, and on every such play attributes the
  play to the team that ENDED with the ball — the defense. So `play.nflTeam` is
  already the scoring club, and one flag covers takeaways AND defensive
  touchdowns, since a pick six is still a turnover. A "Fumble Recovery (Own)"
  correctly arrives as `false`. Read backwards, this credits the defense that
  just gave the ball away, which is why `tests/fixtures/espn-game-plays-turnovers.json`
  pins the direction across eleven real turnovers — a mutation of it fails five
  tests. MFL and ESPN disagree on team codes (`NEP` vs `NE`), so both sides go
  through `normalizeTeamCode`.

  **Still open:** a safety is not a turnover, and no recorded play carries one,
  so which team ESPN attributes it to is unverified. Guessing credits the wrong
  defense and looks fine, so it is deliberately not implemented.

- **ESPN's `participants` lists everyone INVOLVED, not everyone credited**, and
  the trap is `kicker`. Three real rows:

  | Play | Roles |
  |---|---|
  | Field Goal Good | `kicker, scorer, snapper, holder` |
  | Rushing Touchdown | `rusher, scorer, kicker, patScorer` |
  | Kickoff | `kicker, returner, tackler, penalized, other` |

  On the field goal the kicker IS the scorer (same athlete, deduped, so the
  allowlist can drop `kicker` for free); on the kickoff he is the OTHER team's
  placekicker, credited on a return he was trying to prevent. Participants
  carry no team of their own — only `athlete`, `order`, `type` — so a role
  allowlist is the only mechanism available.

  Turnovers need a SECOND, narrower list: an interception lists `passer` and a
  fumble return lists `receiver`, so the ordinary allowlist hands a full-screen
  TOUCHDOWN to the quarterback who threw the pick and to the receiver who
  fumbled — each named, at 68vh, for the worst play of their afternoon.
  `patScorer` is excluded on purpose: the extra point is real scoring, but a
  TOUCHDOWN takeover naming your kicker for someone else's touchdown is the
  wrong framing for one point.

- **Two crest fields assigned the same value is invisible at the call site.**
  `icon` and `iconSmall` were both `brand.icon`, so the takeover's 68vh
  background crest — ~734px on a 1080p TV — was the ~100px rail asset upscaled
  7.3x. `resolveBroadcastCrest` already encoded the split (resolution-first for
  the big surface, theme-first for the small ones) for the draft board; the
  live board simply never called it. All 40 franchises resolve to 400x400
  GroupMe art now, making it a 1.8x upscale.

  Two things this surfaced. The manifest keys the AFL as `afl` while the route
  directory is `afl-fantasy`, and passing the slug straight through finds no
  measured stroke AT ALL — silently, with no AFL crest measured today to notice
  it — so `crestLeagueKey` moved out of `hero-crest.ts` into
  `dark-surface-crest.ts`, which owns the contract. And a guard for this has to
  be BEHAVIOURAL: the regression was two fields holding the same string, which
  no amount of reading the call site reveals.

## Sep 2026 — the TV that has no keyboard (#1069)

The board's controls had been reasoned about entirely as a placement problem —
"not on the screen" — and four rounds of that produced a screen whose only
controls were `F`, `M` and `L`. Then the actual hardware turned out to be an
Xbox browser, where those keys are not a fallback. They are nothing.

- **"No chrome on the board" was the right rule stated one level too
  literally.** The failure it was built from is not *a control on the board*,
  it is *a visible default plus a condition meant to hide it* — and every
  condition turned out to be an assumption about set-top hardware (a
  coarse-pointer TV never receiving the `@media (hover: hover)` rule, a
  fine-pointer TV holding `:hover` true all afternoon because the cursor is
  parked, an idle timer waiting on an interaction a remote never sends). The
  overflow row's toggle is on the board and is not a fourth attempt, because it
  is unconditional: always rendered when it has something to toggle, in normal
  flow, its 4.6vh subtracted from the panel grid rather than painted over it.
  Nothing about it can be wrong on hardware it was not tested on, because
  nothing about it is conditional. Guarded in `broadcast-shell-guards` by
  asserting the ABSENCE of `opacity: 0`, `visibility`, `:hover` and any idle
  class in its rules — the shape, not the pixel.

- **An author `display` beats the UA's `[hidden]`, and this repo has no global
  reset.** The fullscreen button ships `hidden` and reveals itself once it has
  found an API to call, which is the whole mechanism keeping a dead control off
  a browser without the Fullscreen API — and `display: inline-flex` on its
  class silently defeated it. Every stylesheet here that hides something
  declares its own `[hidden]` rule; this one now does too. No runtime symptom
  on a browser that DOES support fullscreen, so only a scan catches it.

- **A vendor prefix has three parts and they are one decision.** Advertising
  `msRequestFullscreen` while reading only `fullscreenElement` /
  `webkitFullscreenElement` and listening only for the lowercase events is
  worse than not supporting `ms` at all: the button reveals itself, enters
  fullscreen, then can neither report it nor leave it. `MSFullscreenChange` is
  genuinely capitalised differently from the other two. That engine is Xbox's
  older EdgeHTML — the hardware the button exists for.

- **Moving a grid moves every rule that targets it.** The header became a flex
  column with the grid on `.lbc__panels` (the overflow row could not be a ninth
  grid child: the rows are explicit precisely so a panel cannot grow past the
  fixed height and paint over the strip). The `max-width: 900px` block kept
  setting `grid-template-columns` on `.lbc__header` — now a flex container, so
  the declarations are inert with no warning anywhere. The symptom is not a
  selector that looks broken; it is a phone keeping the desktop's 2/3/4 columns
  inside a 55%-height header.

- **Two different caps, answering two different questions.**
  `MAX_FEATURED_CELLS` (4) is what a viewer can READ from ten feet;
  `MAX_GRID_PANELS` (8) is what the stylesheet can PLACE. Lifting the first for
  the expanded view while forgetting the second put the ninth panel in an
  implicit row inside an `overflow: hidden` box, where it is not drawn — so
  "Show all leagues" showed eight of nine. Both hold in both states now, and
  the label reads "Show more leagues" rather than promising an "all" the layout
  cannot keep.

- **The board is dark in both themes; the toolbar above it is not the board.**
  This stylesheet consumes no colour token deliberately — franchise colours are
  the board's background and every token either inverts under `html.dark` or is
  floored against a surface the board does not have. The controls strip
  inherited that reasoning by proximity and shipped a hardcoded near-black slab
  sitting under a light-mode site nav, reading as a piece of the board that had
  escaped onto the page. It is an ordinary page element and takes page tokens;
  the no-token guard is scoped around exactly those rules rather than dropped.

- **A toolbar is not a settings screen.** It had grown a heading, a sentence of
  prose, a chip per league (six or eight deep for anyone in other people's
  leagues) and a paragraph of keyboard shortcuts — above the one page whose
  entire job is the scores. Three buttons now: Leagues, Sound, Full screen.
  Leagues is a link to `?picker=1`, which is the screen for choosing leagues
  and still carries every chip, the sound toggle and the shortcut keys.

- **Carry the week through every hop, including the ones that are not the
  board.** `broadcastHref`'s contract is that an explicit `?week=` survives a
  trip through the chips, and the picker is ON that trip: `doneHref` reads
  `parsedWeek` off the PICKER's own URL, so a Leagues link that dropped the
  week sent an owner watching week 3 back to the current week the moment he
  pressed Done.

## Sep 2026 — the board reset a live 87.0 to zero, every few polls

Reported from the couch mid-slate: the scores "keep going back to zero and
then slowly get set again". Four photographs of the same television minutes
apart showed TheLeague populated with the AFL at 0.0, then both populated,
then both at 0.0, then the AFL populated with TheLeague at 0.0. Nothing was
alternating — each league was independently blanking and recovering.

- **The retention rule existed, at the wrong granularity.** `/api/broadcast-live`
  answers `ok: false` only when the ASSEMBLER fails, and the island already
  threw on that and kept its last good payload. But an assembly in which one
  league's MFL read failed is a SUCCESSFUL assembly — `assembleBroadcastBoard`
  says so on purpose ("one dead feed is not an outage") and contributes
  `{ ok: false, live: false, teams: {}, winProbability: [] }` for that league.
  `body.ok === false` is true at the top, so the guard passes and
  `setPoll(body)` shipped the empty league straight to the screen.
- **No client code reads a league's own `ok`, so the failure had no pixels of
  its own — it had everyone else's.** An absent `teams[franchiseId]` is not a
  visible gap: `BroadcastScoreHeader` renders `mine?.yetToPlay ?? 0` and scores
  through a `0.0` formatter, and `buildStripPages` takes `scores[leagueId] ?? {}`.
  The board therefore drew a complete, confident, well-typed "0.0 / Proj 0.0 /
  0 to play" with an empty player strip — the exact rendering of a game nobody
  has played, over one in the second quarter. The two facts this feature
  separates everywhere else, "the feed says nothing" and "we could not reach
  the feed", were merged by a `??` in a presentational component.
- **The fix is `carryLeagueScores` (`broadcast-carry.ts`), per LEAGUE.** Same
  rule as the whole-response one, applied at the granularity the payload
  actually fails at. Two things in it are load-bearing:
  - **Carry on `ok: false` ONLY.** `ok: true` with empty `teams` is the healthy
    shape of a bye or an unplayed week, and carrying over it would print last
    week's score on a game nobody played — the same merge in the other
    direction.
  - **A carry ages out on the last good READ, not on the last poll that failed
    to replace it.** Refreshing the timestamp on each failure carries a league
    forever on the strength of its own outage. Bounded by the island's own
    `STALE_MS`, so the board gives up on a league at the same age it stops
    claiming to be current.
- **Suspected upstream cause, not fixed here.** Each poll costs 2 MFL reads per
  registered league — `liveScoring` and `playoffBrackets`, the latter useless
  in week 2 — so a two-league board is 4 MFL reads every 8 seconds, ~30/min
  sustained for eight hours per television. MFL answers a throttled request
  with an HTML page under a 200, which `loadLiveScoringPayload` correctly reads
  as `ok: false`. Worth reducing (skip the bracket read outside bracket weeks,
  or cache the assembly briefly), but the client must hold its numbers either
  way: no cadence makes an upstream feed infallible.

## Sep 2026 — "1 to play, 1:33 - 1st" on a slate that was almost over

Two complaints from one photograph of a real television, and they turned out to
be the same mistake made twice: **a cell printed a fact about ONE thing where
the viewer reads a fact about the MATCHUP.**

- **"1 to play" was the owner's count alone, and nothing on the cell said so.**
  Both counts lived in the cell foot (`1 to play` · `4 theirs`), and `oppytp`
  was rung ONE of the drop ladder — so at three cells or more the opponent's
  went and the survivor lost the only thing disambiguating it. Four cells is
  not an edge case: it is two leagues with a doubleheader each, the ordinary
  Sunday this board was built for. Both counts now sit on their own team's ROW,
  next to the name whose count it is, and `oppytp` moved to rung three so it
  only fires at tier 4 where the cell genuinely cannot carry two.
- **The clock was the ESPN clock of the one game most of the owner's starters
  were in.** True of that game, and true of nothing the cell was showing —
  because late on a Sunday the only games still `in` are the ones that kicked
  off LAST. An owner with a single starter left in the night game got
  "1:33 - 1st" beside a board where everything else was final. The selection was
  the bug, not the data.

`matchupTimeLeft` replaces it: sum the real seconds left across every starter on
BOTH sides — ESPN's `period` + `displayClock`, MFL's `gameSecondsRemaining` only
for a starter whose game did not resolve at all — and print the fraction as a
position on one 60-minute clock (`2nd 5:31 left`). It is NOT the fabrication `clockLabel()` was, and the distinction is the
owner's: that rule is about asserting a real NFL game's state, and a matchup
meter names no game to be wrong about. Three constraints keep it that way, each
pinned:

- **The inputs tick.** ESPN's period and clock, and only those. A starter ESPN
  could not place leaves both halves of the fraction — review caught the first
  cut keeping MFL's seconds as a per-player fallback, which printed a clock
  made 100% of non-ticking numbers the moment the scoreboard fetch failed
  (`games: []`), and floored a bye starter's matchup above `Final` forever.
  No starter placed, no clock.
- **It cannot be read as a game clock.** ESPN spells one `4:08 - 3rd`; this
  spells `3rd 4:08 left`. A guard test asserts the shape, not just the values.
- **Overtime is not a fifth quarter.** A 5th period contributes only what OT has
  left, or the matchup gains fifteen minutes that cannot be played.

Also fixed in passing, and the reason to read the entry above this one: an
unreadable panel used to print `0 to play` through the same `?? 0` that once
printed `0.0 / Proj 0.0`. It now prints nothing — "the feed says nothing" and
"we could not reach the feed" stay different facts all the way to the pixels.

**What actually caught the last two.** `tests/broadcast-score-header-ssr.test.ts`
renders the header and asserts on the STRING. Both bugs in this entry were
computed correctly and then PLACED somewhere that said something else, which is
invisible to a pure-function test and to a scan guard — and the render test
immediately found a third of the same shape that review had not: an
`unavailable` panel drew em-dashes for every number and printed a confident
`3rd 8:17 left` beside them, because the clock is built from ESPN plus the
league's own starters and never asked whether the league's read had failed.
Anything this component prints belongs behind `readable`.

**The count went UNDER the name, not on the row.** Between the name and the
projection it was competing for width with two numerals and a crest, and on a
real doubleheader cell it ellipsised to `1 to ...` and `0 t...` — worse than
not printing it. Stacked inside `.lbc__ident` it costs the row no height at all:
`.lbc__side` is centred and the score numeral is the tallest item (~5.6vh at
tier 3 against ~4.4vh for two stacked lines), so the second line fits in height
the row already had. The 25% width floor moved with it — it has to sit on the
box the row's flex layout actually shrinks, which is now the column rather than
the text inside it, and `tests/broadcast-shell-guards.test.ts` follows it there.

## 2026-09-14 — the follow-up: an inert floor, and a rounded `Final`

Both items here are the hotfix's deferred work (#1080), and the first one is
the more useful lesson.

**A duplicated class name in this stylesheet is a SILENT override, and the
guard that read the first block could not see it.** `live-broadcast.css` is one
global sheet for nine components, and a bare single-class rule has no scope. The
entry above gave the scoreboard's new identity column the name `.lbc__who` —
which the player strip had already been using, 500 lines down. Same specificity,
later rule wins: the strip's `flex: 1; min-width: 0` overrode the scoreboard's
`flex: 1 1 auto; min-width: 38%`, so the width floor written *that afternoon to
fix a truncation seen on the television* never applied on any screen. Worse than
a no-op — the same change had handed `.lbc__tn`'s old 25% floor over to the
column, so the board went from one floor to none at all, and the CSS, the
component and the guard test all still read as if the fix were live.

Two things make that class of bug mechanical now:

- The scoreboard's column is `.lbc__ident`; `.lbc__who` stays the strip's.
- `tests/broadcast-shell-guards.test.ts` fails on **any** `lbc__*` class that
  two components in `src/components/shared/live-broadcast/` both use AND the
  stylesheet styles with a bare single-class rule. It reads the components with
  comments stripped — this repo's prose names other components' classes
  constantly — and it deliberately ignores a class reached only through a
  descendant selector, which is already scoped to its container. There was
  exactly one violation across nine components: this one.

The general shape, which is not specific to the board: **a guard that extracts
"the rule for `.x`" with a first-match regex asserts about the block it found,
not about the one that wins.** It passed the whole time.

**`Final` is an assertion; everything else on that clock is a measurement.**
Copilot's suppressed comment on #1079, and correct. `matchupTimeLeft` hands
`progressClockLabel` the slate's remaining seconds over the starter COUNT, so
the label computed `round(left / N)` — with nine starters, four real seconds of
football rounded to zero and the cell called a game still being played `Final`.
It self-corrected on the next poll, which is why it was deferred and not why it
was acceptable: it is the same failure the whole hotfix existed to remove, a
confident string true of nothing on the cell. Every positive fraction now floors
at one second (`4th 0:01 left`); only exactly nothing prints `Final`. Rounding
is fine for a label that measures — it is not fine for the one value that
changes what the label MEANS.

Review of the fix found the other half of it, which is the more interesting
one: the floor belonged on the NUMERATOR too. `gameSecondsLeft` returned 0 for
a game ESPN still called `in` — the 4th quarter at `0:00`, the window before
ESPN flips to period 5, and any live game whose `displayClock` does not parse
(`parseDisplayClock` answers 0 for a blank on purpose, since a missing clock
means we know the quarter and not the time inside it). With every other starter
final, either shape summed to exactly nothing and the cell said `Final` over a
game going to overtime. `post` is now the only state that may contribute zero.
Flooring the label alone would have left a `Final` that no longer came from
rounding and was just as wrong.

And the guards that pin the width floor had the same defect they exist to
catch: `/\.lbc__ident\s*\{([^}]*)\}/.exec(CSS)` reads the FIRST block, so a
second `.lbc__ident` block would override the floor with all 102 guards green —
the #1081 failure exactly, one class name later. They read `declared(cls, prop)`
now: the last bare single-class declaration in file order, which is what the
cascade leaves in effect at equal specificity.

