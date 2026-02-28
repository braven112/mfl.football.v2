# Surplus Value Calculator

## Overview

A core utility module (`src/utils/surplus-value.ts`) that converts projected fantasy points into dollar values and compares them against likely salary costs to produce a surplus value per player. Positive surplus = bargain, negative surplus = overpay. This utility powers the Free Agent Targets, VORP Rankings, and Trade Value Analyzer features.

**Who sees it:** Not a page itself — it is a utility consumed by other features. Only admin-gated pages (franchise 0001/0000) will surface its output.

**Related docs:** [Dynasty Value Analysis Index](dynasty-value-analysis-index.md)

---

## Dependencies

None. This is the foundational utility that must be built first.

---

## Architecture

Pure TypeScript utility at `src/utils/surplus-value.ts` with no UI component. Exports pure functions that accept data and return calculations. Types live in `src/types/surplus-value.ts`.

### Data Flow

```
projectedScores.json → projected points per player
players.json → player metadata (position, age, team)
rosters.json → which players are rostered + salary/contract info
mfl-salary-averages-{year}.json → positional salary benchmarks
adp-dynasty.json / Custom Rankings KV → market demand signal
   ↓
surplus-value.ts functions
   ↓
SurplusValueResult per player
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Projected scores | `src/data/theleague/mfl-feeds/{year}/projectedScores.json` | Points → dollar conversion |
| Players | `src/data/theleague/mfl-feeds/{year}/players.json` | Position, age, team |
| Rosters | `src/data/theleague/mfl-feeds/{year}/rosters.json` | Salary, contract years, rostered status |
| Salary averages | `src/data/mfl-salary-averages-{year}.json` | Positional salary benchmarks (`top3Average`, `top5Average`) |
| ADP dynasty | `src/data/theleague/mfl-feeds/{year}/adp-dynasty.json` | Market demand proxy (fallback when no custom rankings) |
| Custom rankings | Vercel KV via `/api/cr` or localStorage | Primary market demand signal |

---

## Algorithm / Core Logic

### Step 1: Calculate league-wide points-per-dollar ratio

```typescript
function calculatePointsPerDollar(
  projectedScores: Map<string, number>,       // playerId → projected season pts
  rosteredPlayers: Map<string, RosteredPlayer> // playerId → { salary, position }
): number {
  // Sum total projected points for ALL rostered players
  let totalPoints = 0;
  let totalSalary = 0;
  for (const [id, roster] of rosteredPlayers) {
    const pts = projectedScores.get(id) ?? 0;
    if (pts > 0 && roster.salary > 0) {
      totalPoints += pts;
      totalSalary += roster.salary;
    }
  }
  // Returns something like 0.0000065 (points per dollar)
  return totalSalary > 0 ? totalPoints / totalSalary : 0;
}
```

### Step 2: Convert projected points to dollar value

```typescript
function pointsToDollarValue(
  projectedPoints: number,
  pointsPerDollar: number
): number {
  if (pointsPerDollar <= 0) return 0;
  return Math.round(projectedPoints / pointsPerDollar);
}
```

### Step 3: Estimate likely auction cost

This is the key estimation. We combine multiple signals:

```typescript
function estimateAuctionCost(
  player: { id: string; position: string; age: number },
  signals: {
    customRank?: number;          // From Custom Rankings (1-based)
    adpDynasty?: number;          // MFL dynasty ADP
    positionSalaryAvg: {
      top3Average: number;
      top5Average: number;
    };
    totalAvailableCap: number;    // Sum of all teams' discretionary cap
    totalFreeAgents: number;      // Count of available players
  }
): number {
  const avgPricePerPlayer = signals.totalFreeAgents > 0
    ? signals.totalAvailableCap / signals.totalFreeAgents
    : 1_000_000;

  // Use custom rank as primary signal, ADP as fallback
  const rank = signals.customRank ?? signals.adpDynasty ?? 999;

  // Rank-to-multiplier curve (exponential decay)
  // Top 10: 4-10x average, Top 30: 2-4x, Top 100: 1-2x, 100+: 0.5-1x
  let multiplier: number;
  if (rank <= 10) {
    multiplier = 10 - (rank - 1) * 0.6;          // 10x → 4.6x
  } else if (rank <= 30) {
    multiplier = 4.6 - ((rank - 10) / 20) * 2.6; // 4.6x → 2.0x
  } else if (rank <= 100) {
    multiplier = 2.0 - ((rank - 30) / 70) * 1.0;  // 2.0x → 1.0x
  } else {
    multiplier = Math.max(0.5, 1.0 - ((rank - 100) / 200) * 0.5); // 1.0x → 0.5x
  }

  let estimated = avgPricePerPlayer * multiplier;

  // Clamp: minimum is league minimum ($425K), max is position top3Average * 1.2
  const floor = 425_000;
  const ceiling = signals.positionSalaryAvg.top3Average * 1.2;
  estimated = Math.max(floor, Math.min(estimated, ceiling));

  // Round to nearest $50K
  return Math.round(estimated / 50_000) * 50_000;
}
```

### Step 4: Calculate surplus value

```typescript
function calculateSurplusValue(
  projectedDollarValue: number,
  estimatedAuctionCost: number
): number {
  return projectedDollarValue - estimatedAuctionCost;
}
```

### Main orchestrator function

```typescript
export function calculateAllSurplusValues(input: SurplusValueInput): SurplusValueResult[]
```

---

## Types

```typescript
// src/types/surplus-value.ts

