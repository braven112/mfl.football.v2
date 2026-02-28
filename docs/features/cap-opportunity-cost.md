# Cap Space Opportunity Cost Model

## Overview

A new utility (`src/utils/cap-opportunity-cost.ts`) plus integration into the Roster page that models the cost of leaving cap space unused versus overspending on multi-year contracts. In a salary cap league with 10% annual escalation:

- **Unused cap evaporates** — every dollar you don't spend is gone forever
- **Overpay compounds** — a $500K/yr overpay on a 3-year deal costs $1.66M total (not $1.50M) because the escalation applies to the full salary including the overpay amount

This tool helps find the sweet spot between waste and compounding mistakes.

**Who sees it:** All authenticated users on the Roster page, in a collapsible analysis card.

**Related docs:** [Dynasty Value Analysis Index](dynasty-value-analysis-index.md)

---

## Dependencies

None — independent feature. Uses existing salary calculation utilities.

---

## Architecture

1. **Utility:** `src/utils/cap-opportunity-cost.ts` — pure calculation functions
2. **UI:** New collapsible card on the Roster page below the cap overview cards

### Data Flow

```
Build Time (rosters.astro):
  Current roster + cap charges + dead money
    → calculateCapCharges() (existing)
    → calculateCapSpace() (existing)
    → calculateOverpayCompoundCost() (new)
    → calculateSpendingAnalysis() (new)
    → render <OpportunityCostCard> component

Client Side:
  Optional interactive slider: "What if I leave $X unused?"
  Recalculates cost model in real time via <script> tag
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Rosters | Already loaded by `rosters.astro` | Current salary commitments |
| Salary adjustments | Already loaded by `rosters.astro` | Dead money charges |
| Cap charges | Calculated by existing `calculateCapCharges()` | Current + future year charges |

No new data sources needed — everything derives from existing roster data.

---

## Algorithm / Core Logic

```typescript
// src/utils/cap-opportunity-cost.ts

import { SALARY_CAP, ESCALATION_RATE } from './salary-calculations';

/**
 * Calculate the true cost of overspending on a multi-year contract.
 *
 * Example: Overpay by $500K/year on a 3-year deal
 * Year 1: $500K overpay
 * Year 2: $550K overpay (10% escalation applies to the overpay too!)
 * Year 3: $605K overpay
 * Total: $1,655K wasted — not just $1,500K
 */
export function calculateOverpayCompoundCost(
  overpayPerYear: number,
  contractYears: number,
  escalationRate: number = ESCALATION_RATE
): {
  yearByYear: number[];       // Overpay per year with escalation
  totalOverpay: number;       // Sum of all years
  naiveTotal: number;         // Simple multiplication (overpay * years)
  escalationPenalty: number;  // totalOverpay - naiveTotal (the hidden cost)
} {
  const yearByYear: number[] = [];
  let total = 0;
  for (let y = 0; y < contractYears; y++) {
    const yearCost = overpayPerYear * Math.pow(escalationRate, y);
    yearByYear.push(Math.round(yearCost));
    total += yearCost;
  }
  const naive = overpayPerYear * contractYears;
  return {
    yearByYear,
    totalOverpay: Math.round(total),
    naiveTotal: Math.round(naive),
    escalationPenalty: Math.round(total - naive),
  };
}

/**
 * Calculate spending analysis for various contract lengths.
 * Shows optimal spending range considering unused cap vs. overpay risk.
 */
export function calculateSpendingAnalysis(
  availableCapSpace: number,
  rosterSpotsToFill: number,
  contractLengthOptions: number[] = [1, 2, 3, 4, 5]
): SpendingScenario[] {
  return contractLengthOptions.map(years => {
    // Calculate what a 10% overpay looks like compounded
    const idealPerPlayer = rosterSpotsToFill > 0
      ? availableCapSpace / rosterSpotsToFill
      : availableCapSpace;
    const tenPercentOverpay = idealPerPlayer * 0.1;
    const overpayResult = calculateOverpayCompoundCost(tenPercentOverpay, years);

    return {
      contractYears: years,
      idealSpendPerPlayer: Math.round(idealPerPlayer),
      overpayPer10Pct: overpayResult,
      recommendation:
        years <= 2 ? 'Overpay tolerance is high — escalation has less time to compound'
        : years === 3 ? 'Moderate tolerance — the sweet spot for most signings'
        : 'Minimize overpay — escalation compounds significantly over 4-5 years',
    };
  });
}

