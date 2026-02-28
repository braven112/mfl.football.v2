# Custom Rankings Page

## Overview

Admin-only page at `/theleague/cr` where franchise 0001/0000 can create personalized player rankings. Seeds from the composite "My Rank" weighted average, supports drag-and-drop reordering, tier breaks, and position filtering. State persists via Vercel KV (Upstash Redis) for cross-device access.

---

## Architecture

### Route & Access
- **URL**: `/theleague/cr`
- **File**: `src/pages/theleague/cr.astro` (SSR, `prerender = false`)
- **Auth**: `getAuthUser()` + `isAdminFranchise()` — redirects non-admin users
- **Nav**: Listed in "My Team" section with `"visibility": "admin"`

### Data Flow
```
Import Rankings page (localStorage)
  → User imports sources, checks "My Rank" favorites, sets weights
  → Composite rank computed (weighted average)

Custom Rankings page
  → Mount: buildCompositePlayerList() reads localStorage
  → Mount: GET /api/cr loads saved state from Vercel KV
  → Staleness check: sourceCompositeHash detects import changes
  → If stale: mergeWithOverrides() preserves manual overrides
  → User drags to reorder → debounced POST /api/cr saves to KV
```

### Storage
- **Primary**: Vercel KV (Upstash Redis) — key `cr:{franchiseId}`
- **Fallback**: localStorage cache at `cr.localCache` for offline/fast loads
- **Payload**: ~6KB JSON (`CustomRankingsState`)
- **Auto-save**: 500ms debounce after any change

### Staleness Detection
A `sourceCompositeHash` (derived from composite config member IDs + player count) detects when imports changed since last save. On mismatch, the system re-seeds from composite while preserving manual overrides via `mergeWithOverrides()`.

---

## Files

### New Files
| File | Purpose |
|------|---------|
| `src/types/custom-rankings.ts` | Types: `CustomRankingsState`, `TierBreak`, `RankedPlayer`, `PositionFilter`, `MFLPlayerBasic` |
| `src/utils/custom-rankings-seeding.ts` | `buildCompositePlayerList()`, `computeCompositeHash()`, `mergeWithOverrides()` |
| `src/utils/custom-rankings-storage.ts` | API wrappers + localStorage cache |
| `src/utils/tier-detection.ts` | `detectTierBreaks()`, `extractImportedTiers()`, `mergeTierBreaks()` |
| `src/pages/api/cr.ts` | GET/POST with auth + Upstash Redis |
| `src/pages/theleague/cr.astro` | SSR page: auth gate, MFL player loading, React hydration |
| `src/components/theleague/custom-rankings/CustomRankingsPage.tsx` | Main orchestrator |
| `src/components/theleague/custom-rankings/RankingList.tsx` | @dnd-kit sortable list with tier dividers |
| `src/components/theleague/custom-rankings/PlayerRow.tsx` | Draggable player row (mirrors PlayerCell.astro) |
| `src/components/theleague/custom-rankings/TierDivider.tsx` | Tier break with move/rename/remove controls |
| `src/components/theleague/custom-rankings/PositionFilter.tsx` | ALL/QB/RB/WR/TE/DEF filter chips |
| `src/components/theleague/custom-rankings/SaveIndicator.tsx` | Save status display |
| `src/styles/custom-rankings.css` | All feature styles (`cr-` prefix) |
| `tests/custom-rankings-seeding.test.ts` | 14 tests for seeding/merge |
| `tests/tier-detection.test.ts` | 16 tests for tier detection |

### Modified Files
| File | Change |
|------|--------|
| `package.json` | Added `@upstash/redis` |
| `src/config/nav-config.json` | Added Custom Rankings nav link (admin visibility) |
| `src/pages/theleague/import-rankings.astro` | Added admin-only cross-link to `/cr` |
| `src/components/theleague/rankings-import/RankingsImportPage.tsx` | Added `isAdmin` prop for cross-link |

---

## Key Patterns

### Edit Mode
An `isEditing` toggle controls drag-and-drop activation. When off:
- Drag sensors disabled (prevents accidental reordering)
- Drag handles hidden
- Tier move/remove/rename controls hidden
- Inline tier insert zones hidden

### Tier System
Three tier sources, managed together:
- **Auto**: Gap-based detection from composite rank differences (`detectTierBreaks()`)
- **Imported**: From KTC tier data (`extractImportedTiers()`) — utility exists but not yet wired into init
- **Manual**: Added inline between players via "+" insert zones

Tier numbers compute sequentially in `RankingList.tsx`. Adding/removing tiers auto-renumbers everything below.

### Position Filtering
View-only concern — filters the displayed list without affecting storage. Rankings are stored as a single overall list; positional views derive from it. Drag-and-drop maps filtered indices back to overall indices via `handleReorder`.

### Cross-Links
- Custom Rankings subtitle links to Import Rankings
- Import Rankings subtitle links to Custom Rankings (admin-only via `isAdmin` prop)

---

## Key Decisions

1. **Vercel KV over localStorage-only** — cross-device persistence without managing a database
2. **Single overall ranking list** — derive positional views rather than maintaining 6 separate lists
3. **Edit mode toggle** — prevents accidental drag-and-drop on touch/desktop
4. **Inline tier insertion** — "+" zones between players instead of a header button
5. **@dnd-kit** — already in codebase, proven pattern from ManageImportsSection
6. **React PlayerRow** — mirrors PlayerCell.astro since Astro components can't be used in React context
7. **Tier breaks reference player IDs** — survive reordering (not tied to rank numbers)

---

## Future Improvements

- Wire `extractImportedTiers()` into initialization to use KTC tier data
- Add retry mechanism for save errors
- Consider making available to all league members (remove admin gate)
