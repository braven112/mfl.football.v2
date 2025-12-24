# Team Preference Cookie Feature Plan

## Overview
Create a persistent, league-wide team preference system using cookies to personalize the user experience across both TheLeague and AFL Fantasy leagues.

## Cookie Structure

**Two separate cookies** to support users who participate in one or both leagues:

```typescript
// Cookie name: 'theleague_team_pref'
{
  franchiseId: "0001",
  lastUpdated: "2025-12-24T..."
}

// Cookie name: 'afl_team_pref'
{
  franchiseId: "0001",
  conferenceId: "A",       // Derived from team.conference in afl.assets.json
  competitionId: "Premier League",  // Derived from team.tier in afl.assets.json
  lastUpdated: "2025-12-24T..."
}
```

**Data Source**: AFL team data stored in `/data/afl-fantasy/afl.assets.json`:
```typescript
{
  id: "0007",           // franchiseId
  conference: "B",      // conferenceId (A or B)
  tier: "D-League"      // competitionId (Premier League or D-League)
}
```

**AFL Conferences & Competitions**:
- **Conference Mapping** (from `src/utils/afl-draft-utils.ts`):
  - Code "A" → "American League" (AL)
  - Code "B" → "National League" (NL)
- **Tier/Competition Note**: The `tier` field and `competition` concept are interchangeable in AFL
  - Teams are organized into tiers: "Premier League" and "D-League"
  - These tiers also function as separate competitions (distinct standings here `/afl-fantasy/standings?view=all_play`)
  - Store as `team.tier` from data, use as `competitionId` in cookie

**Rationale**: Separate cookies allow:
- Users in only one league to have preferences without unused data
- Independent preferences per league for users in both
- Simpler cookie management (smaller payloads)
- Easier to clear/update individual league preferences

## URL Parameter Detection

### Two-Parameter System

**Preference Setting Parameter** (Updates Cookie):
- **TheLeague**: `?myteam=0001` - Sets cookie preference to team 0001
- **AFL**: `?myteam=0001` - Sets cookie preference (lookup team in `afl.assets.json` to get conference/tier)
- **Source**: Added by MFL integration when user enters from their team context
- **Behavior**: Updates cookie AND displays the team

**View-Only Parameter** (No Cookie Update):
- **TheLeague**: `?franchise=0005` - View team 0005 without changing preference
- **AFL**: `?franchise=0005` - View team 0005 without changing preference
- **Use Case**: Allows viewing other teams' rosters/stats without overwriting personal preference
- **Behavior**: Only affects page display, cookie remains unchanged

### Priority Order

When determining which team to display:
1. `?myteam` parameter (if present) - Sets cookie + displays team
2. `?franchise` parameter (if present) - Displays team only, no cookie change
3. Cookie preference (if valid)
4. Auth user franchise (if logged in)
5. Default: Team `0001`

## The League Integration Points

### 1. Rosters Page (`/theleague/rosters`)
**Status**: ✅ Implemented (Phase 1 - Dec 2024)
- Default to user's preferred franchise via cookie
- Dual parameter system (`?myteam` and `?franchise`)
- Priority order: myteam → franchise → cookie → auth → default
- **Location**: Line ~700-726 in rosters.astro
- **Tests**: 31 passing tests (23 unit + 8 E2E)

### 2. Standings Page (`/theleague/standings`)
**Priority**: High
- Highlight preferred team in standings table
- Show my team's division first on the page
- **Use case**: Quick visual reference to user's team performance

### 3. Playoff Predictor (`/theleague/playoff-predictor`)
**Priority**: High
- Default to showing scenarios involving user's team
- Filter "relevant games" based on team's playoff chances
- **Use case**: Focus on games that matter to user's team

### 4. Playoff Brackets (`/theleague/playoffs`)
**Priority**: High
- **Championship vs Toilet Bowl toggle**: Default to bracket containing user's team
- Highlight user's team path through bracket
- **High value**: Auto-show relevant bracket without manual switching

### 5. Draft Order/Predictor (`/theleague/draft-predictor`)
**Priority**: Medium
- Default to showing user's picks
- Highlight trade opportunities involving user's picks
- **Use case**: Quick access to personal draft capital

## AFL Fantasy Integration Points

### 1. Standings/Conference Views
**Priority**: High
- Default to user's preferred conference
- **Use case**: Immediately see relevant competition

### 2. Player Stats/Leaders
**Priority**: Medium
- Filter to conference by default
- **Use case**: Compare against direct competition

## Additional Enhancement Opportunities

### 1. League Navigation
**Priority**: High
- Show team logo/name in header when preference is set
- Quick stats widget for user's team
- **Example**: "Your Team: 8-5-0 | $42.3M Cap | Rank: 3rd"

