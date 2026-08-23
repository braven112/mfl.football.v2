# Franchise History Pages — Insights

## 2026-08-23 - An `ownerHistory` boundary is a CLAIM — one year wide and a page hands an owner a season he never played

**Context:** Midwestside's owner read his own franchise page and found 2010 on
it — a 2-16 Witch City Warlocks season from before he joined. `ownerHistory`
for 0011 claimed franchise 0010 from `yearStart: 2010`, but 0010 was still the
Warlocks that whole season; MFL's 2010 `league.json` says so, and the rename to
Midwestside Connection lands in the 2011 feed. Off by exactly one.

**Insight:** Nothing in the pipeline can catch this. `attributeYear` treats an
`ownerHistory` range as authoritative and hands every year inside it to the
claiming franchise, so a boundary that is one year wide reads as data, not as a
bug — the row renders with the correct name for that year (the SOURCE
franchise's `history` resolves it to "Witch City Warlocks"), which makes the
page look meticulous while it is wrong. The claim also propagates well past the
season table: career W-L, `yearsActive`, `matchupHistory`, trades, draft picks,
auction wins, and the award badges all follow it. The 2010 Jerry Jones Award —
worst cost-per-point in the league — was hanging on the wrong owner's page.

Cross-check a boundary against the FEEDS, never against the config alone: the
config's `history` entry for the era (0010's Warlocks ran `yearEnd: 2010`)
already disagreed with the `ownerHistory` claim, and the two live 80 lines
apart in the same file.

**Evidence:** `theleague.config.json` 0011 `ownerHistory[0].yearStart` 2010 →
2011. Recomputed: career 97-133 → 95-117, `yearsActive` 13 → 12, the 2010 Jerry
Jones drops off, and the era card reads "2011–2015 · 5 seasons · 32-56". 2010
returns to being unattributed, exactly like 2007-2009 already were — no current
franchise claims the Warlocks' original owner.

**Recommendation:** When adding or editing an `ownerHistory` entry, confirm both
edges against `data/<league>/mfl-feeds/<year>/league.json` — the franchise NAME
in the year's own feed is the evidence, not the era ranges in the config. And
when an owner disputes a season, check the boundary before the stats.

## 2026-08-23 - Era art copied from the identity it REPLACED reads as a deliberate choice

**Context:** The same page rendered the 2011-2015 Midwestside years under the
Witch City Warlocks' pentagram. `computer_jocks_midwestside_icon_circle.png`
was a near-duplicate of `witch_city_warlocks_icon_circle.png` — the era got a
copy of the crest it replaced, presumably as a placeholder that outlived its
placeholder-ness. The owner's read was not "missing art", it was "that logo
choice for my old team is interesting 🧐".

**Insight:** A placeholder that LOOKS like real art is worse than a visibly
empty one. The banner slot for that same era held
`historical-team-banner-placeholder.svg`, which announces itself; the icon slot
held a real crest belonging to a different team, which does not. Prefer the
obvious placeholder, or track down the real thing.

The real thing is usually still findable. MFL's `league.json` for each year
stores the era's `icon` URL, and the Wayback Machine has the retired
theleague.us / afl-fantasy.com art those URLs point at (note: `web.archive.org`
binaries need `https://` and the `if_` suffix in this sandbox — plain `http://`
is refused by egress policy, while `archive.org/wayback/available` works over
either). Here the recovered 2011 and 2015 snapshots turned out to be the SAME
artwork the team wears today at lower resolution — the identity never changed —
so the fix needed no new asset, just a pointer at the art already in `public/`.

**Evidence:** 0010's 2011-2015 history entry now points at
`history/midwestside_icon_circle.png` + `banners/midwestside.png` with the
era's real gold/black palette (`#bba329` / `#141312`) in place of the inherited
Warlocks purple. The duplicate PNG is deleted and `theleague.assets.json`
re-synced. `THROWBACK_ASSET_CONFLICTS` already excluded this era from the Jocks'
throwback picker, so pointing it at 0011's art does not let 0010 wear it — which
is also why an `eraLabel` on this entry would be dead config: its only consumer
(`throwback-settings.astro`) iterates the ELIGIBLE eras, and a conflicted one
never reaches it.

**Recommendation:** Before shipping a history entry, open its icon next to the
neighbouring era's. If they are the same picture, one of them is a placeholder.
Check the year's MFL feed for the original URL and the Wayback Machine for the
file before drawing something new.

## 2026-08-11 - Owner-scoping silently DELETES league history — awards need a season-keyed ledger too

**Context:** Auditing TheLeague's division titles against MFL's official
standings. The 8 miscredited titles were the expected finding; the surprise was
that 25 of 76 division-seasons had **no recorded winner at all**.

