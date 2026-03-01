# Contract Declaration System — Epic Plan

## What's Done

All committed to `main` as of 2026-03-01:

| Feature | Summary |
|---------|---------|
| **Feature 1: Eligibility Engine** | `src/utils/contract-eligibility.ts` — derives eligibility from MFL transactions. Handles 5 declaration types: `new-acquisition`, `rookie-override`, `franchise-tag`, `veteran-extension`, `rookie-extension`. Tests in `tests/contract-eligibility.test.ts`. |
| **Feature 3: Declaration API** | Four endpoints: `POST /api/contracts/declare` (owner), `GET /api/contracts/pending`, `POST /api/contracts/approve` (commissioner), `POST /api/contracts/reject` (commissioner). Storage in `data/theleague/contract-declarations.json` via `src/utils/contract-storage.ts`. |
| **Feature 4: MFL Writer** | `src/utils/mfl-contract-writer.ts` — writes to MFL `import?TYPE=salaries&APPEND=1`. Pre-write backup, retry logic, audit logging. Tests in `tests/mfl-contract-writer.test.ts`. |
| **Manage Page** | `src/pages/theleague/contracts/manage.astro` — Commissioner dashboard with sticky right sidebar (status metrics), pending cards with approve/reject, recent decisions section. PlayerDetailsModal aesthetic. |

---

## Feature 2: Roster Page UI — Eligibility Indicators & Inline Editing

**Status:** Plan approved, not started.

**Goal:** Make the roster page's "Years" column interactive. When an owner views their roster in GM mode, eligible players show a clickable years cell with a deadline badge. Clicking opens a `ContractDeclarationModal`. After submitting, the cell updates optimistically with an asterisk indicator.

**Files to modify:** `src/pages/theleague/rosters.astro`
**Files to create:** `src/components/theleague/ContractDeclarationModal.astro`

**Scope:** Only `new-acquisition` and `rookie-override` declaration types. Franchise tags and extensions are Features 6 & 7.

### Part 1: Frontmatter Data Loading (rosters.astro)

Add imports and compute eligibility for all teams at build time:

```typescript
import { getTeamEligibility } from '../../utils/contract-eligibility';
import { getDeclarations } from '../../utils/contract-storage';
```

Build eligibility map after existing data loading (~line 1553):

1. Load `transactions.json` and `players.json` from MFL feeds (already loaded via `transactionsFeeds` glob at line 462 and `playersFeeds` at line 456)
2. Build a `Map<string, MFLPlayerInfo>` from the players feed
3. For each franchise in the current year's roster data, call `getTeamEligibility()` to get eligibility results
4. Build `eligibilityByTeam: Record<franchiseId, Record<playerId, EligibilityResult>>`
5. Load declarations via `getDeclarations()` and build `declarationsByPlayer: Record<playerId, ContractDeclaration>`
6. Add both to `serializedConfig` (line 1555)

### Part 2: SSR Template — Years Cell (rosters.astro ~line 1976)

Add `years-cell` class and `data-player-id` to the years `<td>`. All interactivity is client-side (matches existing pattern).

### Part 3: ContractDeclarationModal Component

Create `src/components/theleague/ContractDeclarationModal.astro` — static HTML shell populated by client-side JS (same pattern as existing contract modal at line 4734).

Structure:
- Overlay backdrop (click to close)
- Modal card styled like PlayerDetailsModal
- Player lockup section (headshot, name, position, NFL logo)
- Declaration type badge ("New Acquisition", "Rookie Override", etc.)
- Current contract info (salary, years, designation)
- Deadline countdown (live-updating, red when <4h, amber when <12h)
- Year selector (radio-style buttons for valid year options)
- Salary projection table (year-by-year with 10% escalation)
- Submit button → calls `POST /api/contracts/declare`

### Part 4: Client-Side JavaScript

- Parse eligibility data from config
- `buildYearsCell()` function — replaces plain years number with enhanced cell
- Indicator states: `*` amber (pending), `*` green (approved), deadline badge
- Clickable only when: user is franchise owner + player has active eligibility + no pending declaration
- Event delegation for years cell clicks (after UFA button handler at line 6161)
- Modal open/close/submit with optimistic UI via `localDeclarations` map
- `updateView()` re-renders with asterisks

### Part 5: CSS

- `.years-cell--eligible` cursor pointer, primary color, hover state
- `.years-cell__asterisk--pending` amber, `--approved` green
- `.years-cell__deadline` tiny countdown badge with urgency colors

### Part 6: Integration

Add `<ContractDeclarationModal />` after existing contract modal (~line 4438).

