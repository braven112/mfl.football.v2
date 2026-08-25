# Franchise History Pages — Insights

## 2026-08-25 - Slot-change inference splits ONE owner into two, and a name is what makes it visible

**Context:** `/owners` shipped with 85 tenures MFL had no name for. Filling
them in by hand turned up something the derivation could not have flagged on
its own: thirteen of those "people" were one owner recorded twice. Tom
Flanagan renamed NOSX to Brady's Bastards in 2009 and became two strangers,
one of them holding the 2012 title. Shane Fitch became Level 3 Inception and
lost eight seasons and a ring to his own alter ego. Jomar's Computer Jocks
moved from AFL slot 0018 to 0005 in 2015. Jesse Schuffenhauer played 2003-04,
left, came back in 2023 and was greeted as a new arrival.

**Insight:** ownership is inferred from a franchise SLOT changing hands, so
two events are indistinguishable from a handover and both produce a false
split:

- **a rename in place** — same slot, same person, new team name;
- **a slot move** — same person, same team name, different slot, which the
  league does whenever it restructures divisions.

Neither is rare. Thirteen splits across 128 owner records is ten percent of
the board, and every one of them silently halved somebody's career.

**Why it stayed invisible:** an anonymous owner is rendered by team name, and
two records reading "Blitzkrieg" and "Blitzkrieg" look like two teams that
happened to share a name. It is only when a human puts the SAME PERSON'S NAME
on both that the duplicate becomes obvious. The data was wrong the whole time;
the names are what made it legible. Expect the same class of bug anywhere an
entity is identified by a slot rather than by a person.

**What to do about it:**

- **Exact team-name matches across two owner records are a merge candidate,
  not a coincidence — but it is a CANDIDATE, not proof (see the Baccam
  correction below).** Five of the thirteen were found by normalizing identity
  names and looking for collisions. `tests/owner-tenures-data.test.ts` now runs
  that scan on every build: two owner records sharing a team name fail the
  suite, with an allowlist for the genuine cases (co-owners of one shared team
  are excluded structurally, via `coOwners`, so a new shared team needs no
  entry).
- **Merge into the EARLIER record.** Owner slugs are `<team>-<firstYear>`, so
  the earlier slug stays correct for the merged span. The later slug goes into
  `previousSlugs`, and `resolveOwnerDetail` redirects from it
  (`src/utils/owner-detail.ts`), so no published URL breaks.
- **Seasons must not move.** A merge relocates franchise-seasons between
  HOLDINGS; it never creates or destroys one. TheLeague held at 320 and the
  AFL at 576 across all thirteen — the conservation assertion in
  `tests/owner-tenures-data.test.ts` is what proves it, and the owner-count
  fixture beside it has to be updated by hand each time.
- **Cross-league is NOT a merge.** Five people own teams in both leagues. The
  repo models that as one registry person PER LEAGUE sharing a `displayName`
  (Jomar is the original precedent), because merging would put one league's
  team name in the other league's owner URL. Watch for spelling drift across
  the two — MFL let Jim Shea enter himself as "James Shea" in one of them, and
  two spellings render as two people.

**Regenerating beats rebasing.** Twenty-seven commits of regenerated
`owner-tenures.json` conflict on the first rebase hop. `owners-registry.json`
is the source of truth and the derived files are a build artifact: reset the
branch to `main`, replay the registry, re-run
`scripts/compute-owner-tenures.mjs`, commit once. Same end state, no
hand-merging of machine-written JSON.

## 2026-08-25 - A shared team name is a merge CANDIDATE, and MFL's owner name is not proof

**Context:** the guard test from the entry above earned its keep within the
hour, and then immediately showed why its finding needs a human. It flagged two
AFL records sharing "Avenging Amish" on slot 0007 — Team Murderface / Avenging
Amish (2014-2020) and Avenging Amish (2021-present). Both carried the SAME
name, `Danny Baccam`, straight from `mfl:league-export`. Contiguous years, one
slot, one name from the source of record: I merged them.

Brandon then said Team Murderface is **Garrison Bravo**. The 2014 season was a
real handover — Bravo held the slot for one year, Baccam took it in 2015 and
renamed it — and the merge had swallowed it. Split back out; #615 had already
shipped the wrong version, so it was fixed forward.

**Insight:** MFL's owner name on a historical franchise-season is NOT evidence
of who owned it. The export reports the name attached to the franchise record,
and a handover overwrites that name backwards across years the previous owner
played. So two adjacent records agreeing on a name is exactly what a handover
looks like too — the agreement is an artifact of the same overwrite that lost
the old owner's name in the first place.

That inverts what the collision means. A shared team name says *look here*; it
does not say *merge*. What actually separates the two cases is only knowable
from outside the data:

- **a rename** — one person, and the team name changed because they wanted it
  to;