### 2. Dashboard/Home Page
**Priority**: High
- Personalized summary cards
- "Your Next Matchup" widget
- Team-specific news/updates
- **Use case**: One-stop shop for your team info

### 3. Comparison Tools
**Priority**: Medium
- Pre-select user's team in roster comparisons
- "Compare with my team" quick action
- **Use case**: Faster trade analysis

### 4. Analytics Pages
**Priority**: Medium
- Benchmark league averages against user's team
- Highlight where user's team excels/struggles
- **Use case**: Data-driven roster decisions

### 5. Trade Analyzer (Future Feature)
**Priority**: Low
- Pre-populate user's team assets
- Quick "fair trade" suggestions
- **Use case**: Streamlined trade building

## Implementation Plan

### Phase 1: Core Infrastructure
**Timeline**: Week 1
1. Create `/src/utils/team-preferences.ts` utility
2. Add URL parameter detection middleware
3. Update rosters page to use cookie preference
4. Test cookie persistence across navigation

**Files to Create/Modify**:
- `src/utils/team-preferences.ts` (new)
- `src/pages/theleague/rosters.astro` (modify)
- `src/middleware.ts` (modify or create)

### Phase 2: The League Pages
**Timeline**: Week 2-3
1. Standings - highlight preferred team
2. Playoffs - default to correct bracket
3. Draft predictor - show user's picks
4. Roster comparisons - pre-select user team

**Files to Modify**:
- `src/pages/theleague/standings.astro`
- `src/pages/theleague/playoffs.astro`
- `src/pages/theleague/draft-predictor.astro`

### Phase 3: AFL Integration
**Timeline**: Week 4
1. Conference view defaults
2. Schedule filtering
3. Player stats filtering

**Files to Modify**:
- `src/pages/afl-fantasy/*.astro` (various)

### Phase 4: Enhanced Features
**Timeline**: Week 5-6
1. Header personalization
2. Dashboard widgets
3. Quick comparison tools
4. Analytics benchmarking

## Technical Implementation

### Cookie Settings

**TheLeague Cookie:**
```javascript
{
  name: 'theleague_team_pref',
  maxAge: 365 * 24 * 60 * 60, // 1 year
  path: '/',
  sameSite: 'lax',
  secure: true, // HTTPS only in production
  httpOnly: false // Accessible to client JS
}
```

**AFL Cookie:**
```javascript
{
  name: 'afl_team_pref',
  maxAge: 365 * 24 * 60 * 60, // 1 year
  path: '/',
  sameSite: 'lax',
  secure: true, // HTTPS only in production
  httpOnly: false // Accessible to client JS
}
```

### Team Preference Utility Structure

```typescript
// src/utils/team-preferences.ts

export interface TheLeaguePreference {
  franchiseId: string;
  lastUpdated: string;
}

export interface AFLPreference {
  franchiseId: string;
  conferenceId: string;  // "A" or "B" (from team.conference in afl.assets.json)
  competitionId: string; // "Premier League" or "D-League" (from team.tier in afl.assets.json)
  lastUpdated: string;
}

export function getTheLeaguePreference(): TheLeaguePreference | null {
  // Read from 'theleague_team_pref' cookie
  // Return parsed preference or null
}

export function setTheLeaguePreference(cookies: AstroCookies, franchiseId: string): void {
  // Validate franchiseId first
  // Update 'theleague_team_pref' cookie via Astro.cookies API
  // Set lastUpdated timestamp
}

export function getAFLPreference(cookies: AstroCookies): AFLPreference | null {
  // Read from 'afl_team_pref' cookie via Astro.cookies API
  // Return parsed preference or null
  // If invalid/corrupted, clear cookie and return null
}

export function setAFLPreference(
  cookies: AstroCookies,
  franchiseId: string,
  conferenceId: string,
  competitionId: string
): void {
  // Validate franchiseId first
  // Update 'afl_team_pref' cookie via Astro.cookies API
  // Set lastUpdated timestamp
}

export function validateFranchiseId(franchiseId: string, league: 'theleague' | 'afl'): boolean {
  // Validate franchise ID exists in respective league's assets
  // Return true if valid, false otherwise
}

export function clearTheLeaguePreference(): void {
  // Remove 'theleague_team_pref' cookie
}

export function clearAFLPreference(): void {
  // Remove 'afl_team_pref' cookie
}
```

### URL Parameter Priority Logic

