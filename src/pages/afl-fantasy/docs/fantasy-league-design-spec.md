# Fantasy League Website – Design & UI Specification

## 1. Brand & Visual Style

### 1.1 Overall Style
- Style: **Soft, clean dashboard (neumorphism-inspired)**.
- Layout: **Top navigation + collapsible left sidebar + main content area**.
- Look & feel:
  - Light backgrounds, subtle depth.
  - Rounded cards, soft shadows.
  - Icon-heavy navigation and status indicators.
  - Data-first: tables and stats are the heroes.

### 1.2 Color System

#### Light Mode

**Core brand:**
- `--color-primary-500: #2563EB;`  /* blue */
- `--color-primary-400: #3B82F6;`
- `--color-primary-100: #DBEAFE;`

- `--color-secondary-500: #22C55E;` /* green */
- `--color-secondary-400: #4ADE80;`

**Feedback:**
- `--color-success-500: #22C55E;`     /* same as secondary */
- `--color-warning-500: #FACC15;`     /* yellow */
- `--color-error-500:   #EF4444;`     /* red */

**Neutrals / background:**
- `--color-bg-page:    #F5F5F7;`      /* page background */
- `--color-bg-card:    #FFFFFF;`      /* card / panel */
- `--color-bg-subtle:  #E5E7EB;`
- `--color-border-subtle: #E5E7EB;`
- `--color-text-strong: #111827;`
- `--color-text-muted:  #6B7280;`

#### Dark Mode

- Base background (per requirement): `--color-bg-page-dark: #222222;`
- Cards: `--color-bg-card-dark: #2C2C2F;`
- Borders: `--color-border-subtle-dark: #3F3F46;`
- Text:
  - `--color-text-strong-dark: #F9FAFB;`
  - `--color-text-muted-dark:  #9CA3AF;`

Brand tints for dark:
- `--color-primary-500-dark: #60A5FA;`
- `--color-secondary-500-dark: #4ADE80;`
- Success/warning/error use slightly brighter versions of light-mode colors.

Use a **theme toggle** in the top-right to switch between light/dark and apply these tokens.

### 1.3 Typography

Use a clean sans-serif stack such as Inter, SF Pro, or similar.

- Display / Page Title: 28–32px, semibold.
- Section Title: 20–22px, semibold.
- Card Title: 16–18px, semibold.
- Body: 14–16px, regular.
- Caption / Meta: 12–13px, medium.

### 1.4 Spacing & Radius

- Spacing scale: 4, 8, 12, 16, 20, 24, 32.
- Card padding: 20–24px.
- Border radius:
  - Cards: 16px.
  - Buttons, pills, tags: 9999px (full pill) or 9999 + 12px for tags.
- Shadows (soft neumorphism):
  - Card: `0 18px 45px rgba(15, 23, 42, 0.08);`
  - Hover: slightly stronger or lifted by 2–3px.

---

## 2. Layout & Navigation

### 2.1 Global Layout

- **Top Nav Bar**
  - Left: League logo + league name.
  - Center: Page title + breadcrumbs.
  - Right: Theme toggle (light/dark), notifications icon, user avatar menu.

- **Left Sidebar (collapsible/hidden by default on smaller screens)**
  - Sections (with icons):
    - Dashboard
    - My Roster
    - Live Scoreboard
    - Extensions & Cap
    - League History
    - Playoff Tracker
    - GroupMe Feed
    - Settings / Account
  - Sidebar can slide in over content or push content on large screens.

- **Breadcrumbs**
  - Example: `Dashboard / Rosters / My Team`
  - Always shown directly under the top nav.

---

## 3. Core Pages & Purpose

### 3.1 Dashboard (`/`)
**Goal:** One-glance view of the league and each owner’s current situation.

**Layout:**
- Top row: 3–4 highlight cards
  - Current Cap Used vs Cap Limit.
  - Number of players under contract.
  - Open roster spots.
  - Upcoming key league dates.
- Middle:
  - “My Team Snapshot” card:
    - Total cap hit current year.
    - Cap hit next year.
    - Longest contract remaining.
  - “Live Scoreboard Summary” card:
    - Current week’s score for the user’s matchup.
- Bottom:
  - “Recent Activity” list (extensions, trades, cuts).
  - Mini view of GroupMe feed (latest 3–5 messages) with “View full feed” link.

### 3.2 Rosters (`/rosters` + `/my-team`)
**Goal:** Main feature – show complete roster, contracts, and future cap.

**Components:**
- Team selector (if viewing other teams).
- Summary strip:
  - Total cap this year.
  - Projected cap next year.
  - Open roster spots.
  - Buttons:
    - “Open Extension Calculator”
    - “Add Contract Years” (for eligible players – MFL auth required)

**Roster Table (primary UI):**
Columns (all visible or configurable):
- Player
- Position
- Age (optional)
- Contract Type (Rookie, Extension, Franchise, etc.)
- Years Remaining
- Cap Hit (this year)
- Total Remaining Salary
- Dead Money (if cut)
- Year-by-year salary timeline for up to 7 years (see below)
- Tags/Badges (e.g., “Extension Eligible”, “Franchise Tag”)

Under each row (expandable):
- Horizontal “salary strip” showing the next 7 years:
  - This year highlighted.
  - Bars sized or colored by salary amount.
  - Hover to show exact amount and cap %.

**Interactions:**
- Click on player row → Player detail drawer/modal or `/player/:id`.
- “Extension” action for eligible players:
  - Opens calculator UI with pre-filled salary and years.
  - Shows impact on future cap.

