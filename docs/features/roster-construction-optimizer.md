# Roster Construction Optimizer

## Overview

New section on the Roster page that models optimal cap allocation by position and compares it against the user's current roster. Given a $45M cap and 28 roster spots in a TE-premium scoring system, how much should you spend at each position? Shows specific recommendations like "You're over-allocated at RB by $3M — consider trading a RB" or "Target a WR in the auction — you're $2M under target."

**Who sees it:** All authenticated users on the Roster page.

**Related docs:** [Dynasty Value Analysis Index](dynasty-value-analysis-index.md) | [Cap Opportunity Cost](cap-opportunity-cost.md)

---

## Dependencies

None — independent feature. Uses existing salary data from rosters.

---

## Architecture

1. **Utility:** `src/utils/roster-optimizer.ts` — optimal allocation logic and comparison
2. **UI:** New `RosterAllocationCard.astro` component on the Roster page

### Data Flow

```
Build Time (rosters.astro):
  Roster data (salary per player, position, status)
    → analyzeRosterAllocation() (new)
    → AllocationAnalysis[] per position
    → render <RosterAllocationCard>
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Rosters | Already loaded by `rosters.astro` | Player salary and position |
| Config | `src/data/theleague.config.json` or `src/data/theleague.assets.json` | Team metadata |

No new data sources needed.

---

## Algorithm / Core Logic

### Optimal allocation model

```typescript
// src/utils/roster-optimizer.ts

import { SALARY_CAP, ROSTER_LIMIT } from './salary-calculations';

/**
 * Optimal cap allocation percentages for TheLeague's scoring system.
 *
 * Scoring context:
 *   QB: 0.04/pass yd, 6pt pass TD (high QB value)
 *   RB: 0.1/rush yd, 0.25 PPR (low PPR depresses floor)
 *   WR: 0.1/rec yd, 0.5 PPR (moderate PPR)
 *   TE: 0.1/rec yd, 1.0 PPR (premium — TEs score disproportionately)
 *
 * These are RECOMMENDED ranges, not hard rules.
 */
const OPTIMAL_ALLOCATION: Record<string, {
  minPct: number;
  maxPct: number;
  targetPct: number;
  idealCount: number;
  description: string;
}> = {
  QB:  { minPct: 0.12, maxPct: 0.20, targetPct: 0.16, idealCount: 2,
         description: '1 elite starter + 1 backup' },
  RB:  { minPct: 0.18, maxPct: 0.28, targetPct: 0.22, idealCount: 5,
         description: '2-3 starters + handcuffs' },
  WR:  { minPct: 0.22, maxPct: 0.32, targetPct: 0.27, idealCount: 6,
         description: '3-4 starters + depth' },
  TE:  { minPct: 0.08, maxPct: 0.18, targetPct: 0.12, idealCount: 2,
         description: '1 elite (TE premium) + backup' },
  PK:  { minPct: 0.01, maxPct: 0.04, targetPct: 0.02, idealCount: 1,
         description: '1 reliable kicker' },
  DEF: { minPct: 0.02, maxPct: 0.06, targetPct: 0.03, idealCount: 2,
         description: '1-2 streaming/matchup' },
};

// Reserve for rookies/BBID: ~11% of cap ($5M)
const RESERVE_PCT = 0.11;

interface AllocationAnalysis {
  position: string;
  currentSpend: number;
  currentPct: number;
  targetSpend: number;
  targetPct: number;
  delta: number;           // currentSpend - targetSpend
  status: 'over' | 'under' | 'optimal';
  recommendation: string;
  playerCount: number;
  idealCount: number;
}

