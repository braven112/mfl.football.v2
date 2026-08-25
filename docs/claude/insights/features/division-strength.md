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

Related: the raw average finish could not be the displayed number either. The
AFL ran six divisions through 2012 and four since, so "2.0" earned in a
six-division year and "2.4" in four-division years are not comparable — shown
side by side, the worse one sorted higher. The displayed figure is the
era-normalized score the sort actually uses, with the raw average as a subtitle.

**Recommendation:** If a page deliberately declines to pick a winner, check that
no component of it picks one anyway. Truncating a ranking, choosing a default
sort, and generating comparative prose are all ways a "neutral" page takes a
side. The default sort here is `seasons` — neutral between both metrics — for
exactly this reason.
