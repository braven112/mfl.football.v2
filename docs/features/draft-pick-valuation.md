# Draft Pick Valuation

## Overview

Enhancement to the Trade Builder and Draft Predictor that assigns dollar values to draft picks based on historical rookie contract surplus value. In TheLeague, a 1st round pick typically yields a rookie on a ~$750K-$1M/3-year contract who produces like a $2-3M player — that's $1.5-2M in surplus value. This feature quantifies that value so you can make apples-to-apples comparisons in pick-for-player trades.

**Who sees it:** All users in the Trade Builder and Draft Predictor. Draft pick values are derived from league-wide averages and are not secret.

**Related docs:** [Dynasty Value Analysis Index](dynasty-value-analysis-index.md) | [Trade Value Analyzer](trade-value-analyzer.md)

---

## Dependencies

None — independent feature. Uses historical draft data and salary averages. However, if the **Trade Value Analyzer** (Feature 4) is built first, this feature can integrate into its surplus balance calculation (showing pick values alongside player surplus).

---

## Architecture

1. **Utility:** `src/utils/draft-pick-value.ts` — pick valuation constants and functions
2. **UI:** Enhancement to Trade Builder draft pick display + optional Draft Predictor column

### Data Flow

```
Build Time (trade-builder.astro):
  Draft pick data (round, pick number, original owner)
    → calculatePickValue() (new)
    → pickValueMap: Record<pickKey, DraftPickValue>
    → pass as prop to TradeBuilder

Trade Builder React:
  For each draft pick in the trade, show its surplus value
  If Trade Value Analyzer is active, include pick values in balance
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Future draft picks | `src/data/theleague/mfl-feeds/{year}/futureDraftPicks.json` | Pick ownership (round, original team) |
| Draft results | `src/data/theleague/mfl-feeds/{year}/draftResults.json` | Historical draft data |
| Salary averages | `src/data/mfl-salary-averages-{year}.json` | Baseline salary benchmarks for calibration |

---

## Algorithm / Core Logic

```typescript
// src/utils/draft-pick-value.ts

export interface DraftPickValue {
  round: number;
  pickInRound: number;
  overallPick: number;
  expectedSalary: number;           // Typical rookie contract salary
  expectedProductionValue: number;  // What their production is worth in $
  surplusValue: number;             // productionValue - salary
  contractYears: number;            // Typical rookie contract length (3 years)
  totalSurplusOverContract: number; // surplusValue * contractYears
}

/**
 * Base values per round, calibrated to TheLeague's $45M cap.
 *
 * These estimates are derived from:
 * - Historical rookie contract salaries in TheLeague
 * - Average production of drafted rookies by round
 * - The general principle that 1st rounders outperform their contracts
 *   more than later rounds
 */
const ROUND_VALUES: Record<number, {
  avgSalary: number;
  avgProductionValue: number;
  contractYears: number;
}> = {
  1: { avgSalary: 850_000,  avgProductionValue: 2_500_000, contractYears: 3 },
  2: { avgSalary: 600_000,  avgProductionValue: 1_500_000, contractYears: 3 },
  3: { avgSalary: 450_000,  avgProductionValue: 800_000,   contractYears: 3 },
};

/**
 * Calculate the value of a specific draft pick.
 *
 * Within a round, picks decay linearly:
 * Pick 1.01 is worth more than pick 1.16.
 * Decay factor: pick 1 in round = 100%, pick 16 = 60%.
 */
export function calculatePickValue(
  round: number,
  pickInRound: number,
  teamsInLeague: number = 16
): DraftPickValue {
  const roundData = ROUND_VALUES[round];
  if (!roundData) {
    // Compensatory or later-round picks: minimal value
    return {
      round,
      pickInRound,
      overallPick: (round - 1) * teamsInLeague + pickInRound,
      expectedSalary: 425_000,
      expectedProductionValue: 500_000,
      surplusValue: 75_000,
      contractYears: 3,
      totalSurplusOverContract: 225_000,
    };
  }

  // Linear decay within round: pick 1 = 100%, pick 16 = 60%
  const decayFactor = 1 - ((pickInRound - 1) / teamsInLeague) * 0.4;

  const expectedSalary = Math.round(roundData.avgSalary * decayFactor);
  const expectedProductionValue = Math.round(roundData.avgProductionValue * decayFactor);
  const surplusValue = expectedProductionValue - expectedSalary;

  return {
    round,
    pickInRound,
    overallPick: (round - 1) * teamsInLeague + pickInRound,
    expectedSalary,
    expectedProductionValue,
    surplusValue,
    contractYears: roundData.contractYears,
    totalSurplusOverContract: surplusValue * roundData.contractYears,
  };
}