### Key Rosters.astro Reference Points

| Line | What's There |
|------|-------------|
| ~456 | `playersFeeds` glob |
| ~462 | `transactionsFeeds` glob |
| ~465 | `rostersFeeds` glob |
| ~1270 | `authUser = getAuthUser(Astro.request)` |
| ~1555 | `serializedConfig = JSON.stringify({...})` |
| ~1976 | SSR years cell `<td data-label="Yrs">` |
| ~4438 | End of existing contract modal HTML |
| ~4443 | `<script type="application/json" id="roster-config">` |
| ~4733 | Modal management (contract modal open/close) |
| ~5848 | `renderTableRows()` function |
| ~6154 | Client-side years cell in template literal |
| ~6161 | Event delegation for UFA buttons |
| ~6653 | `updateView()` function |
| ~6658 | `contractActions` applied to rows |

---

## Feature 5: Rookie Draft Auto-Contract Job

**Status:** Not started.

**Goal:** After the rookie draft completes, automatically set all drafted rookies to 4-year contracts with `RC` designation on MFL.

### Business Rules
- Rookies default to 4 years, `contractInfo = "RC"`
- Must meet BOTH: (1) our RC designation AND (2) MFL marks them as rookie (`status: "R"` in players.json OR `draft_year` matches current year)
- `R1` is a **retired** designation — all rookies get `RC` regardless of round
- Salary = their draft pick salary (already set by MFL)
- Owners can later override to 1-3 years via `rookie-override` declaration (deadline = 3rd Sunday in August @ 8:45 PM PT)

### Implementation

**Create:** `scripts/set-rookie-contracts.ts`

1. **Load data:**
   - `draftResults.json` for current year → all drafted player IDs + franchise IDs
   - `players.json` → verify `status: "R"` or `draft_year` matches
   - `rosters.json` → current salary for each player

2. **For each drafted rookie:**
   - Verify player is still on a roster
   - Set `contractYear = 4`, `contractInfo = "RC"` via `writeContractToMFL()`
   - Log the change

3. **Safety:**
   - Skip players already set to 4yr/RC (idempotent)
   - `--dry-run` flag logs what would change without writing
   - Uses APPEND=1 safety from mfl-contract-writer

4. **Trigger:** `pnpm run set-rookie-contracts` or commissioner button on manage page

### Utilities to Reuse
- `src/utils/mfl-contract-writer.ts` — `writeContractToMFL()`
- `src/utils/contract-eligibility.ts` — `getAugustCutdownDate()`
- MFL feeds: `draftResults.json`, `players.json`, `rosters.json`

---

## Feature 6: Franchise Tag Declaration

**Status:** Not started. Depends on Feature 2 (uses the ContractDeclarationModal).

**Goal:** Allow owners to apply a franchise tag to a player with exactly 1 year remaining during the offseason.

### Business Rules
- **Eligibility:** Exactly 1 year remaining AND not already tagged (`contractInfo !== 'F'`)
- **Offseason only**
- **One tag per team per year**
- **Tag salary** = `MAX(currentSalary × 1.20, top3PositionAverage)`
- **Contract result:** 1 year at tag salary, `contractInfo = "F"`

### Implementation

1. **Create tag salary calculator** — `src/utils/franchise-tag-calculator.ts`:
   - Input: position, current salary, all league rosters
   - Find all players at same position, sort by salary desc, average top 3
   - Return `MAX(currentSalary * 1.20, top3Average)` with explanation string

2. **Extend eligibility engine** (`contract-eligibility.ts`):
   - The `franchise-tag` case at line 274 already returns `eligible: true`
   - Add `tagSalary` and `tagBasis` to the result using the calculator

3. **Extend declaration API** (`declare.ts`):
   - Add validation: only 1 franchise tag per franchise per year
   - Store `requestedSalary = tagSalary` in declaration

4. **Extend ContractDeclarationModal:**
   - Add franchise tag panel: tag salary breakdown, position average detail
   - Single "Apply Franchise Tag" button (no year selection — always 1yr)
   - Salary comparison: current vs. tag salary

5. **MFL write on approval:**
   - `contractYear = 1`, `contractInfo = "F"`, salary = tag salary

### Files
- Create: `src/utils/franchise-tag-calculator.ts`
- Modify: `src/utils/contract-eligibility.ts`, `src/pages/api/contracts/declare.ts`, `ContractDeclarationModal.astro`

---

## Feature 7: Extension Declaration (Veteran + Rookie)

**Status:** Not started. Depends on Feature 2 (uses the ContractDeclarationModal).

**Goal:** Allow owners to extend player contracts during the offseason.

