# Owners as a first-class concept

> **Status:** **PR 1 shipped** (Aug 2026). PRs 2-4 still to build — see
> Phasing. Written August 2026 in the session that fixed Midwestside's 2010
> attribution (PR #597), which is what surfaced the gap. Everything here was
> measured against real data in this repo — a future session should not need to
> re-derive any of it.
>
> **What PR 1 landed**, all numbers confirmed against real data on first run:
> `season-ledger.json` (320 rows / 110 orphaned; 576 / 230),
> `owner-tenures.json` (TheLeague 16 current + 22 former = 38; AFL 24 + 78 =
> 102), `src/data/owners-registry.json` (140 people, every `displayName` null),
> the shared `EraSeasonTable`, four routes, and five guard suites — full suite
> 252 files / 6300 tests.
>
> **Two things a follow-up session should know:**
> - The **"Not verified" risk at the bottom of this doc is resolved.** Apex
>   rewrites do handle these routes: `resolveLeagueRewrite` maps
>   `theleague.us/owners` and `afl-fantasy.com/owners/<slug>` onto the league
>   routes, and `resolveLeaguePath` strips the prefix for apex-host links.
> - **A complete registry bypasses inference entirely.** The seeder claims
>   every season, so claims alone satisfy conservation and the inference path —
>   the code that handles a new orphan the day an owner leaves — is not
>   exercised by the derived file. `tests/owner-tenures-data.test.ts`
>   therefore re-derives with `registry: null` and asserts conservation again.
>   Keep that test if you touch the overlay.

## Start here

**Branch:** `claude/owners-feature-phase-1` off latest `main`.

**Read first, in order:** this doc → `CLAUDE.md` → the four "Traps" below.
Then `scripts/compute-franchise-history.mjs:229-301` (the boundary rule) and
`src/utils/franchise-eras.ts` (the reuse targets).

**Kickoff prompt:**

> Read `docs/plans/owners-feature.md` and implement PR 1. The research is done —
> do not re-derive the numbers, they are measured and in the doc. Ask before
> deviating from the four locked decisions.

**Do not re-litigate:** the four decisions under "Locked decisions" were made by
the user in the planning session.

## Why

Franchise pages are **owner-scoped**: `attributeYear()`
(`scripts/compute-franchise-history.mjs:277-301`) returns `null` for any season
belonging to a previous owner, so those seasons disappear from the site
entirely. The scoping is correct — Midwestside's owner should not inherit the
Witch City Warlocks' record, which is the bug PR #597 fixed — but it has no
destination for the years it drops.

| | franchise-seasons | orphaned | identities | since |
|---|---|---|---|---|
| TheLeague | 320 | **110 (34%)** | 24 | 2007 |
| AFL | 576 | **230 (40%)** | 77 | 2003 |

Inside TheLeague's 110 sit **7 league championships** (2009, 2011, 2012, 2013,
2015, 2016, 2018) and **25 division titles** that appear on no page. The
Warlocks went 12-6, 15-3, 9-9 and won the 2007 Atlantic before the 2-16
collapse; none of it is visible anywhere. The AFL adds 7 more titles and 48 more
division titles.

**Outcome:** every owner tenure — current and former, in every league — becomes
an addressable page with its own record, seasons, trophies and identities worn.
Per-franchise history keeps working exactly as it does today.

## Locked decisions

1. **Per-league pages, cross-linked.** Each league gets its own `/owners`
   section and derived file. A league-neutral registry knows one person is one
   person, so tenures cross-link between leagues.
2. **Every owner gets a page**, current and former. "Former" is a state.
3. **Ship anonymous; names land later.** Owner names exist nowhere in this repo
   — verified: MFL `league.json` carries no owner field in any of 44
   league-years; the `option07.json` scrape yields ~13 TheLeague names and its
   AFL copies for 2012-2024 are byte-identical duplicates of TheLeague's (a
   trap — they point at `L=13522`); `GROUPME_FRANCHISE_MAP`
   (`src/utils/groupme-storage.ts:294-317`) has 15 first names in *code
   comments*, current owners only, one stale. Pages title themselves by the
   identities worn.
4. **Default split = on identity change, merging known rebrands.**

## Traps

