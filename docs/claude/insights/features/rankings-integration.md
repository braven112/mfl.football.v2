# Rankings Integration — Feature Insights

## 2026-02-17 - Reusable Rankings Lookup Standard

**Context:** Building a system to display imported player rankings across multiple pages (Free Agents, Rosters, Trade Builder, Auction Predictor, etc.). Rankings are stored privately per user in localStorage via `rankings-storage.ts`.

**Insight:** A shared utility (`rankings-lookup.ts`) provides the standard API for any page to consume rankings data. The key design decisions:

1. **Import-ID-keyed, not source-keyed** — Users may import the same source multiple times (e.g., KTC dynasty AND KTC redraft). Each import gets its own column keyed by `import.id`.

2. **Pre-built lookup maps** — `buildRankingLookup()` returns `Map<playerId, rank>` per import for O(1) lookups during table rendering. This is critical for vanilla JS pages that build HTML via string concatenation.

3. **Dynamic columns** — Pages don't hardcode ranking column headers. They iterate `lookup.columns` to inject `<th>` and `<td>` elements at runtime, since the number of columns depends on what the user has imported.

4. **Cross-tab reactivity** — `onRankingsChanged()` listens for both `rankingsUpdated` CustomEvent (same tab) and `storage` event (cross-tab). Returns an unsubscribe function.

**Evidence:** `src/utils/rankings-lookup.ts` — the shared utility

### Integration Pattern for Vanilla JS Pages (like `players.astro`)

For Astro pages that use `define:vars` inline scripts:

1. **Listen for CustomEvents on `document`** from the inline script:
   ```js
   document.addEventListener('rankings:set-lookup', function (e) {
     rankingLookup = e.detail.lookup;
     // ... update visibility state
   });
   document.addEventListener('rankings:set-sort', function (e) {
     currentSort = e.detail.key;
     sortDirection = e.detail.dir;
   });
   document.addEventListener('rankings:refresh-table', function () {
     sortPlayers(); render();
   });
   document.addEventListener('rankings:refilter', function () {
     filterPlayers();
   });
   // Synchronous data request — module reads e.detail after dispatch
   document.addEventListener('rankings:get-sort', function (e) {
     e.detail.currentSort = currentSort;
     e.detail.descDefaults = descDefaults;
   });
   // Signal readiness
   document.dispatchEvent(new CustomEvent('rankings:page-ready'));
   ```

2. **Add a separate module `<script>` tag** that imports from `rankings-lookup.ts` and dispatches events:
   ```html
   <script>
     import { buildRankingLookup, onRankingsChanged } from '../../utils/rankings-lookup';
     function emit(name, detail) {
       document.dispatchEvent(new CustomEvent(name, { detail: detail ?? {} }));
     }
     function getSortState() {
       const detail = {};
       document.dispatchEvent(new CustomEvent('rankings:get-sort', { detail }));
       return detail; // populated synchronously by the listener
     }
     // ... inject columns, subscribe to changes
   </script>
   ```

3. **In the inline script's `sortPlayers()`**, add a dynamic case:
   ```js
   if (currentSort.startsWith('ranking_')) {
     const importId = currentSort.slice(8);
     const map = rankingLookup.byImport.get(importId);
     aVal = map?.get(a.id) ?? 9999;
     bVal = map?.get(b.id) ?? 9999;
   }
   ```

4. **In the inline script's `render()`**, emit ranking cells:
   ```js
   for (const col of rankingLookup.columns) {
     const rnk = rankingLookup.byImport.get(col.importId)?.get(p.id);
     html += `<td class="cell-num">${rnk != null ? rnk : '<span class="na">-</span>'}</td>`;
   }
   ```

5. **Inject `<th>` elements via JS** using `data-ranking-col="true"` attribute for easy cleanup on re-inject.

**Key gotcha:** Astro's `define:vars` scripts are classic (non-module) scripts, so they can't use `import`. The rankings module must be a separate `<script>` tag. Communication between them uses **CustomEvents on `document`** — no global `window` properties needed. The inline script fires `rankings:page-ready` when ready; the module script listens for it. For synchronous data reads (e.g., getting current sort state), the module dispatches an event with a mutable `detail` object that the inline listener populates in-place.

