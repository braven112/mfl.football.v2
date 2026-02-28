# Dynasty Value Analysis System

A suite of 9 interconnected features for maximizing points per dollar in TheLeague's dynasty salary cap format ($45M cap, 10% annual escalation, 28-player rosters).

---

## Implementation Order & Dependencies

```
Phase 1 (foundational — build first):
  └── Surplus Value Calculator          → src/utils/surplus-value.ts

Phase 2 (depends on Phase 1):
  ├── Free Agent Target Prioritization  → enhancement to /theleague/players
  ├── VORP Rankings                     → enhancement to /theleague/cr
  └── Trade Value Analyzer              → enhancement to /theleague/trade-builder

Phase 3 (independent — any order):
  ├── Cap Space Opportunity Cost        → new utility + roster page
  ├── Roster Construction Optimizer     → new section on roster page
  ├── Age-Adjusted Value Curves         → enhancement to /theleague/players
  ├── Positional Scarcity Adjustments   → enhancement to /theleague/cr
  └── Draft Pick Valuation              → enhancement to trade builder + draft predictor
```

---

## Feature Index

| # | Feature | Plan Doc | Priority | Phase | Access |
|---|---------|----------|----------|-------|--------|
| 1 | Surplus Value Calculator | [surplus-value-calculator.md](surplus-value-calculator.md) | Foundational | 1 | Utility (no UI) |
| 2 | Free Agent Target Prioritization | [free-agent-targets.md](free-agent-targets.md) | **#1 User Priority** | 2 | Admin (0001/0000) |
| 3 | VORP Rankings | [vorp-rankings.md](vorp-rankings.md) | High | 2 | Admin (0001/0000) |
| 4 | Trade Value Analyzer | [trade-value-analyzer.md](trade-value-analyzer.md) | High | 2 | Admin (0001/0000) |
| 5 | Cap Space Opportunity Cost | [cap-opportunity-cost.md](cap-opportunity-cost.md) | Medium | 3 | All users |
| 6 | Roster Construction Optimizer | [roster-construction-optimizer.md](roster-construction-optimizer.md) | Medium | 3 | All users |
| 7 | Age-Adjusted Value Curves | [age-value-curves.md](age-value-curves.md) | Medium | 3 | All users |
| 8 | Positional Scarcity Adjustments | [positional-scarcity.md](positional-scarcity.md) | Medium | 3 | Admin (0001/0000) |
| 9 | Draft Pick Valuation | [draft-pick-valuation.md](draft-pick-valuation.md) | Medium | 3 | All users |

---

## Shared Conventions

### Data Loading Pattern
All features use build-time data loading from MFL JSON feeds:
```typescript
const modules = import.meta.glob('../../../data/theleague/mfl-feeds/*/fileName.json', { eager: true });
const getModuleData = (mod: any) => mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
const findForYear = (modules: Record<string, any>, yr: number) => {
  const key = Object.keys(modules).find(k => k.includes(`/${yr}/`));
  return key ? getModuleData(modules[key]) : null;
};
const currentYear = getCurrentLeagueYear();
```

### Admin Detection
- **SSR pages** (`prerender = false`): Use `getAuthUser(Astro.request)` + `isAdminFranchise()`
- **Static pages** (`prerender = true`): Use client-side cookie check on `theleague_team_pref`

### Key Shared Utilities
| Utility | Path | Used By |
|---------|------|---------|
| `SALARY_CAP`, `ESCALATION_RATE` | `src/utils/salary-calculations.ts` | All features |
| `formatCurrency()` | `src/utils/formatters.ts` | All features with dollar display |
| `buildPlayerCellHTML()` | `src/utils/player-cell-html.ts` | Features 2, 7 (Free Agents page) |
| `PlayerCell.astro` | `src/components/theleague/PlayerCell.astro` | Features 5, 6 (Roster page) |
| `calculateCapCharges()` | `src/utils/salary-calculations.ts` | Features 5, 6 |
| `calculateAllSurplusValues()` | `src/utils/surplus-value.ts` | Features 2, 3, 4 (after Phase 1) |

