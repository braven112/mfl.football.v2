# Custom Rankings Page — Implementation Plan

## Overview

A hidden, admin-only page where you can create personalized player rankings by starting from your composite "My Rank" average, then dragging players to override positions. The system auto-detects tier breaks from rank gaps, imports tier data from sources that provide it (KTC), and lets you manually add/move/remove tier dividers. Position filtering shows overall or per-position views.

---

## Architecture

### Page Route
- **URL**: `/theleague/cr` (short, non-obvious, not in nav)
- **File**: `src/pages/theleague/cr.astro`
- **SSR**: `prerender = false` (needs runtime data access)
- **No nav entry** — completely hidden route
- **No auth gating** — obscurity is sufficient (no one will guess `/cr`)

### Data Flow
```
Import Rankings page (existing)
  → User imports FBG, DLF, etc. into localStorage
  → User checks "My Rank" favorites, sets weights
  → Composite rank computed (weighted average)

Custom Rankings page (new)
  → Reads composite from buildRankingLookup()
  → Seeds initial list from composite order
  → User drags players → relative reordering
  → User adds/moves/removes tier breaks
  → Saves overrides + tiers to durable storage
```

### Storage Strategy (Durable + Hidden)

**Primary**: localStorage key `cr.state` — fast, reactive, used during editing sessions.

**Durable backup**: A committed data file at `src/data/theleague/perf-cache.json` with base64-encoded content. This file looks like a build cache artifact but contains the custom rankings. An SSR API endpoint (`src/pages/api/cr.ts`) handles read/write during dev.

**On page load**:
1. Try localStorage first (fastest)
2. If empty, hydrate from the committed data file (decoded at build/SSR time)
3. If both empty, show "Import rankings first" state

**On save**:
1. Write to localStorage immediately (debounced)
2. POST to `/api/cr` which writes the base64-encoded file (during dev only)
3. User commits the file as part of normal deploys

**Data payload** (small — just overrides, not full player data):
```typescript
interface CustomRankingsState {
  version: 1;
  lastModified: string;              // ISO date
  sourceCompositeHash: string;       // Hash of composite config to detect stale data

  // Position-specific rankings (player IDs in custom order)
  rankings: {
    overall: string[];               // Player IDs in overall custom order
    QB: string[];
    RB: string[];
    WR: string[];
    TE: string[];
    DEF: string[];
  };

  // Manual overrides (players user explicitly moved)
  overrides: Set<string>;            // Player IDs that were manually repositioned

  // Tier breaks
  tiers: {
    overall: TierBreak[];
    QB: TierBreak[];
    RB: TierBreak[];
    WR: TierBreak[];
    TE: TierBreak[];
    DEF: TierBreak[];
  };
}

interface TierBreak {
  afterPlayerId: string;            // Tier break appears after this player
  label?: string;                   // Optional: "Elite", "Starter", etc.
  source: 'auto' | 'imported' | 'manual';
}
```

---

## Components

### New Files to Create

| File | Purpose |
|------|---------|
| `src/pages/theleague/cr.astro` | Page scaffold (loads MFL players, hydrates React) |
| `src/pages/api/cr.ts` | SSR endpoint for durable save/load |
| `src/components/theleague/custom-rankings/CustomRankingsPage.tsx` | Main orchestrator |
| `src/components/theleague/custom-rankings/RankingList.tsx` | Drag-and-drop player list with tiers |
| `src/components/theleague/custom-rankings/PlayerRow.tsx` | React player lockup (mirrors PlayerCell.astro) |
| `src/components/theleague/custom-rankings/TierDivider.tsx` | Draggable tier break row |
| `src/components/theleague/custom-rankings/PositionFilter.tsx` | ALL/QB/RB/WR/TE/DEF filter chips |
| `src/utils/custom-rankings-storage.ts` | localStorage + file persistence |
| `src/utils/tier-detection.ts` | Auto-detect tiers from rank gaps |
| `src/types/custom-rankings.ts` | Type definitions |

### Existing Files to Modify

| File | Change |
|------|--------|
| `src/data/theleague/perf-cache.json` | New file (base64 data, committed) |
| `.gitignore` | No changes needed |

---

## UI Design

### Layout
```
┌─────────────────────────────────────────────┐
│  Custom Rankings                    [Save]   │
│  Last saved: Feb 24, 2026                    │
├─────────────────────────────────────────────┤
│  [ALL] [QB] [RB] [WR] [TE] [DEF]           │
├─────────────────────────────────────────────┤
│  ── Tier 1 ─────────────────────── [×] [⋮]  │
│  ⠿  1.  [headshot] Ja'Marr Chase  CIN WR ▲3│
│  ⠿  2.  [headshot] CeeDee Lamb    DAL WR    │
│  ⠿  3.  [headshot] Bijan Robinson ATL RB ▼1 │
│  ── Tier 2 ─────────────────────── [×] [⋮]  │
│  ⠿  4.  [headshot] Breece Hall    NYJ RB    │
│  ⠿  5.  [headshot] Amon-Ra St. Br DET WR ▲6│
│  ...                                         │
│  ── Tier 3 (auto-detected) ──────── [×] [⋮] │
│  ⠿  12. [headshot] ...                      │
│                                              │
│  [+ Add tier break]                          │
└─────────────────────────────────────────────┘
```