```typescript
// In TheLeague Astro page
const myTeamParam = Astro.url.searchParams.get('myteam');
const franchiseParam = Astro.url.searchParams.get('franchise');
const cookieValue = getTheLeaguePreference();
const authUser = getAuthUser(Astro.request);
const userFranchise = authUser?.franchiseId;

// If myteam param exists, update the cookie preference
if (myTeamParam) {
  // Validate franchise ID exists in league
  const isValid = validateFranchiseId(myTeamParam);
  if (isValid) {
    setTheLeaguePreference(Astro.cookies, myTeamParam);
  }
}

// Priority order for display
const selectedTeam =
  myTeamParam ||                 // 1. myteam param (sets cookie + displays)
  franchiseParam ||              // 2. franchise param (view only, no cookie change)
  cookieValue?.franchiseId ||    // 3. Cookie value (if valid)
  userFranchise ||               // 4. Auth user franchise (if logged in)
  '0001';                        // 5. Default fallback

// Validate the selected team exists, fallback to 0001 if invalid
const finalTeam = validateFranchiseId(selectedTeam) ? selectedTeam : '0001';
```

```typescript
// In AFL Astro page
import aflAssets from '../../data/afl-fantasy/afl.assets.json';

const myTeamParam = Astro.url.searchParams.get('myteam');
const franchiseParam = Astro.url.searchParams.get('franchise');
const conferenceParam = Astro.url.searchParams.get('conference');
const competitionParam = Astro.url.searchParams.get('competition');
const cookieValue = getAFLPreference();

// If myteam param provided, derive conference/competition from afl.assets.json and SET cookie
if (myTeamParam) {
  const teamData = aflAssets.teams.find(t => t.id === myTeamParam);
  if (teamData) {
    // teamData.conference = "A" or "B"
    // teamData.tier = "Premier League" or "D-League"
    setAFLPreference(Astro.cookies, myTeamParam, teamData.conference, teamData.tier);
  }
}
// If only conference/competition params, update just those fields in cookie
else if (conferenceParam || competitionParam) {
  const current = cookieValue || {};
  setAFLPreference(
    Astro.cookies,
    current.franchiseId,
    conferenceParam || current.conferenceId,
    competitionParam || current.competitionId
  );
}

// Priority order for display (franchiseParam is view-only, doesn't update cookie)
const displayFranchise = myTeamParam || franchiseParam || cookieValue?.franchiseId;
const selectedConference = cookieValue?.conferenceId || 'A';
const selectedCompetition = cookieValue?.competitionId || 'Premier League';
```

## Edge Cases to Handle

1. **Invalid franchise IDs in cookie**
   - Validate against known team IDs in respective league
   - Silently clear invalid cookie and fall back to default (0001)

2. **Invalid franchise IDs in URL params**
   - `?myteam=9999` (invalid) → Ignore and use cookie/auth/default
   - `?franchise=9999` (invalid) → Ignore and use cookie/auth/default

3. **Commissioner's team will show as `franchise=0000`**
   - Normalize `0000` to `0001` in both leagues

4. **User in only one league**
   - Only one cookie will be set
   - Other league's pages won't be affected by missing cookie

5. **User in both leagues with different teams**
   - Each league maintains its own independent preference
   - Example: User is team 0003 in TheLeague, team 0007 in AFL

6. **Cookie corruption/malformed data**
   - Silently clear corrupted cookie and fall back to defaults
   - No error message shown to user
   - System continues with graceful degradation

7. **Viewing another team's page**
   - User preference: Team 0003 (via cookie)
   - Visits: `/rosters?franchise=0008`
   - Result: Shows team 0008, cookie stays 0003
   - Refresh: Back to team 0003 (cookie persists)

8. **Setting preference while viewing another team**
   - Current view: Team 0008 (via `?franchise=0008`)
   - Visits: `/rosters?myteam=0003`
   - Result: Cookie updated to 0003, displays team 0003
   - Future visits: Defaults to team 0003

9. **Multiple browser tabs with different selections**
   - Tab 1: `?myteam=0003` → Cookie set to 0003
   - Tab 2: `?franchise=0008` → Shows 0008, cookie stays 0003
   - Tab 3: `?myteam=0012` → Cookie updated to 0012
   - Only `?myteam` parameter updates cookie

10. **Manual UI selection (dropdown/buttons)**
    - Per specification: Manual selections do NOT update cookie
    - Only URL parameters (`?myteam`) update cookie
    - UI selections are temporary for current page view

## User Experience Flow

**TheLeague Example:**
```
User visits /theleague/rosters?myteam=0003
  ↓
Cookie 'theleague_team_pref' set: { franchiseId: "0003", lastUpdated: "..." }
  ↓
Page loads with Team 0003 selected
  ↓
User navigates to /theleague/playoffs
  ↓
Page reads cookie, shows bracket with Team 0003
  ↓
User clicks link to view another team: /theleague/rosters?franchise=0008
  ↓
Page shows Team 0008, but cookie stays 0003 (view-only mode)
  ↓
User navigates to /theleague/standings (no params)
  ↓
Back to Team 0003 (cookie preference persists)
  ↓
User manually selects different team in UI dropdown
  ↓
Cookie NOT updated (only ?myteam param updates cookie)
  ↓
User refreshes page
  ↓
Back to Team 0003 (cookie persists)
```