### League-Specific Constants
```typescript
SALARY_CAP = 45_000_000        // $45M
ROSTER_LIMIT = 28              // 28 players
ESCALATION_RATE = 1.10         // 10% annual
TEAM_COUNT = 16                // 16 teams
LEAGUE_MINIMUM = 425_000       // $425K minimum salary

// Scoring (affects scarcity and VORP calculations)
QB: 0.04 pts/passing yard, 6 pts/passing TD
RB: 0.1 pts/rushing yard, 1 pt/rushing TD, 0.25 PPR
WR: 0.1 pts/receiving yard, 1 pt/receiving TD, 0.5 PPR
TE: 0.1 pts/receiving yard, 1 pt/receiving TD, 1.0 PPR (premium)

// Starting lineup per team
QB: 1, RB: ~2, WR: ~3, TE: 1, PK: 1, DEF: 1
```

### Relationship to Auction Predictor
These features complement the [Auction Price Predictor](auction-predictor-design.md) (not yet implemented). Several utilities created here — particularly `surplus-value.ts`, `age-curves.ts`, `positional-scarcity.ts`, and `draft-pick-value.ts` — are designed to be consumed by the Auction Predictor when it is built.

---

## New Files Summary (Across All Features)

### Utilities
| File | Feature |
|------|---------|
| `src/utils/surplus-value.ts` | Surplus Value Calculator |
| `src/types/surplus-value.ts` | Surplus Value types |
| `src/utils/vorp.ts` | VORP Rankings |
| `src/utils/cap-opportunity-cost.ts` | Cap Opportunity Cost |
| `src/utils/roster-optimizer.ts` | Roster Construction Optimizer |
| `src/utils/age-curves.ts` | Age-Adjusted Value Curves |
| `src/utils/positional-scarcity.ts` | Positional Scarcity |
| `src/utils/draft-pick-value.ts` | Draft Pick Valuation |

### Components
| File | Feature |
|------|---------|
| `src/components/theleague/trade-builder/TradeValueAnalysis.tsx` | Trade Value Analyzer |
| `src/components/theleague/OpportunityCostCard.astro` | Cap Opportunity Cost |
| `src/components/theleague/RosterAllocationCard.astro` | Roster Construction Optimizer |

### Tests
| File | Feature |
|------|---------|
| `tests/surplus-value.test.ts` | Surplus Value Calculator |
| `tests/vorp.test.ts` | VORP Rankings |
| `tests/cap-opportunity-cost.test.ts` | Cap Opportunity Cost |
| `tests/roster-optimizer.test.ts` | Roster Construction Optimizer |
| `tests/age-curves.test.ts` | Age-Adjusted Value Curves |
| `tests/positional-scarcity.test.ts` | Positional Scarcity |
| `tests/draft-pick-value.test.ts` | Draft Pick Valuation |

### Styles
| File | Feature |
|------|---------|
| `src/styles/free-agent-targets.css` | Free Agent Targets |

---

## Modified Files Summary

| File | Modified By |
|------|-------------|
| `src/pages/theleague/players.astro` | Free Agent Targets, Age-Adjusted Value Curves |
| `src/pages/theleague/cr.astro` | VORP Rankings, Positional Scarcity |
| `src/pages/theleague/trade-builder.astro` | Trade Value Analyzer, Draft Pick Valuation |
| `src/pages/theleague/rosters.astro` | Cap Opportunity Cost, Roster Construction Optimizer |
| `src/components/theleague/custom-rankings/CustomRankingsPage.tsx` | VORP Rankings, Positional Scarcity |
| `src/components/theleague/custom-rankings/PlayerRow.tsx` | VORP Rankings, Positional Scarcity |
| `src/components/theleague/trade-builder/TradeBuilder.tsx` | Trade Value Analyzer, Draft Pick Valuation |
| `src/styles/custom-rankings.css` | VORP Rankings, Positional Scarcity |
| `src/types/trade-builder.ts` | Trade Value Analyzer, Draft Pick Valuation |
