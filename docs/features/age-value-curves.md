# Age-Adjusted Value Curves

## Overview

Enhancement to the Free Agents page and player data system that shows each player's position on a position-specific production curve. Different positions peak and decline at different ages:

- **QB:** Long plateau (peak 26-34), slow decline
- **RB:** Short window (peak 24-26), sharp cliff at 30
- **WR:** Gradual rise (peak 26-29), moderate decline
- **TE:** Late bloomer (peak 26-30), moderate cliff at 34

This helps answer: "Am I buying a rising stock, a blue chip at peak, or yesterday's news?" — critical for contract length decisions in a dynasty league with 10% annual escalation.

**Who sees it:** All users on the Free Agents page. The age curve data enriches the existing age column.

**Related docs:** [Dynasty Value Analysis Index](dynasty-value-analysis-index.md) | [Surplus Value Calculator](surplus-value-calculator.md) (can consume age multiplier)

---

## Dependencies

None — independent feature. Uses player age from `players.json` and position-specific peak windows.

---

## Architecture

1. **Utility:** `src/utils/age-curves.ts` — position-specific production curve models
2. **UI:** Enhancement to existing player tables — add a "Trajectory" badge/icon next to the age column

The curves are **hardcoded models** based on well-known NFL positional aging patterns. No historical league data analysis is needed for v1, though a future version could analyze the 7 years of `weekly-results-raw.json` data available (2019-2025).

### Data Flow

```
Build Time (players.astro):
  Player age + position
    → getTrajectory(position, age) (new)
    → trajectory badge data serialized alongside player data

Client Side:
  Render trajectory icon/badge next to age in the player table
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Players | Already loaded by `players.astro` | Position and age (via `birthdate` field) |

No new data sources needed. Player age is already calculated from the MFL `birthdate` Unix timestamp on the Free Agents page.

---

## Algorithm / Core Logic

```typescript
// src/utils/age-curves.ts

export type Trajectory = 'ascending' | 'peak' | 'declining' | 'cliff';

interface AgeWindow {
  ascending: [number, number];   // [minAge, maxAge] for ascending phase
  peak: [number, number];        // Peak production window
  declining: [number, number];   // Gradual decline phase
  cliff: number;                 // Age where production drops sharply
}

export const POSITION_AGE_WINDOWS: Record<string, AgeWindow> = {
  QB:  { ascending: [22, 25], peak: [26, 34], declining: [35, 38], cliff: 39 },
  RB:  { ascending: [21, 23], peak: [24, 26], declining: [27, 29], cliff: 30 },
  WR:  { ascending: [21, 25], peak: [26, 29], declining: [30, 32], cliff: 33 },
  TE:  { ascending: [22, 25], peak: [26, 30], declining: [31, 33], cliff: 34 },
  PK:  { ascending: [22, 24], peak: [25, 36], declining: [37, 40], cliff: 41 },
  DEF: { ascending: [0, 0],   peak: [0, 99],  declining: [0, 0],   cliff: 99 },
};

/**
 * Determine a player's trajectory phase based on position and age.
 */
export function getTrajectory(position: string, age: number): Trajectory {
  const window = POSITION_AGE_WINDOWS[position];
  if (!window) return 'peak'; // Unknown position defaults to peak

  if (age >= window.cliff) return 'cliff';
  if (age >= window.declining[0] && age <= window.declining[1]) return 'declining';
  if (age >= window.peak[0] && age <= window.peak[1]) return 'peak';
  if (age >= window.ascending[0] && age <= window.ascending[1]) return 'ascending';
  if (age < window.ascending[0]) return 'ascending'; // Younger than ascending range
  return 'declining'; // Fallback
}

/**
 * Dynasty value multiplier based on age trajectory.
 * Used by surplus-value.ts to adjust contract length recommendations.
 *
 * ascending: 1.15 (production will increase — go long)
 * peak:      1.0  (current production is real)
 * declining: 0.85 (production will decrease — go short)
 * cliff:     0.6  (sharp decline imminent — avoid long contracts)
 */
export function getAgeCurveMultiplier(position: string, age: number): number {
  const trajectory = getTrajectory(position, age);
  switch (trajectory) {
    case 'ascending': return 1.15;
    case 'peak':      return 1.0;
    case 'declining': return 0.85;
    case 'cliff':     return 0.6;
  }
}

