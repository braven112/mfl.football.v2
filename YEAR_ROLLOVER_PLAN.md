# Year Rollover Feature - Implementation Plan

## Overview

The MFL Football v2 application has **two critical dates** for year transitions:

1. **Feb 14th @ 8:45 PT** - New MFL league created, rosters transfer to new year
2. **Labor Day** - NFL season starts, historical pages switch to new season

## Current State

- **Environment Variable**: `PUBLIC_MFL_YEAR=2025` (hardcoded)
- **Data Structure**: `data/theleague/mfl-feeds/{year}/` (supports multiple years)
- **Fetch Script**: `scripts/fetch-mfl-feeds.mjs` (uses env var for current year)
- **Pages**: 26 pages use MFL data, each with different update requirements

---

## Pages Requiring Year Logic

### **Group 1: Immediate Update (Feb 14th @ 8:45 PT)**
*These pages deal with current roster management and should switch immediately when new league is created*

| Page | File | Current Year Logic | Update Reason |
|------|------|-------------------|---------------|
| **Rosters** | `theleague/rosters.astro` | `selectedYear` (defaults to current) | Current roster = new league |
| **Rosters (AFL)** | `afl-fantasy/rosters.astro` | `selectedYear` (defaults to current) | Current roster = new league |
| **Contracts** | `theleague/contracts.astro` | Uses current year data | Contract management for active rosters |
| **Salary** | `theleague/salary.astro` | Uses current year data | Salary cap for active rosters |
| **Calculator** | `theleague/calculator.astro` | Uses current year cap | Cap calculations for active season |
| **Live Auction API** | `api/live-auction.ts` | Uses `MFL_YEAR` env var | Auction happens in Feb for new year |
| **Matchup Data** | `theleague/matchup-data.astro` | Uses `MFLMatchupApiClient` | Preview matchups for upcoming season |

**Special Case: Auction Predictor**
- **File**: `theleague/auction-predictor.astro`
- **Behavior**: Always predicts "next year's" free agent class
- **Update Logic**:
  - Before Feb 14th 2026: Predicts 2026 auction
  - After Feb 14th 2026: Predicts 2026 auction
  - After Labor Day 2026: Should immediately switch to predicting 2027 auction
  - This is forward-looking, not historical

---

### **Group 2: Delayed Update (Labor Day)**
*These pages show season performance/results and should remain historical until NFL season starts*

| Page | File | Current Year Logic | Update Reason |
|------|------|-------------------|---------------|
| **Standings** | `theleague/standings.astro` | `selectedYear` with year selector | Season results don't exist until games are played |
| **Standings (AFL)** | `afl-fantasy/standings.astro` | `selectedYear` with year selector | Season results don't exist until games are played |
| **Playoffs** | `theleague/playoffs.astro` | `selectedYear` with year selector | No playoffs until season completes |
| **Playoffs (AFL)** | `afl-fantasy/playoffs.astro` | `selectedYear` with year selector | No playoffs until season completes |
| **Draft Predictor** | `theleague/draft-predictor.astro` | Uses "next year" (`currentYear + 1`) | Draft order based on completed season |
| **Draft Predictor (AFL)** | `afl-fantasy/draft-predictor.astro` | Uses "next year" (`currentYear + 1`) | Draft order based on completed season |
| **MVP** | `theleague/mvp.astro` | Likely uses current year | Tracks season performance/awards |
| **Live Scoring API** | `api/live-scoring.ts` | Uses `MFL_YEAR` env var | Only relevant during active games |
| **Weekly Results** | Used by playoffs | `weekly-results.json` by year | Week-by-week game scores |

---

### **Group 3: Historical/Year-Agnostic Pages**
*These pages have year selectors or don't depend on "current" year*