### 3.3 Extensions & Cap (`/extensions`)
**Goal:** Help owner calculate future roster and cap situation.

**Sections:**
1. **Extension Calculator**
   - Inputs:
     - Player picker (from roster).
     - Current salary.
     - Years remaining.
     - Desired extension years (1–X, per league rules).
   - Output:
     - New average salary.
     - Year-by-year salaries (next 7 years).
     - Cap impact summary for each year.
   - Use your constitution rules (escalation, total extension money ÷ years, etc.).

2. **Cap Forecast**
   - A timeline chart (7 years) showing:
     - Current committed salary.
     - Cap limit (configurable per year).
     - Open cap space.
   - Table view beneath for detail.

### 3.4 Live Scoreboard (`/scoreboard`)
**Goal:** Real-time view of current week’s matchups.

**Layout:**
- Week selector at top.
- Grid of matchup cards:
  - Team A vs Team B.
  - Scores, projected scores, time status.
  - Record and playoff seed.
- My matchup card pinned to top (highlighted).
- Optional mini “red zone” style panel showing closest games.

### 3.5 League History (`/history`)
**Goal:** Showcase seasons and historical salary trends.

**Sections:**
- “Champions by Year” card (trophy icons, winners, records).
- Historical cap charts (using MFL + Google Sheets data):
  - e.g., “Average salary by position over time”.
- “Records & Milestones” list:
  - Highest single-week score.
  - Most points in a season.
  - Largest cap number ever committed.

### 3.6 Playoff Tracker (`/playoffs`)
**Goal:** Visualize current and projected playoff picture.

**Sections:**
- Bracket view (seeded).
- Table of standings with:
  - Seed, team, record, PF, PA, tiebreaker info.
- “Playoff Odds” card if you calculate probabilities.
- Past years’ brackets accessible via tabs or dropdown.

### 3.7 GroupMe Feed (`/groupme` or as a main panel)
**Goal:** Integrate league chat directly into the site.

**UI:**
- Card with scrollable list of messages (height ~400–600px).
- Show avatar, name, timestamp, and message text.
- Badge for new/unread messages.
- On Dashboard and maybe Roster page, show a mini version with last few messages.

*(Implementation detail: the card is generic; backend can plug in GroupMe’s data.)*

### 3.8 Auth / MFL Login (`/login`)
**Goal:** Authenticate via MyFantasyLeague so the app knows which owner is logged in.

**UI:**
- Centered card:
  - League logo.
  - “Sign in with MyFantasyLeague” primary button.
  - Short description: “Connect your MFL account to manage your roster, contracts, and cap.”

Once logged in:
- Use MFL league ID + owner ID to filter data for that user.
- Show user avatar/name in top-right nav.

---

## 4. Components

### 4.1 Global Components

- **AppShell**
  - Wraps top nav, sidebar, and main content area.

- **TopNav**
  - Props:
    - `pageTitle`
    - `breadcrumbs`
    - `onToggleSidebar()`
    - `onToggleTheme()`
  - Right side: theme toggle, notifications, user profile menu.

- **Sidebar**
  - Nav items:
    - Dashboard
    - My Roster
    - Scoreboard
    - Extensions & Cap
    - League History
    - Playoff Tracker
    - GroupMe
    - Settings
  - Collapsible; show icons only when collapsed.

- **Breadcrumbs**
  - Simple list: Dashboard / Section / Page.

### 4.2 UI Elements

- **Card**
  - Props:
    - `title`
    - `subtitle?`
    - `actions?`
    - `variant = 'default' | 'highlight'`
  - Rounded 16px, soft shadow, white/light-gray background in light mode; darker card background in dark mode.

- **Tag / Pill**
  - Variants: `primary`, `success`, `warning`, `danger`, `neutral`.
  - Used for statuses like “Active”, “Extension Eligible”, “Drafted”, “Completed”, “Playoff”, “Eliminated”.

- **IconButton**
  - Circle pill with icon inside.
  - Used for small actions (info, settings, expand/collapse).

- **Table**
  - Header row with subtle background.
  - Sticky header on scroll.
  - Hover state for rows.

### 4.3 Domain-Specific Components

- **RosterTable**
  - Props: `players`, `years = 7`, `showTeamSummary`.
  - Responsible for:
    - Displaying all core player fields.
    - Rendering salary strip per player.
    - Emitting events:
      - `onSelectPlayer(playerId)`
      - `onOpenExtension(playerId)`

- **SalaryStrip**
  - Props: `salaries: number[]`, `currentYearIndex`.
  - Visual: 7 small columns or blocks showing each year’s salary.

- **CapSummaryCard**
  - Props: `year`, `capLimit`, `capUsed`, `openCap`.
  - Display: donut or bar + text.

- **ExtensionCalculatorPanel**
  - Props: `player`, `currentSalary`, `yearsRemaining`.
  - Output: computed extension values and new year-by-year schedule.

- **ScoreboardCard**
  - Props: `teamA`, `teamB`, `scoreA`, `scoreB`, `status`.
  - State tags: `LIVE`, `FINAL`, `SCHEDULED`.

- **PlayoffBracket**
  - Props: `rounds`, `matchups`.
  - Visual bracket or ladder style.

- **GroupMeFeedCard**
  - Props: `messages`.
  - Layout: vertical feed with avatars.

---

## 5. Data Assumptions

### 5.1 Roster Data Shape (example)

```json

