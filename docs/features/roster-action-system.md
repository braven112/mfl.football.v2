# Roster Action System — Design & Implementation Guide

## Overview

The roster page is evolving from a read-only data view into an action-oriented management tool. Two columns — **YRS** (contract years) and **ACTIONS** — are both interactive, sharing a unified visual language of left-border accent chips.

This document covers the full redesign across three sessions. **Session 1 is complete and merged to main.**

---

## Architecture: How the Roster Page Works

### Rendering Pipeline

The roster page uses a hybrid SSR + client-side rendering model:

1. **SSR (Astro frontmatter)** — Renders initial HTML with player data, salary tables, and static structure
2. **Client-side `updateView()`** — Rebuilds table rows via `renderTableRows()` on every team/season change
3. **`applyEligibilityStyling()`** — Attaches click handlers to interactive chip buttons after each render

**Critical flow:** `updateView()` → `renderTableRows()` (builds HTML with `buildYearsCellContent()`) → DOM insertion → `applyEligibilityStyling()` (attaches handlers)

### State Management

All roster state lives in client-side variables inside `initRosterPage()`:

| Variable | Purpose | Persisted? |
|----------|---------|------------|
| `contractActions` | Sandbox action state `{ playerId: { type, newSalary, newYears, ... } }` | No (session only) |
| `localDeclarations` | Optimistic declaration cache `{ playerId: { status, years } }` | No (session only) |
| `declarationsByPlayer` | Server-fetched declarations | No (from SSR config) |
| `eligibilityByTeam` | Server-fetched eligibility data | No (from SSR config) |
| `franchiseTagsByYear` | Tracks which player has franchise tag per year | No (session only) |
| `currentVeteranExtension` | Singleton: only one vet extension allowed | No (session only) |
| `demoActive` | Boolean flag for demo mode | No (session only) |
| `rosterViewMode` | GM or Coach | Yes (`localStorage`) |
| `trendWeeksExpanded` | Coach mode trend columns | Yes (`localStorage`) |

### Key Functions Reference

| Function | Location | Purpose |
|----------|----------|---------|
| `buildYearsCellContent(playerId, displayYears, teamId)` | ~line 4946 | Returns chip HTML for a player's years cell |
| `buildDeadlineBadge(elig)` | ~line 4919 | Returns deadline countdown badge HTML |
| `applyEligibilityStyling()` | ~line 5943 | Attaches click handlers to `.yrs-chip--eligible` and `.yrs-chip--pending` buttons |
| `extractPlayerDataFromRow(row, playerId, elig)` | ~line 5927 | Extracts player info from DOM row for modal |
| `openDeclarationModal(data, preSelectedYears?)` | ~line 7229 | Opens contract declaration modal |
| `submitDeclaration()` | ~line 7363 | Handles declaration submit (demo shortcircuit + real API) |
| `openModal(playerData)` | ~line 5253 | Opens sandbox contract action modal |
| `applyContractAction(actionType, extensionYears?)` | ~line 5376 | Applies sandbox action to player |
| `recalculateRoster()` | ~line 5453 | Triggers full table re-render after sandbox change |
| `updateView()` | ~line 7416 | Master re-render function |
| `startDemo()` | ~line 8016 | Enters demo mode, injects mock players |
| `exitDemo()` | ~line 8032 | Exits demo mode, cleans up mock data |

---

## Session 1: YRS Chip + ACTIONS Kebab (COMPLETE)

### What Was Built

#### 1. YRS Cell Interactive Chips

Replaced subtle blue text with obvious chip buttons. Four visual states:

| State | Class | Appearance | Interactive? | When |
|-------|-------|-----------|-------------|------|
| **Default** | `.yrs-chip` | Plain number, no decoration | No | Non-eligible or not owner's team |
| **Eligible** | `.yrs-chip--eligible` | Blue left-border (2.5px `#1c497c`), light blue gradient bg, deadline badge | Yes → opens declaration modal | Owner viewing team + player eligible + no declaration yet |
| **Pending** | `.yrs-chip--pending` | Amber left-border (2.5px `#d97706`), light amber gradient bg, deadline badge | Yes → reopens modal to edit | Declaration submitted, not yet approved, deadline not passed |
| **Approved** | `.yrs-chip--approved` | Green asterisk (*) after value, font-weight 600 | No | Declaration approved by commissioner |

**Chip HTML structure:**
```html
<button class="yrs-chip yrs-chip--eligible" type="button">
  <span class="yrs-chip__value">2</span>
  <span class="yrs-chip__deadline yrs-chip__deadline--critical">17h</span>
</button>
```

