# Login Integration - Phase 1 Plan

## Goal
Authenticate users via MFL credentials, resolve their franchise_id, and set the `theleague_team_pref` cookie so their team shows by default across the app.

## Guiding Principle
**No faking it.** If MFL authentication fails or franchise_id can't be resolved, the login fails. We never guess, override, or pretend it worked.

---

## Current State Summary

| Component | Status | File |
|-----------|--------|------|
| Login page UI | Complete | `src/pages/theleague/login.astro` |
| MFL login utility | **Has 3 bugs** | `src/utils/mfl-login.ts` |
| JWT session mgmt | Complete | `src/utils/session.ts` |
| Auth user extraction | Complete | `src/utils/auth.ts` |
| React AuthContext | Complete | `src/components/AuthContext.tsx` |
| Team pref cookies | Complete | `src/utils/team-preferences.ts` |
| **API endpoints** | **Missing** | `src/pages/api/auth/` (empty) |

---

## Bugs in `src/utils/mfl-login.ts` (Must Fix First)

### Bug 1: `USER_FRANCHISE_OVERRIDES` not defined
- **Line 145**: References `USER_FRANCHISE_OVERRIDES` which doesn't exist in this file
- **Fix**: Remove the entire override block (lines 140-150). Per user requirement: no fallbacks, no faking.

### Bug 2: `normalizedUserId` temporal dead zone
- **Line 143**: References `normalizedUserId` before its `const` declaration on line 157
- **Fix**: Move `normalizedUserId` extraction before the override block (or just remove the override block entirely, which eliminates this reference)

### Bug 3: `const normalizedLeagueId` reassignment
- **Line 152**: Declares `const normalizedLeagueId`
- **Line 188**: Attempts to reassign it inside the `myleagues` block
- **Fix**: Change to `let normalizedLeagueId` on line 152

### Bug 4: Non-JSON response = success (dangerous)
- **Lines 78-86**: If MFL returns non-JSON (e.g., HTML error page), the code catches the parse failure and returns `success: true` with empty franchise info
- **Fix**: Return `success: false` when we can't parse the MFL response. We must understand what MFL returned.

---

## Implementation Steps

### Step 1: Fix `src/utils/mfl-login.ts`

1. Remove `USER_FRANCHISE_OVERRIDES` block (lines 140-150) entirely
2. Change `const normalizedLeagueId` to `let normalizedLeagueId` (line 152)
3. Move `normalizedUserId` extraction (lines 157-160) above the franchise override block (now moot since we removed it, but for correctness)
4. Fix non-JSON fallback: change lines 78-85 to return `success: false` with the raw text for debugging
5. Add structured debug logging throughout so the user can diagnose MFL response quirks during testing

**Confidence**: High - these are straightforward code fixes.

### Step 2: Create `POST /api/auth/login` endpoint

**File**: `src/pages/api/auth/login.ts`

**Flow**:
1. Parse request body: `{ username, password, leagueId }`
2. Validate inputs (non-empty username/password)
3. Call `authenticateWithMFL(username, password, leagueId)` from `src/utils/mfl-login.ts`
4. If `!response.success` → return 401 with `response.error`
5. If `!response.franchiseId` → return 401 with clear message: "Login succeeded but franchise could not be determined. Contact commissioner."
6. Create JWT session token via `createSessionToken({ userId, username, franchiseId, leagueId, role })`
7. Set `session_token` cookie via `createSessionCookie()`
8. Set `theleague_team_pref` cookie via `setTheLeaguePreference(cookies, franchiseId)`
9. Return JSON: `{ success: true, user: { userId, username, franchiseId, leagueId, role } }`

**Confidence**: High for the endpoint scaffolding. **Medium** for MFL API integration - the actual MFL response shape needs testing with real credentials. The debug logging from Step 1 will make this testable.

### Step 3: Create `GET /api/auth/me` endpoint

**File**: `src/pages/api/auth/me.ts`

**Flow**:
1. Call `getAuthUser(request)` from `src/utils/auth.ts`
2. If user exists → return `{ authenticated: true, user: { userId, username, franchiseId, leagueId, role } }`
3. If no user → return `{ authenticated: false }`

**Confidence**: High - this just reads and validates the JWT cookie, no external API calls.

### Step 4: Create `POST /api/auth/logout` endpoint

**File**: `src/pages/api/auth/logout.ts`

**Flow**:
1. Clear `session_token` cookie (set expired)
2. Do NOT clear `theleague_team_pref` cookie (team preference persists after logout, as it does today via ?myteam= param)
3. Return `{ success: true }`