**Insight:** `franchises[].divisionTitles[]` is keyed by *current* franchise id,
and the whole `attributeYear` / `ownerHistory` / `currentOwnerSince` machinery
exists to keep career stats with the **human owner**, not the franchise slot.
That is correct for career records — the present Midwestside Connection owner
should not inherit a prior owner's wins. But applied to *awards* it means a
title won under a previous owner has nowhere to live and vanishes from the site
entirely: nobody's page shows it, and no per-season view can reconstruct it.

The trap is that this looks identical to "defunct franchise" from the outside.
It isn't — franchise ids in TheLeague are stable back to 2007 (0001 = Pacific
Pigskins in 2007, 2011, 2015, 2016), and every historical name resolves to a
current slot via `theleague.config.json`'s `history` array. LBer-DeCleaters is
today's Music City Mafia; Amish Rakefighters is slot 0011. Diagnosing this as
"those teams folded" leads to the wrong fix (inventing defunct-franchise
records) instead of the right one (a season-keyed ledger).

**Evidence:** `scripts/compute-franchise-history.mjs` now emits
`yearSummaries[].divisionWinners = [{ divisionId, divisionName, franchiseId,
name, sourceFranchiseId }]` — a complete 4-per-season record where
`franchiseId` is null when no current franchise can claim it and `name` retains
that season's MFL name. `franchises[].divisionTitles[]` is unchanged, so the
per-franchise counts the three consumer pages read keep working.
`tests/theleague-division-titles.test.ts` asserts the two agree wherever a
claimant exists and that the ledger is complete where one doesn't.

**Recommendation:** Any *award* this script starts tracking (MVP, Jerry Jones,
Brock Osweiler already have the same exposure) needs the season-keyed ledger in
addition to the franchise-keyed array, or it will quietly lose every pre-current-
owner instance. When a historical award count looks low, check
`attributeYear(sourceId, year) === null` before concluding the franchise is gone
— and prefer `yearSummaries` over `franchises` for any "who won X in year Y"
question.

**Confidence: High** — ledger verified complete at 76/76 division-seasons for
2007-2025, cross-checked against the raw feeds.

## 2026-07-04 - Franchise detail pages are owner-scoped; never link to #era- anchors blindly

**Context:** The Former Identities strip on `/theleague/franchises` linked every
identity to `/theleague/franchises/{id}#era-{yearStart}` — all 23 links were
dead-ends.