**Deadline badge urgency levels:**
- Normal (24h+): default amber badge
- Urgent (4-24h): `.yrs-chip__deadline--urgent` — orange bg
- Critical (<4h): `.yrs-chip__deadline--critical` — red bg with pulse animation

**Key design decisions:**
- Semantic `<button>` elements (not divs with click handlers) for accessibility
- `onclick` (not `addEventListener`) to prevent duplicate handlers on re-render
- Pending chips are editable — clicking reopens the modal pre-populated with current selection
- `openDeclarationModal()` accepts optional `preSelectedYears` param for edit mode
- Edit mode changes CTA from "Declare Contract" to "Update Declaration"

#### 2. ACTIONS Column Kebab Menu

Replaced the tiny 20x20px amber `+` button with a neutral 24x24px kebab menu trigger (three vertical dots).

**Default state:** Neutral gray border, gray dots
**Active action states:** Left-border accent matching action type:
- `data-action-type="franchise"` → Blue left-border + blue gradient
- `data-action-type="extension"` → Green left-border + green gradient
- `data-action-type="cut"` → Red left-border + red gradient
- `data-action-type="trade"` → Amber left-border + amber gradient

The `data-action-type` attribute is set in `renderTableRows()` from `contractActions[player.id]?.type`.

Column header changed from "Actions" text to icon-only kebab (saves horizontal space).

#### 3. Demo System Updates

- Step 2 mockup in `ContractDemoOverlay.astro` uses real `.yrs-chip` components instead of custom markup
- Copy updated: "Look for the blue chips" instead of "blue numbers"
- Demo declaration submissions bypass the API and show success immediately (checks `demoActive && id.startsWith('DEMO_')`)
- Hopkins fixed to BAL (not LVR), Mendoza headshot uses correct college ESPN URL
- Exit button changed from red to dark slate (`#334155` → `#1e293b`)

### Files Modified (Session 1)

| File | Changes |
|------|---------|
| `src/pages/theleague/rosters.astro` | New `.yrs-chip` CSS system, rewritten `buildYearsCellContent()`, `buildDeadlineBadge()` helper, updated `applyEligibilityStyling()`, kebab icon + `data-action-type` on action buttons, demo submit shortcircuit, Hopkins BAL fix, Mendoza headshot fix |
| `src/components/theleague/ContractDemoOverlay.astro` | Step 2 mockup uses `.yrs-chip` + `PlayerCell`, Hopkins team BAL, exit button slate, old mockrow CSS removed |

---

## Session 2: Sandbox / Live Mode Toggle (PLANNED)

### Goal

Add a mode toggle that distinguishes between "exploring what-if scenarios" (sandbox) and "building a real action queue" (live). The key insight: **YRS declarations are always live** — they have real deadlines and submit to the API. The sandbox/live toggle only affects the ACTIONS column (franchise tags, extensions, cuts, trades).

### User's Requirement

Live mode does NOT auto-submit to MFL. Instead it builds a **queue of pending actions** that the commissioner reviews and manually submits. Think of it as "draft mode" vs "intent mode."

### Mode Comparison

| Aspect | Sandbox Mode | Live Mode |
|--------|-------------|-----------|
| **Purpose** | What-if cap simulation | Real actions you intend to submit |
| **Actions** | Visual-only, clearable, no persistence | Queued for manual commissioner submission |
| **Persistence** | Session only (current `contractActions` behavior) | Saved to localStorage so you don't lose them |
| **Visual indicator** | Amber banner above table: "Sandbox — changes are hypothetical" | Green indicator + queue count badge |
| **Salary cells** | Italic styling for simulated values (existing `.salary-cell--simulated`) | Same italic styling + "queued" badge |
| **YRS chip** | Always live (unchanged) | Always live (unchanged) |
| **Clear All** | Existing "Clear All Tags" button | "Clear Queue" with confirmation |

### Implementation Plan

#### 2A. Mode Toggle UI

**Placement:** Near the existing GM/Coach toggle, visible only when `isOwnerViewingTeam(currentTeam)` is true.

**Design:** Two-button pill matching the GM/Coach toggle pattern:
- "Sandbox" (amber accent) — default
- "Live" (green accent)

**Persistence:** `localStorage.setItem('rosterActionMode', 'sandbox' | 'live')` — mirrors the GM/Coach pattern.

**State variable:** `let actionMode = localStorage.getItem('rosterActionMode') || 'sandbox';`

#### 2B. Sandbox Mode Behavior

This is the **current behavior** — no changes needed:
- `contractActions` object stores visual-only changes
- `recalculateRoster()` re-renders table with simulated values
- "Clear All Tags" button resets everything
- Nothing persisted, nothing submitted

