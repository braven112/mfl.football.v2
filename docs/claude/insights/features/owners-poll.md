# The Owners' Poll — insights

Weekly owner vote that publishes inside The Pecking Order. Plan:
`docs/plans/owners-poll.md`.

## 2026-09-06 — A section that renders nothing when its data is absent can ship invisible

`OwnersPollSection.astro` correctly renders NOTHING when an issue has no
`ownersPoll` block — that is what keeps archived columns untouched. But the
poll shipped after the last real column ran, so every committed issue was in
that state, and the result was a one-way link: `/pecking-order/ballot` and
`/pecking-order/voters` both point INTO the column, and the column mentioned
the poll nowhere. The one page an owner following that link lands on had no
evidence the feature existed.

Nothing was broken. Every test passed, both pages rendered, the absent state
was deliberate. The gap only exists in the seam between "the feature is built"
and "the feature has run once", and it is invisible to anything that tests the
feature in isolation.

The lesson generalizes past this feature: **when a new section is gated on data
a cron will produce later, ask what its entry points look like in the window
before the first run.** Either give the empty state something to say, or seed a
worked example. Here it was the example —
`scripts/seed-example-owners-poll.mjs`, seeded into each league's latest issue,
described in `docs/plans/owners-poll.md`. Its ballots are fabricated but the
tally is not: it calls the same `tallyOwnersPoll` / `consensusRankMap` /
`contrarianIndex` / `homerIndex` that `closePoll` does, so the example
exercises the real pipeline and cannot drift from it. Every seeded block
carries `source: "synthetic"` and the seeder refuses to overwrite a block
without it, so a real tally can never be clobbered by a demo re-run.

## 2026-09-06 — `homerIndex`'s omission cap does not scale with field size

Rendering the AFL example surfaced this, and it is shipped behaviour, not a
seeding artifact: an owner who leaves their own team off the ballot is scored
as having ranked it `slots + 1`, described in the source as "the most
charitable bounded reading". That reasoning was worked out for TheLeague's
7-of-16, where the cap sits at 8 in a field of 16 — genuinely modest.

At the AFL's 10-of-24 it does not hold. The 24th-place franchise's owner
omitted themselves, was scored at 11, and the consensus had them 24th, so their
Homer Index came out **+13 — the largest in the league.** The most modest ballot
on the board reads as the biggest homer, and the voters page prints it under
"Biggest homer" with no way to tell the difference.

The cap wants to be relative to the field (`eligibleVoters`), not to `slots`,
or omission wants to score null rather than a number. Left alone for now
because it is not this change's to fix, but any future league with a ballot
covering under half the field will hit it harder.

## 2026-09-06 — A test that names one league as "the disabled one" expires

Enabling the AFL broke four assertions across three suites, and none of them
was a real behaviour change. All four had used the AFL as a stand-in for a
property it merely happened to have:

- `refuses a league whose poll is disabled` — the AFL was the disabled league;
- `hides the Owners' Poll categories from a league that does not run it` — same;
- `returns null for a league that does not run the poll` — same;
- `refuses a commissioner of ANOTHER league` — the interesting one.

That last was the only one that had been passing for the wrong reason.
`resolveOwnersPollCaller` checks `?league=` against the session BEFORE it
checks `ownersPoll.enabled`, but the test sent no `?league=` at all, so the
request resolved the AFL commissioner's own league and was refused as
`poll-disabled`. The cross-league guard the test was named for never ran. With
the AFL enabled that same request became a legitimate AFL commissioner opening
the AFL's own ballot — correct, and a 200. The test now sends
`?league=theleague`, which is what every real client sends (BallotBuilder and
LineupBallotStrip are both handed `leagueParam`), and refuses for the reason it
always claimed.

The mirror test — "a page never renders a ballot the API would refuse" — had
the same shape of hole: it fed ONE request to both gates, but the two learn
which league is being addressed differently (the page from its path, the API
from `?league=`). Dropping the param does not make the API stricter, it asks it
a different question.

