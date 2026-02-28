# Positional Scarcity Adjustments

## Overview

Enhancement to the Custom Rankings page (`/theleague/cr`) that shows scarcity-adjusted rankings alongside raw rankings. In TheLeague, not all positions are created equal:

- **QB:** 6pt pass TD + only 1 starter → high scarcity
- **RB:** 0.25 PPR (low) → depressed floor, moderate scarcity
- **WR:** 0.5 PPR + ~3 starters → deep position, lower scarcity
- **TE:** 1.0 PPR premium + only 1 starter → **highest scarcity** (few elite options, premium scoring inflates their value)

The Positional Scarcity Index (PSI) measures how much a position's top players outscore replacement level relative to other positions. Higher PSI = more scarce = more valuable in context. Scarcity-adjusted rankings bump up players at scarce positions and bump down players at deep positions.

**Who sees it:** Admin only (franchise 0001/0000) — the Custom Rankings page is already admin-gated.

**Related docs:** [VORP Rankings](vorp-rankings.md) | [Dynasty Value Analysis Index](dynasty-value-analysis-index.md)

---

## Dependencies

- Can share the `calculateReplacementLevels()` function from the **VORP Rankings** feature (`src/utils/vorp.ts`) if built first. If not, this feature can independently compute its own replacement levels using the same approach.

---

## Architecture

1. **Utility:** `src/utils/positional-scarcity.ts` — scarcity index calculation
2. **UI:** New toggle/column in Custom Rankings showing scarcity-adjusted rank

### Data Flow

```
Build Time (cr.astro):
  projectedScores + players
    → calculatePositionalScarcity() (new)
    → scarcityMap: Map<position, PositionalScarcity>
    → pass as prop to CustomRankingsPage

React (CustomRankingsPage.tsx):
  Toggle "Scarcity" → adjusts displayed rank using scarcityMap multipliers
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Projected scores | `src/data/theleague/mfl-feeds/{year}/projectedScores.json` | Points per player for scarcity calculation |
| Players | `src/data/theleague/mfl-feeds/{year}/players.json` | Position grouping |

---

## Algorithm / Core Logic

```typescript
// src/utils/positional-scarcity.ts

export interface PositionalScarcity {
  position: string;
  psi: number;                    // Positional Scarcity Index (higher = more scarce)
  top5Average: number;            // Projected points for top 5 at position
  replacementLevel: number;       // Projected points for replacement player
  scarcityMultiplier: number;     // Factor to adjust raw rankings (> 1 = scarce)
  scarcityRank: number;           // 1st, 2nd, 3rd most scarce position
}

/**
 * PSI Formula: (top5Avg - replacementLevel) / replacementLevel
 *
 * Higher PSI means the gap between elite and replacement is larger,
 * meaning elite players at that position are disproportionately valuable.
 *
 * In TheLeague with TE premium:
 *   TE PSI will be HIGH — few elite TEs, premium scoring widens the gap
 *   QB PSI will be HIGH — 6pt pass TD, only 1 starter
 *   RB PSI will be MODERATE — short careers, high replacement rate
 *   WR PSI will be LOWER — deep position with 0.5 PPR
 */
export function calculatePositionalScarcity(
  projectedScores: Map<string, number>,
  players: Map<string, { position: string }>,
  teamCount: number = 16,
  startersPerPosition: Record<string, number> = {
    QB: 1, RB: 2, WR: 3, TE: 1, PK: 1, DEF: 1
  }
): Map<string, PositionalScarcity> {
  // Group projected scores by position
  const byPosition = new Map<string, number[]>();
  for (const [id, pts] of projectedScores) {
    const player = players.get(id);
    if (!player) continue;
    const pos = normalizePosition(player.position);
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(pts);
  }

  // Sort descending within each position
  for (const scores of byPosition.values()) {
    scores.sort((a, b) => b - a);
  }

  const rawResults: Array<{ pos: string; psi: number; top5Avg: number; repl: number }> = [];

  for (const [pos, scores] of byPosition) {
    const starters = startersPerPosition[pos] ?? 1;
    const replacementIndex = teamCount * starters;
    const replacementLevel = scores[replacementIndex] ?? 0;
    const top5Average = scores.slice(0, 5).reduce((s, v) => s + v, 0)
      / Math.min(5, scores.length);

    const psi = replacementLevel > 0
      ? (top5Average - replacementLevel) / replacementLevel
      : 0;

    rawResults.push({ pos, psi, top5Avg: top5Average, repl: replacementLevel });
  }

  // Rank positions by PSI (highest = 1st most scarce)
  rawResults.sort((a, b) => b.psi - a.psi);

  const results = new Map<string, PositionalScarcity>();
  const maxPSI = rawResults[0]?.psi ?? 1;

  rawResults.forEach((r, i) => {
    // Normalize PSI to a multiplier:
    // Most scarce position gets 20% rank improvement
    // Least scarce gets no adjustment
    const normalizedPSI = maxPSI > 0 ? r.psi / maxPSI : 0;
    const scarcityMultiplier = 1 + (normalizedPSI * 0.20);

    results.set(r.pos, {
      position: r.pos,
      psi: r.psi,
      top5Average: r.top5Avg,
      replacementLevel: r.repl,
      scarcityMultiplier,
      scarcityRank: i + 1,
    });
  });

  return results;
}

