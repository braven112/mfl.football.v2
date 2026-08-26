# Division Strength — Insights

The Strength of Division report (`/division-strength`, both leagues), built from
`data/<league>/derived/division-strength.json`.

## 2026-08-25 - A division's OVERALL record cannot measure its strength

**Context:** Building the report from a league suggestion — "accumulate the
stats of each team by division, then say which division has been strongest".

**Insight:** The obvious implementation — sum each division's W-L — is
mathematically incapable of answering the question. Every intra-division game
hands one of that division's own teams a win and another a loss, so that slice
of the record is pinned to exactly .500 by arithmetic no matter how good the
teams are. Both leagues schedule a heavier in-division slate than an
out-of-division one, so the more games a division plays against itself, the
harder its record is dragged toward .500 — the metric actively punishes the
thing it is supposed to measure.

The only slice where a division can separate from the field is games against
teams OUTSIDE it. `interDivision` is therefore the ranking metric everywhere in
this feature; `totals` is reported (it is what an owner remembers) but never
sorts anything.

**Evidence:** TheLeague 2015 Central went 38-10 (.792) interdivisionally while
its overall mark was far tamer. Intra-division records are asserted to be
exactly zero-sum in `tests/division-strength-data.test.ts` — if that assertion
ever fails, games are being counted from only one side.