The lesson generalizes past this feature: a negative case pinned to a specific
league is only a test for as long as that league stays on the wrong side of the
flag. Where a genuinely-disabled example is needed now, use Best Ball — it is
disabled for a reason that cannot expire (draft-only: no lineups, no weekly team
story to rank), not because nobody has got to it yet.

## 2026-09-06 — The AFL port was config plus two wrappers, because the poll was never TheLeague-shaped

The port moved almost no code: `ownersPoll.enabled: true` plus two thin route
wrappers and one island on the lineup page. Everything else — Redis keys, the
open/nag/close passes, the GroupMe day claim, the three push categories, the
cron — was already per-league and already invoking `--league afl-fantasy`.

That is worth recording because it was a DESIGN choice made months earlier and
it is invisible in the diff: the poll took `poll:<navSlug>:…` unconditionally
rather than reusing `scopedKvKey`'s bare-key-for-TheLeague conditional, and it
put slots/quorum/close in the registry rather than in constants. The reward for
both showed up here as a port that could not silently write one league's
ballots into the other's bucket.

The two numbers that DID need thought are the ones the registry made explicit.
Slots and quorum are not TheLeague's values reused — 10 and 12 re-apply
TheLeague's *rules* (rank ~45% of the field; quorum at half) to a 24-team
league. Copying 7/8 across would have ranked under a third of the AFL and set a
quorum a third of the league could reach alone.

And the AFL's conference split, which is load-bearing nearly everywhere else,
is deliberately NOT applied here: one 24-team ballot, because the column the
poll publishes inside already ranks all 24 in one list. A conference-scoped
consensus beside a league-wide machine ranking would disagree with it about
which teams are comparable at all. That is asserted in
`tests/owners-poll-ballot.test.ts` rather than left in prose, because the
default assumption in this repo — correctly, for the draft pages — is that
anything AFL-facing must scope to a conference.

## 2026-09-04 — The ballot has to OPEN with the column, not close before it

The obvious design — tally the ballot, then publish the column with the result
— cannot work on this repo's schedule. MNF ends late Monday; the column
generates Tuesday 07:00 PT. A ballot that had to close before generation would
run overnight, roughly six hours, most of it while owners are asleep.

The fix is a two-stage publish. Tuesday's column ships with the poll section in
its **open** state; a second pass after Thursday's close amends the *same* issue file
with the tally. That buys ~35 hours and, incidentally, three GroupMe
touchpoints (open, nag, reveal) where the one-stage design had one.

Consequences worth knowing before touching it:

- **The close pass must never call the AI.** It amends an issue owners already
  read on Tuesday. Re-voicing would rewrite the headline and blurbs underneath
  them. `--close-poll` short-circuits before `generatePeckingOrder`.
- **The issue pages are prerendered.** So the open state cannot be server
  rendered per viewer — turnout climbs during the window and "did you vote" is
  not a property of a static page. It is an island; the closed state is static.
- **The island must trust the API over the baked JSON.** Between the close
  close and the redeploy carrying the amendment, the prerendered page still says
  `status: "open"`. Without that precedence the page shows a ballot CTA that
  409s on submit.

## 2026-09-04 — Failure posture differs per pass, and that asymmetry is the design

Both passes talk to Redis. They must not react to its absence the same way.

- **Open degrades.** No credentials → return null → the column publishes with
  no poll section. The column is the product; the poll is a section of it.
  Failing the whole run over an additive feature trades a working column for a
  missing one.
- **Close is fatal.** Writing an empty consensus over an issue would erase
  ballots owners actually cast. Better to fail the job and retry.
- **The nag throws on missing credentials but exits clean on "no ballot
  open".** These are different facts. A cron that prints "no ballot is open"
  when it actually cannot reach storage hides a broken deployment for as long
  as nobody checks by hand — the same merge that
  `resolveLineupFillState` and `live-poll-store` exist to prevent. `readTurnout`
  returns `{ ok: false, reason }`, never a bare null.

The close pass also clears the window pointer **last**, after the tally
succeeded. Clearing first would close voting on a run that then threw, leaving
a week with no ballot and no result.

