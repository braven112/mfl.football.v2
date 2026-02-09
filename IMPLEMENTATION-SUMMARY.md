# Team Preferences Cookie Feature - Phase 1 Implementation Summary

**Status:** ✅ Complete
**Date:** 2025-12-24
**Scope:** Phase 1 - Core Infrastructure (TheLeague only)

## What Was Implemented

### 1. Core Utility Library
**File:** [src/utils/team-preferences.ts](src/utils/team-preferences.ts)

**Functions:**
- `validateFranchiseId()` - Validates franchise IDs against league assets
- `getTheLeaguePreference()` - Reads and validates cookie, handles corruption
- `setTheLeaguePreference()` - Sets cookie with validation and normalization
- `clearTheLeaguePreference()` - Removes cookie
- `resolveTeamSelection()` - Implements priority order for team selection
- AFL functions (stubbed for Phase 3)

**Features:**
- ✅ Auto-validates franchise IDs
- ✅ Auto-clears corrupted cookies
- ✅ Normalizes IDs (0000 → 0001, padding)
- ✅ 1-year cookie expiration
- ✅ Secure & SameSite=lax

### 2. Rosters Page Integration
**File:** [src/pages/theleague/rosters.astro](src/pages/theleague/rosters.astro)

**Changes:**
- Imported team preference utilities
- Added dual parameter detection (`?myteam` and `?franchise`)
- Integrated cookie-based team selection
- Maintains backward compatibility

**Priority Order:**
1. `?myteam` parameter → Sets cookie + displays
2. `?franchise` parameter → View only, no cookie change
3. Cookie preference
4. Auth user franchise
5. Default: Team 0001

### 3. Comprehensive Test Suite

#### Unit Tests (23 tests)
**File:** [tests/team-preferences.test.ts](tests/team-preferences.test.ts)

Coverage:
- ✅ Franchise ID validation
- ✅ Team selection priority
- ✅ Cookie operations (get/set/clear)
- ✅ Corruption handling
- ✅ ID normalization
- ✅ Edge cases

**Run:** `npm run test:unit`

#### E2E Tests (8 tests)
**File:** [tests/e2e-cookie-test.mjs](tests/e2e-cookie-test.mjs)

Coverage:
- ✅ Cookie setting via `?myteam`
- ✅ Cookie persistence
- ✅ View-only `?franchise` mode
- ✅ Cookie updates
- ✅ Invalid ID handling
- ✅ ID normalization
- ✅ Priority order

**Run:** `npm run test:e2e`

#### Test Infrastructure
- **Config:** [vitest.config.ts](vitest.config.ts)
- **Documentation:** [tests/README.md](tests/README.md)
- **npm scripts:** `npm test`, `npm run test:unit`, `npm run test:e2e`, `npm run test:watch`, `npm run test:coverage`

### 4. Documentation Updates

**Updated Files:**
- [CLAUDE.md](CLAUDE.md) - Added team personalization overview
- [PERSONALIZATION.md](PERSONALIZATION.md) - Updated with implementation details

## How It Works

### User Flow Example

1. **User visits from MFL:**
   ```
   https://yourdomain.com/theleague/rosters?myteam=0003
   ```
   - Cookie set: `{"franchiseId":"0003","lastUpdated":"..."}`
   - Team 0003 displayed

2. **User navigates to another page:**
   ```
   https://yourdomain.com/theleague/rosters
   ```
   - Cookie read automatically
   - Team 0003 displayed (no params needed)

3. **User views another team:**
   ```
   https://yourdomain.com/theleague/rosters?franchise=0008
   ```
   - Team 0008 displayed
   - Cookie stays 0003 (not updated)

4. **User returns:**
   ```
   https://yourdomain.com/theleague/rosters
   ```
   - Team 0003 displayed (cookie preference)

## Testing Results

### Unit Tests: ✅ 23/23 Passing
```bash
npm run test:unit
```

### E2E Tests: ✅ 8/8 Passing
```bash
npm run test:e2e
```

