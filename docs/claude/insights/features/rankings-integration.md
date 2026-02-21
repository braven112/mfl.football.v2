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
