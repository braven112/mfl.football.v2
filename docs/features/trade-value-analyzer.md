# Trade Value Analyzer

## Overview

Enhancement to the Trade Builder (`/theleague/trade-builder`) that adds a "Value Analysis" section showing surplus value for each player in the trade and the net surplus value exchanged per side. Answers the question: "Am I getting fair value in this trade, or am I rearranging deck chairs?"

**Who sees it:** The Value Analysis section only appears when the admin franchise (0001/0000) is one of the trade parties. This prevents revealing the admin's private valuations to other users.

**Related docs:** [Surplus Value Calculator](surplus-value-calculator.md) | [Dynasty Value Analysis Index](dynasty-value-analysis-index.md)

---

## Dependencies

- **Surplus Value Calculator** (`src/utils/surplus-value.ts`) — for `calculateAllSurplusValues()`.

---

## Architecture

The Trade Builder is a React component (`TradeBuilder.tsx`) with data passed from the Astro page. Since `trade-builder.astro` is SSR (`prerender = false`), we can use the authenticated user to gate the surplus value data server-side.

### Data Flow

```
Build Time (trade-builder.astro):
  const user = getAuthUser(Astro.request);
  const isAdmin = user && isAdminFranchise(user.franchiseId);

  if (isAdmin) {
    projectedScores + players + rosters + salaryAverages + adpDynasty
      → calculateAllSurplusValues()
      → surplusMap: Record<playerId, SurplusValueResult>
      → pass as prop to TradeBuilder React component
  } else {
    surplusMap = {} (empty)
  }

React (TradeBuilder.tsx):
  If surplusMap is non-empty:
    → Render <TradeValueAnalysis> below cap impact table
    → Show surplus per player, net balance per side
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| Rosters | Already loaded by `trade-builder.astro` | Player salary/contract data |
| Players | Already loaded by `trade-builder.astro` | Player metadata |
| Projected scores (**new glob needed**) | `src/data/theleague/mfl-feeds/{year}/projectedScores.json` | Points for surplus calc |
| Salary averages | Already loaded by `trade-builder.astro` | Position salary benchmarks |
| ADP dynasty | `src/data/theleague/mfl-feeds/{year}/adp-dynasty.json` | Fallback rank signal |

---

## Algorithm / Core Logic

### Trade surplus balance calculation

```typescript
interface TradeSurplusBalance {
  teamASurplusGiven: number;    // Total surplus of players Team A sends away
  teamASurplusReceived: number; // Total surplus of players Team A gets
  teamBSurplusGiven: number;
  teamBSurplusReceived: number;
  netSurplusA: number;          // Positive = Team A "wins" the trade on value
  netSurplusB: number;
}

function calculateTradeSurplusBalance(
  teamAPlayerIds: string[],
  teamBPlayerIds: string[],
  surplusMap: Record<string, SurplusValueResult>
): TradeSurplusBalance {
  const sumSurplus = (ids: string[]) =>
    ids.reduce((sum, id) => sum + (surplusMap[id]?.surplusValue ?? 0), 0);

  const teamAGives = sumSurplus(teamAPlayerIds);
  const teamBGives = sumSurplus(teamBPlayerIds);

  return {
    teamASurplusGiven: teamAGives,
    teamASurplusReceived: teamBGives,
    teamBSurplusGiven: teamBGives,
    teamBSurplusReceived: teamAGives,
    netSurplusA: teamBGives - teamAGives,
    netSurplusB: teamAGives - teamBGives,
  };
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/components/theleague/trade-builder/TradeValueAnalysis.tsx` | React component showing surplus value per player and net balance |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/trade-builder.astro` | Add projected scores glob import, calculate surplus values when admin, pass `surplusMap` prop |
| `src/components/theleague/trade-builder/TradeBuilder.tsx` | Accept `surplusMap` prop, pass to `TradeValueAnalysis`, conditionally render |
| `src/types/trade-builder.ts` | Add `surplusMap?: Record<string, SurplusValueResult>` to `TradeBuilderPageData` |

---

## Key Patterns

- Follow the existing **React component prop pattern** in Trade Builder
- Use `formatCurrency()` from `src/utils/formatters.ts` for dollar display
- Use the same **cap impact table styling** for visual consistency
- Position the Value Analysis section **below the cap impact table, above the share link**
- The `TradeValueAnalysis` component should render **nothing** when `surplusMap` is empty (non-admin users)

---

## Access Control

**Server-side gating** via `getAuthUser()` + `isAdminFranchise()` in the SSR page. The `surplusMap` prop is only populated for admin users — other users receive an empty object and the `TradeValueAnalysis` component renders nothing.

```typescript
// In trade-builder.astro frontmatter
const user = getAuthUser(Astro.request);
const showSurplusValue = user && isAdminFranchise(user.franchiseId);
let surplusMap: Record<string, SurplusValueResult> = {};
if (showSurplusValue) {
  const results = calculateAllSurplusValues(input);
  surplusMap = Object.fromEntries(results.map(r => [r.playerId, r]));
}
```

---

## UI Design

Appears below the existing cap impact section when an admin views a trade:

```
┌─────────────────────────────────────────────────────────┐
│  Value Analysis                                          │
│  ─────────────────────────────────────────────────────── │
│                                                           │
│  You give:                      You get:                 │
│  ┌─────────────────────┐       ┌─────────────────────┐  │
│  │ J. Chase    +$2.1M  │       │ D. Henry    -$0.5M  │  │
│  │ 2027 1st    n/a     │       │ T. Hockenson +$0.3M │  │
│  │ ─────────────────── │       │ ─────────────────── │  │
│  │ Total:      +$2.1M  │       │ Total:       -$0.2M │  │
│  └─────────────────────┘       └─────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Net: You receive +$2.3M more surplus value          │ │
│  │ (or: You give up $2.3M in surplus value)            │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Color coding

- Positive surplus player: green text (`#059669`)
- Negative surplus player: red text (`#dc2626`)
- Net balance favors you: green background
- Net balance against you: red/amber background
- Draft picks: show "n/a" (until Draft Pick Valuation feature is built)

---

## Testing

1. **`calculateTradeSurplusBalance`** — Mock 2 players per side, verify net surplus
2. **Net surplus correctly reflects who "wins"** — Team with higher surplus sent = "loses"
3. **Players not in surplus map** show "n/a" (not $0)
4. **Draft picks** show "n/a" (no surplus value for picks until Feature 9)
5. **Component renders nothing** when `surplusMap` is empty (non-admin)
6. **Edge case:** One-sided trade (player for draft pick only)
7. **Edge case:** Trade with no players (picks only) — show "n/a" for both sides

---

## What's New

Add entry with `"excludeFromHero": true` (admin-only):
- **category:** `enhancement`
- **copy direction:** "The Trade Builder now shows whether you're actually getting fair value or just rearranging deck chairs on the Titanic."
