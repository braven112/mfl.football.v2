# MFL Football v2

## Development Principle

ALL features, utilities, and data structures should be designed with the **Auction Price Predictor** in mind. Every function must be **reusable** and **composable**.

---

## Year Rollover System

Two critical dates drive year transitions:

| Date | Event | What Changes |
|------|-------|--------------|
| **Feb 14th @ 8:45 PT** | New MFL league created | `getCurrentLeagueYear()` updates |
| **Labor Day** | NFL season starts | `getCurrentSeasonYear()` updates |

### Decision Framework

**Use `getCurrentLeagueYear()`** for:
- Rosters, contracts, salary cap, auctions, trade analysis
- Key question: *"Does this page help manage my roster?"*

**Use `getCurrentSeasonYear()`** for:
- Standings, playoffs, MVP tracking, draft order
- Key question: *"Does this page show results from games played?"*

```typescript
import { getCurrentLeagueYear, getCurrentSeasonYear, getNextDraftYear, getNextAuctionYear } from '../utils/league-year';
```

Test date-dependent features with `?testDate=YYYY-MM-DD` URL parameter.

---

## Team Name Display

**CRITICAL:** Always use `chooseTeamName()` to prevent UI overflow:

```typescript
import { chooseTeamName } from '../utils/team-names';

const displayName = chooseTeamName({
  fullName: team.name,
  nameMedium: assets?.nameMedium,  // ≤15 chars (default)
  nameShort: assets?.nameShort,    // ≤10 chars
  abbrev: assets?.abbrev,          // 2-6 chars
}, 'default'); // Context: 'default' | 'short' | 'abbrev'
```

Config locations:
- TheLeague: `src/data/theleague.config.json`
- AFL Fantasy: `data/afl-fantasy/afl.config.json`

---

## League Context

Two leagues share this codebase:

| League | Slug | MFL ID | Data Path |
|--------|------|--------|-----------|
| TheLeague | `theleague` | 13522 | `src/data/theleague/` |
| AFL Fantasy | `afl` | 19621 | `data/afl-fantasy/` |

---

## Key Utilities

| Utility | Purpose |
|---------|---------|
| `src/utils/league-year.ts` | Year rollover logic |
| `src/utils/team-names.ts` | Team name display |
| `src/utils/salary-calculations.ts` | Cap math (10% escalation) |
| `src/utils/auth.ts` | Authentication |
| `src/utils/team-preferences.ts` | Cookie-based preferences |
| `src/utils/league-context.ts` | Dual-league support |

---

## Documentation Index

For detailed documentation, see `docs/claude/`:

| Document | Contents |
|----------|----------|
| [build-dev.md](docs/claude/build-dev.md) | Build commands, npm scripts, dev workflow |
| [data-flow.md](docs/claude/data-flow.md) | MFL API, data sources, cache layer |
| [components.md](docs/claude/components.md) | Astro/React patterns, layouts, styling |
| [testing.md](docs/claude/testing.md) | Vitest, test patterns, coverage |
| [auth.md](docs/claude/auth.md) | Authentication, sessions, cookies |
| [code-standards.md](docs/claude/code-standards.md) | TypeScript, imports, naming conventions |
| [troubleshooting.md](docs/claude/troubleshooting.md) | Common issues, debug techniques |
| [critical-assumptions.md](docs/claude/critical-assumptions.md) | Hardcoded values ($45M cap, 10% escalation) |
| [league-rules.md](docs/claude/league-rules.md) | TheLeague rules, scoring, roster config |
| [afl-rules.md](docs/claude/afl-rules.md) | AFL Fantasy rules, scoring, roster config |

### Feature Documentation

| Document | Contents |
|----------|----------|
| [AUCTION_PREDICTOR_REQUIREMENTS.md](AUCTION_PREDICTOR_REQUIREMENTS.md) | User stories, functional requirements |
| [AUCTION_PREDICTOR_DESIGN.md](AUCTION_PREDICTOR_DESIGN.md) | System architecture, algorithms |
| [AUCTION_PREDICTOR_TASKS.md](AUCTION_PREDICTOR_TASKS.md) | Implementation tasks |
| [MFL-API.md](MFL-API.md) | MFL API reference |
| [PERSONALIZATION.md](PERSONALIZATION.md) | Team preference cookie system |

---

## Quick Reference

### Critical Constants
```typescript
SALARY_CAP = 45_000_000       // $45M
ROSTER_LIMIT = 28             // 28 players
ESCALATION_RATE = 1.10        // 10% annual
```

### Common Commands
```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm test         # Run all tests
pnpm sync:all     # Sync data from MFL
```

---

## Team Strategy (Fantasy Football)

This section describes the dynasty fantasy football strategy that informs feature priorities and analysis tools.

**Primary Goal:** Sign as many long-term contracts as possible by targeting **young, inexpensive players** to build sustained dynasty dominance.

**Secondary Goal:** Acquire good short-term contracts (1-2 years) that provide trade asset value, roster depth, and plug-and-play starters.