1. **`yearSummaries` trophies are RAW MFL ids, not attributed.** `champion`,
   `runnerUp`, `thirdPlace`, `mvpFranchise`, `jerryJonesFranchise`,
   `brockOsweilerFranchise` are written straight from the bracket/award parse
   (`compute-franchise-history.mjs:1378-1386`); only `divisionWinners[]` runs
   through `attributeYear` (`:1400`), and it already carries
   `sourceFranchiseId`. **So all 7+25 orphaned trophies are recoverable from the
   file on disk today — no pipeline change.** Do not "fix" this.
2. **The orphaned SEASONS are not on disk anywhere.** `:915`
   (`if (!targetId) continue`) drops them before writing. Emitting a flat
   unattributed ledger is the one genuine prerequisite edit.
3. **Five parallel copies of the boundary rule exist, and two already
   disagree.** `compute-franchise-history.mjs:265` walks back on
   `sameName || sameEra`; `src/utils/afl-awards.ts:198` walks back on **name
   only** — no `ownerEra` clause. They agree today only because `ownerEra`
   exists solely on TheLeague `0003` and `afl-awards.ts` never reads TheLeague's
   config. Adding `ownerEra` to any AFL team silently forks stat attribution
   from display. The others: `franchise-eras.ts:172-194`, `team-names.ts:325`,
   and page-local logic in `afl-fantasy/franchises/[id].astro:217-300`.
4. **Astro scoped CSS never reaches a child component.** The era-table rules
   live in the franchise page's own `<style>`; moving the markup without the CSS
   ships an unstyled table. See `docs/claude/rules/theming-and-assets.md`.

## Data model

### Registry — `src/data/owners-registry.json` (new, hand-edited, league-neutral)

`src/data/` beside `page-directory.json` — the home for hand-edited config that
is cross-league and imported by both Astro and node scripts. League-neutral
because a person is one person; this is the only place that knows so.

**Claims are authoritative where they cover; inference fills the rest.** The
seeder writes a complete file so it reads as a full ledger and is pleasant to
edit, but a new season or `history[]` entry flows in automatically.

```jsonc
{
  "version": 1,
  "people": [
    {
      "id": "own-0006",                       // opaque, sequence-assigned, never regenerated
      "slug": "witch-city-warlocks-2007",     // URL segment; FROZEN at seed time
      "previousSlugs": [],                    // old slugs 301 to the current one
      "displayName": null,                    // add a name later — nothing else changes
      "claims": [
        { "league": "theleague", "franchiseId": "0010", "yearStart": 2007, "yearEnd": 2010 }
      ],
      "seededFrom": "inferred:identity-split@2026-08-23",
      "notes": null
    }
  ]
}
```

`id` is deliberately meaningless so merging, splitting, or naming can never
invalidate it, and it is globally unique by construction — cross-league
collision is impossible. `slug` is seeded as `kebab(dominantIdentity)-firstYear`
(`cska-sofia-2016` vs `cska-sofia-2017` genuinely collide on name alone) and
frozen thereafter; a nicer URL later means setting `slug` and pushing the old
value into `previousSlugs`, which the route resolves and redirects.
`yearEnd: 9999` is open-ended, matching the existing `ownerHistory` convention.

**Every override is expressible as claims.** Merge two inferred tenures → one
person, two claims. Split one → two people claiming sub-ranges. Same person on
slot X 2007-2010 and slot Y 2016-2018 → one person, two claims. Cross-league →
claims in both leagues. This is `ownerHistory` generalized, and unlike
`ownerHistory` it works for people **no longer in the league** — which is why
config alone cannot express it.

### New intermediate — `data/<league>/derived/season-ledger.json`

A flat, **unattributed** row per franchise-season: year, franchiseId,
era-correct name/icon, W-L-T, PF, rank, division, `wonDivision`,
`playoffResult`, `attributedTo` (nullable).

The edit to `compute-franchise-history.mjs:914-948` is surgical: hoist the
row-payload construction above `if (!targetId) continue`, always push to
`ledgerRows`, keep `fr.yearByYear.push(...)` behind the existing guard.
`playoffResult` / `wonDivision` / `seasonNotStarted` are already computed from
the **raw** `row.franchiseId` (`:936-947`), so orphan rows are correct with no
extra work, and `franchise-history.json` comes out byte-identical.

Doing it here rather than in a second script avoids duplicating the
standings/bracket/division parsing — the guaranteed source of future drift.

