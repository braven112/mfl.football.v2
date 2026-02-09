# New Homepage Planning Document

## Overview
Building a personalized, dynamic homepage that serves as the central hub for each owner. The page should be owner-specific, showing relevant information and actionable items.

## Core Features (Must-Have)

### 1. Quick Navigation Section
**Purpose:** Easy access to most-used pages
- **Roster Report** - Prominent link/button to current roster
- **Standings** - Current season standings
- **Quick stats** - Record, current rank, points for/against

### 2. Contract Alerts Module (Dynamic)
**Purpose:** Highlight players requiring contract action
**Shows when:** Owner has players needing contracts
**Data Source:** `rosters.json` + `transactions.json` (FREE_AGENT adds)

**Alert types:**
- **Recently Signed Players** - Players added via FREE_AGENT transaction who don't have contracts yet
  - Show: Player name, position, days since signed, "Add Contract" CTA
  - Data: Parse transactions for recent FREE_AGENT adds by this franchise

- **Expiring Contracts** (if contract data available)
  - Players whose contracts expire soon
  - Show warning if in danger of losing player

- **Contract Window Status**
  - Display if contract submission window is open/closed
  - Show next window opening date

### 3. Player News Feed
**Purpose:** Personalized news about YOUR players
**Data Sources:**
- MFL `players.json` (has injury status, news)
- Your roster from `rosters.json`
- Transaction history from `transactions.json`

**News items to show:**
- **Injury Updates** - Players on your roster with injury status changes
  - Show: Player name, injury status, when it changed
  - Priority: IR, Out, Questionable, Doubtful

- **Recent Roster Moves** - Your recent adds/drops (last 7 days)
  - Format: "You added [Player] on [Date]"
  - "You dropped [Player] on [Date]"

- **Taxi Squad Changes** - Recent promotions/demotions
  - "You promoted [Player] from taxi squad"

- **Waiver Claims** - BBID_WAIVER transactions
  - Show amount spent and player acquired

## Additional Important Features

### 4. Salary Cap Status Widget
**Purpose:** At-a-glance salary cap health
**Data Source:** `salaryAdjustments.json` + league settings

**Display:**
- Current cap space (green if healthy, yellow if tight, red if over)
- Cap space number with progress bar
- Link to full salary page
- Warning if approaching cap limit

### 5. Upcoming Matchup Preview (During Season)
**Purpose:** Show this week's opponent and key stats
**Data Source:** `weekly-results.json` + `standings.json`

**Display:**
- Your team vs Opponent team (logos/banners)
- Week number
- Current records
- Points scored trends (chart?)
- Link to full matchup details

### 6. League Activity Stream
**Purpose:** Stay informed about league-wide moves
**Data Source:** `transactions.json`

**Display (last 24-48 hours):**
- Recent trades (if applicable)
- Big waiver claims by other teams
- Notable player pickups (high-value FAs)
- Filter to show only "interesting" transactions
- Limit to 5-10 most recent/relevant

### 7. Quick Actions Panel
**Purpose:** Common tasks owners need to do
**Actions:**
- "Manage Contracts" button (if players need contracts - dynamic)
- "View Roster Report" button
- "Check Standings" button
- "Review Salary Cap" button
- "Trade Bait" button (if feature exists)

### 8. Draft Pick Preview (Seasonal)
**Purpose:** Show your upcoming draft position
**When to show:** After regular season ends, before draft
**Data Source:** `assets.json` (draft picks you own)

**Display:**
- Your draft picks for next season
- Projected draft position based on standings
- Link to full draft predictor page

### 9. Season Stats Summary Card
**Purpose:** Personal performance tracking
**Data Source:** `weekly-results.json` + `standings.json`

**Display:**
- Total Points Scored (and league rank)
- Average Points Per Week
- Highest/Lowest scoring week
- Current streak (W/L)
- Points For vs Points Against
- Visual: Small sparkline chart of weekly scores