/**
 * Get years until decline/cliff for contract length guidance.
 */
export function getYearsUntilDecline(position: string, age: number): {
  yearsUntilDecline: number;
  yearsUntilCliff: number;
  maxRecommendedContractYears: number;
} {
  const window = POSITION_AGE_WINDOWS[position];
  if (!window) return { yearsUntilDecline: 5, yearsUntilCliff: 10, maxRecommendedContractYears: 5 };

  const yearsUntilDecline = Math.max(0, window.declining[0] - age);
  const yearsUntilCliff = Math.max(0, window.cliff - age);
  const maxRecommendedContractYears = Math.min(5, Math.max(1, yearsUntilCliff));

  return { yearsUntilDecline, yearsUntilCliff, maxRecommendedContractYears };
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/utils/age-curves.ts` | `getTrajectory()`, `getAgeCurveMultiplier()`, `getYearsUntilDecline()`, `POSITION_AGE_WINDOWS` |
| `tests/age-curves.test.ts` | Unit tests for all age functions |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/players.astro` | Add trajectory data to the serialized player list, render trajectory badge/icon next to age in the table |

---

## Key Patterns

- **Badge colors:**
  - Ascending: green (`#059669`) + up-arrow icon
  - Peak: blue (`#0ea5e9`) + equals icon
  - Declining: amber (`#f59e0b`) + down-arrow icon
  - Cliff: red (`#dc2626`) + warning icon
- **Follow existing badge patterns** already in the Free Agents table (injury badges, rookie badges)
- **Keep it subtle** — small icon/indicator next to the age number, not a large component
- Player age calculation from MFL `birthdate` field: `new Date(parseInt(birthdate) * 1000)` → calculate years from today

---

## Access Control

Visible to **all users** — age trajectory is derived from public player data and is not a competitive advantage (it's common fantasy football knowledge).

---

## UI Design

### In the Free Agents table age column

Replace the plain age number with age + trajectory indicator:

```
Age 23 ↑    (green — ascending)
Age 27 ═    (blue — peak)
Age 31 ↓    (amber — declining)
Age 33 ⚠    (red — cliff)
```

### Tooltip on hover (optional enhancement)

```
┌──────────────────────────────┐
│ WR Peak Window: 26-29        │
│ Current: Ascending (age 23)  │
│ Years until decline: 7       │
│ Max contract: 5 years        │
└──────────────────────────────┘
```

### Mobile

Same compact format — the icon takes minimal space alongside the age number.

---

## Testing

### Unit tests (`tests/age-curves.test.ts`)

1. **`getTrajectory` by position:**
   - RB age 24 → `'peak'`
   - WR age 22 → `'ascending'`
   - QB age 35 → `'declining'`
   - RB age 30 → `'cliff'`
   - TE age 28 → `'peak'`
   - DEF any age → `'peak'`
2. **`getAgeCurveMultiplier`:**
   - Ascending → 1.15
   - Peak → 1.0
   - Declining → 0.85
   - Cliff → 0.6
3. **`getYearsUntilDecline`:**
   - RB age 23 → `yearsUntilDecline: 4` (decline starts at 27)
   - WR age 29 → `yearsUntilDecline: 1` (decline starts at 30)
   - QB age 38 → `yearsUntilDecline: 0` (already declining)
4. **`maxRecommendedContractYears`:**
   - RB age 29 → max 1 year (cliff at 30)
   - WR age 22 → max 5 years (cliff at 33)
5. **Edge cases:**
   - Age younger than ascending range (e.g., 20) → `'ascending'`
   - Unknown position → defaults to `'peak'`

---

## What's New

Add entry:
- **category:** `enhancement`
- **copy direction:** "Every player has a shelf life. Now the Free Agents page tells you whether you're buying a rising stock, a blue chip at peak value, or yesterday's news. Because signing a 29-year-old RB to a 5-year deal is the dynasty equivalent of buying milk that expires tomorrow."

---

## Future Enhancement

Analyze 7 years of `weekly-results-raw.json` (2019-2025) to build league-specific aging curves rather than using NFL-wide hardcoded windows. This would account for TheLeague's TE premium scoring potentially extending TE peak windows.