**AFL Example:**
```
User visits /afl-fantasy/standings?myteam=0007
  ↓
System looks up team 0007 in afl.assets.json
  ↓
Finds: { id: "0007", conference: "B", tier: "D-League" }
  ↓
Cookie 'afl_team_pref' set: {
  franchiseId: "0007",
  conferenceId: "B",        // from team.conference
  competitionId: "D-League", // from team.tier
  lastUpdated: "..."
}
  ↓
Page loads showing Conference B standings with Team 0007 highlighted
  ↓
User navigates to schedule page
  ↓
Page reads cookie, defaults to Conference B view
  ↓
User views another team: /afl-fantasy/roster?franchise=0012
  ↓
Shows team 0012, but cookie stays 0007 (view-only mode)
```

**User in Both Leagues:**
```
User has Team 0003 in TheLeague, Team 0012 in AFL
  ↓
Visits /theleague/rosters?myteam=0003
  ↓
'theleague_team_pref' cookie set (AFL cookie unchanged)
  ↓
Visits /afl-fantasy/standings?myteam=0012
  ↓
'afl_team_pref' cookie set (TheLeague cookie unchanged)
  ↓
Both preferences persist independently
  ↓
Can view other teams via ?franchise param without changing preferences
```

## Benefits Summary

1. **Reduced Clicks**: Skip team selection on every page
2. **Personalization**: Site remembers your context per league
3. **Cross-Page Consistency**: Same team across all views within each league
4. **Mobile Friendly**: Less navigation on small screens
5. **Shareable Links**:
   - `?myteam` for setting preferences (from MFL integration)
   - `?franchise` for sharing specific team views without affecting preferences
6. **Progressive Enhancement**: Works without JS for URL params
7. **Independent League Preferences**: Users in both leagues can have different teams/preferences
8. **Lightweight**: Only relevant cookies are set (no unnecessary data)
9. **Safe Browsing**: View other teams without losing your preference
10. **MFL Integration**: Seamless handoff from MFL message board to personalized team view

## Testing Checklist

- [ ] TheLeague cookie persists across page navigation
- [ ] AFL cookie persists across page navigation
- [ ] Both cookies persist across browser sessions (1 year)
- [ ] `?myteam` param sets cookie and displays team
- [ ] `?franchise` param displays team WITHOUT updating cookie
- [ ] Cookie value used when no URL params present
- [ ] Auth user franchise used when no cookie/params (TheLeague)
- [ ] Default to team `0001` when no preference exists
- [ ] Invalid team IDs gracefully handled (silently clear cookie)
- [ ] Commissioner team `0000` normalized to `0001`
- [ ] TheLeague cookie independent from AFL cookie
- [ ] AFL cookie independent from TheLeague cookie
- [ ] Users in both leagues can have different franchise preferences
- [ ] Users in only one league only have one cookie set
- [ ] Manual UI selection doesn't update cookie (only `?myteam` does)
- [ ] AFL conference/competition derived correctly from franchise ID
- [ ] AFL direct conference/competition params work independently
- [ ] Viewing another team via `?franchise` doesn't reset preference
- [ ] Multiple tabs with different `?franchise` values don't conflict
- [ ] Works with JS disabled (URL params only)
- [ ] Mobile responsiveness maintained

## Future Enhancements

1. **Multiple team tracking**: Support following multiple teams
2. **Notification preferences**: Alert for your team's games/trades
3. **Custom dashboard layouts**: Drag-and-drop widgets
4. **Team comparison mode**: Side-by-side team views
5. **Historical tracking**: View your team's evolution over seasons

## Related Files

- Current auth logic: `src/utils/auth.ts`
- Roster page implementation: `src/pages/theleague/rosters.astro`
- TheLeague team data: `src/data/theleague.assets.json`
- AFL team data: `data/afl-fantasy/afl.assets.json`
  - Contains `team.conference` ("A" or "B")
  - Contains `team.tier` ("Premier League" or "D-League")
  - Contains `team.id` (franchise ID)
- AFL conference mapping: `src/utils/afl-draft-utils.ts`
  - Maps conference "A" → "American League" (AL)
  - Maps conference "B" → "National League" (NL)
  - Note: `tier` and `competition` are interchangeable terms in AFL
    - Tiers: "Premier League" and "D-League" 
    - Each tier operates as a side competition with a distinct standings `/afl-fantasy/standings?view=all_play`)