### Integration Pattern for React Components

For React pages (like trade-builder), usage is simpler:

```tsx
import { buildRankingLookup, onRankingsChanged } from '../../utils/rankings-lookup';

function MyComponent() {
  const [lookup, setLookup] = useState(() => buildRankingLookup());

  useEffect(() => {
    return onRankingsChanged(() => setLookup(buildRankingLookup()));
  }, []);

  // Use lookup.columns for headers, lookup.byImport for cell data
}
```

### Shared Labels

`SOURCE_LABELS` and `SOURCE_ABBREVS` are exported from `rankings-lookup.ts` and should be used everywhere:
- `ImportDetailModal.tsx` and `ManageImportsSection.tsx` import from here (deduplicated)
- Any future component that displays source names should import from here

**Recommendation:**
- When adding rankings to a new page, follow the vanilla JS or React pattern above
- Always use `data-ranking-col="true"` on injected `<th>` elements for easy cleanup
- Ranking sort keys follow the convention `ranking_{importId}`
- Rankings default to ascending sort (rank 1 at top, best first)
- Future: migrate the auction predictor to use `buildRankingLookup()` instead of its inline `getPlayerRank()` functions

---

## 2026-02-17 - Ranking Column Sort Direction

**Context:** Integrating ranking columns into the Free Agents page sort system.

**Insight:** Ranking columns should default to **ascending** sort (rank 1 = best at top), unlike most numeric columns (points, ADP) that default to descending. The existing `descDefaults` Set in `players.astro` only applies to the built-in columns. Ranking columns handle their own default direction in the module script's click handler.

**Evidence:** `src/pages/theleague/players.astro` — module script sort handler

**Recommendation:** Always default ranking columns to ascending. This matches user expectation: "sort by this ranking" means "show the best-ranked players first" which is rank 1 at the top.

---

## 2026-02-17 - Column Group Toggles for Wide Tables

**Context:** The Free Agents page table was already 13+ columns and adding multiple ranking imports caused horizontal overflow. Needed a way to show/hide groups of columns.

**Insight:** Independent pill-button toggles (not mutually exclusive) allow users to show/hide column groups. The pattern follows the Rosters page's GM/Coach mode toggle but with key differences:

1. **Independent toggles** — Unlike Rosters (mutually exclusive GM/Coach), Free Agents uses independent buttons where multiple groups can be active simultaneously.

2. **CSS marker classes** — Each `<th>` and `<td>` gets a `col-group--{name}` class (e.g., `col-group--profile`, `col-group--stats`, `col-group--rankings`). `applyGroupVisibility()` queries all elements with the class and sets `display: none` or `''`.

3. **Re-apply after render** — Since `render()` rebuilds `tbody.innerHTML` via string concatenation, all inline `display` styles are destroyed. `applyGroupVisibility()` must be called at the end of every `render()` call.

4. **Rankings auto-show with null sentinel** — `groupVisibility.rankings` starts as `null` (unset) in the state. The rankings module script calls `setRankingsGroupDefault(hasColumns)` which only sets the value if it's still `null`. Once the user explicitly toggles rankings, their choice is persisted and the auto-show logic is skipped.

5. **localStorage persistence** — Prefs stored under `playersViewColumns` key as `{ profile: bool, stats: bool, rankings: bool }`. The `null` sentinel for rankings is stripped before saving (`delete prefs.rankings` when null).

**Evidence:** `src/pages/theleague/players.astro` — inline script group visibility functions, module script `setRankingsGroupDefault` call

**Column groups defined:**

| Group | Columns | Default | CSS class |
|-------|---------|---------|-----------|
| Profile | Exp, Draft, Ht, Wt | OFF | `col-group--profile` |
| Stats | Snaps, Snap%, Last Yr, Proj | ON | `col-group--stats` |
| Rankings | FBG Dyn, KTC Dyn, etc. (dynamic) | ON when imports exist | `col-group--rankings` |