### Player Row Details
- **Drag handle** (6-dot icon, left)
- **Rank number** (overall or positional depending on filter)
- **Player lockup** (headshot, name, NFL team + position — mirrors PlayerCell)
- **Override indicator** (right side): green ▲N or red ▼N showing delta from composite rank. Only shown for manually moved players.
- Position badge color-coded when in "ALL" view

### Tier Dividers
- Full-width colored bar between player rows (accent color from design tokens)
- Label: "Tier 1", "Tier 2", etc. (or custom label if user sets one)
- Source indicator: subtle "(auto)" or "(KTC)" badge for non-manual tiers
- **Draggable**: user can drag a tier divider up/down between players
- **Removable**: × button on the right
- **Renameable**: click the label to edit inline

### Position Filter
- Sticky chip bar below the header
- Active chip gets primary color background
- Counts next to each: `QB (24)` `RB (48)` etc.
- Switching positions re-numbers ranks and shows position-specific tiers

### Empty State
When no composite exists: show a message with a link to the import rankings page.

---

## Tier Detection Algorithm

### Auto-Detection (from composite rank gaps)
```typescript
function detectTierBreaks(
  rankedPlayerIds: string[],
  compositeRanks: Map<string, number>,
): TierBreak[] {
  // 1. Calculate gaps between adjacent players
  const gaps = rankedPlayerIds.map((id, i) => {
    if (i === 0) return 0;
    const prevRank = compositeRanks.get(rankedPlayerIds[i - 1]) ?? 0;
    const currRank = compositeRanks.get(id) ?? 0;
    return currRank - prevRank;
  });

  // 2. Calculate median gap (excluding first element)
  const sortedGaps = gaps.slice(1).sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

  // 3. Tier break where gap > threshold × median
  const THRESHOLD = 2.5;
  const tierBreaks: TierBreak[] = [];

  for (let i = 1; i < gaps.length; i++) {
    if (gaps[i] > medianGap * THRESHOLD && gaps[i] > 2) {
      tierBreaks.push({
        afterPlayerId: rankedPlayerIds[i - 1],
        source: 'auto',
      });
    }
  }

  return tierBreaks;
}
```

### Imported Tiers (from KTC and other sources)
- Read `tier` field from `StoredRankingEntry` in composite member imports
- Map tier transitions to tier breaks (when tier number changes between adjacent players)
- Merge with auto-detected tiers (prefer imported when they overlap)

### Manual Tiers
- User clicks "+ Add tier break" or right-clicks between players
- Stored with `source: 'manual'`
- Survive re-detection (auto tiers regenerate, manual tiers persist)

---

## Implementation Phases

### Phase 1: Foundation (scaffold + data)
1. Create type definitions (`src/types/custom-rankings.ts`)
2. Create storage utility (`src/utils/custom-rankings-storage.ts`)
3. Create tier detection utility (`src/utils/tier-detection.ts`)
4. Create API endpoint (`src/pages/api/cr.ts`)
5. Create the Astro page scaffold (`src/pages/theleague/cr.astro`)

### Phase 2: Core UI
6. Create `PlayerRow.tsx` (React version of PlayerCell pattern)
7. Create `PositionFilter.tsx` (filter chip bar)
8. Create `TierDivider.tsx` (draggable tier break row)
9. Create `RankingList.tsx` (drag-and-drop list with @dnd-kit)
10. Create `CustomRankingsPage.tsx` (main orchestrator)

### Phase 3: Interactivity
11. Wire up drag-and-drop reordering (relative — renumber on drop)
12. Wire up tier divider dragging (move between players)
13. Wire up position filtering (re-render list per position)
14. Wire up override delta indicators
15. Wire up save/load (localStorage + API endpoint)

### Phase 4: Polish
16. Auto-detect tiers on initial load from composite
17. Import tier data from sources that provide it
18. Add "Reset to composite" button (undo all overrides)
19. Add "+ Add tier break" button
20. Tier label editing (click to rename)
21. Page styles (following existing design tokens and `ri-` pattern conventions)

---

## Key Decisions

1. **React, not Astro** for the interactive list — drag-and-drop requires client-side JS, same pattern as ManageImportsSection
2. **@dnd-kit** for drag-and-drop — already in `package.json`, proven in the codebase
3. **PlayerRow.tsx** as a new React component — PlayerCell.astro can't be used in React context
4. **Relative reordering** — dropping a player renumbers the entire list, no absolute rank assignments
5. **Position-independent storage** — store overall order + derive positional views, rather than maintaining 6 separate lists that can drift out of sync. When filtering by position, the list shows the subset in their overall-order sequence, re-numbered 1..N.
6. **Tier breaks reference player IDs** (not rank numbers) — so they survive reordering

---

## Questions Resolved
- ✅ Starts empty, progressively available after imports added
- ✅ Relative reordering (everyone renumbers)
- ✅ All players from imports (union of imported players)
- ✅ Durable storage (base64-encoded committed file + localStorage)
- ✅ Hidden route at `/theleague/cr`
- ✅ Combined tier approach (auto-detect + imported + manual)