- **a handover** — two people, and the incoming owner renamed the team on
  arrival, which is the normal thing to do.

Both produce identical rows. Nothing in MFL distinguishes them.

**So: never merge on the guard test's say-so alone.** Take the collision to
somebody who was in the league. Where nobody remembers, leave the records
split — two half-careers are a smaller lie than one career credited to the
wrong person, and the split is reversible while a merge that shipped is not.
The weak signal, for what it is worth: slot 0007's abbrev stayed `FACE` from
2014 into 2015 and only became `AMSH` in 2016, which reads like continuity and
was in fact a new owner who had not gotten around to it.

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

**Recommendation:** ~~fall back to the Asset Library card~~ **SUPERSEDED
2026-08-25 — the destination is now the owner page.** The diagnosis above still
holds exactly (a prior-owner identity can never have an anchor, so re-keying
the map fixes nothing), but the Asset Library was a consolation prize: it shows
the art, not the seasons. `/owners` now holds those seasons, so the resolution
order is `ownerSlugForIdentity()` (`src/utils/owner-links.ts`) → the era anchor
via `renderedEraStarts()` → the Asset Library. That took TheLeague from 0 of 23
resolving to 23 of 23, and the AFL from 95 blanket `#name-history` links to 95
owner pages. Still never duplicate the era-building logic — the detail page and
any linker must share the utility or they will drift.

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


## 2026-08-25 - A derived field nothing reads is a field that is silently wrong

**Context:** PR 2 of the owners feature replaced the AFL franchise page's
config-driven "Previous owners" list with a component reading
`owner-tenures.json`. The six last-place rebrands the AFL page had always
tagged with 💀 disappeared. The derived file's `identity.punitive` was `false`
for all 141 owners in both leagues, and `identity.rebrandGroup` `null` for
every one.

**Insight:** `buildTenuresFromRows` assembles identities from LEDGER ROWS,
which carry a name, icon and banner but no `rebrand` — so it hardcoded
`rebrandGroup: null, punitive: false`. That shipped in PR 1 and nothing caught
it for a simple reason: **no consumer read either field.** The owner pages
render names, records and trophies; the schema declared the fields; the
conservation tests checked season coverage. A field can be present, typed,
documented, and wrong indefinitely, because a test suite that never reads it
is not testing it. It only surfaced when a page switched its source from the
config to the derived file — which is exactly when a silent gap becomes a
visible regression.

The corollary bit too. Swapping the AFL's list was verified as a "strict
superset" by checking that every NAME the old list rendered still appeared —
which it did. Names were the primary key, and the check passed while an
attribute attached to those names vanished. **Superset verification over
identity keys says nothing about the attributes hanging off them.**

**Recommendation:** When a derived file gains a field, give it a test that
compares it against the SOURCE, not just a shape assertion — here,
`tests/owner-tenures-data.test.ts`'s `REBRANDS` case diffs the config's
punitive entries against the derived identities, and fails when the hardcoded
nulls are restored. And when replacing one rendering source with another,
diff the rendered ATTRIBUTES (tags, badges, flags), not only the row labels:
compare the two pages' output, not the two data structures' keys.

**Evidence:** `src/utils/owner-tenures.mjs` (`rebrandsByName` / `rebrandFor`,
matched by normalized name and year overlap across ALL teams, since a punitive
rebrand can follow an owner onto a different franchise id — which is what
`rebrandGroup` exists to express), and the `REBRANDS` assertion in
`tests/owner-tenures-data.test.ts`.

**Confidence: High** — all six config rebrands verified back in the derived
file with counts unchanged, rendered on their franchise pages (two through the
prior-owner path, four through the untouched name-history path for owners still
holding their slot), and the guard mutation-checked.


## 2026-08-25 - Folding a name run keeps the first row's artwork forever

**Context:** Every current owner's card on `/owners` showed a logo their team
had retired years ago — Da Dangsters as the 2017 wizard, Midwestside as the
old photo circle, the Ninjas as the 2016 sombrero. The ledger was right: rows
2015-2024 carry `history/da_dangsters_2017_icon_circle.png` and rows 2025-2026
carry `icons/da_dangsters.png`. The page never saw the newer one.

**Insight:** `buildTenuresFromRows` groups consecutive same-name seasons into
one identity run. Creating a run copies the row's `icon`/`banner`; folding a
later row into it only extended `yearEnd` and `years`. The grouping key is the
NAME, but artwork is not a function of the name — **a team can restyle without
renaming**, and TheLeague's config makes that the normal case: `history[]`
holds the retired art (`Da Dangsters, 2015-2024`) while the live art lives on
`team.icon`, so the same name spans both. Eight of TheLeague's seventeen
current owners were affected; the AFL had zero, because its config keys icons
by name and never restyles under one. A bug can be structural and still show
up in exactly one league.