**Recommendation:**
- When adding column group toggles to other pages, follow this same pattern: CSS marker classes + `applyGroupVisibility()` after each render
- Always call `applyGroupVisibility()` after any operation that rebuilds DOM (innerHTML, React re-render, etc.)
- For dynamic columns (like rankings), use the null-sentinel pattern to distinguish "user hasn't chosen yet" from "user chose OFF"
- Ranking `<th>` elements injected by the module script must include `col-group--rankings` in their className

---

## 2026-02-22 - Composite Rank ("My Rank") Feature

**Context:** Users import rankings from multiple sources but wanted a single personalized column that blends their most trusted sources with configurable weights.

**Insight:** The composite rank system introduces two synthetic column types (`__composite__` and `__average__`) that coexist in `buildRankingLookup()`. Key architecture decisions:

1. **Weighted average computation** — `Math.round(sum(rank * weight) / sum(weights))` across member imports where the player appears. Players only in 1 of N members get that single import's rank (no penalty for missing data).

2. **Column ordering with grouping** — When composite is active, columns are partitioned: `[composite, ...members, ...others]`. The existing average column insertion then runs on this reordered array, with its position offset by the composite group size (`1 + members.length`).

3. **Average column offset** — The stored average position is relative to non-composite columns. When composite is active, the effective insertion position is `storedPosition + compositeGroupSize` so the average always lands after the composite group. This prevents the average from pushing the composite out of position 0.

4. **Average computation isolation** — The average column must only use real import maps (not synthetic composite/average maps). A `realImportMaps` array is built by iterating `allImports` rather than `byImport.entries()` to exclude synthetic entries.

5. **Composite config validation** — `getCompositeConfig()` validates member IDs against current imports and returns `null` if fewer than 2 valid members remain. This handles deleted imports gracefully.

6. **Import replacement ID swap** — When `saveImport()` replaces an existing import (same source+type), it updates composite config to swap the old ID for the new ID, preserving the user's composite membership.

7. **Border separator** — `isLastCompositeMember` flag on the rightmost member column drives a CSS `border-right: 2px solid rgba(28, 73, 124, 0.15)` on both `<th>` and `<td>` elements via the `.col-ranking-member-last` class.

8. **Auto-sort** — When composite exists and user hasn't explicitly sorted, the Free Agents page auto-sets `currentSort = 'ranking___composite__'` with ascending direction. A `hasExplicitSortPref` flag (set on manual column header click) prevents overriding user choice.

