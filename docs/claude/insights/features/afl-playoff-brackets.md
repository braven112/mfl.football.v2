# AFL Playoff Bracket Reconstruction

Rebuilding `/afl-fantasy/playoffs` for the twenty seasons MFL only ever exported
seeds for. See `domains/mfl-api.md` (2026-08-12) for the API-level facts; this
file is about method — how to reconstruct something like this without shipping a
plausible-but-wrong answer, and how to verify it.

---

## 2026-08-12 - Prove a Reconstruction by Conservation, Not by Spot-Checking

**Context:** Three families of bracket had to be recovered per season — the
championship, the 16-team NIT, and five to eight consolation/placement brackets
whose fields are made of *losers* and so cannot be seeded from the standings at
all. Every one of them is plausible-looking. A wrong bracket does not announce
itself; it renders as a perfectly normal tournament with the wrong teams in it.

**Insight:** The strong correctness property is **conservation**, not
correctness of any individual bracket: *every scored game in the playoff weeks
must land in exactly one bracket, and every bracket must end up with the number
of teams MFL says it has.* Both are cheap to assert and impossible to satisfy by
accident. A mis-assignment then surfaces as a leftover game or a team-count
mismatch — a loud, specific failure — instead of as a believable wrong bracket.
This caught the 2006 "AFL Losers Bracket Placing Games" case (a 4-team bracket
that plays two *unconnected* games a week apart, so it needs to absorb a second
cohort rather than continue from survivors), which no amount of eyeballing the
championship bracket would have revealed.

**Evidence:** `tests/afl-reconstructed-brackets.test.ts` — "assigns every playoff
game to exactly one bracket, and invents none" plus "gives each bracket the
number of teams MFL says it has". The solver reports unclaimed games at
generation time (`reconstructConsolation` returns `unclaimed`), so a regression
is visible in the script output before it reaches a test.

**Recommendation:** When reconstructing structure over a known-complete set of
facts, find the conservation law first and assert it. Spot-checking a few
outputs against known results verifies the happy path and misses exactly the
cases that matter.

---

## 2026-08-12 - Solve Losers' Brackets Forward by Consumption, With Elimination Depth as the Tiebreak

**Context:** Consolation brackets can't be seeded — their fields are whoever
lost. Worse, several start in the same week on the same side of the draw and
need the same number of games, so "which unassigned games belong to which
bracket" is genuinely ambiguous from counts alone.

**Insight:** Walk forward week by week, consuming what the primary brackets left
behind, in two passes per week:

1. **Continuation** — an open bracket claims any unconsumed game on its own side
   involving a team it still has alive. This is what lets *late entrants* join: the
   AFL Consolation Bracket is 6 teams — 4 quarterfinal losers in week 15, then
   the 2 semifinal losers drop in for week 16.
2. **Seeding** — group whatever remains by how deep its teams got in the
   *primary* bracket, and hand the groups to the brackets starting that week,
   deepest run to the lowest bracket id.

Elimination depth is the load-bearing part. 2005 week 17 starts three separate
1-game brackets at once ("3rd Round NIT Losers", "2nd and 3rd Round NIT Losers",
"1st Rd. NIT Losers & Week 16 Losers"); they are indistinguishable by week, side,
or game count, and they award the #3 first-rounder, the #2 second-rounder and the
#3 second-rounder respectively. Guessing hands out the wrong draft picks.

**Recommendation:** Reach for structural signals already present in the data
(here: which round a team exited the parent tournament) before reaching for name
parsing. The names in this dataset are wildly inconsistent across eras; the
elimination graph is not.

---

## 2026-08-12 - When the Seeding Rule Is Unrecoverable, Fingerprint the Shape and Anchor on a Known Result

**Context:** 2004 and 2011 ran six divisions into an eight-team bracket, so the
field was not top-N-per-conference and the standings-seeded walk collapsed. The
actual qualification rule is not derivable from the feed — six division winners
plus two wildcards *almost* fits, but the wildcards don't follow best-remaining
either.

**Insight:** You don't need the rule. A valid bracket is its own fingerprint:
pick `teams/2` games from the opening week whose winners pair off into real games
the following week, and so on down to one. For a 24-team league that's 495
subsets — trivially searchable. It narrows 2011 to **three** candidates (the
championship plus two structurally identical halves of the 16-team NIT), so a
single known fact — the final — decides. Gate the fallback on having *both*
champion and runner-up on record and on the match being unique, and it cannot
invent a bracket: 2004 has the same three-candidate ambiguity and correctly
stays unreconstructed because its champion isn't recorded.

**Evidence:** `searchChampionshipField` in
`scripts/reconstruct-afl-playoff-brackets.mjs`; 2011 recovered this way and
verified game-for-game against MFL's own bracket pages.

**Recommendation:** Separate "what rule produced this" from "what actually
happened". The second is often recoverable when the first isn't, and it's the
one that matters.

---

## 2026-08-12 - Fingerprint Screenshot Evidence by SCORE, Never by Team Name

**Context:** The commissioner supplied bracket screenshots labelled 2011. They
were 2015. Acting on the label would have pinned a whole season's fixtures to
the wrong year — and the mislabel was invisible, because the two teams named in
the earlier verbal summary ("Delirium Tremens" and "Drunk Indians") really do
appear in 2011.

**Insight:** In a 20+ year league, team names are a terrible year anchor.
"Delirium Tremens" and "Drunk Indians" coexist in **ten** seasons; a name pair
that feels distinctive usually isn't. Fantasy **scores** are effectively unique
fingerprints — grep a handful of them across every committed `schedule.json` and
the year falls out unambiguously in one command:

```bash
# scores from the screenshot → the season they belong to
node -e "…for each season's schedule.json, report any franchise whose score matches…"
```

Doing this took seconds and caught an error that would otherwise have been
baked into test fixtures.

**Recommendation:** Any time a human supplies dated evidence (screenshots,
exports, recollections) for a historical dataset, verify the date from the
content before using it. Prefer numeric fields over labels — and say so when you
correct the label, because the human's memory of *which* year is exactly what
was wrong.

---

## 2026-08-12 - Look Up Franchise IDs; Never Infer Them From Names

**Context:** Twice while writing test fixtures I wrote franchise ids inferred
from names seen in nearby output rather than looked up. Both times the scores
matched and the ids didn't, so the tests failed loudly — but they'd have been
silently wrong pins if I'd asserted only on ids.

**Insight:** Franchise ids are not stable across leagues (AFL 0001 ≠ TheLeague
0001) and not memorable within one. Generate fixture tables from the data:

```bash
node -e "…print ['<id>', '<winner>', '<points>'], // <name> for each bracket…"
```

**Recommendation:** When a test pins ids, emit the pin table from the source
data and paste it, rather than hand-writing it. Pair every id assertion with a
second field (here, points) so a wrong id can't quietly pass.