/**
 * Adjust a player's raw rank by their position's scarcity.
 * High scarcity → rank improves (lower number = better).
 */
export function adjustRankByScarcity(
  rawRank: number,
  position: string,
  scarcityMap: Map<string, PositionalScarcity>
): number {
  const scarcity = scarcityMap.get(position);
  if (!scarcity) return rawRank;

  // Higher scarcityMultiplier → divide rank by it → rank improves
  // scarcityMultiplier of 1.20 for most scarce → rank 10 becomes ~8
  // scarcityMultiplier of 1.0 for least scarce → rank stays same
  return Math.round(rawRank / scarcity.scarcityMultiplier);
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/utils/positional-scarcity.ts` | `calculatePositionalScarcity()`, `adjustRankByScarcity()` |
| `tests/positional-scarcity.test.ts` | Unit tests |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/cr.astro` | Add projected scores glob (if not already added by VORP), calculate scarcity map, pass as prop |
| `src/components/theleague/custom-rankings/CustomRankingsPage.tsx` | Accept `scarcityMap` prop, add "Scarcity" toggle |
| `src/components/theleague/custom-rankings/PlayerRow.tsx` | Show scarcity-adjusted rank when toggle is on |
| `src/styles/custom-rankings.css` | Add `.cr-scarcity-badge` styles |

---

## Key Patterns

- Follow the **VORP integration pattern** (toggle + additional data in PlayerRow)
- If both VORP and Scarcity toggles exist, they should work independently (can both be on)
- Scarcity badge format: show adjusted rank alongside raw rank, plus position PSI label

---

## Access Control

Already gated — `cr.astro` is admin-only via `getAuthUser()` + `isAdminFranchise()`.

---

## UI Design

### Toggle in toolbar

Add alongside VORP toggle:

```
[Edit] [ALL QB RB WR TE DEF]  [VORP] [Scarcity]
```

### PlayerRow with Scarcity enabled

Show the scarcity-adjusted rank in parentheses alongside the raw rank:

```
┌──────────────────────────────────────────────────────────────┐
│ #12 (→#8)   ○ Player Name    TE · KC    [TE: 1st most scarce]│
│ #15 (→#11)  ○ Player Name    QB · BUF   [QB: 2nd most scarce]│
│ #18 (→#18)  ○ Player Name    WR · LAR   [WR: 5th most scarce]│
└──────────────────────────────────────────────────────────────┘
```

### Position scarcity summary (optional header card)

```
┌─────────────────────────────────────┐
│  Scarcity Rankings                   │
│  1. TE  (PSI: 1.82) — Most scarce  │
│  2. QB  (PSI: 1.45)                 │
│  3. RB  (PSI: 1.12)                 │
│  4. WR  (PSI: 0.88)                 │
│  5. PK  (PSI: 0.45)                 │
│  6. DEF (PSI: 0.32) — Least scarce │
└─────────────────────────────────────┘
```

---

## Testing

### Unit tests (`tests/positional-scarcity.test.ts`)

1. **With TE premium scoring:** TE should have high PSI (likely 1st or 2nd most scarce)
2. **QB with only 1 starter:** Should have high PSI
3. **WR with deep position (3 starters):** Should have lower PSI
4. **`adjustRankByScarcity`:** Most scarce position player moves up (rank decreases); least scarce stays same
5. **Scarcity multiplier range:** Between 1.0 and 1.20
6. **Edge case:** Position with very few projected players
7. **Edge case:** All positions have identical PSI → all multipliers = 1.0

---

## What's New

Add entry with `"excludeFromHero": true` (admin-only):
- **category:** `enhancement`
- **copy direction:** "Because not all positions are created equal — especially when your league pays TEs like first-class passengers. Scarcity-adjusted rankings bump up the positions where elite matters most."
