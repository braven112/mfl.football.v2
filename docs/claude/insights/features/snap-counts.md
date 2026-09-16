# Snap Counts — Free Agents GP / Snaps / Snap%

NFLverse per-game snap counts, aggregated to a season and joined to MFL player
ids, rendered as three columns on both free-agent pages.

- Data: `data/nfl/snap-counts-<year>.json`
- Fetcher: `scripts/fetch-snap-counts.mjs` + `scripts/lib/snap-counts.mjs`
- Season rule: `src/utils/snap-count-season.mjs` (`resolveSnapCounts`)
- Cron: `.github/workflows/snap-counts-sync.yml` (Tue 20:00 UTC)
- Guard: `tests/snap-counts.test.ts`

---

## 2026-09-15 — Four bugs in one screenshot, and what each one generalizes to

An owner sent one screenshot from week 2 of the 2026 season: Kareem Hunt, 529
snaps, 47.1%, GP blank. Four separate defects were visible in that single row.
Each is worth remembering as a shape, not as a fact about snap counts.

### A docblock describing a schedule is not a schedule

`scripts/fetch-snap-counts.mjs` opened with a lifecycle comment — offseason vs
regular season, "fetch weekly on Tuesdays at noon", even the cron line to use.
No workflow ever ran it. The file on disk was the 2025 season captured on
2026-02-17 and had been stale for seven months.

The comment is what makes this hard to see: reading the script leaves you
confident the data is fresh, because the script tells you when it refreshes.
**When you meet a fetcher, grep `.github/workflows/` and `scripts/prebuild.mjs`
for its filename before believing anything its header says about cadence.**

### "Newest file wins" cannot be wrong out loud

The page chose its data with `Object.keys(modules).sort().reverse()` and
rendered the result under bare labels — `Snaps`, `Snap%`. A file-sort pick has
no notion of the season it is supposed to be showing, so it cannot notice that
it is showing the wrong one, and an unlabelled number cannot be checked by the
person reading it. 529 and 41 are both plausible.

**Select by the value you mean, and print it.** The pick is now
`resolveSnapCounts` — the most recent season whose `nflWeekOneKickoff` has
passed — and each header carries the season it reports (`SNAPS '26`), so a
fallback announces itself instead of impersonating live data. That labelling is
not decoration; it is the only thing standing between a cron outage and another
seven silent months.

### A mutable attribute in an aggregation key turns a split into an overwrite

Rows were grouped by `name|team|position`, so a midseason trade produced two
entries for one player. Harmless on its own — but the next step wrote them into
a map keyed by MFL id, where the second simply replaced the first. Jakobi
Meyers shipped as 463 of his 872 snaps; 27 players were wrong this way in 2025.

Two invisible failures compounding: the split produces no error, and the
overwrite produces a *smaller, still-plausible* number rather than a missing
one. **Key aggregation on the entity's own stable id** (`pfr_player_id` here),
and let team and position follow the latest row instead of partitioning it.

### A percentage needs a denominator you can name

`offense_pct` was averaged across games — a mean of ratios with different
denominators, weighting a 45-play game like an 80-play one. The correction is
small (44.4 → 45.0), which is exactly why it survived: nothing looked wrong.
NFLverse does not publish team plays, but every row implies them
(`offense_snaps / offense_pct`), so the season share is Σ snaps ÷ Σ implied
plays.

Worth separating from the *other* percentage question, which is a product
decision and not a bug: share **in the games he played** (Ekeler, 2 games,
49.5%) versus share of the team's whole season (Ekeler, 6%). Brandon chose the
former — standard fantasy snap share — with `games` beside it so the sample
size is visible. Both are defensible; the failure was that the column did not
say which one it was.

### A column group is a claim that the numbers share a source

GP rendered only when snap counts existed, sat inside the snap column group —
and was fed from `lastYrGamesMap`, a fantasy-scoring count from a *different*
season, which in week 2 was empty. The row read "GP –, Snaps 529".

**Adjacency is an assertion.** If two columns sit together under one gate, they
must come from one source and one season, or the group is lying about what it
is. The field is now `snapGames` — named for its source, which also keeps it
from colliding with the AFL's own `games` (fantasy games, *doubled* for a
player rostered in both conferences, since the AFL is duplicate-player).

---

## 2026-09-15 — Sharing NFL data across leagues: the test is the join key

Rolling the columns out to the AFL raised where the data should live. It was
under `data/theleague/nfl-cache/`, which would have forced either a second copy
or a `data/theleague` literal inside the AFL's page.

The question is not "is this NFL-wide in spirit" — it is **whether the join key
is global**. Here it is, and it is checkable: every one of the AFL's 2,622
players for 2026 resolves to the same MFL id *and* the same name in
TheLeague's feed, zero mismatches. That measurement is what justified one file
at `data/nfl/snap-counts-<year>.json` (beside `bye-weeks.json`) rather than a
copy per league. Run the check before assuming; a shared file with a
league-scoped key is worse than two files.

The unrelated `week15-*.json` ESPN schedule files stayed in
`data/theleague/nfl-cache/` — a directory being wrongly named for one league
does not mean everything in it moves.

### A build-time snapshot cannot answer a request-time question

The AFL's page is deliberately fed by `data/afl-fantasy/derived/free-agents.json`,
computed in `scripts/compute-afl-free-agents.mjs`, to keep ~50 MB of feeds out
of the SSR function. The obvious move was to add snap counts to that snapshot.
It is wrong: the snapshot freezes at deploy time, and *which season these
columns show* changes at kickoff — so a page built in August would sit on 2025
until something else forced a deploy, reintroducing the exact staleness being
fixed.

**A derived artifact can hold values; it cannot hold a decision that depends on
`now`.** The three snap files are ~150 KB, so the page globs them directly and
resolves the season per request. Watch for this shape whenever a value is
cached at build time and the thing selecting it is a clock.

### Forked siblings: put the whole decision in the shared helper, not just the data

Both free-agent pages are forked siblings (~4,000 and ~2,700 lines). The
temptation is to share the *lookup* and let each page compute its own labels.
Don't — the label is part of the decision, and two copies of "which season is
this" is how they drift. `resolveSnapCounts` returns the season, the map, the
`'26` label and the tooltip text together, and both pages destructure it.

Same reasoning put the header CSS in `src/styles/snap-columns.css` as a plain
global import rather than each page's scoped `<style>`, for the documented
`fa-claim-button.css` reason: a scoped rule is simply absent from the sibling.

`tests/snap-counts.test.ts` runs every page assertion over **both** pages via
`describe.each`, including that the number of `{hasSnapCounts && (` header
gates matches the row builder's `if (hasSnapCounts)` cell block — a `<th>`
without its `<td>` shifts every column after it.