/**
 * For future draft picks where we don't know the exact pick number,
 * estimate using the round's middle pick.
 */
export function estimateFuturePickValue(round: number): DraftPickValue {
  return calculatePickValue(round, 8); // Middle of 16-team round
}

/**
 * Format a pick value for display.
 */
export function formatPickValue(value: DraftPickValue): string {
  return `~${formatCurrency(value.surplusValue)} surplus/yr (${formatCurrency(value.totalSurplusOverContract)} over ${value.contractYears}yr)`;
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/utils/draft-pick-value.ts` | `calculatePickValue()`, `estimateFuturePickValue()`, `ROUND_VALUES` constants |
| `tests/draft-pick-value.test.ts` | Unit tests |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/trade-builder.astro` | Import `draft-pick-value.ts`, calculate pick values for all picks in the trade, pass as `pickValueMap` prop |
| `src/components/theleague/trade-builder/TradeBuilder.tsx` | Show pick values in draft pick display cards |
| `src/types/trade-builder.ts` | Add `pickValueMap?: Record<string, DraftPickValue>` to page data type |

### Optional Modified Files (if Trade Value Analyzer exists)

| File | Change |
|------|--------|
| `src/components/theleague/trade-builder/TradeValueAnalysis.tsx` | Include pick surplus in trade balance calculation (instead of "n/a") |

---

## Key Patterns

- Use `formatCurrency()` from `src/utils/formatters.ts`
- Draft picks in Trade Builder already display with team logos and pick descriptions — add the value as a sub-line
- Follow the existing draft pick rendering pattern in `TradeBuilder.tsx`
- Use existing `futureDraftPicks.json` parsing from `src/utils/draft-utils.ts`

---

## Access Control

Visible to **all users** — pick values are derived from league-wide averages, not personal strategy data.

---

## UI Design

### In Trade Builder — Draft pick display

Current:
```
2027 1st (from Pacific Pigskins)
```

Enhanced:
```
2027 1st (from Pacific Pigskins)
Est. value: ~$1.65M surplus/yr ($4.95M over 3yr)
```

### In Draft Predictor (optional)

Add a "Value" column to the draft order table:

```
┌──────┬───────────────────────┬───────────────────────┐
│ Pick │ Team                  │ Est. Surplus Value     │
├──────┼───────────────────────┼───────────────────────┤
│ 1.01 │ Worst Record FC       │ ~$1.65M/yr ($4.95M)  │
│ 1.02 │ Second Worst          │ ~$1.58M/yr ($4.74M)  │
│ ...  │ ...                   │ ...                   │
│ 1.16 │ Champion              │ ~$0.99M/yr ($2.97M)  │
│ 2.01 │ Worst Record FC       │ ~$0.90M/yr ($2.70M)  │
└──────┴───────────────────────┴───────────────────────┘
```

---

## Testing

### Unit tests (`tests/draft-pick-value.test.ts`)

1. **Round 1 pick 1:** Highest value — verify salary, production value, surplus all > 0
2. **Round 1 pick 16:** ~60% of pick 1's production value (decay factor)
3. **Round 2 vs Round 1:** Round 2 has lower surplus than Round 1
4. **Round 3 vs Round 2:** Further decrease
5. **Unknown round (round 4+):** Returns minimal values ($75K surplus)
6. **`estimateFuturePickValue`:** Uses pick 8 (middle) — between pick 1 and pick 16 values
7. **`formatPickValue`:** Produces human-readable string
8. **Edge cases:**
   - `pickInRound` = 0 → handled gracefully
   - `teamsInLeague` = 1 → no decay
   - Negative round → returns minimal

---

## What's New

Add entry:
- **category:** `enhancement`
- **copy direction:** "Draft picks have dollar values now. So the next time someone offers you a '2027 2nd' for your star player, you'll know exactly how insulting that offer really is. Spoiler: it's probably pretty insulting."

---

## Future Enhancement

- Analyze TheLeague's historical draft data (7 years in `draftResults.json`) to calibrate `ROUND_VALUES` against actual league performance rather than using generic estimates
- Position-specific pick values (a 1st round QB pick is worth more than a 1st round DEF pick)
- Account for pick trading chains (a traded pick might end up at a different slot than originally projected)
