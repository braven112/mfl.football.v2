# Troubleshooting Guide

## Common Issues

### Build Errors

#### "Cannot find module" errors
**Cause:** Missing dependencies or incorrect import paths

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules
pnpm install

# Check import paths are correct
# Use '@/' alias for src imports
import { util } from '@/utils/my-util';
```

#### Type errors during build
**Cause:** TypeScript compilation issues

**Solution:**
```bash
# Run type check to see all errors
pnpm type-check

# Check specific file
npx tsc --noEmit src/path/to/file.ts
```

#### Prebuild script failures
**Cause:** Missing environment variables or network issues

**Solution:**
1. Check `.env` file has required variables
2. Verify network access to MFL API
3. Run prebuild steps manually to isolate:
   ```bash
   pnpm build:styles
   pnpm update:salary:all
   pnpm fetch:live:lineups
   ```

### Data Issues

#### Stale roster/standings data
**Cause:** Cached JSON data is outdated

**Solution:**
```bash
# Sync latest data from MFL
pnpm sync:theleague
pnpm sync:afl

# Or run the feed fetch script directly
node scripts/fetch-mfl-feeds.mjs
```

#### Missing player data
**Cause:** Player not in players.json or roster data mismatch

**Solution:**
1. Check if player exists in `src/data/theleague/players.json`
2. Verify roster includes the player
3. Re-sync data if needed

#### Wrong year data showing
**Cause:** Year logic issues or stale cache

**Solution:**
1. Check `getCurrentLeagueYear()` and `getCurrentSeasonYear()` output
2. Clear browser cache
3. Test with `?testDate=YYYY-MM-DD` parameter
4. Verify `PUBLIC_BASE_YEAR` env var if set

### Authentication Issues

#### "Unauthorized" errors
**Cause:** Missing or invalid authentication

**Solution:**
1. Check cookie is being set correctly
2. Verify session token is valid
3. Test with X-Auth-User header:
   ```
   X-Auth-User: testuser:0001:13522:TestUser:owner
   ```

#### Franchise ID mismatch
**Cause:** Franchise ID not normalized

**Solution:**
- Ensure franchise IDs are 4-digit strings
- `"1"` should be `"0001"`
- Use `normalizeFranchiseId()` utility

### Development Server Issues

#### Hot reload not working
**Cause:** File watcher issues or circular dependencies

**Solution:**
```bash
# Restart dev server
# Ctrl+C to stop, then:
pnpm dev

# Check for circular imports in error output
```

#### Port already in use
**Cause:** Previous process still running

**Solution:**
```bash
# Find and kill process on port 4321
lsof -ti:4321 | xargs kill -9

# Or use different port
pnpm dev -- --port 4322
```

### Test Failures

#### Tests timing out
**Cause:** Async operations not completing

**Solution:**
1. Check for unresolved promises
2. Add explicit timeouts
3. Ensure mocks are set up correctly

#### Coverage gaps
**Cause:** Untested code paths

**Solution:**
```bash
# Run with coverage
pnpm test:coverage

# Review HTML report
open coverage/index.html
```

### Asset Issues

#### Team logos not loading
**Cause:** Assets not synced or incorrect paths

**Solution:**
```bash
# Re-sync team assets
pnpm sync:theleague
pnpm sync:afl

# Check asset paths in config
# TheLeague: src/data/theleague.config.json
# AFL: data/afl-fantasy/afl.config.json
```

#### Styles not applying
**Cause:** Build styles not run or CSS specificity issues

**Solution:**
```bash
# Rebuild styles
pnpm build:styles

# Check for CSS variable definitions in theme files
```

## Debug Techniques

### Console Logging
Auth logging is built-in:
```typescript
console.log('[auth.ts] cookieHeader present?', !!cookieHeader);
console.log('[auth.ts] sessionToken found?', !!sessionToken);
```

### Date Testing
Add URL parameter to test date-dependent features:
```
http://localhost:4321/theleague/standings?testDate=2026-02-15
```

### MFL API Testing
Test API responses directly:
```bash
# Check MFL API response
curl "https://www.myfantasyleague.com/2025/export?TYPE=rosters&L=13522&JSON=1"
```

## Getting Help

1. Check existing documentation in `/docs`
2. Review test files for usage examples
3. Search codebase for similar patterns
4. Check MFL-API.md for API questions

## Quick Fixes Checklist

- [ ] `pnpm install` - Reinstall dependencies
- [ ] `pnpm build:styles` - Rebuild CSS
- [ ] `pnpm sync:all` - Refresh data from MFL
- [ ] Clear browser cache
- [ ] Restart dev server
- [ ] Check `.env` file
- [ ] Verify import paths