#### 2C. Live Mode Behavior

When `actionMode === 'live'`:

1. **Action submission flow:**
   - User clicks kebab → modal opens with "LIVE" badge in header
   - User selects action → confirmation step with salary impact preview
   - User confirms → action stored in `liveActionQueue` (new state variable)
   - `liveActionQueue` synced to localStorage for persistence across refreshes

2. **Queue data structure:**
```javascript
const liveActionQueue = JSON.parse(localStorage.getItem('liveActionQueue') || '[]');
// Each entry:
{
  id: crypto.randomUUID(),
  playerId: string,
  playerName: string,
  actionType: 'franchise' | 'extension' | 'cut' | 'trade',
  params: { extensionYears?: number },
  originalSalary: number,
  originalYears: number,
  newSalary: number,
  newYears: number,
  queuedAt: ISO timestamp,
}
```

3. **Visual changes in live mode:**
   - Action button gets left-border accent (same as sandbox, but also shows a small dot indicator)
   - Salary cells show simulated values with italic + "queued" micro-badge
   - Queue count badge on the mode toggle: "Live (3)"

4. **Queue management:**
   - "View Queue" button opens a slide-out panel or modal listing all queued actions
   - Each queued action shows: player name, action type, salary impact, timestamp
   - Individual "Remove" button per action
   - "Clear Queue" button with "Are you sure?" confirmation
   - Commissioner can view/export the queue for manual MFL submission

#### 2D. Mode Toggle Interaction with Existing Systems

- **GM/Coach toggle:** Sandbox/Live toggle only visible in GM mode
- **Demo mode:** Always uses sandbox behavior regardless of toggle state
- **Contract declarations (YRS chips):** Unaffected by toggle — always real submissions
- **`contractActions` object:** In sandbox mode, works as today. In live mode, also populates `liveActionQueue` for persistence.

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/theleague/rosters.astro` | Add mode toggle HTML near GM/Coach, add `liveActionQueue` state, modify `applyContractAction()` to dual-write in live mode, add queue count badge, add "LIVE" badge to action modal, add confirmation step in live mode, add queue viewer panel/modal |
| `src/components/theleague/ContractDemoOverlay.astro` | Possibly update tutorial to mention sandbox vs live (or skip for now) |

### Verification Checklist

- [ ] Toggle renders only for team owner in GM mode
- [ ] Sandbox mode: identical to current behavior (no regression)
- [ ] Live mode: actions persist to localStorage across page refresh
- [ ] Live mode: queue count badge updates on action add/remove
- [ ] Live mode: confirmation step before queueing
- [ ] Mode toggle persists to localStorage
- [ ] Demo mode always uses sandbox regardless of toggle
- [ ] YRS declarations unaffected by toggle
- [ ] Mobile: toggle fits at 375px
- [ ] "Clear Queue" has confirmation dialog

---

## Session 3: Editorial Modal Overhaul (PLANNED)

### Goal

All roster modals (contract actions, declarations, queue viewer) should share a "sports magazine" design language with editorial microcopy. Extract the inline action modal into a standalone component.

### Shared Modal Design Language

Every modal follows this structural pattern:

```
[Close X]
[Player Hero: circular headshot + name + team + position]
[Kicker: UPPERCASE label with left-border accent]
[Headline: bold, confident, large]
[Body: light-weight, readable, smaller]
[Content area: cards/tiles/projections]
[Footer: primary CTA button]
```

This matches the existing `ContractDeclarationModal.astro` and `PlayerDetailsModal.astro` patterns.

### Editorial Microcopy

Replace clinical language with the league's editorial voice:

| Current | Editorial |
|---------|-----------|
| "Select Contract Length" | "How long are you locking this in?" |
| "Declare Contract" | "Lock it in" |
| "Declaration submitted" | "Done deal. The commish has your paperwork." |
| "Veteran Extension" description | "Keep the band together. Add 1-2 years at a negotiated rate." |
| "Franchise Tag" description | "The safety net. One more year at the higher of 120% or the position average." |
| "Cut Player" description | "Sometimes you have to eat the dead money. 50% hit now, penalties later." |
| "Trade Player" description | "Ship 'em out. Their contract goes with them, no cap penalty." |
| "Manage Contract" (modal title) | "What's the Move?" |
| "Current Salary" | "On the books for" |
| "Years Remaining" | "Locked in through" |

### Component Extraction

#### 3A. `RosterActionModal.astro`

Extract the inline sandbox action modal (currently embedded HTML in `rosters.astro` ~line 4767) into a standalone component following the same pattern as `ContractDeclarationModal.astro`.

**Current inline structure to extract:**
- Modal overlay + container
- Player hero section (headshot, name, position, injury badge)
- Current contract display (salary, years)
- Action option buttons (franchise, extension, cut, trade)
- Extension year selector (hidden by default)
- Close button

**New component location:** `src/components/theleague/RosterActionModal.astro`

#### 3B. Modal Typography Tokens

Add shared modal typography tokens to `src/styles/tokens.css`:

```css
/* Modal Tokens */
--modal-kicker-size: 0.6875rem;
--modal-kicker-weight: 800;
--modal-kicker-spacing: 0.08em;
--modal-kicker-transform: uppercase;
--modal-kicker-color: var(--color-primary);