### Generated — `data/<league>/derived/owner-tenures.json` (committed)

Per owner: `ownerId`, `slug`, `displayName`, `title` (= `displayName ??`
identities joined), `isCurrent`, `source` (`registry | inferred`),
`identities[]` (name, years, icon, banner, `rebrandGroup`, `punitive`,
`inferredFromFeed`), `tenures[]` (one per franchise slot, each with `seasons[]`),
`totals` (record, PF, playoff appearances, championships, runnerUps,
divisionTitles, awards), `currentFranchiseId` (null if gone), `slotSuccession`
(predecessor/successor slugs per slot), `crossLeague[]`.

Plus two indexes so consumers never scan `owners[]`:
`bySlot: { "0010": [slug, …] }` and
`identityIndex: { "witch city warlocks|2007": slug }` — keyed exactly as
`buildHistoricalIdentities()` (`src/utils/franchise-eras.ts:270`) already
returns, making the Former Identities fix a one-line lookup.

**Must be committed**, like `franchise-history.json`: wrappers use static
imports and `prebuild.mjs`'s `run()` is non-fatal, so a missing file fails the
build.

## Derivation — `src/utils/owner-tenures.mjs`

`.mjs` so `scripts/*.mjs` and `.astro` both import it (established pattern:
`division-aliases.mjs`, `rivalry-intensity.mjs`), with
`src/types/owner-tenures.ts` for the interfaces.

**Reuse, don't reimplement:** `normalizeIdentity` (`franchise-eras.ts:62`),
`HISTORICAL_TEAM_ICON_FALLBACK` / `..._BANNER_FALLBACK` (`team-names.ts:10-11`),
`getLeagueBySlug` / `LEAGUES` (`leagues-data.mjs`), `getCurrentSeasonYear()`.

1. **Current-owner tenures.** Port `inferCurrentOwnerSince()`
   (`compute-franchise-history.mjs:229-272`) verbatim — the version **with** the
   `sameEra` clause. This makes the new `attributeSeason()` definitionally equal
   to `attributeYear`, which the parity test then pins.
2. **Orphan pool** = all ledger rows − current claims (110 / 230, verified).
3. **Identity segmentation** over the orphan pool. Per slot, group *adjacent*
   `history[]` entries when any holds:
   - same `ownerEra` → collapses TheLeague `0003`'s Poker in the Rear /
     Generals / Poker in the Rear into one 2012-2015 tenure;
   - same `normalizeIdentity(name)`;
   - same `rebrand.group`;
   - **either entry is punitive AND the two are year-adjacent**
     (`b.yearStart === a.yearEnd + 1`) — a last-place rename is transparent and
     bridges on both sides. This merges AFL `0016`'s *Be Gentle! 2019 / Be
     Rough! 2020 / Be Gentle. 2021*, where only 2020 carries the group tag.
     **The year-adjacency clause is load-bearing:** without it AFL `0007`'s 2014
     entry wrongly bridges a six-year gap to its 2021 punitive entry.
4. **Gap fill.** A played year with no covering `history[]` entry extends the
   preceding group and takes its **name from
   `data/<league>/mfl-feeds/<year>/league.json`** — accurate in both leagues for
   every covered year, and the only way to get "Avenging Amish" for AFL `0007`
   2015-2020. Mark `inferredFromFeed: true` so the UI can soften it and a human
   knows where to look. TheLeague has zero gaps; the AFL has four slots (`0002`
   and `0010` have no `history` at all — never rebranded — plus partial gaps on
   `0007` and `0023`).
5. **Registry overlay.** A claimed `(league, slot, year)` leaves both pools and
   goes to that person; remaining inferred tenures become auto-people. A doubly
   claimed season is a hard error, not silent last-wins.
6. **Aggregation.** Records from the ledger; championships / runner-ups /
   individual awards straight from `yearSummaries` raw ids; division titles from
   `divisionWinners[].sourceFranchiseId`. **Resolve icons at compute time** —
   many config `history[].icon` values are dead `theleague.us` URLs, which is why
   `[id].astro:48-54` has `resolveRowIcon`; doing the repair once in the script
   removes page logic and makes it testable.

