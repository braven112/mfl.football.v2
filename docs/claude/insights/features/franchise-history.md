# Franchise History Pages — Insights

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