9. **Roster page gets composite for free** — Since the roster page already consumes `buildRankingLookup()` and displays the first ranking column, the composite column automatically appears there when active (it's always first in the columns array).

**Evidence:**
- `src/utils/rankings-lookup.ts` — composite computation in `buildRankingLookup()`
- `src/utils/rankings-storage.ts` — composite config CRUD
- `src/components/theleague/rankings-import/ManageImportsSection.tsx` — checkbox + weight picker UI
- `src/pages/theleague/players.astro` — auto-sort and CSS classes

**Recommendation:**
- Any new page consuming rankings should check `col.isComposite` for special styling
- The composite column uses `source: 'custom'` and `type: 'overall'` — avoid filtering on these if you want synthetic columns to appear
- Weight values are constrained to `1 | 2 | 3` — if expanding, update the `CompositeImportConfig` type and the UI picker

---

## 2026-08-21 - Built-In Ranking Sources: Match Once at Build, Not Per Visitor

**Context:** Import Rankings required every owner to drag bookmarklets to a
desktop bookmarks bar or click a one-click import. Most never would, so most
boards were empty. Six sources are now supplied pre-loaded
(`scripts/fetch-ranking-sources.mjs` → `data/ranking-sources/<year>.json`).

**Insight:** Sources split cleanly into two classes, and the split decides the
whole architecture:

1. **Already MFL-keyed — zero matching.** MFL `adp`, MFL `playerRanks`, and
   **FantasyCalc** (which returns `player.mflId` at 100% coverage on skill
   players). These resolve by id and can never mis-match.
2. **Foreign-keyed — matched ONCE at build.** Sleeper and ESPN. Doing this at
   build instead of in every browser is not just a perf win: it is the only
   way to get a deterministic, inspectable match rate. ESPN resolves 432/436.

Build-time matching also **cleans the data for free**. Sleeper's list is full
of retired stars (see below); none exist in the MFL feed, so dropping
unmatched players removes them with no hand-maintained retirement list.

Two things make that safe rather than lossy:

- **MFL speaks its own team dialect** — `TBB`/`NOS`/`GBP`/`WAS` where every
  external source says `TB`/`NO`/`GB`/`WSH`. Team is used to break name ties,
  so comparing raw strings fails for about a third of the league.
- **MFL stores LEGAL names.** `Gainwell, Kenneth` vs Sleeper's "Kenny
  Gainwell"; `Okonkwo, Chigoziem` vs "Chig Okonkwo". Both are current
  starters. A narrow fallback (same position + surname + first initial + team,
  refusing when no team is supplied) recovers them without ever pairing two
  different people.

**Evidence:** Exact-match-only dropped 170 of Sleeper's 500; the nickname
fallback recovered Gainwell and Okonkwo, and the remaining 167 drops were
verified to be retirees. Every source ends at 0 ids absent from the players
feed.

**Recommendation:** Adding a source is two edits that nothing connects —
the fetch script AND `SOURCE_LABELS`/`SOURCE_ABBREVS`. Shipping only the first
renders the raw id in the table (that reached a preview twice).
`tests/builtin-ranking-defaults.test.ts` now fails on a missing label, a
duplicate label, or a source typed `overall`. Also trim every source to the
positions the board renders and **re-rank 1..n** — Sharks returns the whole
league including kickers and IDP, and leaving gaps where those were makes
every downstream rank look wrong.

---

## 2026-08-21 - Sleeper's `search_rank` Is Popularity, Not ADP

**Context:** The Sleeper import's match rate sat at ~73%, which looked like a
name-matching bug worth chasing.

**Insight:** It wasn't. `/v1/players/nfl`'s `search_rank` is Sleeper's
**search popularity** ordering, not ADP — so it ranks retired stars highly:
Todd Gurley #27, Drew Brees #76, Antonio Brown #89, Gronkowski #118, Larry
Fitzgerald #165. The `active` flag does not exclude them.

**Evidence:** Of 133 unmatched players, 112 ranked 301–500 and were retirees.
The top 100 matched 99%; the top 50 matched 98%.

**Recommendation:** A headline match rate on a Sleeper import is misleading —
judge it by the top 100. And never present `search_rank` to owners as "ADP"
without qualification. MFL's own `TYPE=adp` is real ADP from hundreds of
drafts and needs no matching at all; prefer it.

---

## 2026-08-21 - A Normalized Weight Must Be Shown Normalized, or the Number Lies

**Context:** Composite weights moved from a `1|2|3` multiplier to a
user-entered percentage so an owner could say "5% superflex".

**Insight:** The composite has always computed `weightedSum / totalWeight`, so
a source's real share is `weight / Σweight`. That means the math needed **no
change** to support percentages — but it also means an un-normalized set lies
to the user: typing `5` against three sources at `1` each yields 5/8 = **62.5%**,
the exact opposite of the intent. Weights must be re-totalled to 100 on every
mutation — set, toggle on, toggle off, and hide — pinning the value just typed
and distributing the remainder across the others in proportion to what they
had. A newly-added member gets an even `100/n` share, never 0: a member at 0 is
*in* the composite but ignored, which is worse than absent because the UI shows
it contributing.

**Evidence:** All four mutation paths were written separately and three of them
shipped without rebalancing. Hiding a source left the survivors at 68.3.

**Recommendation:** Never patch composite state optimistically in the
component. Any mutation re-weights *sibling* rows, so a handler that updates
only the row that was clicked leaves the table showing numbers that disagree
with storage — the store held 31.6/31.7/31.7/5 while the screen showed
25/25/25/5. Re-read from storage after every change.