**Verified output:** TheLeague 16 current + 22 former = **38**; AFL 24 current +
78 former = **~102**. Spot-checks: `0004` splits into four tenures (Las Vegas
Elite 2007-2017 / Art of War 2018 / Drunk Indians 2019 / Heavy Chevy 2020-2025);
`0010` yields Witch City Warlocks 2007-2010; AFL `0004`'s 2005-2007 Muck
Juggling Micks correctly does *not* appear, because `0013`'s `ownerHistory`
claims it.

No test can check whether two adjacent identities were really the same person.
That is what the registry is for.

## Pages

```
src/components/shared/owners/OwnersIndexPage.astro
src/components/shared/owners/OwnerDetailPage.astro
src/components/shared/franchises/EraSeasonTable.astro   # extracted, shared
src/utils/owner-detail.ts                               # {redirectTo} | {owner, …}
src/pages/{theleague,afl-fantasy}/owners/index.astro    # ~10-line wrappers
src/pages/{theleague,afl-fantasy}/owners/[slug].astro
```

Wrappers own `prerender = false`, the static JSON import (specifiers can't be
runtime variables), the redirect, and the title. **No `getStaticPaths`** — both
existing `franchises/[id].astro` routes are pure SSR, and
`tests/nav-drawer-links.test.ts:50-66` fails the build on a prerendered
nav-reachable page. `Astro.redirect()` from a component renders a blank 200
(`CLAUDE.md`, "Astro.redirect() only redirects from a PAGE"), so
`owner-detail.ts` mirrors `whats-new-detail.ts`: it returns `{redirectTo}` or the
owner and the **wrapper** redirects. Hrefs use the `r()` helper
(`WhatsNewDetailPage.astro:47-59`).

**`/owners`** — current owners as cards reusing the `.franchise-card` /
`.stats` / `.badges` language from `franchises/index.astro:130-190`; former
owners as a **dense sortable table**, because the AFL has ~78 and a card grid
there is unreadable (Identity · Slot · Years · Seasons · Record · 🏆 · 🛡,
default sort seasons-desc so one-season cameos sink, client-side filter). Above
it, a **"Champions you've never seen"** callout promoting the 7 title-winning
former owners — the highest-value thing on the page. Lede counts come from the
file so they never go stale.

**`/owners/[slug]`** — hero (identity lockup, `displayName ?? identity`, years ·
league · slot, a `Current`/`Former owner` pill, a dim note when unnamed);
cross-league strip; career totals `<dl>`; trophy chips reusing `.era-award`
(`[id].astro:764-771`); one `<EraSeasonTable>` per tenure; succession footer
("Franchise 0010 today: Computer Jocks →", previous/next owner of this slot).

**The `EraSeasonTable` extraction must move the scoped CSS with the markup**
(trap 4) — `.era`, `.year-by-year`, `.row-icon`, `.era-award`, etc. Do it as one
isolated, reviewable refactor commit. Copying the markup into an owners-only
component instead would recreate the parallel-implementation problem this
feature exists to reduce.

### Franchise pages keep working, and gain links

Era construction, `priorOwnerEras`, `relatedRebrands`, `claimedBy`,
`buildFranchiseEras` and `yearByYear` filtering are **untouched** — franchise
pages keep showing the former identities of that slot exactly as today. Purely
additive:

- TheLeague's `franchises/[id].astro` gains a **"Previous owners of this
  franchise"** section (the AFL has one at `:816-830`) listing `bySlot[id]` with
  records and links. That alone makes the 110 orphaned seasons reachable from
  the page they belong to, and closes a two-league drift.
- The AFL's existing list becomes links with records attached.

### The Former Identities strip — fixed here

`franchises/index.astro:96-105` keys the anchor map on the identity's *source*
slot, so **0 of 23** links resolve to an era anchor (measured); all fall through
to the asset library. Re-keying does not fix it: franchise pages filter eras to
those with attributed seasons (`[id].astro:706`), so a prior-owner identity can
never have an anchor. **The owner page is the correct destination.** New ordered
lookup:

1. `identityIndex[normalize(name) + "|" + yearStart]` → `/owners/<slug>` *(new;
   resolves prior-owner identities)*
2. existing era anchor → `#era-<yearStart>` *(unchanged; an owner's own rebrand
   stays on their franchise page)*
3. asset-library slug *(unchanged fallback)*

Same for `afl-fantasy/franchises/index.astro:277`.

## Phasing