### Business Rules — Veteran Extension
- **Eligibility:** 2+ years remaining, NOT a rookie contract (`contractInfo !== 'RC'`)
- **Offseason only**
- **Extension:** +2 years to current contract
- **Salary:** `currentSalary × 1.10^currentYears` (escalated to extension point)
- One extension per player per offseason

### Business Rules — Rookie Extension
- **Eligibility:** Player has `RC` designation, offseason only
- **Extension:** +2 years to current contract
- **Salary:** Same escalation math as veteran
- **Special:** After extension, `contractInfo` changes from `RC` to blank (graduated from rookie deal)

### Implementation

1. **Extend eligibility engine:**
   - `veteran-extension` (line 283) and `rookie-extension` (line 292) already return `eligible: true`
   - Add `extensionSalary` = `salary * ESCALATION_RATE^currentYears`
   - Add `extensionYears` = `currentYears + 2`
   - Validate: no more than 1 extension per player per offseason

2. **Extend declaration API:**
   - Add validation: check existing extension this offseason
   - Store `requestedYears = currentYears + 2` and `requestedSalary = extensionSalary`

3. **Extend ContractDeclarationModal:**
   - Extension panel: current contract, +2yr projection, salary escalation table
   - "Extend Contract" button
   - Before/after comparison

4. **MFL write on approval:**
   - `contractYear = currentYears + 2`
   - Salary = escalated salary
   - For rookie extensions: clear `contractInfo` from `RC` to blank

### Utilities
- `src/utils/salary-calculations.ts` — escalation math already exists

---

## Feature 8: Transaction Log & Contract History

**Status:** Not started. Independent of other features.

**Goal:** Public-facing log of all contract declarations. Transparency and audit trail.

### Implementation

1. **Create page:** `src/pages/theleague/contracts/history.astro`
   - Chronological list of all declarations (newest first)
   - Filterable by: status, type, team
   - Each entry: player name, team, type, before/after contract, status, timestamps
   - Same card design language as manage page

2. **Data source:** `getDeclarations()` from `contract-storage.ts` (already stores full audit trail)

3. **Navigation:** Add to `nav-config.json` under a Contracts section

4. **Auth:** History page is public (all members). Manage page should get commissioner auth guard.

5. **Design:** Same sidebar layout as manage page. Sidebar shows aggregate stats or filter controls.

---

## Implementation Order

1. **Feature 2** — connects eligibility engine to UI (prerequisite for 6 & 7)
2. **Feature 5** — small standalone script, quick win
3. **Feature 6** — extends declaration modal with tag calculator
4. **Feature 7** — extends declaration modal with extension logic
5. **Feature 8** — standalone new page

Features 6 and 7 both extend the ContractDeclarationModal from Feature 2, so Feature 2 must be done first. Feature 5 is independent.

---

## Key Architecture Reference

| File | Purpose |
|------|---------|
| `src/types/contract-eligibility.ts` | All eligibility types (DeclarationType, EligibilityResult, etc.) |
| `src/types/contracts.ts` | ContractDeclaration, DeclarationStatus types |
| `src/utils/contract-eligibility.ts` | Eligibility engine — `getPlayerEligibility()`, `getTeamEligibility()` |
| `src/utils/contract-storage.ts` | JSON CRUD — `getDeclarations()`, `addDeclaration()`, `updateDeclaration()` |
| `src/utils/mfl-contract-writer.ts` | MFL API writer — `writeContractToMFL()` with APPEND=1 safety |
| `src/utils/salary-calculations.ts` | 10% escalation math |
| `src/pages/api/contracts/declare.ts` | POST — owner submits declaration |
| `src/pages/api/contracts/approve.ts` | POST — commissioner approves |
| `src/pages/api/contracts/reject.ts` | POST — commissioner rejects |
| `src/pages/api/contracts/pending.ts` | GET — list pending |
| `src/pages/theleague/contracts/manage.astro` | Commissioner dashboard (sidebar layout) |
| `src/pages/theleague/rosters.astro` | Roster page (Feature 2 target) |

### Design Language

All contract UI follows the PlayerDetailsModal aesthetic:
- Section titles: `0.85rem, 700 weight, uppercase, 0.05em tracking, #475569`
- Field labels: `0.7rem, 300/500 weight, uppercase, #64748b`
- Field values: `0.9rem, 300 weight, #1a1a1a`
- Status indicators: colored dot + text (not pills)
- Cards: `12px border-radius`, dramatic shadow, staggered `fadeInUp` animations
- Manage page: sticky right sidebar with left-accent color metric cards