| Page | File | Update Needed? |
|------|------|----------------|
| **Contracts History** | `theleague/contracts/history.astro` | ❌ User selects year via dropdown |
| **Salary History** | `theleague/salary-history.astro` | ❌ User selects year via dropdown |
| **League Comparison** | `theleague/league-comparison.astro` | ⚠️ May need review - unclear if it compares "current" year |
| **Assets** | `theleague/assets.astro`, `afl-fantasy/assets.astro` | ❌ Team assets don't change by year |
| **Rules/Instructions** | Various | ❌ Static content |

---

## Decision Framework for New Pages

**When creating ANY new page that uses MFL data, determine which year logic to use:**

### Use `getCurrentLeagueYear()` - Updates Feb 14th
**For pages dealing with:**
- Current rosters and player management
- Active contracts and salary cap
- Auction predictions (next year's free agents)
- Trade analysis and trade bait
- Matchup previews and starting lineups
- Anything related to "managing your current team"

**Key question:** *"Does this page help me manage my roster or plan for upcoming auctions/trades?"*
→ If YES, use `getCurrentLeagueYear()`

### Use `getCurrentSeasonYear()` - Updates Labor Day
**For pages dealing with:**
- Standings and rankings
- Playoff brackets and results
- Historical season performance
- Draft order projections (based on season results)
- MVP/awards tracking
- Weekly matchup results
- Anything related to "season performance and results"

**Key question:** *"Does this page show results from games that have been played?"*
→ If YES, use `getCurrentSeasonYear()`

### Examples

| Page Type | Use | Reasoning |
|-----------|-----|-----------|
| Free agent analysis | `getCurrentLeagueYear()` | Managing current roster |
| Power rankings | `getCurrentSeasonYear()` | Based on game results |
| Waiver wire tool | `getCurrentLeagueYear()` | Managing current roster |
| Season recap | `getCurrentSeasonYear()` | Historical game results |
| Trade calculator | `getCurrentLeagueYear()` | Managing current roster |
| Playoff odds | `getCurrentSeasonYear()` | Based on game results |

---

## Proposed Implementation Strategy

### **Phase 1: Centralized Year Configuration**

Create a new utility file to manage year transitions:

**File**: `src/utils/league-year.ts`

```typescript
/**
 * League Year Management
 *
 * Key Dates:
 * - Feb 14th @ 8:45 PT: New MFL league created, rosters move to new year
 * - Labor Day: NFL season starts, standings/playoffs/draft predictor update
 */

export interface LeagueYearConfig {
  /** Current MFL league year (for rosters, contracts, live data) */
  currentLeagueYear: number;

  /** Year for standings/playoffs (historical until Labor Day) */
  currentSeasonYear: number;

  /** Year for draft predictor (always shows next year's draft) */
  nextDraftYear: number;

  /** Year for auction predictor (always shows next year's free agents) */
  nextAuctionYear: number;
}

/**
 * Determines which MFL year to use based on current date
 *
 * @param referenceDate - Optional date for testing (defaults to now)
 * @returns LeagueYearConfig with appropriate years
 */
export function getLeagueYear(referenceDate: Date = new Date()): LeagueYearConfig {
  const envYear = parseInt(import.meta.env.PUBLIC_MFL_YEAR || '2025', 10);

  // Feb 14th @ 8:45 PT cutoff
  const febCutoff = new Date(referenceDate.getFullYear(), 1, 14, 16, 45, 0); // 8:45 PT = 16:45 UTC (PST+8)

  // Labor Day cutoff
  const sepCutoff = new Date(referenceDate.getFullYear(), 8, 1, 0, 0, 0); // Sep = month 8 (0-indexed)

  let currentLeagueYear = envYear;
  let currentSeasonYear = envYear;

  // After Feb 14th, league year advances (rosters move to new MFL league)
  if (referenceDate >= febCutoff) {
    currentLeagueYear = envYear + 1;
  }

  // After Labor Day, season year advances (standings/playoffs show new season)
  if (referenceDate >= sepCutoff) {
    currentSeasonYear = envYear + 1;
  }

  return {
    currentLeagueYear,
    currentSeasonYear,
    nextDraftYear: currentSeasonYear + 1, // Draft is always for next year
    nextAuctionYear: currentLeagueYear + 1, // Auction is always for next year's free agents
  };
}

/**
 * Get current league year for roster/contract management
 * Updates: Feb 14th @ 8:45 PT
 */
export function getCurrentLeagueYear(): number {
  return getLeagueYear().currentLeagueYear;
}

/**
 * Get current season year for standings/playoffs
 * Updates: Labor Day
 */
export function getCurrentSeasonYear(): number {
  return getLeagueYear().currentSeasonYear;
}

/**
 * Get next draft year (always currentSeasonYear + 1)
 */
export function getNextDraftYear(): number {
  return getLeagueYear().nextDraftYear;
}

/**
 * Get next auction year (always currentLeagueYear + 1)
 */
export function getNextAuctionYear(): number {
  return getLeagueYear().nextAuctionYear;
}
```

---

### **Phase 2: Update Pages by Group**

#### **Group 1 Updates (Feb 14th Pages)**

1. **Rosters Pages**
   - Replace: `parseInt(import.meta.env.PUBLIC_MFL_YEAR || ...)`
   - With: `import { getCurrentLeagueYear } from '../../utils/league-year';`
   - Update default year logic to use `getCurrentLeagueYear()`

2. **Contracts Page**
   - Find hardcoded `2025` references
   - Replace with `getCurrentLeagueYear()`

3. **Salary/Calculator Pages**
   - Update year logic to use `getCurrentLeagueYear()`

4. **Auction Predictor**
   - Replace "2026" logic with `getNextAuctionYear()`
   - Ensure UI displays "20XX Free Agent Auction" dynamically

5. **API: live-auction.ts**
   - Update to use `getCurrentLeagueYear()` for MFL API calls

---

#### **Group 2 Updates (Labor Day Pages)**

1. **Standings Pages (TheLeague + AFL)**
   - Update default year logic: `getCurrentSeasonYear()`
   - Keep year selector for historical data

2. **Playoffs Pages (TheLeague + AFL)**
   - Update default year logic: `getCurrentSeasonYear()`
   - Keep year selector for historical data

3. **Draft Predictor Pages (TheLeague + AFL)**
   - Update to use `getNextDraftYear()` for "showing 20XX draft"
   - Ensure it correctly reads from `currentSeasonYear` standings

4. **MVP Page**
   - Review and update to use `getCurrentSeasonYear()`

5. **API: live-scoring.ts**
   - Update to use `getCurrentSeasonYear()`

---

#### **Group 3 Review**

1. **League Comparison**
   - Audit to determine if it uses "current" year
   - Update if necessary

---

### **Phase 3: Update Data Fetching**

**File**: `scripts/fetch-mfl-feeds.mjs`

Currently uses:
```javascript
const MFL_YEAR = process.env.MFL_YEAR || new Date().getFullYear();
```

**Options**:
1. **Keep env var, update manually**: Continue using `MFL_YEAR` env var, update it on Feb 14th
2. **Add date logic to script**: Import `getLeagueYear()` logic into script
3. **Fetch multiple years**: Always fetch both current season AND current league year if different

**Recommended**: Option 3 - During Feb 14th to Labor Day window, fetch BOTH years:
- `currentLeagueYear` (2026) - For rosters, contracts
- `currentSeasonYear` (2025) - For standings, playoffs

---

### **Phase 4: Environment Variable Strategy**

**Current**:
- `PUBLIC_MFL_YEAR=2025` (hardcoded in `.env`)

**Option A: Keep Static, Update Manually**
- Pros: Simple, explicit, easy to test specific years
- Cons: Requires manual update on Feb 14th, risk of forgetting

**Option B: Remove Env Var, Use Date Logic**
- Pros: Fully automated, no manual updates needed
- Cons: Harder to test historical years, need to pass override param

**Option C: Hybrid - Base Year + Auto Offset**
- Set `PUBLIC_BASE_YEAR=2025` (year of last completed NFL season)
- Use `getLeagueYear()` to calculate offset automatically
- On Labor Day 2026, manually update to `PUBLIC_BASE_YEAR=2026`

**Recommended**: Option C for predictability with automation

---

### **Phase 5: Testing Strategy**

Create test utilities to simulate different dates:

```typescript
// Example usage in tests
const configDec2025 = getLeagueYear(new Date('2025-12-01'));
// Returns: { currentLeagueYear: 2025, currentSeasonYear: 2025, ... }

const configFeb2026 = getLeagueYear(new Date('2026-02-15'));
// Returns: { currentLeagueYear: 2026, currentSeasonYear: 2025, ... }

const configSep2026 = getLeagueYear(new Date('2026-09-02'));
// Returns: { currentLeagueYear: 2026, currentSeasonYear: 2026, ... }
```

Add URL parameter for testing:
```
?testDate=2026-02-15
```

---

## Edge Cases & Special Considerations

### **1. Draft Predictor "Next Year" Logic**
- Currently shows `currentYear + 1` draft
- After Labor Day 2026, should show 2027 draft (based on 2026 standings)
- After Feb 14th 2027, should show 2027 draft (based on 2026 standings still)
- After Labor Day 2027, should show 2028 draft (based on 2027 standings)

### **2. Auction Predictor "Next Auction" Logic**
- Before Feb 14th 2026: Shows 2026 free agents
- After Feb 14th 2026: Shows 2027 free agents (immediately)
- This is forward-looking for upcoming auction

### **3. "Next Year" Tabs**
- Rosters page has "Vet Extensions (Next Year)" tab
- After Feb 14th, "next year" should be `currentLeagueYear + 1`

### **4. Historical Data**
- All pages with year selectors should continue to work for 2007-present
- Year selector dropdown should include all available years

### **5. Data Fetching Window (Feb 14 - Sep 1)**
- Two active years exist simultaneously:
  - 2026 league (rosters, contracts)
  - 2025 season (standings, playoffs)
- `fetch-mfl-feeds.mjs` may need to fetch BOTH years during this window

### **6. Playoff Brackets**
- TheLeague playoffs end in Feb (around draft time)
- Playoff data for 2025 season should remain accessible until Labor Day 2026
- After Labor Day 2026, defaults to 2026 season playoffs

### **7. Live Scoring**
- Only relevant during NFL season (Sep-Feb)
- Should use `currentSeasonYear` during season
- During offseason, may not be applicable

---

## Implementation Checklist

### **Step 1: Create Infrastructure**
- [ ] Create `src/utils/league-year.ts` with date logic
- [ ] Add unit tests for `getLeagueYear()` function
- [ ] Add URL parameter support for testing (`?testDate=YYYY-MM-DD`)

### **Step 2: Update Group 1 Pages (Feb 14th)**
- [ ] Rosters (TheLeague) - `getCurrentLeagueYear()`
- [ ] Rosters (AFL) - `getCurrentLeagueYear()`
- [ ] Contracts - `getCurrentLeagueYear()`
- [ ] Salary - `getCurrentLeagueYear()`
- [ ] Calculator - `getCurrentLeagueYear()`
- [ ] Auction Predictor - `getNextAuctionYear()`
- [ ] Matchup Data - `getCurrentLeagueYear()`
- [ ] API: live-auction.ts - `getCurrentLeagueYear()`

### **Step 3: Update Group 2 Pages (Labor Day)**
- [ ] Standings (TheLeague) - `getCurrentSeasonYear()`
- [ ] Standings (AFL) - `getCurrentSeasonYear()`
- [ ] Playoffs (TheLeague) - `getCurrentSeasonYear()`
- [ ] Playoffs (AFL) - `getCurrentSeasonYear()`
- [ ] Draft Predictor (TheLeague) - `getNextDraftYear()`
- [ ] Draft Predictor (AFL) - `getNextDraftYear()`
- [ ] MVP - `getCurrentSeasonYear()`
- [ ] API: live-scoring.ts - `getCurrentSeasonYear()`

### **Step 4: Update Data Fetching**
- [ ] Update `fetch-mfl-feeds.mjs` to handle dual-year window
- [ ] Test fetching during Feb 14 - Sep 1 window
- [ ] Update GitHub Actions workflow if needed

### **Step 5: Environment Variable Strategy**
- [ ] Decide on Option A, B, or C
- [ ] Update `.env` and `.env.example` files
- [ ] Document env var purpose in README

### **Step 6: Testing**
- [ ] Test with `?testDate=2025-12-01` (pre-Feb)
- [ ] Test with `?testDate=2026-02-15` (post-Feb, pre-Sep)
- [ ] Test with `?testDate=2026-09-02` (post-Sep)
- [ ] Test year selectors still work for historical data
- [ ] Test dual-year data fetching

### **Step 7: Documentation**
- [ ] Update CLAUDE.md with year rollover behavior
- [ ] Add comments to critical date logic
- [ ] Document testing procedures
- [ ] Create runbook for manual steps (if any)

---

## Timeline Example (2025-2026 Transition)

| Date | Event | League Year | Season Year | Draft Year | Auction Year |
|------|-------|-------------|-------------|------------|--------------|
| **Dec 1, 2025** | Regular season | 2025 | 2025 | 2026 | 2026 |
| **Jan 15, 2026** | Playoffs ongoing | 2025 | 2025 | 2026 | 2026 |
| **Feb 14, 2026 8:45 PT** | 🚨 New MFL league | **2026** | 2025 | 2026 | **2027** |
| **Feb 21, 2026** | Draft occurs | 2026 | 2025 | 2026 | 2027 |
| **May 1, 2026** | Offseason | 2026 | 2025 | 2026 | 2027 |
| **Sep 1, 2026** | 🚨 NFL season starts | 2026 | **2026** | **2027** | 2027 |
| **Dec 1, 2026** | Regular season | 2026 | 2026 | 2027 | 2027 |

---

## Questions for Decision

1. **Environment Variable Strategy**: Which option (A/B/C) for `PUBLIC_MFL_YEAR`?

2. **Data Fetching**: Should `fetch-mfl-feeds.mjs` automatically fetch both years during Feb-Sep window, or rely on manual env var update?

3. **Testing Override**: Should there be a persistent way to test specific dates (URL param, admin panel, etc.)?

4. **Manual Steps**: Are you comfortable with zero manual updates (fully automated), or prefer explicit control (update env var on key dates)?

5. **League Comparison Page**: Need to audit - does it compare "current" years or user-selected years?

6. **MVP Page**: Need to clarify - does it show current season awards or historical awards?

---

## Additional Pages to Review

These pages weren't fully analyzed for year dependencies:

- **Matchup Data** (`theleague/matchup-data.astro`) - May need `getCurrentLeagueYear()`
- **Injury Management Demo** (`theleague/injury-management-demo.astro`) - Probably demo only
- **Player Status Demo** (`theleague/player-status-demo.astro`) - Probably demo only
- **League Comparison** (`theleague/league-comparison.astro`) - Needs audit

---

## Success Criteria

✅ **No manual updates required** (or minimal, well-documented steps)
✅ **Rosters/contracts switch to new league on Feb 14th**
✅ **Standings/playoffs remain historical until Labor Day**
✅ **Draft predictor always shows next year's draft based on current season**
✅ **Auction predictor always shows next auction year's free agents**
✅ **Historical year selectors continue to work (2007-present)**
✅ **Data fetching handles dual-year window correctly**
✅ **Testable with date overrides**
✅ **Clear documentation for future maintainers**