**Insight:** TheLeague detail pages ([id].astro) build eras from config history
and `ownerHistory`, then **filter out eras with zero seasons in the franchise's
`yearByYear`** (which covers only the current owner's tenure). Identities held
by prior owners of a slot have no anchor. Overlap heuristics don't work either:
ownerHistory-driven eras can have different `yearStart`s than the identity
groups (Amish Rakefighters 2007–2015 overlaps 0011's years, but the rendered
anchor is `era-2010`).

AFL detail pages are different: they render the slot's **complete** name
history — the owner's lineage AND a "Previous owners" list — so
`#name-history` links from the AFL index never dead-end.

**Evidence:** `src/utils/franchise-eras.ts` (shared era builder, extracted from
`src/pages/theleague/franchises/[id].astro`), PR #340.

**Recommendation:** Anything linking into a theleague franchise page era must
use `renderedEraStarts()` from `src/utils/franchise-eras.ts` to check the
anchor exists, and fall back to the Asset Library card
(`/theleague/assets#{slug}` — cards render `id={team.slug}` from
`theleague.assets.json`; match by `normalizeIdentity()` on the name minus its
trailing year parenthetical, former cards winning over active ones). Never
duplicate the era-building logic — the detail page and any linker must share
the utility or they will drift.

## 2026-07-04 - overflow-wrap: anywhere breaks flex-item names mid-word

**Context:** Porting the Former Identities strip (icon + name + years flex
rows) to AFL, where team names are much longer.

**Insight:** `overflow-wrap: anywhere` collapses the flex item's min-content
width to ~one character, so the name column shrinks and splits words
("Maga Natio n", "Deliriu m Tremens"). TheLeague never hit it because its
names are short.

**Recommendation:** In flex rows with `flex: 1; min-width: 0` text, use
`overflow-wrap: break-word` (only breaks genuinely overlong words) instead of
`anywhere`.

## 2026-08-15 - A franchise name is not a unique key — not across slots, not across eras

**Context:** Building former-name callbacks for Schefter ("Dead Cap Walking,
the former Heavy Chevy"). Needed to answer "what did this franchise used to be
called", which looks like a one-line read off `history[]` and is not.

**Insight:** `history[]` is an **appearance log, not a rename log**, and names
are not owned by franchises. Three distinct shapes live in the same array, and
only the first is a rename:

1. **Real renames** — `Heavy Chevy (2020-2025)` under `Dead Cap Walking`.
2. **Re-skins that repeat the CURRENT name** — `Pacific Pigskins (2007-2012)`
   AND `Pacific Pigskins (2013-2024)` under a team still called Pacific
   Pigskins. These rows exist to date icon/banner artwork eras, not names.
   Nearly every TheLeague franchise has at least one; Bring The Pain and Dark
   Magicians of Chaos are pure re-skin histories with no rename at all. Naive
   "most recent history entry" logic yields "the Pigskins, formerly the
   Pigskins."
3. **Names that MIGRATED between franchises** — `Midwestside Connection` is
   `0010`'s former name and **`0011`'s current one**. `Sabertooths` sits in
   both `0002`'s and `0013`'s history. `Maverick` and `Poker in the Rear`
   trade back and forth within `0003`.

Shape 3 is the dangerous one: a name→franchise lookup, a search index, or any
"formerly known as" copy resolves to a **live team that isn't the subject**,
and it looks completely plausible in output. Nothing in the config marks these
— the collision is only visible by cross-referencing every team's current name
forms and `aliases` against every other team's `history[]`.

**Recommendation:** Any feature reading `history[]` needs two filters before
it can treat an entry as a former name: drop entries matching the team's own
current name forms (shape 2), and drop entries matching any name or alias
currently in use league-wide (shape 3). `pickFormerName` in
`scripts/lib/schefter-former-name.mjs` is the reference implementation. Note
this is the same latent hazard behind the `inferCurrentOwnerSince` trap
documented in `afl-team-rename.md` — that one compares the last history name
to the current name and reads a mismatch as an ownership change, which shape 2
suppresses and shape 1 triggers.

## 2026-08-16 - Owner-scoping deletes GAMES too, and matchupHistory keys them in two id spaces

**Context:** Follow-on from the 2026-08-11 entry above, which established that
owner-scoping deletes *awards*. Building an AFL all-time record book surfaced
that it deletes *games* on the same mechanism, and that two further defects sit
on top of the ledger's matchup data.

**Three findings, in the order they bite:**

**1. `matchupHistory` is not a record of what happened — it is a record of what
the current owners did.** `recordMatchup` skips a game when
`attributeYear(id, year)` returns null, so games played under a slot's previous
owner never enter the ledger. For the AFL that is 1,158 of 5,333 games, and the
loss is not spread evenly: 63% of 2004, roughly half of 2005-2011, 0% of
2022-2025. Any league-wide aggregate built on it — biggest blowout, longest
streak, most-played rivalry — therefore means "since the current owners
arrived" while reading as "ever", and skews hard modern. That is why
`scripts/compute-record-book.mjs` walks the committed feeds directly instead.
Use the ledger for "what has THIS franchise done"; never for "what is the
league record".

**2. The same game is filed under two different id spaces, so a pair-keyed
dedup double-counts it.** A meeting is stored on the ATTRIBUTED current
franchise but names its opponent by that season's SOURCE slot. So Harambe's
2018 week-4 win is `0008 → 0021` from one side and `0021 → 0016` from the
other; keys `0008:0021` and `0016:0021` do not match. Deduping on the filed ids
put one game on a leaderboard twice, under two different franchise names.
Canonicalise on `sourceFranchiseId ?? holderId` and `opponentSourceId ??
opponentKey` — and note that merging both entries is the only way to learn who
each slot IS today, because each side names only itself.

**3. `weekly-results-raw.json` is a SECOND pairing source, and it wins.**
`compute-franchise-history.mjs` processes it before `schedule.json` and marks
`(week, franchiseA, franchiseB)` seen. That dedup key is the pairing, so when
the two feeds disagree about who played whom, both survive rather than one
overriding the other. Repairing `schedule.json` for the AFL's fabricated
2012-2015 seasons therefore left 173 phantom meetings in the rivalry records —
the league's hottest rivalry read 18-17 when it was 17-17. `schedule.json` now
wins for any week it covers. Confirmed a no-op for TheLeague first: 3,215 of its
weeklyRaw pairings sit inside schedule-covered weeks and every one agrees.

**Recommendation:** Before trusting any derived aggregate, ask which of the two
questions it answers — franchise-scoped or league-scoped — and check that its
source matches. And when repairing a feed, grep for every other feed that
carries the same facts: `schedule.json` and `weekly-results-raw.json` both hold
matchups, and fixing one is not fixing the data.

**Evidence:** `scripts/compute-record-book.mjs`, `src/utils/record-book.mjs`,
`tests/record-book.test.ts` (pins the committed book above 5,000 games so a
silent rebuild from the ledger fails), and the `scheduleCoveredWeeks` guard in
`compute-franchise-history.mjs`.

**Confidence: High** — the game-loss percentages are measured per season against
the feeds, and every stored AFL season replays to MFL's own standings
(`tests/afl-schedule-integrity.test.ts`).