export function analyzeRosterAllocation(
  roster: Array<{ position: string; salary: number; status?: string }>,
  capLimit: number = SALARY_CAP
): AllocationAnalysis[] {
  // Group salary by position
  const spendByPosition = new Map<string, { total: number; count: number }>();
  for (const player of roster) {
    const pos = normalizePosition(player.position);
    const current = spendByPosition.get(pos) ?? { total: 0, count: 0 };
    current.total += player.salary;
    current.count += 1;
    spendByPosition.set(pos, current);
  }

  const allocatable = capLimit * (1 - RESERVE_PCT);

  return Object.entries(OPTIMAL_ALLOCATION).map(([pos, target]) => {
    const current = spendByPosition.get(pos) ?? { total: 0, count: 0 };
    const currentPct = current.total / capLimit;
    const targetSpend = allocatable * target.targetPct;
    const delta = current.total - targetSpend;

    // 2% tolerance band ($900K)
    const tolerance = capLimit * 0.02;
    let status: 'over' | 'under' | 'optimal';
    if (delta > tolerance) status = 'over';
    else if (delta < -tolerance) status = 'under';
    else status = 'optimal';

    const recommendation = status === 'over'
      ? `Consider trading a ${pos} — you're ${formatCurrency(Math.abs(delta))} over target`
      : status === 'under'
      ? `Target a ${pos} in the auction — you're ${formatCurrency(Math.abs(delta))} under target`
      : `${pos} allocation looks good`;

    return {
      position: pos,
      currentSpend: current.total,
      currentPct,
      targetSpend: Math.round(targetSpend),
      targetPct: target.targetPct,
      delta: Math.round(delta),
      status,
      recommendation,
      playerCount: current.count,
      idealCount: target.idealCount,
    };
  });
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/utils/roster-optimizer.ts` | `analyzeRosterAllocation()`, `OPTIMAL_ALLOCATION` constants |
| `src/components/theleague/RosterAllocationCard.astro` | Visual comparison of current vs. optimal allocation |
| `tests/roster-optimizer.test.ts` | Unit tests |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/rosters.astro` | Import and render `RosterAllocationCard` in the League Planner view |

---

## Key Patterns

- Use `POSITION_COLORS` from `src/constants/roster-constants.ts` for position-coded bar chart segments
- Follow the existing **chart card patterns** on the Roster page (`DonutChart.astro`, `BarChart.astro`)
- Use the `ChartCard.astro` wrapper for consistent card styling
- Use `formatCurrency()` from `src/utils/formatters.ts`
- Import `normalizePosition()` from wherever it's defined in the codebase (check roster utilities)

---

## Access Control

Visible to **all authenticated users** viewing their own roster.

---

## UI Design

### Horizontal bar comparison

```
┌─────────────────────────────────────────────────────────────┐
│  Cap Allocation vs. Optimal                                  │
│  ─────────────────────────────────────────────────────────── │
│                                                               │
│  Position  Target    Actual    Delta       Action             │
│  ──────── ──────── ──────── ──────────── ─────────────────── │
│  QB       16%      22%      +$1.2M over  Consider trading    │
│           ████░░   ██████                                    │
│                                                               │
│  RB       22%      18%      -$1.8M under Target in auction   │
│           ██████░  ████░░                                    │
│                                                               │
│  WR       27%      25%      Optimal      Looks good          │
│           ███████  ██████                                    │
│                                                               │
│  TE       12%      14%      Optimal      Looks good          │
│           ███░░░░  ████░░                                    │
│                                                               │
│  PK        2%       2%      Optimal      Looks good          │
│           █░░░░░░  █░░░░░                                    │
│                                                               │
│  DEF       3%       4%      Optimal      Looks good          │
│           █░░░░░░  █░░░░░                                    │
│                                                               │
│  Reserve  11%      15%      +$1.8M       Extra cap to spend  │
└─────────────────────────────────────────────────────────────┘
```

### Color coding

- **Over:** Red bar for actual, recommendation text in amber
- **Under:** Gray bar for actual, recommendation text in green
- **Optimal:** Green bar for actual, checkmark

---

## Testing

### Unit tests (`tests/roster-optimizer.test.ts`)

1. **Balanced roster** — All positions show "optimal" status
2. **QB-heavy roster** — QB shows "over", some positions show "under"
3. **Empty roster** — All positions show "under" with full target amounts as deltas
4. **Single expensive player** — One RB at $15M shows RB as massively "over"
5. **Player count vs. ideal count** — Verify correct counts per position
6. **Tolerance band** — Delta of $800K (under 2% of $45M) should be "optimal", $1M should be "over" or "under"

---

## What's New

Add entry:
- **category:** `enhancement`
- **copy direction:** "Your roster page now shows whether your cap allocation looks like a championship contender or a fantasy football Frankenstein's monster. It's one thing to feel like you need a WR — it's another to see the bar chart proving you're $3M short."
