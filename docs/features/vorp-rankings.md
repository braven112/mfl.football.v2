# Value-Over-Replacement Rankings (VORP)

## Overview

Enhancement to the Custom Rankings page (`/theleague/cr`) that adds a VORP column showing each player's value over replacement level. VORP = player's projected points minus the replacement-level player's projected points at that position. This answers: "How much does this player outperform a freely available alternative?"

**Who sees it:** Admin only (franchise 0001/0000) — the Custom Rankings page is already admin-gated.

**Related docs:** [Surplus Value Calculator](surplus-value-calculator.md) | [Dynasty Value Analysis Index](dynasty-value-analysis-index.md)

---

## Dependencies

- **Surplus Value Calculator** (`src/utils/surplus-value.ts`) — for the `pointsToDollarValue()` function to optionally show dollar-based VORP alongside points-based VORP.

---

## Architecture

Since Custom Rankings is a React app (`CustomRankingsPage.tsx`), VORP data needs to be:

1. Calculated at build time in `cr.astro` frontmatter
2. Passed as a prop to the React component
3. Displayed as an optional column in `PlayerRow.tsx`

### Data Flow

```
Build Time (cr.astro):
  projectedScores + players data
    → calculateReplacementLevels() (new utility)
    → calculateAllVORP()
    → vorpMap: Record<string, { vorpPoints: number; vorpDollar: number }>
    → passed as JSON prop to CustomRankingsPage

React (CustomRankingsPage.tsx):
  Toggle "Show VORP" → renders VORP column in PlayerRow
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Projected scores | `src/data/theleague/mfl-feeds/{year}/projectedScores.json` | Player projected points |
| Players | `src/data/theleague/mfl-feeds/{year}/players.json` | Position identity |
| Rosters | `src/data/theleague/mfl-feeds/{year}/rosters.json` | League-wide salary for dollar conversion |
| Salary averages | `src/data/mfl-salary-averages-{year}.json` | For dollar conversion via surplus-value util |

---

## Algorithm / Core Logic

```typescript
// src/utils/vorp.ts

interface VORPConfig {
  teamCount: number;
  startersPerPosition: Record<string, number>;
}

// TheLeague config: 16 teams
// Starting lineup: 1 QB, 2-3 RB/WR flex, 1 TE, 1 PK, 1 DEF
const THE_LEAGUE_VORP_CONFIG: VORPConfig = {
  teamCount: 16,
  startersPerPosition: {
    QB: 1,    // Replacement = QB17 (16 * 1 + 1)
    RB: 2,    // Replacement = RB33 (16 * 2 + 1)
    WR: 3,    // Replacement = WR49 (16 * 3 + 1)
    TE: 1,    // Replacement = TE17 (16 * 1 + 1)
    PK: 1,    // Replacement = PK17
    DEF: 1,   // Replacement = DEF17
  },
};

/**
 * Calculate the replacement-level projected points for each position.
 * Replacement level = the (teamCount * startersPerPosition + 1)th player.
 */
function calculateReplacementLevels(
  projectedScores: Map<string, number>,
  players: Map<string, { position: string }>,
  config: VORPConfig
): Map<string, number> {
  // Group players by position, sorted by projected points descending
  const byPosition = new Map<string, number[]>();

  for (const [id, pts] of projectedScores) {
    const player = players.get(id);
    if (!player) continue;
    const pos = normalizePosition(player.position);
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(pts);
  }

  // Sort each position descending
  for (const scores of byPosition.values()) {
    scores.sort((a, b) => b - a);
  }

  // Replacement level = the Nth player (0-indexed)
  const replacementLevel = new Map<string, number>();
  for (const [pos, starters] of Object.entries(config.startersPerPosition)) {
    const scores = byPosition.get(pos) ?? [];
    const replacementIndex = config.teamCount * starters; // 0-indexed
    replacementLevel.set(pos, scores[replacementIndex] ?? 0);
  }

  return replacementLevel; // position → replacement-level points
}

/**
 * Calculate VORP for a single player.
 */
