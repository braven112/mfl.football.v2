# Franchise History Pages — Insights

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