interface SpendingScenario {
  contractYears: number;
  idealSpendPerPlayer: number;
  overpayPer10Pct: {
    yearByYear: number[];
    totalOverpay: number;
    naiveTotal: number;
    escalationPenalty: number;
  };
  recommendation: string;
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/utils/cap-opportunity-cost.ts` | `calculateOverpayCompoundCost()`, `calculateSpendingAnalysis()` |
| `src/components/theleague/OpportunityCostCard.astro` | Collapsible card showing cap utilization analysis |
| `tests/cap-opportunity-cost.test.ts` | Unit tests |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/rosters.astro` | Import and render `OpportunityCostCard` below cap overview in the League Planner section |

---

## Key Patterns

- Follow the **existing card patterns** on the Roster page (`MetricCard.astro`, `ChartCard.astro` wrappers)
- Use `formatCurrency()` and `formatCapSpaceDisplay()` from `src/utils/formatters.ts`
- **Collapsible section:** Use `<details>/<summary>` HTML elements for progressive enhancement (no JS required to toggle)
- Use existing `SALARY_CAP` and `ESCALATION_RATE` constants from `src/utils/salary-calculations.ts`

---

## Access Control

Visible to **all authenticated users** viewing their own roster. The data is derived from publicly visible cap information and standard escalation math.

---

## UI Design

### Collapsed state

```
▸ Cap Utilization Analysis
```

### Expanded state

```
┌─────────────────────────────────────────────────────────────┐
│  ▾ Cap Utilization Analysis                                  │
│  ─────────────────────────────────────────────────────────── │
│                                                               │
│  Your available cap: $8.2M                                   │
│  Roster spots to fill: 4                                     │
│  Ideal spend per player: ~$2.05M                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  UNUSED CAP = LOST VALUE                             │    │
│  │  Every dollar you don't spend evaporates.            │    │
│  │  $8.2M unused = $8.2M gone. No rollover.            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  OVERPAY COMPOUNDS                                    │    │
│  │                                                       │    │
│  │  If you overpay by $200K/yr on a 3-year deal:        │    │
│  │  Year 1: $200K                                        │    │
│  │  Year 2: $220K (+10%)                                 │    │
│  │  Year 3: $242K (+10%)                                 │    │
│  │  Total: $662K wasted (not $600K)                      │    │
│  │  Hidden escalation cost: $62K                         │    │
│  │                                                       │    │
│  │  Same $200K overpay on a 5-year deal:                │    │
│  │  Total: $1.22M wasted (not $1.0M)                     │    │
│  │  Hidden escalation cost: $221K                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  TAKEAWAY: Slight overpay on 1-2yr deals is better          │
│  than leaving cap unused. But minimize overpay on 4-5yr     │
│  deals — the escalation penalty is brutal.                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing

### Unit tests (`tests/cap-opportunity-cost.test.ts`)

1. **`calculateOverpayCompoundCost`:**
   - $500K/yr x 3yr = $1,655K total (not $1,500K), escalation penalty = $155K
   - $1M/yr x 5yr with 10% escalation → verify each year's amount and total
   - $0 overpay → all zeros
   - 1-year contract → no escalation (total = overpay)
2. **`calculateSpendingAnalysis`:**
   - With $8M cap and 4 spots → ideal = $2M/player
   - Recommendations change by contract length
   - Edge case: 0 roster spots (shouldn't divide by zero)

---

## What's New

Add entry:
- **category:** `enhancement`
- **excludeFromHero:** `true` (it's a subtle roster page addition)
- **copy direction:** "The difference between leaving $2M on the table and overpaying on a 5-year deal? About $2M in compounding regret. Now your roster page shows you the math so you can stop guessing."