**PR 1 — "The missing 340 seasons."** Season-ledger emission (+ byte-identity
guard on `franchise-history.json`); `owner-tenures.mjs` + types;
`scripts/seed-owners-registry.mjs` (one-shot, `--dry-run` default, never
rewrites an existing slug) and the committed registry it produces, all
`displayName: null`; `scripts/compute-owner-tenures.mjs` on the
`compute-schedule-strength.mjs` shape (enumerate `Object.keys(LEAGUES)`,
`--league=` optional with the `afl` alias, paths from `LEAGUE.dataPath`, skip any
league lacking `franchise-history.json` — which silently covers best-ball-1),
wired into `prebuild.mjs` **PARALLEL** (pure local compute; PARALLEL starts after
SEQUENTIAL, where franchise-history runs, so the dependency holds); the
`EraSeasonTable` extraction; both shared components; four wrappers;
`page-directory.json` entries (`owners` bare `/owners`, `afl-owners` prefixed,
`category: "reports"`, `subcategory: "league-history"`, ≥10 tags, a real sprite
icon). Ships complete and searchable.

Deliberately **no nav yet** — `tests/nav-drawer-links.test.ts` only constrains
pages once they're in `nav-config.json`, so this PR cannot break nav.

**PR 2 — "Discoverable and connected."** Nav link + `routeEquivalence["/owners"]`;
`footer-config.ts` (`owners` into TheLeague's `Record Book`, `afl-owners` into
the AFL's); `whats-new.json` entry + light/dark webp pair (**ask about
`excludeFromHero`**); franchise ⇄ owner cross-links; the Former Identities fix.

**PR 3 — "One boundary, one implementation."** Migrate
`compute-franchise-history.mjs`, `afl-awards.ts`, `franchise-eras.ts`, and
`afl-fantasy/franchises/[id].astro:217-300` onto `owner-tenures.mjs`, resolving
the `ownerEra` divergence (trap 3). Flip the parity test from advisory to
required. Zero user-visible change; snapshot both franchise pages before/after.

**PR 4 — "Names."** *(source found — see below.)* Add `sourceFranchiseId` to `compute-afl-awards.mjs` (~`:505`
writes `{franchiseId: null, name, source}` with no source slot — the one genuine
producer-side gap; the merge logic near `:603` preserves existing fields, so
verify against a full re-derive) and light up AFL award badges. Then populate
`displayName`s — a pure data edit. Optionally fold in the 15 names from
`groupme-storage.ts:294-317`, making the registry the single source of truth.

**The names have a real source.** Locked decision 3 said owner names exist
nowhere in this repo, and that is still true of what is COMMITTED — a
structured walk of all 44 `league.json` files finds zero owner/email/username
fields, because they were fetched unauthenticated. But MFL's `league` export
returns owner names to a request carrying a COMMISSIONER cookie. Since each
MFL league-year is its own league, a year-by-year authenticated sweep can name
FORMER owners too, not just the 40 current ones — which is most of the 140.

`scripts/fetch-owner-names.mjs` (added in PR 1, wired into nothing) does this:
`MFL_USERNAME`/`MFL_PASSWORD` or `MFL_COOKIE`, `--dry-run` by default. Three
rules it enforces, all covered by `tests/fetch-owner-names.test.ts`:
- **Names only.** The same response carries email addresses. Fields are a
  whitelist, and `assertNoContactInfo` throws if anything email- or URL-shaped
  reaches the registry. Never widen this to a blacklist.
- **A name a human set is never overwritten.**
- **A tenure MFL reports two owners for is left alone**, and reported with a
  season count per name. That is a tenure that should be SPLIT; naming it after
  whichever appeared more would bury exactly the boundary the registry exists
  to record.

## Guard tests

- **`tests/owner-tenures-data.test.ts`** — iterates `ALL_LEAGUES`, skipping any
  without the derived file (bb1 excluded structurally, not special-cased).
  **Conservation:** the multiset of `(franchiseId, year)` across all owners
  equals the ledger row set exactly — nothing lost, nothing double-counted.
  *This is the test that would have caught the original bug.* Plus: no season
  under two owners; exactly one `isCurrent` owner per live slot; every
  `yearSummaries` champion/runnerUp/thirdPlace and every
  `divisionWinners[].sourceFranchiseId` lands on exactly one owner (pinning 7+25
  TheLeague, 7+48 AFL); slugs unique **across both leagues' files combined**;
  every icon path exists under `public/` or is the documented fallback;
  `bySlot`/`identityIndex` consistent with `owners[]`.
