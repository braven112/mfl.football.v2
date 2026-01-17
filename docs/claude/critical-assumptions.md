# Critical Assumptions & Hardcoded Values

## Salary Cap System

### Core Constants
Location: `src/utils/salary-calculations.ts`

```typescript
export const SALARY_CAP = 45_000_000;        // $45M salary cap
export const ROSTER_LIMIT = 25;              // 25 players max
export const TARGET_ACTIVE_COUNT = 22;       // 22 active roster spots
export const RESERVE_FOR_ROOKIES = 5_000_000; // $5M reserved for draft
```

### 10% Annual Escalation
**CRITICAL:** Multi-year contracts escalate at **10% per year**.

```typescript
// Year 1: $1,000,000
// Year 2: $1,100,000 (1.10x)
// Year 3: $1,210,000 (1.10^2)
// Year 4: $1,331,000 (1.10^3)
// Year 5: $1,464,100 (1.10^4)

const salaryForYear = baseSalary * Math.pow(1.10, yearIndex);
```

This is used in:
- `calculateCapCharges()` in `salary-calculations.ts`
- `cap-space-calculator.ts`
- `multi-contract-pricer.ts`
- Auction price predictions

### Salary Years
```typescript
export const SALARY_YEARS = [2025, 2026, 2027, 2028, 2029];
```

### Cap Inclusion by Status
```typescript
export const CAP_INCLUSION = {
  ACTIVE:   { current: 1,   future: 1 },    // 100% current, 100% future
  PRACTICE: { current: 0.5, future: 1 },    // 50% current (taxi), 100% future
  INJURED:  { current: 1,   future: 1 },    // 100% both (IR counts full)
};
```

## Year Rollover Dates

### League Year Rollover
**Feb 14th @ 8:45 PT** - New MFL league created

### Season Year Rollover
**Labor Day** (First Monday of September) - NFL season starts

Utility: `src/utils/league-year.ts`

```typescript
// Updates Feb 14th
getCurrentLeagueYear(): number

// Updates Labor Day
getCurrentSeasonYear(): number

// Always season year + 1
getNextDraftYear(): number

// Always league year + 1
getNextAuctionYear(): number
```

## League Configuration

### TheLeague
```typescript
const THELEAGUE = {
  mflLeagueId: '13522',
  slug: 'theleague',
  teams: 16,
  draftRounds: 3,
  totalPicks: 51,  // 48 base + 3 toilet bowl
};
```

### AFL Fantasy
```typescript
const AFL = {
  mflLeagueId: '19621',
  slug: 'afl',
};
```

## Franchise Tag Rules

Location: `src/utils/franchise-tag-predictor.ts`

### Tag Value Multipliers
```typescript
// Based on position value and scarcity
const TAG_MULTIPLIERS = {
  QB: 1.2,
  RB: 1.0,
  WR: 1.1,
  TE: 0.9,
};
```

### Tag Eligibility
- Contract expiring (1 year remaining)
- Not already tagged
- Team has cap space

## Draft Order Rules

### Regular Picks (1-16, rounds 1-3)
- Reverse order of standings
- Champion always picks 16th

### Toilet Bowl Bonus Picks
- Pick 1.17 - Main Toilet Bowl winner
- Pick 2.17 - Toilet Bowl Consolation winner
- Pick 2.18 - Toilet Bowl Consolation 2 winner

## Team Name Limits

Location: `src/utils/team-names.ts`

```typescript
const NAME_LIMITS = {
  default: 15,  // Medium name limit
  short: 10,    // Short name limit
  abbrev: 6,    // Abbreviation limit
};
```

## Auction Pricing

### Price Floor/Ceiling
```typescript
const MIN_AUCTION_PRICE = 10;       // $10 minimum bid
const MAX_AUCTION_PRICE = 99_999;   // Max display value
```

### Ranking Weights
```typescript
// Default composite ranking weights
const DEFAULT_WEIGHTS = {
  dynasty: 0.6,   // 60% dynasty ranking
  redraft: 0.4,   // 40% redraft ranking
};
```

## MFL API

### Base URLs
```typescript
const MFL_BASE = 'https://www.myfantasyleague.com';
const MFL_API_PATH = '/{year}/export';
```

### Rate Limiting
- Respect MFL API rate limits
- Cache responses in JSON files
- Use APIKEY for authenticated endpoints

## Date Formats

### MFL Timestamps
MFL uses Unix timestamps (seconds since epoch):
```typescript
const mflTimestamp = 1704067200;
const date = new Date(mflTimestamp * 1000);
```

### Display Format
```typescript
// Standard display: "Jan 1, 2025"
const formatted = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
}).format(date);
```

## Important: Changing These Values

**WARNING:** These values are interconnected. Changing them may affect:
1. Cap calculations across all pages
2. Historical data comparisons
3. Auction price predictions
4. Multi-year contract projections

Before changing any critical value:
1. Document the change and reason
2. Update all related utilities
3. Run full test suite
4. Verify calculations manually