### Manual Testing
See [PERSONALIZATION.md](PERSONALIZATION.md) Testing Checklist

## Files Modified/Created

### Created:
- ✅ `src/utils/team-preferences.ts`
- ✅ `tests/team-preferences.test.ts`
- ✅ `tests/e2e-cookie-test.mjs`
- ✅ `tests/README.md`
- ✅ `vitest.config.ts`
- ✅ `IMPLEMENTATION-SUMMARY.md` (this file)

### Modified:
- ✅ `src/pages/theleague/rosters.astro`
- ✅ `package.json` (added test scripts)
- ✅ `CLAUDE.md`
- ✅ `PERSONALIZATION.md`

## npm Scripts Added

```json
{
  "test": "pnpm run test:unit && pnpm run test:e2e",
  "test:unit": "vitest run",
  "test:e2e": "node tests/e2e-cookie-test.mjs",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

## Usage Examples

### For Developers

**Set preference:**
```typescript
import { setTheLeaguePreference } from '@/utils/team-preferences';

// In an Astro page
setTheLeaguePreference(Astro.cookies, '0003');
```

**Get preference:**
```typescript
import { getTheLeaguePreference } from '@/utils/team-preferences';

const pref = getTheLeaguePreference(Astro.cookies);
console.log(pref?.franchiseId); // "0003"
```

**Resolve team selection:**
```typescript
import { resolveTeamSelection } from '@/utils/team-preferences';

const teamId = resolveTeamSelection({
  myTeamParam: Astro.url.searchParams.get('myteam'),
  franchiseParam: Astro.url.searchParams.get('franchise'),
  cookiePreference: pref?.franchiseId,
  authUserFranchise: authUser?.franchiseId,
  defaultTeam: '0001',
});
```

### For Users

**From MFL message board:**
```html
<a href="https://yourdomain.com/theleague/rosters?myteam=0003">
  View My Roster
</a>
```

**Sharing team view:**
```html
<a href="https://yourdomain.com/theleague/rosters?franchise=0008">
  Check out Team 0008
</a>
```

## Next Steps (Phase 2)

Per [PERSONALIZATION.md](PERSONALIZATION.md), Phase 2 would include:

1. **Standings Page** - Highlight preferred team, show user's division first
2. **Playoffs Page** - Default to bracket containing user's team
3. **Draft Predictor** - Default to showing user's picks
4. **Playoff Predictor** - Filter relevant games for user's team

## Maintenance

### Running Tests in CI/CD

```yaml
- name: Run Tests
  run: |
    npm run build
    npm run dev &
    sleep 5
    npm test
```

### Adding New Features

When extending this feature:
1. Add unit tests to `tests/team-preferences.test.ts`
2. Add E2E tests to `tests/e2e-cookie-test.mjs`
3. Update [PERSONALIZATION.md](PERSONALIZATION.md)
4. Run `npm test` before committing

## Technical Notes

- **Cookie Name:** `theleague_team_pref`
- **Cookie Lifetime:** 365 days
- **Cookie Path:** `/`
- **SameSite:** `lax`
- **Secure:** `true` in production
- **HttpOnly:** `false` (accessible to client JS)
- **Default Team:** `0001`
- **Validation:** Against `src/data/theleague.assets.json`

## Browser Compatibility

- ✅ Chrome/Edge (modern)
- ✅ Firefox (modern)
- ✅ Safari (modern)
- ✅ Works without JavaScript (URL params only)

## Known Limitations

1. **Phase 1 Scope:** Only TheLeague implemented (AFL in Phase 3)
2. **Manual UI:** Team selector in UI does NOT update cookie (per spec)
3. **Single Preference:** One team per league (multi-team tracking in future enhancements)

## Support

For issues or questions:
- See [PERSONALIZATION.md](PERSONALIZATION.md) for full specification
- See [tests/README.md](tests/README.md) for testing guide
- Run tests: `npm test`