- **`tests/owners-registry.test.ts`** — unique ids and slugs; no `previousSlug`
  shadowing a live slug; every `league` a real registry key and every
  `franchiseId` real in that league's config (via `configPath`, never a
  literal); `yearStart <= yearEnd`; no overlapping claims within or across
  people; `displayName` null or non-empty trimmed.
- **`tests/owner-tenure-derivation.test.ts`** — unit tests on inline fixtures
  (the `tests/franchise-history.test.ts` convention): `0004` → four tenures;
  `0003`'s `ownerEra` collapse; AFL `0016`'s punitive bridge; a punitive entry
  across a multi-year gap does **not** bridge; `ownerHistory` cross-slot;
  gap-fill naming from the feed; each registry override kind.
- **`tests/owner-boundary-parity.test.ts`** — the anti-drift test that makes PR 3
  safe. For every `(franchiseId, year)` in both leagues, assert
  `attributeSeason()` agrees with `attributeYear`, `attributeAwardYear`,
  `getCurrentOwnerSince`, and `renderedEraStarts`. Pin **current** behavior with
  a comment naming the `ownerEra` divergence; tighten in PR 3.
- **`tests/season-ledger.test.ts`** — row count equals summed standings lengths;
  every row with a non-null `attributedTo` is field-for-field identical to that
  franchise's `yearByYear` entry. The proof the refactor changed nothing.
- Free: `page-directory-data`, `nav-drawer-links`, `footer-links`,
  `league-literal-guard`, `whats-new-data`, `leagues-registry`.

## Verification

1. `pnpm compute:franchise-history && pnpm compute:owner-tenures`, then confirm
   `git diff` shows **no change** to either `franchise-history.json`.
2. Spot-check `data/theleague/derived/owner-tenures.json`: the Warlocks tenure is
   2007-2010, **38-34**, one division title (2007), one MVP (2007), two Jerry
   Jones (2009, 2010); `0004` has four separate former owners.
3. Assert league-wide: tenure seasons sum to 320 (TheLeague) / 576 (AFL), and all
   7+25 / 7+48 orphaned trophies land on exactly one owner.
4. `pnpm vitest run` the five new suites, then full `pnpm test:unit` at the
   baseline current when this doc was written: **247 files / 6151 tests**.
5. Per `.claude/skills/verify`: `JWT_SECRET=x pnpm dev --port 4399`, then
   screenshot `/theleague/owners`, `/theleague/owners/witch-city-warlocks-2007`,
   `/afl-fantasy/owners`, plus `/theleague/franchises/0011` and `/0010` in
   **both themes** — confirming the franchise pages are unchanged apart from the
   new section, and the extracted era table is still styled.
6. Confirm no `/best-ball-1/owners` route exists and bb1's nav shows no link.

## Risks

- **Regressing franchise pages** — three touchpoints. The compute edit is
  additive and pinned by the byte-identity test. The `EraSeasonTable` extraction
  can silently unstyle the table if the scoped CSS doesn't move with it (trap 4);
  isolate that commit. The `identityHref` change is an additive lookup ordered
  ahead of the existing branch for former identities only — assert both branches.
- **Five parallel boundary implementations, two already divergent** (trap 3).
  Adding a sixth without a parity test is the worst outcome — hence the parity
  test in PR 1 and the migration in PR 3.
- **AFL's ~102-owner index** is a layout problem, not a data one — cards for the
  24 current, a filterable table for the rest.
- **A stale derived file is silent.** `run()` is non-fatal in prebuild, so
  surface `generatedAt` in the index footer and exit non-zero from the compute
  script on a conservation failure.
- **Anonymous pages read like franchise pages.** The `Former owner` pill, the
  `2007–2010 · The League · franchise 0010` subtitle, and the succession footer
  are what make "this is a person" legible. Check on first render.
- ~~**Not verified:** whether the apex-domain rewrites resolve
  `/owners/<slug>` under `hideLeaguePrefix`.~~ **Resolved in PR 1** — they do,
  in both leagues and both directions. The `r()` recipe was the right one.