export interface SurplusValueInput {
  projectedScores: Array<{ id: string; score: string }>;
  players: Array<{ id: string; name: string; position: string; team: string; birthdate?: string }>;
  rosters: Array<{
    id: string;
    player: Array<{ id: string; salary: string; contractYear: string; status: string }>;
  }>;
  salaryAverages: {
    positions: Record<string, { top3Average: number; top5Average: number }>;
  };
  customRankings?: Map<string, number>;   // playerId → rank
  adpDynasty?: Map<string, number>;       // playerId → averagePick
}

export interface SurplusValueResult {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string;
  age: number | null;
  projectedPoints: number;
  dollarValue: number;           // What their production is worth
  estimatedCost: number;         // What they'll likely cost at auction
  surplusValue: number;          // dollarValue - estimatedCost
  surplusPercent: number;        // surplusValue / estimatedCost as %
  isRostered: boolean;
  currentSalary: number | null;
  contractYears: number | null;
  rank: number | null;           // Custom rank or ADP
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/utils/surplus-value.ts` | Core surplus value calculation functions |
| `src/types/surplus-value.ts` | `SurplusValueInput`, `SurplusValueResult` |
| `tests/surplus-value.test.ts` | Unit tests for all calculation functions |

### Modified Files

None — this is a standalone utility.

---

## Key Patterns

- Follow the **pure-function pattern** from `src/utils/salary-calculations.ts` — no side effects, all data passed in as arguments
- Use `parseNumber()` or safe number parsing for MFL JSON strings (salaries come as strings like `"850000"`)
- Reuse `normalizeStatus()` from `src/utils/salary-calculations.ts` for roster player status normalization
- Import `SALARY_CAP`, `ROSTER_LIMIT` constants from `src/utils/salary-calculations.ts`
- Player age calculation: MFL `birthdate` field is a Unix timestamp; convert with `new Date(parseInt(birthdate) * 1000)` and calculate age from today

---

## Access Control

Not applicable — this is a utility module. Access control is enforced by consuming pages.

---

## Testing

**Test file:** `tests/surplus-value.test.ts`

### Key test cases

1. **`calculatePointsPerDollar`** — With realistic league data (total ~3,500 points, ~$45M salary), returns a sensible ratio
2. **`pointsToDollarValue`** — 300 projected points returns a multi-million dollar value; 0 points returns 0
3. **`estimateAuctionCost` rank-to-multiplier curve:**
   - Rank 1 gets highest multiplier (~10x average)
   - Rank 50 gets mid-range (~1.7x)
   - Rank 200+ gets floor (0.5x)
4. **`estimateAuctionCost` clamping** — Never below $425K, never above position top3Average * 1.2
5. **`calculateSurplusValue`** — Positive (bargain), negative (overpay), zero (fair value)
6. **`calculateAllSurplusValues` end-to-end** — With mock data for 10 players across positions
7. **Edge cases:**
   - Player with no projections (0 points → $0 value)
   - Player with no ADP or custom rank (defaults to rank 999 → minimum estimate)
   - Empty rosters input
   - All players are free agents (no rostered players for points-per-dollar baseline)

---

## What's New

No entry needed — this is a backend utility with no user-facing UI.