### 10. Playoff Picture (During Playoff Race)
**Purpose:** Show playoff chances and what's needed
**When to show:** Weeks 10-14
**Data Source:** `standings.json` + `playoff-brackets.json`

**Display:**
- Current playoff seed (or how far from playoffs)
- "Magic number" - wins needed to clinch
- Playoff bracket preview if already in
- Toilet bowl warning if in danger

## Layout Structure

```
┌─────────────────────────────────────────────────┐
│  Header: [Team Name] Dashboard                  │
│  Quick Stats: 8-5 | 3rd Place | 1,234 PF       │
└─────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────────────┐
│ Contract Alerts  │  │  Salary Cap Status       │
│ (if applicable)  │  │  $XXX remaining          │
│ 🔔 3 players     │  │  Progress bar            │
│ need contracts   │  │  [View Details]          │
└──────────────────┘  └──────────────────────────┘

┌──────────────────────────────────────────────────┐
│  This Week's Matchup                             │
│  [Your Team] vs [Opponent]                       │
│  Week 14 | Dec 11-15                            │
└──────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────────────┐
│ Player News      │  │  Season Stats            │
│ (Your Players)   │  │  Total: 1,234 PF (#3)   │
│ • Player A: OUT  │  │  Avg: 94.9 PPW          │
│ • Player B: Q    │  │  Chart: [sparkline]     │
└──────────────────┘  └──────────────────────────┘

┌──────────────────────────────────────────────────┐
│  Quick Actions                                   │
│  [Roster] [Standings] [Contracts] [Salary Cap]  │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  Recent League Activity                          │
│  • Team X added Player Y (BBID: $5k)            │
│  • Team Z dropped Player A                       │
│  (last 24 hours)                                 │
└──────────────────────────────────────────────────┘
```

## Technical Implementation Notes

### Data Requirements
- **User Context**: Need to identify current owner (franchise ID)
  - From auth/session or URL parameter
  - Use to filter all data to owner-specific

- **Data Files Needed**:
  - `rosters.json` - Current roster
  - `transactions.json` - Recent moves, contract needs
  - `players.json` - Player details, injury status
  - `salaryAdjustments.json` - Salary cap info
  - `standings.json` - Current standings, playoff picture
  - `weekly-results.json` - Matchup data, scoring
  - `assets.json` - Draft picks owned
  - `league.json` - League settings (cap, calendar)

### Priority Widgets (MVP)
1. Contract Alerts (if players need action)
2. Quick Navigation
3. Salary Cap Status
4. Player News Feed
5. Season Stats Summary

### Phase 2 Features
- Upcoming Matchup Preview
- League Activity Stream
- Playoff Picture
- Draft Pick Preview

### Mobile Considerations
- Stack widgets vertically on mobile
- Collapsible sections for less critical info
- Swipeable cards for news/activity feeds
- Touch-friendly button sizes

## Open Questions
1. How to handle authentication/owner identification?
   - Cookie/session?
   - URL parameter?
   - Default to first franchise for testing?

2. Contract system integration
   - What defines "needs contract"?
   - Is contract data in MFL or custom DB?
   - What's the contract submission flow?

3. Refresh frequency
   - Real-time updates or build-time static?
   - Cache strategy for MFL data?

4. Notifications/Badges
   - Show notification count on nav items?
   - Email/push notifications for urgent items?

## Success Metrics
- **Engagement**: Owners visit homepage daily vs old nav page
- **Efficiency**: Reduced clicks to common actions
- **Action Rate**: Higher % of owners managing contracts when needed
- **Satisfaction**: Owner feedback on usefulness

## Future Enhancements
- Customizable widget layout (drag-and-drop)
- Owner preferences for which widgets to show
- Historical performance graphs
- Head-to-head history vs this week's opponent
- Trade analyzer recommendations
- "Player of the Week" highlight
- Social features (trash talk, reactions)