function calculateVORP(
  projectedPoints: number,
  position: string,
  replacementLevel: Map<string, number>
): number {
  const replacement = replacementLevel.get(position) ?? 0;
  return projectedPoints - replacement;
}

/**
 * Calculate VORP for all players.
 * Returns Map<playerId, { vorpPoints, vorpDollar }>.
 */
export function calculateAllVORP(
  projectedScores: Map<string, number>,
  players: Map<string, { position: string }>,
  pointsPerDollar: number,
  config?: VORPConfig
): Map<string, { vorpPoints: number; vorpDollar: number }>
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/utils/vorp.ts` | `calculateReplacementLevels()`, `calculateVORP()`, `calculateAllVORP()`, `THE_LEAGUE_VORP_CONFIG` |
| `tests/vorp.test.ts` | Unit tests for VORP calculations |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/cr.astro` | Add projected scores glob import, calculate VORP map, pass as `vorpMap` prop to React component |
| `src/components/theleague/custom-rankings/CustomRankingsPage.tsx` | Accept `vorpMap` prop, add "VORP" toggle button in toolbar, pass down to child components |
| `src/components/theleague/custom-rankings/PlayerRow.tsx` | Render VORP chip when enabled (green for positive, gray/red for negative) |
| `src/styles/custom-rankings.css` | Add `.cr-vorp-chip` styles (green/red badge) |

---

## Key Patterns

- Follow the existing **prop-passing pattern** from `cr.astro` → `CustomRankingsPage.tsx` (see how `mflPlayers` prop is passed and consumed)
- VORP chip should use position-based color coding consistent with existing position badges
- VORP display format: `+42.3` for positive (green), `-5.2` for negative (muted/red)
- Toggle state can be stored in React component state (no need for persistence — resets on page load)

---

## Access Control

Already gated — `cr.astro` has `export const prerender = false` and checks `getAuthUser()` + `isAdminFranchise()`. No additional gating needed.

---

## UI Design

### Toggle in toolbar

Add alongside existing controls (Edit toggle, position filter):

```
[Edit] [ALL QB RB WR TE DEF]  [VORP]
                                  ↑ toggle on/off
```

### PlayerRow with VORP enabled

```
┌──────────────────────────────────────────────────────────┐
│ #1  ○ Brock Bowers     TE · LV      VORP: +42.3 pts    │
│ #2  ○ Ja'Marr Chase    WR · CIN     VORP: +38.1 pts    │
│ #3  ○ Josh Allen       QB · BUF     VORP: +35.8 pts    │
│ #4  ○ Travis Kelce     TE · KC      VORP: +28.5 pts    │
│                                                          │
│ ...                                                      │
│                                                          │
│ #150 ○ John Doe        RB · NYJ     VORP: -8.2 pts     │
└──────────────────────────────────────────────────────────┘
```

### VORP chip styles

- Positive: green background (`#059669`), white text
- Zero/Near-zero: gray background
- Negative: red/muted background (`#dc2626` at reduced opacity)

---

## Testing

### Unit tests (`tests/vorp.test.ts`)

1. **`calculateReplacementLevels`:**
   - QB replacement at index 16 (QB17) with 16 teams, 1 starter
   - RB replacement at index 32 (RB33) with 16 teams, 2 starters
   - WR replacement at index 48 (WR49) with 16 teams, 3 starters
2. **`calculateVORP`:**
   - Top-tier player: significantly positive
   - Replacement-level player: approximately 0
   - Below-replacement: negative
3. **Edge cases:**
   - Position with fewer players than the replacement threshold (e.g., only 10 QBs → replacement level is last player)
   - Player with 0 projected points → negative VORP
   - DEF position: verify replacement level makes sense

### Integration test

4. Verify VORP prop flows correctly from `cr.astro` → React component → PlayerRow display

---

## What's New

Add entry with `"excludeFromHero": true` (admin-only):
- **category:** `enhancement`
- **copy direction:** "Now you can see which players are actually elite versus just filling a roster spot. VORP tells you the difference between a league-winner and a warm body."
