# Code Standards & Conventions

## TypeScript Guidelines

### Type Definitions
- Define interfaces for all data structures
- Use type annotations for function parameters and returns
- Prefer interfaces over type aliases for object shapes
- Export types that are used across files

```typescript
// Good
export interface Player {
  id: string;
  name: string;
  salary: number;
  contractYears: number;
}

export function calculateSalary(player: Player): number {
  return player.salary * player.contractYears;
}

// Avoid
function calculateSalary(player: any) { ... }
```

### Null Handling
- Use optional chaining (`?.`) for potentially undefined values
- Use nullish coalescing (`??`) for default values
- Prefer explicit null checks over truthy checks

```typescript
// Good
const name = player?.name ?? 'Unknown';

// Avoid
const name = player && player.name || 'Unknown';
```

## Import Organization

Order imports in this sequence:
1. Node built-ins
2. External packages
3. Internal utilities
4. Types
5. Data files

```typescript
// Node built-ins
import path from 'path';

// External packages
import { defineConfig } from 'astro/config';

// Internal utilities
import { calculateSalary } from '../utils/salary-calculations';
import { getLeagueContext } from '../utils/league-context';

// Types
import type { Player, Roster } from '../types';

// Data
import rostersData from '../data/theleague/rosters.json';
```

## Naming Conventions

### Files
- `kebab-case` for all file names
- `.ts` for TypeScript
- `.astro` for Astro components
- `.tsx` for React components
- `.test.ts` for test files

### Variables & Functions
- `camelCase` for variables and functions
- `PascalCase` for types, interfaces, and classes
- `SCREAMING_SNAKE_CASE` for constants

```typescript
// Constants
const SALARY_CAP = 45_000_000;
const ROSTER_LIMIT = 28;

// Functions
function calculateCapSpace(roster: Roster[]): number { }

// Interfaces
interface TeamCapSituation { }
```

### Component Names
- `PascalCase` for component files when React
- `kebab-case` for Astro component files

## Error Handling

### Utility Functions
- Return null/undefined for "not found" scenarios
- Throw errors only for programmer mistakes
- Document error conditions in JSDoc

```typescript
/**
 * Get player by ID
 * @returns Player if found, null otherwise
 */
function getPlayer(id: string): Player | null {
  return players.find(p => p.id === id) ?? null;
}
```

### API Endpoints
- Return appropriate HTTP status codes
- Include error messages in response body
- Log errors server-side

```typescript
if (!user) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

## Comments & Documentation

### When to Comment
- Complex algorithms that aren't self-explanatory
- Business rules and domain-specific logic
- TODO items with context
- Workarounds with explanation

### JSDoc for Public Functions
```typescript
/**
 * Calculate cap charges for each salary year
 * Applies 10% annual salary escalation for multi-year contracts
 * @param rows - List of players on roster
 * @returns Array of cap charges, one per year in SALARY_YEARS
 */
export const calculateCapCharges = (rows: CapPlayer[] = []): number[] => { }
```

### Avoid Obvious Comments
```typescript
// Bad - comment states the obvious
// Increment counter
counter++;

// Good - explains the why
// Reset to handle pagination restart on filter change
counter = 0;
```

## Astro Specifics

### Static vs Dynamic
- Use `export const prerender = true` for static pages
- Remove it for dynamic SSR pages

### Props Destructuring
```astro
---
interface Props {
  title: string;
  showNav?: boolean;
}

const { title, showNav = true } = Astro.props;
---
```

## CSS Guidelines

### Use CSS Variables
```css
/* Use theme variables */
.card {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: var(--radius-md);
}
```

### Scoped Styles (Astro)
- Prefer scoped styles in Astro components
- Use `is:global` sparingly
- Keep global styles in layout files

### Mobile-First
- Write base styles for mobile
- Add breakpoints for larger screens

```css
.grid {
  display: flex;
  flex-direction: column;
}

@media (min-width: 768px) {
  .grid {
    flex-direction: row;
  }
}
```

## Git Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Keep first line under 72 characters
- Reference issues when applicable

```
feat: add franchise tag predictor

- Implement scoring algorithm for tag candidates
- Add team cap situation analysis
- Include override functionality

Closes #123
```

## Avoid

- `any` type (use `unknown` if needed, then narrow)
- Magic numbers (use named constants)
- Deep nesting (prefer early returns)
- Mutating function parameters
- Side effects in utility functions