**Recommendation:** Any future "how strong is this group of teams" question
(conference strength, an era, a draft class's franchises) needs the same split.
Sum the group's record against everyone else, never its total.

## 2026-08-25 - Records come from PLAYED seasons; membership must not

**Context:** An owner asked why the new owner of a Southwest franchise did not
appear in the report.

**Insight:** Everything record-bearing is built from played franchise-seasons,
which is correct — an unplayed season has no record to contribute. But the same
filter had been used to answer "who is in this division", so the section headed
*As currently constituted* rendered the lineup and the owner as of the last
COMPLETED season. TheLeague's franchise 0004 passed from Heavy Chevy to Dead Cap
Walking for 2026, and the table showed the outgoing owner under a heading
promising today's.

The same conflation broke `?year=<upcoming>` harder: with zero played rows the
season view rendered "Teams 0 · 0 divisions · 0 playoff berths", a "by division"
heading and an empty grid — directly under copy asserting "Divisions are set".

**Evidence:** `compute-division-strength.mjs` now emits `upcoming`, read from
the latest season on file whether or not it has been played, and every
difference from the last played season is reported rather than folded in
(`newOwner`, `arrivals`, `departures`, `movedDivision`). A pure RENAME keeps its
`ownerId` and is deliberately NOT flagged as an ownership change.

**Recommendation:** In any derived dataset spanning an offseason, treat "what
happened" and "who is here now" as two different queries against two different
year selections. A single `latestYear` serving both is wrong for roughly half
the calendar. Note this is a third clock alongside the two in CLAUDE.md: not
`getCurrentLeagueYear()` or `getCurrentSeasonYear()` but "latest season with
played rows" vs "latest season on file", both read from the data.

## 2026-08-25 - Divisions are keyed by NAME, not by MFL slot id

**Context:** Deciding what a division IS, across two leagues that have both
realigned.

**Insight:** MFL's `division` ids are slots, and a slot's meaning does not
survive a realignment. The AFL's id `03` was the East through 2012 and has been
the West ever since — keying all-time records on the id merges two different
divisions into one nonsense row. Names are stable across every realignment on
file, and reading TheLeague's 2011 rename as "the Pacific ran 2007-2010, the
Northwest since 2011" is both true and what an owner means.

Consequence to accept: retired divisions are real rows with real records, and
short-lived ones (the AFL's Atlantic, one season) will top any rate metric. They
are marked with their season count inline rather than hidden.

**Recommendation:** Before joining anything on an MFL division id across years,
check whether the id's NAME changed. `divisionId` in the derived file is
informational for exactly this reason.

## 2026-08-25 - Membership eras are what make two divisions comparable

**Context:** "Compare divisions as eras with current members so some have been
the same longer."

**Insight:** A division name outlives the teams that earned its record, so
comparing two division names all-time compares two different sets of franchises.
Segmenting each division's seasons into runs with an identical franchise set —
breaking on a membership change OR a gap year — produces the one slice where two
divisions are compared as the same group over their whole shared span.

It changes the answer. The AFL's North carries .513 interdivisionally under its
name all-time, but **.571 with the six teams actually in it since 2019**. That
gap is the difference between a division's reputation and its current occupants.

**Evidence:** `membershipEras[]` / `currentEra` in the derived file. TheLeague's
East and Northwest have fielded the same four since 2016 (2-3 lineups each since
2007); the AFL churned far harder (9-10 lineups per division).

**Recommendation:** When a group's identity is a label rather than its members,
report both — the label's history and the current members' shared history — and
say which is which. Neither alone is honest.

## 2026-08-25 - Two metrics that disagree need full orderings, not podiums

**Context:** The PO's call was to show both strength metrics and crown no
all-time winner.

**Insight:** Rendering the "no verdict" decision as two top-three podiums
defeated it. Both podiums were led by the same one-season division (the AFL's
Atlantic, .556), and the generated copy read "Both metrics agree here — Atlantic
leads either way", which is a STRONGER claim than the underlying table supports.
A podium crowns; that is what a podium is for.

Replacing the top-three cut with the complete ordering, season counts visible on
every short run, turned the same data into something that reads as data. The
copy now names the short run outright instead of reporting it as a finding.

**Postscript (same day):** the second metric is gone. The owner found the
era-normalized finish score opaque — fair, it is synthetic — and asked for plain
overall win% instead. Measuring that first was worth the two minutes: overall
win% ranks the divisions IDENTICALLY to interdivisional win%, 7 for 7 in both
leagues, because the intra-division slice is exactly .500 and shrinks every
division toward the middle by a similar factor. Two columns that always agree
cannot be "two ways to read it".

So the section is now one ranking, sorted on the interdivisional rate, with both
rates on every row and the overall figure explicitly called out as the
flattering one (the AFL East plays 52% of its games in-division: .459 against
everyone else, .483 overall). The no-verdict decision survives, but it now rests
on sample size alone, which is the reason that was always doing the real work.

**Recommendation:** If a page deliberately declines to pick a winner, check that
no component of it picks one anyway. Truncating a ranking, choosing a default
sort, and generating comparative prose are all ways a "neutral" page takes a
side. The default sort here is `seasons`, which is neutral with respect to
strength, for exactly this reason.

## 2026-08-25 - Eras were computed but never compared; a name-only ranking is a different question

**Context:** Same-day follow-up to the launch. `membershipEras[]` already
existed and the "as currently constituted" table already used the CURRENT one
— but the page's only actual ranking still ordered division NAMES, and every
retired era on file was reachable only by opening a per-division `<details>`.

**Insight:** Computing the right slice is not the same as comparing on it. The
report shipped with the honest unit of comparison (a fixed set of franchises
over its whole shared span) sitting one disclosure-triangle deep, while the
prominent ranking compared seven labels. The fix was not new math — nothing in
`compute-division-strength.mjs` changed — it was ranking the eras against each
other across divisions, which turns the same numbers into the comparison the
page's own copy had been arguing for.

It re-reads the league. TheLeague's East is 2nd of nine qualifying lineups with
the four it has had since 2016 and 9th — last — with the four it had 2011-2015.
One name, two eras, opposite ends of the same list. A name-only ranking cannot
express that at all; it averages the two into 4th and calls it the East.

**Evidence:** `rankEras` / `divisionAlumni` / `formatEraYears` in
`src/utils/division-strength-view.ts`, pinned by the `era board` block in
`tests/division-strength-data.test.ts`.

**Recommendation:** When a derived file already carries the defensible slice,
check what the page RANKS on before adding anything. A field that exists but
never sorts a list is not yet a position the page has taken.

## 2026-08-25 - A minimum era length is a claim about evidence, not a filter

**Context:** Choosing which membership eras earn a place on the cross-division
board.

**Insight:** The floor is four consecutive seasons, and it is doing the job the
all-time list needs a caveat pill for. Both leagues realign in a way that
scatters one- and two-season lineups — the AFL's West has ten eras, six of them
a single season — and on a rate metric those short runs land at the extremes and
push every long-standing lineup toward the middle of the board. Admitting them
would reproduce, inside the honest comparison, exactly the sample-size problem
that stops this page naming an all-time strongest division.

Two consequences to accept rather than paper over. Divisions can be ABSENT: no
group has held TheLeague's Midwest or Pacific together four years, so neither
appears, and the note names them so a reader who scans for their own division
is told why rather than assuming the board is broken. And a division can appear
TWICE, which is the point — Northwest (2011-2015) and Northwest (2016-present)
are two different sets of teams.

**Evidence:** `ERA_MIN_SEASONS` in `src/utils/division-strength-view.ts`. The
floor is a parameter with a default, and the suite asserts `rankEras` honors
the one it is passed rather than a constant baked into the body.

**Recommendation:** Any "compare these groups" ranking needs a stated minimum
membership, chosen from how the underlying churn actually distributes rather
than picked as a round number. Say what the minimum excluded, by name, in the
copy under the ranking.

**Postscript (same day):** every count in this entry was measured against
franchise-keyed eras. Re-keying them on OWNERS (see the last entry in this file)
cut the board to 6 rows in TheLeague and 4 in the AFL, added the Atlantic to the
absent list, and made the Central — not the Northwest — the division that
appears more than once. The floor itself survived the change unaltered, which is
the argument for stating it as a parameter.

## 2026-08-25 - Two `auto` margins do not make a column

**Context:** Adding team crests to the all-time ranking rows, which already
pushed the record to the right with `.verdict-value { margin-left: auto }`.

**Insight:** Adding a second `margin-left: auto` to the crest span splits the
free space between the two gaps instead of pinning either, so the crests landed
at a different x on every row — the exact ragged edge the change was meant to
fix. Only the FIRST auto margin can define the column; the element after it
needs a fixed gap, which means out-specifying the existing rule
(`.member-icons + .verdict-value`) rather than adding to it.

**Recommendation:** In a flex row, `margin-left: auto` is a break between two
groups, not a right-align. A second one starts a third group and un-pins the
first.

## 2026-08-25 - An era is a group of PEOPLE, not a group of slots

**Context:** An owner read the *As currently constituted* table and said the
Together numbers did not look right.

**Insight:** They weren't. Membership eras broke on a change in the franchise
SET, and the page printed that span under the word "together", beside crests
and owner names — so the reader hears *these people*. TheLeague's Southwest was
credited with 9 shared years since 2017 while three of its four seats changed
hands inside that run (0004 in 2018, 2019 and again in 2020; 0006 and 0011 in
2019); the current group is six years old. Central was 9 for a group of eight.
The same page's own "New for 2026" panel already treated a takeover as breaking
the group ("has not played a game with this exact group yet"), so the two
halves of one table contradicted each other.

First fix shipped the franchise span with an owner annotation next to it
("same owners since 2020"), on the argument that the RECORD belongs to the
slots and that owner-keyed eras leave the AFL's North with a one-season sample.
The PO overruled it in one line — *"franchise slots isn't important, it's
owners together that we want to track"* — and that is the right call: the whole
point of the slice is to compare divisions as the same group over their shared
span, and a group is people. The sample objection was real but it was an
argument for saying the span out loud, not for inflating it.

**Evidence:** `seatKey()` in `compute-division-strength.mjs` is now the era key
itself (franchise + sorted ownerIds, so a pure rename does not move it, matching
`upcoming`'s `newOwner` rule). Eras got shorter and more numerous — TheLeague's
Southwest 3→8 lineups, the AFL's West 10→18 — and two things absorb that:

- a **Founded** column carrying the division's own `firstYear` / `seasons`, so
  a 1-year Together on a 23-year-old division reads as information rather than
  as an error;
- `eraVsAllTime` returns null below `SHORT_RUN_SEASONS`, because "▲.084 vs
  all-time" off one season is a comparative claim the sample cannot carry. The
  record still shows, with "1 yr" beside it.

`tests/division-strength-data.test.ts` recomputes the owner set per season from
`years[].divisions[].teams[].owners` and pins that it is unbroken inside every
era, that the era's own `members` are that set, and that adjacent eras differ
on OWNERS — identical franchise ids across an era boundary is now legitimate,
because that is exactly what a takeover looks like.

It also moves the era board that landed on main the same afternoon (see the
`ERA_MIN_SEASONS` entry above). Qualifying eras fall from 9 to 6 in TheLeague
and 6 to 4 in the AFL; TheLeague's Atlantic joins the Midwest and Pacific in the
absent list (its one 4-season franchise lineup was two owner groups), and the
division that now appears more than once is the Central, three times, not the
Northwest twice. Both the board's copy and the launch article's quoted examples
had to be re-derived — a reminder that generated-looking prose naming specific
rows is coupled to the segmentation key, and reads as confidently wrong the
moment the key changes.

**Recommendation:** When a derived span is segmented on identity, write down
WHICH identity — a slot, a name, or a person — and check every label rendered
next to it. And when the honest segmentation produces small samples, the answer
is to show the sample size and withhold the comparative claims, not to pick a
looser key. TheLeague's East and Northwest agree under both keys, which is
exactly why this survived review: the two rows you read first are the two where
the distinction does not show.

## 2026-08-25 - A natural flex wrap is not a row shape

**Context:** The phone layout of the ranked division rows. The `li` was
`display: flex; flex-wrap: wrap` with `order` assigned to rank / name / crests /
record, on the assumption that "the crests wrap to their own line" was the
layout.

**Insight:** Wrapping is content-dependent, so it is a per-row outcome, not a
row shape. A division called "South" with no `current` pill left room for six
crests on line one; "North 2019–present current" did not — so the same board
rendered two-line and three-line rows alternately down the column, and the
records had no shared edge. Nothing was wrong with any single row; the raggedness
only exists between rows, which is why it survives a desktop check and every
unit test.

**Recommendation:** When a wrapped flex row is supposed to have a *shape*, make
the break explicit — `flex: 0 0 100%` on the item that should start line two.
That also forces everything after it onto line three, which is usually what you
wanted for the trailing column anyway. Reserve natural wrapping for content
whose ragged edge is acceptable, and verify a list layout by screenshotting
SEVERAL rows at the target width: the shortest label and the longest one wrap
differently, and one row proves nothing.

## 2026-08-25 - An unscoped `order` reaches into a nested flex container

**Context:** Same mobile media block. `.verdict-name` and `.verdict-list .pill`
carried `order: 2` to place the division name after the rank.

**Insight:** On the era board those two elements are not children of the row —
they sit inside `.era-board__name`, which is itself `display: inline-flex`. A
descendant selector matched them there too, so `order: 2` applied against their
real parent and reordered ITS children, while `.era-board__years` kept the
implicit `order: 0` and sorted ahead of both. The phone read
"2019–present North current" where desktop read "North 2019–present current".
Nothing in the diff that introduced the wrapper touched the order rules; the
selector simply started matching one level deeper.

**Recommendation:** `order` resolves against an element's own flex parent, so a
selector that names an element by class alone will silently re-sort a nested
flex container it was never written for. Scope ordering rules to the generation
they mean — `.list > li > .thing`, not `.list .thing` — the moment any row wraps
part of its content in a flex wrapper.
## 2026-08-25 - "Division titles" is a season counter, not an achievement

**Context:** An owner reading a division panel: *"it seems to count division
titles but it's just counting how many years the division has been around."*
Exactly right. The Northwest panel led with **Titles / Champs 15 / 3** over
*2011–present* — 15 seasons, 15 titles.

**Insight:** A division crowns exactly one winner in every season it plays, so
a DIVISION's all-time division-title count is identically its season count.
The number is a restatement of the row next to it, formatted as a trophy case.
Checked before believing it: `divisionTitles === seasons` for 7 of 7 divisions
and 28 of 28 membership eras in TheLeague, and 7 of 7 and 70 of 70 in the AFL —
100%, because it is arithmetic and not a coincidence.

Worse than redundant, it was load-bearing: the all-time table's **Titles**
column was sortable, and `?sort=titles` produced exactly the same ordering as
`?sort=seasons` while reading as a ranking of accomplishment.

The same field is genuinely informative one level down. Inside a division, the
owners split those titles unevenly — Bring The Pain has 8 of the Central's 19
— so `DivisionOwnerEra.divisionTitles` stays, and only the two aggregate copies
were pulled from the page.

**Evidence:** What replaced it had to be earned against the rest of the league:
`playoffBerths` and `championships`, which do vary between two divisions of the
same age (Northwest 28/3 vs Southwest 27/3 over the same 15 seasons). Berths
are reported over `playoffBerths / teamSeasons` — franchise-seasons, not
seasons, because the AFL ran six divisions of four through 2012 and four of six
after, and per-season would flatter the bigger ones.

A berth rate compares only within a fixed playoff field, so the page measures
that field from the data (`playoffFieldRange()`) and prints a caveat only when
it has moved. It renders in neither league today: TheLeague has seeded 7 of 16
every season since 2007 and the AFL 8 of 24 every season since 2003. The first
draft of this entry said the AFL's field had shrunk to four or five — that was
a bug, not a league, and the entry below is what it turned out to be.

Three guards in `tests/division-strength-data.test.ts`: the identity itself is
pinned (as "titles equals the seasons already crowned", so it holds mid-season
too, when winners are not yet recorded); the page source is scanned for any
`divisionTitles` receiver other than the owner loop variable; and
`ALL_TIME_SORT_KEYS` is asserted not to contain `titles`. A stale
`?sort=titles` bookmark clamps to the default like any unknown key.

**Recommendation:** Before publishing a count, ask what the number would be if
the thing being measured were maximally mediocre. If the answer is "the same",
it is a structural constant wearing a metric's clothes — the tell here was a
column that moved in lockstep with the one beside it. Awards that are handed
out per-group per-season (division titles, weekly high score within a division,
"most improved" of a fixed field) only carry information at the level BELOW the
group that always receives one.

## 2026-08-25 - Bracket 1 stopped being the AFL's playoff entry in 2018

**Context:** Reviewing the berth numbers the entry above put on the page, the
owner rejected the premise outright: *"only 8 ever playoff berths between AL
and NL since year 1."* The derived data said four or five a year since 2018.
The owner was right and the data was wrong.

**Insight:** `compute-franchise-history.mjs` derived every playoff appearance
in the repo — the division report, `franchise-history.playoffAppearances`,
owner tenures, badges — from a single hardcoded bracket id: `brackets['1']`.
That was correct for fifteen years and then silently stopped being correct.
From 2018 the AFL seeds its eight playoff teams into TWO conference brackets,
`2 AL Championship` (4 teams) and `3 NL Championship` (4), and `1 AFL
Championship` became the two-team FINAL between their winners. Reading id 1
therefore reported a two-team playoff field for eight straight seasons.

It never showed as an error because two fallbacks quietly filled the hole with
something plausible: the standings-seeding inference sized itself off the same
bracket 1 (`teamsInvolved: 2`), and the belt-and-suspenders pass credited the
division winners plus the champion and runner-up. That produced four or five
berths a year — a number too reasonable to question, on pages nobody
cross-checks against MFL.

This is the SECOND bug from reading an AFL bracket by id. The first one
mislabelled playoff rounds and was fixed by classifying on the bracket NAME
(`afl-bracket-kind.mjs`, whose header even documents that id 2 became the AL
bracket in 2018). The name-based resolver existed; the participant reader just
never got moved onto it.

**Evidence:** `src/utils/playoff-entry-brackets.mjs` now owns the question for
both leagues. The AFL resolves it by name and start week — the
championship-side title brackets that open in the FIRST postseason week, which
is bracket 1 alone through 2017 and AL + NL from 2018. TheLeague answers `['1']`
directly, because a week rule would be wrong there: its Toilet Bowl Challenge
is a full 7-team tournament starting the same week as the championship, so the
week rule alone would report a 14-team playoff field in a 16-team league.

Participants now come from real games wherever they exist. MFL's export carries
franchise ids only from 2024, so the reconstructed brackets
(`derived/reconstructed-playoff-brackets.json`, 2004-2023, a schedule walk
verified against championship-history) became the first fallback rather than
being used only for round labels. Standings inference dropped to last resort —
2003 alone. That also settled two seasons where the inference had produced a
NINE-team field in an eight-team bracket — 2004, 2007 and 2013, three seasons
rather than the two an earlier draft of this entry claimed — and corrected eight
franchise-seasons between 2004 and 2014 where it had seeded the wrong team: 2014
credited berths to 0022 and 0002, who were both in the NIT that year.

Every AFL division's berth count moved: North 28 → 38, West 37 → 44, East 29 →
34. The ordering changed with it, and the corrected one agrees with
interdivisional strength — West leads both at .536 and 37%, East trails both at
.459 and 29%, where before the two metrics disagreed for no reason anyone could
have explained.

`tests/playoff-field-size.test.ts` is the guard, and it is a conservation law
rather than a policy claim: berths counted in the season ledger must equal the
field MFL's own bracket metadata declares, season by season, in both leagues. A
league that genuinely changes its playoff size stays green; a reader pointed at
the wrong bracket does not. Reverting the resolver to `['1']` fails it with
"2018: 8 berths in the ledger, 2 seats in brackets [1]".

**Recommendation:** A derived number that no page cross-checks against its
source can be wrong for eight years without anyone noticing, and fallbacks make
it worse by keeping the output plausible. Where an external system's structure
is a fact you depend on, assert the derived result against that system's own
declaration of it — MFL says how many teams it seeds; nothing was comparing our
answer to it. And when a source is known to renumber its keys, fix every reader
at once: this file already documented the renumbering, for the reader that got
fixed the first time.
