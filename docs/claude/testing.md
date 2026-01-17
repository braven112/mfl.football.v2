# Testing Guide

## Test Framework

- **Vitest** - Unit testing framework
- **fast-check** - Property-based testing

## Running Tests

```bash
# Run all tests once
pnpm test

# Run unit tests only
pnpm test:unit

# Run e2e tests only
pnpm test:e2e

# Watch mode (re-run on file changes)
pnpm test:watch

# With coverage report
pnpm test:coverage
```

## Test File Organization

```
tests/
├── capMath.test.ts                    # Salary cap calculations
├── cap-space-calculator.test.ts       # Cap space projections
├── franchise-tag-predictor.test.ts    # Tag prediction logic
├── auction-price-calculator.test.ts   # Auction pricing
├── team-preferences.test.ts           # Cookie/preference handling
├── matchup-*.test.ts                  # Matchup-related tests
├── e2e-cookie-test.mjs               # E2E cookie testing
└── README.md                          # Test documentation

src/utils/__tests__/
└── extension-salary-calculator.test.ts  # Co-located test
```

## Vitest Configuration

Location: `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    globals: true,           // Use global test functions
    environment: 'node',     // Node environment
    include: ['tests/**/*.test.ts', 'tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/utils/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
```

## Writing Tests

### Basic Test Structure
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { myFunction } from '../src/utils/my-utility';

describe('myFunction', () => {
  beforeEach(() => {
    // Setup before each test
  });

  it('should return expected result', () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });

  it('should handle edge cases', () => {
    expect(myFunction(null)).toBeUndefined();
  });
});
```

### Testing Async Functions
```typescript
it('should fetch data correctly', async () => {
  const result = await fetchData();
  expect(result).toHaveProperty('data');
});
```

### Property-Based Testing (fast-check)
```typescript
import fc from 'fast-check';

it('should always return positive number', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1 }), (n) => {
      return calculateValue(n) > 0;
    })
  );
});
```

## Test Patterns Used

### Cap Calculations
```typescript
describe('calculateCapCharges', () => {
  it('should apply 10% annual escalation', () => {
    const players = [{ salary: 1000000, contractYears: 3 }];
    const charges = calculateCapCharges(players);

    expect(charges[0]).toBe(1000000);      // Year 1
    expect(charges[1]).toBe(1100000);      // Year 2 (+10%)
    expect(charges[2]).toBe(1210000);      // Year 3 (+10%)
  });
});
```

### Team Preferences
```typescript
describe('team preferences', () => {
  it('should normalize franchise ID to 4 digits', () => {
    expect(normalizeFranchiseId('1')).toBe('0001');
    expect(normalizeFranchiseId('0015')).toBe('0015');
  });
});
```

## Coverage Requirements

Coverage is tracked for `src/utils/**/*.ts`:

```bash
# View coverage report
pnpm test:coverage

# Coverage report locations:
# - Console output (text)
# - coverage/index.html (HTML)
# - coverage/coverage.json (JSON)
```

## E2E Testing

The `e2e-cookie-test.mjs` script tests cookie persistence:

```bash
pnpm test:e2e
```

Tests verify:
- Cookie setting and reading
- Cross-page persistence
- League-specific preferences

## Best Practices

1. **Test utilities, not pages** - Focus on `src/utils/` functions
2. **Use descriptive test names** - Describe the expected behavior
3. **Test edge cases** - Null, undefined, empty arrays, boundary values
4. **Keep tests fast** - Avoid real network calls in unit tests
5. **Group related tests** - Use `describe` blocks for organization

## Adding New Tests

1. Create test file in `tests/` directory
2. Name it `{feature}.test.ts`
3. Import functions from `src/utils/`
4. Write tests using Vitest syntax
5. Run `pnpm test` to verify
