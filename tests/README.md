# Team Preferences Testing

This directory contains comprehensive tests for the team preference cookie system.

## Test Files

### 1. Unit Tests: `team-preferences.test.ts`

Tests the core cookie utility functions without requiring a browser.

**Coverage:**
- ✅ Franchise ID validation
- ✅ Team selection priority order
- ✅ Cookie get/set/clear operations
- ✅ Cookie corruption handling
- ✅ ID normalization (0000 → 0001, padding, etc.)
- ✅ Edge cases (whitespace, invalid data, etc.)

**Run:**
```bash
npm run test:unit
# or
npx vitest run tests/team-preferences.test.ts
```

### 2. E2E Tests: `e2e-cookie-test.mjs`

Tests actual HTTP requests and cookie behavior with the running dev server.

**Coverage:**
- ✅ Cookie setting via `?myteam` parameter
- ✅ Cookie persistence across requests
- ✅ View-only mode with `?franchise` parameter
- ✅ Cookie updates with new `?myteam` values
- ✅ Invalid franchise ID handling
- ✅ Commissioner ID normalization
- ✅ Short ID padding
- ✅ Parameter priority order

**Run:**
```bash
npm run test:e2e
# or
node tests/e2e-cookie-test.mjs
```

## Running All Tests

```bash
npm test
```

This runs both unit tests and E2E tests sequentially.

## Test Results (Current)

- **Unit Tests:** 23/23 passing ✅
- **E2E Tests:** 8/8 passing ✅
- **Total:** 31/31 passing ✅

## Manual Testing Checklist

For manual browser testing, see [PERSONALIZATION.md](../PERSONALIZATION.md) testing checklist.

Quick manual test:
1. Visit `http://localhost:4321/theleague/rosters?myteam=0003`
2. Open DevTools → Application → Cookies
3. Verify `theleague_team_pref` cookie exists with `franchiseId: "0003"`
4. Navigate to `/theleague/rosters` (no params)
5. Verify team 0003 is still displayed
6. Visit `/theleague/rosters?franchise=0008`
7. Verify team 0008 is shown but cookie still has `0003`

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Run Tests
  run: |
    npm run build
    npm run dev & # Start dev server in background
    sleep 5 # Wait for server
    npm test
```

## Adding New Tests

### Unit Tests
Add to `team-preferences.test.ts`:
```typescript
it('should handle new edge case', () => {
  const result = validateFranchiseId('edge-case');
  expect(result).toBe(expectedValue);
});
```

### E2E Tests
Add to `e2e-cookie-test.mjs`:
```javascript
await runner.test('Should test new behavior', async () => {
  const { status, cookies } = await makeRequest(
    `${BASE_URL}/path?param=value`
  );
  runner.assertEqual(status, 200, 'Should succeed');
});
```

## Debugging Failed Tests

### Unit Tests
```bash
# Run in watch mode
npx vitest tests/team-preferences.test.ts

# Run with coverage
npx vitest run --coverage
```

### E2E Tests
```bash
# Increase verbosity
DEBUG=* node tests/e2e-cookie-test.mjs

# Test against production
TEST_URL=https://yourdomain.com node tests/e2e-cookie-test.mjs
```

## Test Coverage

Run coverage report:
```bash
npx vitest run --coverage
```

Current coverage for `src/utils/team-preferences.ts`:
- Statements: ~100%
- Branches: ~100%
- Functions: ~100%
- Lines: ~100%