**Confidence**: High - no external dependencies.

### Step 5: Remove debug console.logs from `src/utils/auth.ts`

Lines 36-42 have `console.log` statements that were likely left from previous debugging. These should either be:
- Converted to conditional debug logging (only in dev mode), or
- Removed entirely

**Confidence**: High.

### Step 6: Verify integration with existing layout

The existing `TheLeagueLayout.astro` (line 111) already reads the `theleague_team_pref` cookie:
```
const theLeaguePref = getTheLeaguePreference(Astro.cookies);
myteam = myteamParam || theLeaguePref?.franchiseId || ...
```

After login sets this cookie in Step 2, subsequent page loads will automatically pick up the user's team. **No layout changes needed.**

The `resolveTeamSelection()` priority already includes `authUserFranchise` in the chain. Once the session cookie exists, this also works automatically via `getAuthUser()`.

**Confidence**: High - the existing infrastructure handles this.

---

## What I'm Confident About

1. **JWT session management** - `session.ts` is well-implemented with proper HMAC-SHA256, expiry, and cookie security flags
2. **Team preference cookie flow** - The entire pipeline from cookie set → layout read → team display is working
3. **API endpoint structure** - Astro's SSR endpoint pattern is straightforward
4. **Auth user extraction** - `auth.ts` correctly reads/validates JWT from cookies
5. **The 3 endpoint implementations** - Standard request/response handling with no external unknowns

## What Needs Real Testing (Honest Unknowns)

1. **MFL login endpoint response shape** - The `authenticateWithMFL` function tries many field name variants, but the actual MFL response may differ from what was anticipated. The debug logging will reveal the true shape.

2. **MFL `myleagues` API behavior** - This is the fallback for resolving franchise_id. The field names (`franchise_id` vs `franchiseId` vs others) need verification with real data.

3. **MFL API availability by year** - The code uses `new Date().getFullYear()` for the MFL API year. In early 2026, MFL may not have created the 2026 league yet (insights doc confirms this). May need to use 2025 as the API year during the transition period.

4. **Cross-origin/redirect behavior** - MFL API redirects from `api.myfantasyleague.com` to `www49.myfantasyleague.com`. Server-side `fetch` should follow redirects by default, but this needs verification.

5. **Whether MFL login endpoint returns a `cookie` field in JSON** - The code checks for `data.cookie` to determine login success (line 90). If MFL doesn't include this field, the logic may incorrectly report failure.

---

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| **Fix** | `src/utils/mfl-login.ts` | Fix 4 bugs, add debug logging |
| **Create** | `src/pages/api/auth/login.ts` | POST endpoint |
| **Create** | `src/pages/api/auth/me.ts` | GET endpoint |
| **Create** | `src/pages/api/auth/logout.ts` | POST endpoint |
| **Clean** | `src/utils/auth.ts` | Remove/conditionalize debug logs |

**Total: 5 files (1 fix, 3 new, 1 cleanup)**

---

## What This Does NOT Include (Future Phases)

- Logout UI (button in nav/header) - deferred per user request
- AFL Fantasy login support - deferred, TheLeague only
- `AuthProvider` integration into Astro layouts - not needed for Phase 1 (the AuthContext exists for future React-heavy features)
- MFL authenticated API calls (lineup setting, free agent pickup, etc.)
- Rankings integration with MFL draft lists
- The `packages/shared-utils/src/mfl-login.ts` duplicate - not used by the app, can be cleaned up separately

---

## Testing Plan

1. **After implementation**: User logs in with their MFL credentials
2. **Check console output**: Debug logging shows raw MFL response shape
3. **Verify cookie**: `theleague_team_pref` cookie is set with correct franchise_id
4. **Verify session**: Navigating to `/api/auth/me` returns authenticated user
5. **Verify team display**: Navigating to any page shows correct team by default
6. **Test failure**: Enter wrong password, verify clear error message
7. **Test edge case**: If MFL returns franchise_id="" (commissioner account), verify graceful failure

---

## MFL API Year Strategy

The MFL API year should match the league year, not necessarily the calendar year. The project already has `getCurrentLeagueYear()` in `src/utils/league-year.ts` which handles the Feb 14 rollover logic. The `authenticateWithMFL` function currently hardcodes `new Date().getFullYear()` - this should be updated to use `getCurrentLeagueYear()` or accept a year parameter, but given that `myleagues` endpoint works across years, this is low-risk for Phase 1. We can parameterize it if testing reveals an issue.