## 2026-09-04 — Poll KV keys are always league-scoped; do NOT reuse `scopedKvKey`

`rankings-scope.ts#scopedKvKey` produces a BARE key for TheLeague
(`ri:0001`) and a scoped one for everyone else. That conditional exists only to
keep pre-existing owner data readable, and it carries a fail-OPEN default: an
unattributable session resolves to TheLeague.

The poll has no legacy keys, so it takes the safe shape unconditionally —
`poll:<navSlug>:<year>-w<week>` — and its own builders throw on a bad scope
rather than defaulting. **Both leagues have a franchise `0001`**, so the bare
form is genuinely ambiguous the moment a second league writes.

Ballots are one Redis **hash per week**, field = franchiseId:

- `HGETALL` reads the week in one round trip at close (no SCAN over a keyspace,
  which Upstash bills per call and which can miss keys mid-write);
- `HLEN` answers the public turnout meter without transferring — or exposing —
  a single ballot;
- per-field writes are atomic, so two owners submitting at the same instant
  cannot clobber each other the way a read-modify-write on one JSON blob would.

## 2026-09-04 — "Count-only" is a product rule, and it has to hold at every layer

The decision was: remind non-voters with a COUNT, never names or @-mentions.
It is easy to honour that in the chat copy and then leak it everywhere else.
Three places had to enforce it independently:

- the nag builder (no names, no mentions — and a test asserts no franchise id
  or team name appears in the string);
- `/api/owners-poll/turnout`, which uses `HLEN` rather than `HGETALL` so the
  endpoint *cannot* name a voter even if a caller wanted it to;
- the issue file, which records `nonVoterCount` rather than a list. A committed
  file carrying names would route straight around the decision, permanently.

A "name the non-voters in the column" idea was drafted and cut for exactly this
reason. Don't re-add it without revisiting the decision itself.

## 2026-09-04 — Accuracy is scored against NEXT week's column, and that choice matters

Pairwise accuracy needs something to be right *about*. Three candidates:

- **This week's own composite** — trivially gamed. It is printed directly above
  the ballot; copying it is not foresight.
- **Next week's raw fantasy results** — mostly luck over one week, which makes
  the leaderboard noise.
- **Next week's composite** (chosen) — 50% all-play, 50% rolling-3-week form.
  Everyone starts from the same freely available baseline (this week's
  ranking), and beating it requires actually seeing a change coming.

That timing is also why the metric lives in `src/utils/owners-poll-accuracy.mjs`
rather than with the rest of the tally math: it can only be computed once the
FOLLOWING week exists, so the accountability page computes it at render time,
and a page cannot import from `scripts/`. `scripts/lib/owners-poll-math.mjs`
re-exports it so there is still one implementation. Contrarian and homer need
only that week's own consensus, so they are computed at close and stored.

Pairs are **pooled** across weeks, not averaged as weekly percentages — a week
where most of a voter's pairs were unscorable should not weigh as much as a
full one. With 7 slots that is 21 pairs a week, so the leaderboard means little
before about week 6; the page says so rather than letting an early leader look
established.

## 2026-09-04 — Two theming bugs the tests could not have caught

Both found by opening the page in a browser, in both themes:

- **The team accent shipped `colorPrimary` only.** That colour is chosen for
  light surfaces; several franchises' primaries are near-black and vanished
  against a dark card. The config already carries `colorPrimaryDark` for
  exactly this. Both are now set inline per card and CSS picks per theme,
  covering the `prefers-color-scheme` default *and* an explicit `[data-theme]`
  toggle. In the article section the same problem is avoided differently, by
  using `teamAccentVar` — which already carries a value per theme, and is why
  the raw brand colour is never used there.
- **An "own team" dashed ring read as an error box** once it stacked on the
  picked state's team-coloured border. The `· you` label carries it instead.

`tests/design-token-guard.test.ts` catches the broader class (a `var(--x)`
defined nowhere) and covers these files, but neither of these was an undefined
token — they were defined tokens used in the wrong theme. Only looking catches
that.
