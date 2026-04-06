# Mock Draft: Per-Owner Auto-Pick Ranking Lists

## Overview

Allow each AI-controlled team in a mock draft to use a **different ranking source** for auto-pick. This makes mock drafts more realistic — each "opponent" drafts from a different board, creating realistic board variance and forcing the user to adapt their strategy.

## Current State

- Auto-pick uses a single global list: **MFL Rookie ADP** (fetched live at session creation)
- All AI teams pick the same best-available player from that one list
- The session creator manually picks for whichever team is on the clock

## Proposed Feature

### Ranking Sources

Each AI team can be assigned one of these ranking lists:

| Source | Data File | Coverage | Notes |
|--------|-----------|----------|-------|
| **MFL Rookie ADP** | Live fetch from MFL API | ~50-100 players | League-specific ADP, consensus default |
| **FBG Rookies** | `data/fantasy-expert/sources/fbg/2026-rookies.json` | 130 players | FantasyBullsGap dynasty rookie rankings |
| **RSP (Waldman)** | `data/fantasy-expert/rsp-scouting/*.json` | ~50 players | Matt Waldman's Rookie Scouting Portfolio, tier-based |
| **FBG Dynasty** | `data/fantasy-expert/sources/fbg/2026-dynasty.json` | 700+ players | Full dynasty rankings (veterans + rookies) |
| **Composite** | Computed | Varies | Average rank across 2-3 sources |
| **Random** | N/A | All rookies | Shuffled rookie list — chaotic wildcard |

### Architecture

#### Session Creation

The create endpoint builds **multiple ranked lists** and stores them in PartyKit:

```typescript
// POST /api/mock-draft/create body gains:
{
  timerSeconds: 120,
  totalRounds: 3,
  useRealOrder: true,
  // NEW: optional ranking assignment
  rankingAssignments?: Record<string, RankingSource>
  // e.g. { "0001": "user", "0002": "fbg", "0003": "rsp", ... }
}
```

#### PartyKit Storage

Instead of a single `ranked-players` array, store per-source lists:

```typescript
// Storage keys:
'ranked-players-mfl'       → string[]  // MFL ADP order
'ranked-players-fbg'       → string[]  // FBG rookie rank order
'ranked-players-rsp'       → string[]  // RSP DoT score order
'ranked-players-dynasty'   → string[]  // FBG dynasty rank order
'ranked-players-composite' → string[]  // Averaged ranks
'ranking-assignments'      → Record<string, RankingSource>
```

#### Auto-Pick Logic

```typescript
private async autoPick(session: MockDraftSession): Promise<void> {
  const currentFranchise = session.draftOrder[session.currentPickIndex];
  const assignments = await this.room.storage.get<Record<string, string>>('ranking-assignments') ?? {};
  const source = assignments[currentFranchise] || 'mfl';

  const rankedPlayerIds = await this.room.storage.get<string[]>(`ranked-players-${source}`) ?? [];
  const pickedPlayerIds = new Set(session.picks.filter(p => p.playerId).map(p => p.playerId!));
  const nextPlayerId = rankedPlayerIds.find(id => !pickedPlayerIds.has(id));

  // If source is exhausted, fall back to MFL ADP
  if (!nextPlayerId) {
    const fallback = await this.room.storage.get<string[]>('ranked-players-mfl') ?? [];
    const fallbackId = fallback.find(id => !pickedPlayerIds.has(id));
    if (fallbackId) {
      await this.makePick(session, fallbackId, true);
      return;
    }
  }

  await this.makePick(session, nextPlayerId || `auto-${Date.now()}`, true);
}
```

### Lobby UI

Add a "Board Settings" section to the mock draft lobby:

```
┌─────────────────────────────────────────┐
│ ┃ BOARD SETTINGS                        │
│ │ Choose how AI opponents draft          │
│                                          │
│  Default for all:  [MFL ADP ▾]          │
│                                          │
│  ── Or customize per team ──            │
│  Fire Ready Aim    [FBG Rookies ▾]      │
│  Dead Cap Walking  [RSP (Waldman) ▾]    │
│  Cowboy Up         [MFL ADP ▾]          │
│  Music City Mafia  [Composite ▾]        │
│  ...                                     │
└─────────────────────────────────────────┘
```

**Preset buttons** for quick setup:
- **"All MFL ADP"** — everyone uses MFL (current behavior)
- **"Mixed Boards"** — randomly assigns different sources to each team
- **"Chaos Mode"** — every team gets a shuffled random list

### Name-to-ID Matching

FBG and RSP data use player names, not MFL IDs. The create endpoint must fuzzy-match:

```typescript
function matchNameToMflId(
  name: string,
  mflPlayers: Map<string, { id: string; name: string }>
): string | undefined {
  // Normalize: "Smith, Breshard" → "breshard smith"
  // Handle Jr., III, etc.
  // Try exact match, then Levenshtein distance ≤ 2
}
```

This matching logic already exists in `rookies-2026.astro` (`normalizeFbgName`). Extract it into a shared utility.

### Data Flow

```
1. User clicks "Start Mock Draft" with ranking config
2. POST /api/mock-draft/create
   ├── Fetch MFL rookie ADP (live)
   ├── Load FBG rookies JSON → match names to MFL IDs
   ├── Load RSP data → match names to MFL IDs
   ├── Compute composite (average rank across sources)
   └── POST to PartyKit with all ranked lists + assignments
3. PartyKit stores per-source lists
4. On auto-pick: look up current team's assigned source → pick from that list
```

## Implementation Phases

### Phase 1 (Current — DONE)
- [x] Single global MFL Rookie ADP list
- [x] Fallback to local players feed rookies
- [x] Creator can pick for any team

### Phase 2: Multiple Sources
- [ ] Build FBG rookies → MFL ID mapping in create endpoint
- [ ] Build RSP → MFL ID mapping in create endpoint
- [ ] Store per-source lists in PartyKit storage
- [ ] Auto-pick reads team's assigned source
- [ ] Default: random assignment across sources

### Phase 3: Lobby UI
- [ ] Add "Board Settings" section to lobby page
- [ ] Default dropdown (applies to all teams)
- [ ] Per-team override dropdowns
- [ ] Preset buttons (All MFL, Mixed, Chaos)
- [ ] Store config in session and send to PartyKit

### Phase 4: Composite Rankings
- [ ] Build composite ranking algorithm (average rank normalization)
- [ ] Handle missing players across sources (use max rank + penalty)
- [ ] Show composite methodology on hover/tooltip

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/api/mock-draft/create.ts` | Build multiple ranked lists, accept ranking config |
| `party/draft-room.ts` | Per-team auto-pick source selection |
| `src/pages/theleague/mock-draft/index.astro` | Board Settings UI in lobby |
| `src/utils/player-name-matching.ts` | NEW — shared fuzzy name → MFL ID matching |
| `src/types/draft-room.ts` | Add `RankingSource` type, update `MockDraftSession` |

## Open Questions

1. Should the user see which board each AI team is using during the draft? (e.g., small badge next to team name showing "FBG" or "RSP")
2. Should we support custom imported rankings (paste a list) as a source?
3. Should completed mock drafts show a "Board Variance" analysis — how much the results differed from a single-board draft?