`makeIconResolver` did not save it either: the resolver's by-name map does
prefer `team.icon` (the current art) over `history[]`, but it is only consulted
when the identity's own icon is unusable. A *stale but valid local path* is the
worst input here — it looks healthy and wins.

**Recommendation:** When collapsing rows into a run, ask which fields are
constant across the run and which vary with time. Constant-by-construction
(the name, the franchise slot) can come from any row; anything else needs a
rule. For artwork the rule is newest-wins — the run's most recent year is what
the identity looks like today. Note this is the second bug in this exact loop
(see the `punitive`/`rebrandGroup` entry above): identities assembled from
ledger rows keep losing attributes that the rows actually carry. Treat every
new field on an identity as guilty until a test compares it against the source.

**Evidence:** `src/utils/owner-tenures.mjs` (`buildTenuresFromRows`, the fold
branch), guarded by `buildOwnerTenures identity artwork` in
`tests/owner-tenure-derivation.test.ts` — newest wins, a newer year with no
icon does not blank the run, and artwork never leaks across a rename.

**The same symptom had a second, unrelated cause — in the other league.**
Fixing the fold made all 17 of TheLeague's current owners match their config
`team.icon` exactly, and left three AFL owners still on retired art. Those come
from `dominantIdentity`, which picks the identity a tenure is NAMED for by
season count: AFL 0012 spent ten years as "Pubes" and the last eight as "Suh
girls, one cup", and 0016's two names tie at two seasons each so the tie-break
(*earliest* start) chose the older one deliberately. That function is right for
a title and wrong for a face — the owner card answers "what does this team look
like today". `finalizeOwner` now takes the newest non-punitive identity of the
slot an owner holds TODAY, and falls back to dominant for former owners, whose
era is over. The punitive skip is what keeps AFL 0014's card on Thundering Herd
instead of the 2026 last-place rename.

Two things generalize. First, **"all N of league A are now correct" is not
evidence about league B** — the leagues' configs express the same idea
differently (TheLeague restyles under one name; the AFL renames), so one defect
surfaces through two mechanisms and a fix to one mechanism looks complete.
Verify the invariant per league, against the config, rather than inspecting the
diff. Second, `dominantName` and `icon` on an owner now describe different
identities on purpose; that was only safe to do because nothing outside
`src/types/owner-tenures.ts` reads `dominantName`.

**Confidence: High** — all 8 changed TheLeague owners and both changed AFL
owners verified against the config's live `team.icon`; every current owner in
both leagues now matches it except AFL 0014, whose punitive exemption is
asserted by test; no former owner's icon moved; 41 images on TheLeague's page
and 107 on the AFL's all return 200.
## 2026-08-25 - An owner's `title` is a lookup key, not a name — never render it

**Context:** The Strength of Division report groups rows by owner and labelled
each row with `owner.title`. The AFL South rendered `Vit's Brother / Avenging
Amish / Broke Back 'lil Half Dead's Brother` — 68 characters over three lines.

**Insight:** `title` in `owner-tenures.json` is **every identity that owner has
worn, slash-joined** (`docs/plans/owners-feature.md:188` says so, but nothing
warns the consumer). It exists so an owner is findable under any name they used;
it is not a name anyone has ever gone by. 12 owner rows across the two leagues
carried a joined title, so any surface that labels by owner hits this.

The label is `identities[]` reduced to the highest `yearEnd` — and **"latest"
must be scoped to that OWNER's tenure, never the franchise's.** AFL franchise
`0004` has had NINE different owners; a franchise-wide "current name" stamps a
stranger's team onto someone else's seasons. Same trap as the era-anchor and
name-as-key entries above: the franchise outlives the people in it.

Two second-order consequences, both measured rather than assumed:

- **Labelling by team makes an adjacent owner column redundant.** Once the label
  IS the team name, a separate owner column repeated column one on 38 of 41
  rows; the 3 that differed were short-vs-long forms of one name, not renames.
  Dropped it and moved the `/owners/` link onto the team name itself.
- **The same rule is a REGRESSION on per-season rows.** Applying latest-name
  there would relabel ~59 rows, nearly all `"Midwestside"` → `"Midwestside
  Connection"` — the season row already resolved that season's name correctly,
  and lengthening it fights the mobile layout and disagrees with
  `/standings?year=`. Latest-name is for labels that span YEARS, nothing else.

**Recommendation:** Grouping key and display label are different fields; if the
"name" on a record is derived by joining history, it is a key. Convert every
label site at once and add a **source-scan guard test** — converting six sites
here left a seventh (`Built by N owners · …`) that a scan for `o.title` caught
still printing the joined string on the AFL's North panel. Label sites get added
after a sweep, so the guard is the only thing that holds.