--modal-headline-size: 1.5rem;
--modal-headline-weight: 700;
--modal-headline-spacing: -0.01em;
--modal-headline-color: var(--color-text);

--modal-body-size: 0.875rem;
--modal-body-weight: 400;
--modal-body-color: var(--color-text-secondary);
--modal-body-leading: 1.6;
```

#### 3C. Shared Patterns

Both `ContractDeclarationModal` and `RosterActionModal` should use:
- Same hero layout (circular headshot + player lockup)
- Same kicker pattern (left-border accent + uppercase label)
- Same `fadeInUp` animation on open
- Same close button positioning
- Same overlay backdrop

### Files to Create/Modify

| File | Changes |
|------|---------|
| `src/components/theleague/RosterActionModal.astro` | NEW — extracted from inline HTML in rosters.astro |
| `src/pages/theleague/rosters.astro` | Remove inline modal HTML, import new component, update JS references |
| `src/components/theleague/ContractDeclarationModal.astro` | Update microcopy to editorial voice |
| `src/styles/tokens.css` | Add `--modal-*` typography tokens |

### Verification Checklist

- [ ] Action modal renders from extracted component (no visual regression)
- [ ] Declaration modal uses editorial microcopy
- [ ] Action modal uses editorial microcopy
- [ ] Modal tokens used consistently across both modals
- [ ] Animations preserved (fadeInUp)
- [ ] Mobile: modals don't overflow at 375px
- [ ] Keyboard: Escape closes modals
- [ ] Click outside closes modals

---

## Visual Design Language Reference

### The Left-Border Accent System

Both YRS chips and ACTIONS buttons use the same visual language:

```
[2.5px colored left-border] [gradient background] [content]
```

**Color mapping:**
| Context | Left-border color | Gradient |
|---------|------------------|----------|
| Eligible (YRS) | `#1c497c` (brand blue) | `#eff6ff → #dbeafe` |
| Pending (YRS) | `#d97706` (amber) | `#fffbeb → #fef3c7` |
| Franchise Tag (ACTION) | `#1c497c` (brand blue) | `#eff6ff → #dbeafe` |
| Extension (ACTION) | `#059669` (green) | `#ecfdf5 → #d1fae5` |
| Cut (ACTION) | `#dc2626` (red) | `#fef2f2 → #fecaca` |
| Trade (ACTION) | `#d97706` (amber) | `#fffbeb → #fef3c7` |

### Hover States

All interactive chips/buttons use:
- Background darkens slightly
- Subtle `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08)`
- `transition: all 0.18s ease`

### Mobile Considerations

- Chips must fit at 375px without overflow
- Deadline badges use compact labels: `17h`, `168d`, `<1h`
- Kebab buttons are 24x24px minimum (meets 44px touch target with cell padding)

---

## Demo System Reference

### Mock Players

| Player | ID | NFL Team | ESPN ID | Type | Deadline |
|--------|-----|----------|---------|------|----------|
| Hopkins, DeAndre | `DEMO_HOPKINS` | BAL | `15795` | `new-acquisition` | 18 hours from now |
| Mendoza, Fernando | `DEMO_MENDOZA` | LVR | `4837248` (college) | `rookie-override` | 3rd Sunday in August, 8:45 PM PT |

### Demo Flow

1. User clicks "Preview" floating button → Tutorial stepper opens
2. Steps 1-3 explain the system, Step 2 shows chip mockup
3. "Start Exploring" → Demo players injected, auth spoofed for current team
4. User can click chips, submit declarations (bypasses API), see success flow
5. "EXIT DEMO" button (dark slate, fixed right edge) → cleans up all mock data

### Important: Demo declarations skip the API

In `submitDeclaration()`, demo players are detected by `demoActive && id.startsWith('DEMO_')` and go straight to optimistic success without hitting `/api/contracts/declare`.
