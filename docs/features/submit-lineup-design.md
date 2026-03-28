# Submit Lineup Page -- Design Specification

**Page:** `/theleague/lineup`
**Rendering:** SSR (auth-required, `export const prerender = false`)
**Primary viewport:** 375px mobile
**Secondary:** Desktop >=640px (centered max-width ~480px)
**Framework:** Astro + vanilla JS (zero React)
**Layout:** `TheLeagueLayout.astro`

---

## Table of Contents

1. [Component Structure](#1-component-structure)
2. [Slot Card Design](#2-slot-card-design)
3. [CDM Bottom-Sheet Design](#3-cdm-bottom-sheet-design)
4. [Bench Section Design](#4-bench-section-design)
5. [Validation UX](#5-validation-ux)
6. [Week Selector Design](#6-week-selector-design)
7. [Set Optimal Lineup UX](#7-set-optimal-lineup-ux)
8. [Design Token Plan](#8-design-token-plan)
9. [Accessibility Requirements](#9-accessibility-requirements)
10. [Responsive Strategy](#10-responsive-strategy)
11. [Animation and Motion](#11-animation-and-motion)
12. [Data Payload Design](#12-data-payload-design)

---

## 1. Component Structure

### Page Layout Hierarchy

```
TheLeagueLayout
  main.lineup-page
    header.lineup-header
      h1.lineup-title          "Set Lineup"
      .lineup-week-selector    Week dropdown
    .lineup-toolbar
      button.lineup-optimal    "Set Optimal Lineup"
      .lineup-status           Validation indicator (live region)
    section.lineup-starters    (aria-labelledby="starters-heading")
      h2.section-title         "STARTERS"
      ol.lineup-slots          9 slot cards (ordered list -- reflects lineup order)
        li.lineup-slot         Individual slot card (one per position)
    section.lineup-bench       (aria-labelledby="bench-heading")
      h2.section-title         "BENCH"
      ul.lineup-bench-list     Bench player rows
        li.lineup-bench-row    Individual bench row
    .lineup-submit-bar         Fixed bottom bar (sticky)
      span.lineup-changes      "3 changes" badge
      button.lineup-submit     "Submit Lineup"
    .lineup-cdm               CDM overlay + bottom-sheet (hidden by default)
      .lineup-cdm__overlay     Frosted backdrop
      .lineup-cdm__sheet       The sheet itself
    div.visually-hidden        Live region announcer (role="status")
```

### Component Breakdown

| Component | Rendering | Purpose |
|-----------|-----------|---------|
| `lineup.astro` | SSR page | Fetches roster + schedule data in frontmatter, renders shell |
| `PlayerCell.astro` | Server | Player lockup in starter slots (server-rendered initial state) |
| `buildPlayerCellHTML()` | Client | Player lockup in CDM replacement list (JS-rendered) |
| Slot card | Server + Client | Server renders initial state; JS handles swap animations |
| CDM bottom-sheet | Client-only | HTML shell is in the Astro template; JS populates content |
| Submit bar | Server + Client | Server renders shell; JS manages button state + change count |

### Data Flow

**Frontmatter (server):**
- Fetch current roster via MFL API (`rosters` endpoint)
- Fetch current week's lineup (`weeklyResults` or `rosters` with starters)
- Fetch schedule data (opponent, game time, spread, O/U)
- Fetch projected scores
- Fetch injury data
- Process into a typed `LineupPayload` object

**Serialized to client via `<script>` tag:**
```html
<script is:inline define:vars={{ payload: JSON.stringify(lineupPayload) }}>
  window.__LINEUP_DATA__ = JSON.parse(payload);
</script>
```

**Client JS module** (`<script>` tag, not `is:inline`):
- Reads `window.__LINEUP_DATA__`
- Manages lineup state in memory
- Persists draft state to `localStorage`
- Handles all interactions (tap-to-swap, CDM, validation, submit)

---

## 2. Slot Card Design

### Layout (Mobile -- 375px)

Each starter slot is a tappable card that spans the full width of the content area.

```
+------------------------------------------------------+
|  [QB]  [Avatar] Name, Last         [OPP]  [12.4 pts] |
|         KC - QB                    4:25p   [Q]  [##] |
+------------------------------------------------------+
```

**Detailed anatomy (left to right):**

```
+-----------+------------------------------+-----------+
|  POSITION |    PLAYER LOCKUP             |   GAME    |
|  BADGE    |                              |   INFO    |
|           |  [40px avatar] Name          | @OPP logo |
|   "QB"    |              KC - QB         |  4:25 PM  |
|           |                              |  Proj: 18 |
+-----------+------------------------------+-----------+
```

**Three zones within the slot card:**

1. **Position badge** (left, 44px wide): Position abbreviation in uppercase. Background color keyed to position group. Vertically centered. Serves as the visual anchor.

2. **Player lockup** (center, flexible): Standard `PlayerCell` pattern -- 40px circular avatar, name (bold), NFL logo + position meta. Truncate name with ellipsis if needed.

3. **Game info** (right, auto-width): Opponent team code with mini logo (16px), game time or countdown, projected score. Stacked vertically, right-aligned. Numbers use `tabular-nums`.

### Position Badge Colors

Position badges use a muted, editorial-appropriate color palette with white text:

| Position | Background | Fallback |
|----------|-----------|----------|
| QB | `var(--lineup-pos-qb, #1c497c)` | Primary blue |
| RB | `var(--lineup-pos-rb, #2e8743)` | Secondary green |
| WR | `var(--lineup-pos-wr, #7c3aed)` | Franchise tag purple |
| TE | `var(--lineup-pos-te, #c0623a)` | Burnt sienna (chart-2) |
| FLEX | `var(--lineup-pos-flex, #5a6672)` | Graphite (chart-6) |
| PK | `var(--lineup-pos-pk, #b8860b)` | Goldenrod (chart-5) |
| DEF | `var(--lineup-pos-def, #374151)` | Gray-700 |

### States

**Filled state (default):**
- White background (`var(--card-bg, #ffffff)`)
- 1px border (`var(--content-border, #e2e8f0)`)
- `var(--shadow-sm)` shadow
- `border-radius: var(--radius-md, 0.5rem)`
- Full player lockup + game info visible

**Empty slot state:**
- Same card dimensions
- Dashed border: `2px dashed var(--color-gray-300, #d1d5db)`
- No shadow
- Position badge still shows
- Center text: "Tap to set" in `var(--color-gray-500, #6b7280)`, 0.8125rem, italic
- Subtle pulsing opacity animation on the dashed border (reduced motion: static)

**Active/tapped state (CDM open for this slot):**
- Left border accent: `box-shadow: inset 3px 0 0 var(--color-primary, #1c497c)` (use inset box-shadow per design-system insight, never `border-left` on cards in table context)
- Background: `var(--color-gray-50, #f9fafb)`
- Slight scale: `transform: scale(0.98)` with `transition: transform 0.15s ease`

**Locked state (game started):**
- Overlay: semi-transparent gray layer over the entire card
- Lock icon (SVG, 14px) in the top-right corner of the card
- Position badge gets reduced opacity (0.6)
- Card is `pointer-events: none` -- not tappable
- `aria-disabled="true"` on the card button
- Game info shows "LIVE" or "FINAL" instead of time

**BYE state:**
- Normal card layout but player lockup meta shows "BYE" in a pill badge
- Game info zone shows "BYE WEEK" in `var(--color-gray-500)`
- No opponent, no projection
- Card is still tappable (owner may want to bench the player)

**Swapped state (unsaved change):**
- Left accent: `box-shadow: inset 3px 0 0 var(--color-secondary, #2e8743)` (green = pending change)
- Tiny dot indicator in top-right corner (green, 6px circle)
- This state clears after successful Submit

**Injury badge:** Inline after name, same pattern as PlayerCell `after-name` slot:
```html
<span class="lineup-injury lineup-injury--Q" title="Questionable">Q</span>
```
Color-coded: O (Out, red), D (Doubtful, orange), Q (Questionable, yellow-on-dark), IR (red).

**Streak/hot indicator:** When a player has scored above their season average for 3+ consecutive recent weeks, show a flame icon (🔥) next to their name. Computed client-side from the weekly scores data already in the payload.

```html
<span class="lineup-streak" title="3-week hot streak" aria-label="Hot streak">🔥</span>
```

```css
.lineup-streak {
  font-size: 0.75rem;
  margin-left: 0.25rem;
  animation: lineup-flame-pulse 1.5s ease-in-out infinite;
}
@keyframes lineup-flame-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

The streak data is pre-computed per player on the server and included in the `LineupPlayer` payload as `streak: number | null` (number of consecutive above-average weeks, null if < 3).

### Desktop (>=640px)

Same card layout, but within a centered column (`max-width: 480px; margin: 0 auto`). Cards get slightly more padding (0.75rem vs 0.625rem). No multi-column grid -- the single-column stack is the canonical layout at all sizes for lineup clarity.

### Slot Card HTML Structure

```html
<li class="lineup-slot" data-slot="QB" data-player-id="14836">
  <button class="lineup-slot__card" aria-label="QB: Patrick Mahomes, KC. Projected 18.4 points. Tap to change.">
    <span class="lineup-slot__pos">QB</span>
    <div class="lineup-slot__player">
      <!-- PlayerCell rendered here (server or client) -->
    </div>
    <div class="lineup-slot__game">
      <div class="lineup-slot__opp">
        <img src="/assets/nfl-logos/DEN.svg" alt="DEN" class="lineup-slot__opp-logo" />
        <span class="lineup-slot__opp-code">@DEN</span>
      </div>
      <span class="lineup-slot__time">4:25 PM</span>
      <span class="lineup-slot__proj">18.4</span>
    </div>
  </button>
</li>
```

The entire card is a `<button>` for accessibility (keyboard focusable, activatable with Enter/Space). The `aria-label` is a complete sentence describing the slot state.

---

## 3. CDM (Bottom-Sheet) Design

The CDM (Contract Detail Modal pattern repurposed for lineup) opens when tapping a starter slot. It shows the current starter pinned at top and eligible bench replacements below.

### Mobile: Bottom-Sheet Behavior

**Dimensions:**
- Width: 100vw (full screen width)
- Max height: 85vh (leaves 15vh visible above for the frosted backdrop peek)
- Min height: 50vh
- `border-radius: var(--radius-xl, 1.5rem) var(--radius-xl, 1.5rem) 0 0` (top corners only)

**Snap points:**
- Default open: 70vh
- Expanded: 85vh (when user swipes up)
- Collapsed: dismiss (when user swipes down past 40vh threshold)

**Swipe-to-dismiss:**
- Drag handle: 32px wide, 4px tall, centered, `var(--color-gray-300)` background, `border-radius: 2px`
- Track vertical touch movement on the handle and sheet header area
- If dragged down > 30% of sheet height, dismiss with slide-down animation
- If dragged up, snap to 85vh expanded state
- Velocity-based: fast flick down always dismisses regardless of distance

**Entry animation:** `translateY(100%) -> translateY(0)`, 0.3s `cubic-bezier(0.32, 0.72, 0, 1)` (iOS-style spring feel)
**Exit animation:** `translateY(0) -> translateY(100%)`, 0.25s `ease-in`

### Desktop (>=640px): Centered Modal

- `max-width: 480px`
- `max-height: 70vh`
- Centered vertically and horizontally
- `border-radius: var(--radius-lg, 1rem)`
- `box-shadow: var(--shadow-xl)`
- Entry: `scale(0.96) translateY(12px)` -> `scale(1) translateY(0)`, 0.32s ease-out
- Exit: fade out 0.2s

### Backdrop (Both Viewports)

**MANDATORY frosted glass:**
```css
.lineup-cdm__overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: var(--z-modal-backdrop, 400);
}
```

### CDM Internal Layout

```
+------------------------------------------+
|              [drag handle]                |
|  CURRENT STARTER                         |
|  +--------------------------------------+|
|  | [Avatar] Name           Proj: 18.4   ||
|  |          KC - QB        L3: 22.1     ||
|  +--------------------------------------+|
|                                          |
|  ELIGIBLE REPLACEMENTS      [Sort: Proj] |
|  +--------------------------------------+|
|  | PLR  NAME     FPA OPP PROJ L3  SEA   ||
|  |--------------------------------------||
|  | [av] J.Hurts   3  @DAL 16.2 19 17.8  ||
|  | [av] D.Prescot 8  PHI  14.1 15 16.2  ||
|  | [av] ...                              ||
|  +--------------------------------------+|
+------------------------------------------+
```

**Section 1: Current Starter (Pinned)**

A highlighted card at the top showing who currently occupies this slot:
- Full player lockup (compact size -- 32px avatar)
- Projection value (large, bold, `tabular-nums`)
- Last 3 weeks average
- Season average
- Opponent + game time
- Background: `var(--color-gray-50, #f9fafb)`
- Left border accent: `box-shadow: inset 3px 0 0 var(--color-primary, #1c497c)`
- Section title: "CURRENT STARTER" (editorial pattern)

**Section 2: Eligible Replacements**

A scrollable table of bench players who are eligible for this slot position.

**Eligibility rules:**
- QB slot: only QB-eligible bench players
- RB slot: only RB-eligible bench players
- WR slot: only WR-eligible bench players
- TE slot: only TE-eligible bench players
- FLEX slot: RB, WR, or TE bench players
- PK slot: only PK bench players
- DEF slot: only DEF bench players
- Exclude players already in other starter slots
- Exclude locked players (game already started)

### Coach Data Columns in CDM

The replacement table uses a compact, horizontally scrollable table. The player lockup is in a sticky left column; data columns scroll horizontally.

| Column | Header | Width | Description |
|--------|--------|-------|-------------|
| Player | PLR | sticky, ~140px | Compact player lockup (28px avatar) |
| FPA Rank | FPA | 40px | Fantasy Points Allowed rank vs position (1=best matchup, 32=worst). Color-coded: 1-8 green, 9-24 gray, 25-32 red |
| Opponent | OPP | 48px | Team code + home/away indicator (@) |
| Spread | SPR | 44px | Point spread for the game. Green if team favored |
| Over/Under | O/U | 40px | Game total |
| Projection | PROJ | 48px | Projected points. **Bold, primary column** |
| Last 3 Avg | L3 | 40px | Average of last 3 weeks |
| Season Avg | SEA | 40px | Full season average |
| Custom Rank | RNK | 40px | Owner's custom ranking (hidden column if no rankings entered). Star icon (⭐) in header |
| Streak | 🔥 | 28px | Flame icon if 3+ consecutive above-avg weeks |

**Custom Rank column behavior:**
- If the owner has custom rankings entered, the RNK column appears and becomes the **default sort** (ascending — rank 1 first)
- If no custom rankings exist, the column is hidden entirely and Projection remains the default sort
- In the CDM header, show a subtle info tooltip: "Based on your custom rankings"

**Table styling follows editorial standard:**
```css
thead th {
  background: var(--color-gray-50, #f9fafb);
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-500, #6b7280);
  position: sticky;
  top: 0;
  z-index: 2;
  white-space: nowrap;
  padding: 0.375rem 0.25rem;
}

tbody td {
  padding: 0.375rem 0.25rem;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-gray-700, #374151);
  border-bottom: 1px solid var(--color-gray-50, #f9fafb);
}
```

**Sort controls:**
- Default sort: Projection (descending)
- Tappable column headers toggle sort
- Sorted column header gets: `color: var(--color-primary, #1c497c); background: rgba(28, 73, 124, 0.06)`
- Sort indicator arrow (SVG, 10px) next to sorted header

**Row tap behavior:**
- Entire row is a `<button role="option">` (within a listbox)
- Tapping a row swaps that player into the starter slot
- CDM dismisses with exit animation
- Slot card updates optimistically

### CDM HTML Shell

```html
<div class="lineup-cdm" id="lineup-cdm" role="dialog" aria-modal="true"
     aria-label="Choose replacement player" aria-hidden="true">
  <div class="lineup-cdm__overlay"></div>
  <div class="lineup-cdm__sheet">
    <div class="lineup-cdm__handle" aria-hidden="true">
      <span class="lineup-cdm__handle-bar"></span>
    </div>
    <button class="lineup-cdm__close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>

    <div class="lineup-cdm__current" id="cdm-current-starter">
      <!-- JS-populated: current starter card -->
    </div>

    <div class="lineup-cdm__replacements">
      <div class="lineup-cdm__replacements-header">
        <h3 class="section-title">Eligible Replacements</h3>
        <span class="lineup-cdm__sort-label" id="cdm-sort-label">by Projection</span>
      </div>
      <div class="lineup-cdm__table-scroll">
        <table class="lineup-cdm__table" role="listbox" aria-label="Available replacement players">
          <thead id="cdm-thead">
            <!-- JS-populated column headers -->
          </thead>
          <tbody id="cdm-tbody">
            <!-- JS-populated player rows -->
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
```

---

## 4. Bench Section Design

The bench section sits below the starters, separated by a visual divider.

### Layout

```
---[ BENCH (19 players) ]---

+------------------------------------------------------+
| [Avatar] Name, Last        KC - QB       Proj: 12.4  |
+------------------------------------------------------+
| [Avatar] Name, Last        DEN - RB      Proj: 8.2   |
+------------------------------------------------------+
...
```

**Each bench row is a compact, non-interactive display row (not tappable from here -- players are accessed via the CDM when tapping a starter slot).**

**Row content:**
- Compact player lockup (32px avatar, `player-cell--compact`)
- Position pill badge (small, inline, `var(--color-gray-100)` background)
- Projected points (right-aligned, `tabular-nums`)
- Injury badge (if applicable, after name)

**How bench rows differ from starter slots:**
1. **Not tappable** -- bench rows are display-only. Interaction happens via CDM.
2. **No position badge column** -- position shown inline in the player meta
3. **No game info block** -- just the projection number, right-aligned
4. **Simpler visual weight** -- no card border/shadow, just a bottom border separator (`1px solid var(--color-gray-50)`)
5. **Compact sizing** -- 32px avatars, 0.8125rem name text
6. **No empty state** -- bench always shows all non-starter roster players

**Section title:** Uses editorial standard with player count:
```html
<div class="lineup-bench__header">
  <h2 class="section-title" id="bench-heading">Bench</h2>
  <span class="count-display"><strong>19</strong> players</span>
</div>
```

**Locked bench players** (game started) get the same reduced opacity (0.6) treatment as locked starter slots, plus the lock icon inline after the name.

---

## 5. Validation UX

### Lineup Validity Rules

A valid lineup requires exactly 9 starters:
- 1 QB
- At least 1 RB (in a dedicated RB or FLEX slot)
- At least 1 WR (in a dedicated WR or FLEX slot)
- At least 1 TE (in a dedicated TE or FLEX slot)
- 3 FLEX (any combination of RB/WR/TE)
- 1 PK
- 1 DEF
- No empty slots
- No duplicate players (same player in two slots)

### Submit Button States

The submit button lives in a fixed bottom bar that sticks to the bottom of the viewport.

**Disabled state (invalid lineup):**
```css
.lineup-submit--disabled {
  background: var(--color-gray-300, #d1d5db);
  color: var(--color-gray-500, #6b7280);
  cursor: not-allowed;
  opacity: 0.7;
}
```
- `aria-disabled="true"` (not `disabled` attribute -- allows focus for screen reader explanation)
- `aria-describedby` pointing to the validation message

**Enabled state (valid + has changes):**
```css
.lineup-submit--ready {
  background: var(--btn-secondary-bg, #2e8743);
  color: white;
}
```
Green CTA because this is a "go/confirm" action (per the button hierarchy rules).

**No changes state (valid but nothing changed):**
```css
.lineup-submit--clean {
  background: var(--color-gray-200, #dddedf);
  color: var(--color-gray-600, #4b5563);
}
```
Button shows "Lineup Saved" with a checkmark icon. Not tappable.

**Submitting state:**
```css
.lineup-submit--loading {
  background: var(--btn-secondary-bg, #2e8743);
  opacity: 0.8;
  pointer-events: none;
}
```
Button text replaced with a spinner + "Submitting..." text.

**Success state (after submit):**
- Brief flash: button background pulses green, text shows "Saved!" with checkmark
- After 2s, reverts to "clean" state
- Green dot indicators on swapped cards clear

**Error state (submit failed):**
- Button background: `var(--color-error, #dc2626)`
- Text: "Failed -- Retry"
- Tappable to retry
- Error detail shown in a toast notification above the submit bar

### FLEX Label Guidance

When FLEX slots are empty, they show position-need hints:

- If no RB in lineup: first empty FLEX shows "FLEX (need RB)"
- If no WR in lineup: first empty FLEX shows "FLEX (need WR)"
- If no TE in lineup: first empty FLEX shows "FLEX (need TE)"
- If all position minimums met: empty FLEX shows "FLEX (RB/WR/TE)"

This text appears in the "Tap to set" empty state, in `var(--color-gray-500)`.

### Unsaved Changes Badge

In the fixed submit bar, a pill badge shows the number of pending changes:

```html
<span class="lineup-changes" aria-live="polite">
  <strong>3</strong> changes
</span>
```

Styling:
```css
.lineup-changes {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-gray-700, #374151);
  background: var(--color-warning-light, #fef3c7);
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-full, 9999px);
  font-variant-numeric: tabular-nums;
}
```

Hidden when change count is 0.

### Validation Error Display

When the user taps Submit with an invalid lineup (should be rare since button is disabled), or when a race condition creates an invalid state:

- Live region announces: "Lineup is incomplete. Missing: Kicker."
- The empty/invalid slot card pulses with a red border flash (0.3s, 2 cycles)
- The submit bar shows an inline error message below the button

```html
<div class="lineup-error" role="alert" id="lineup-error">
  Missing: <strong>PK</strong>
</div>
```

---

## 6. Week Selector Design

### Layout

A horizontal pill selector in the page header, right-aligned next to the page title.

```
Set Lineup                    [Wk 12 v]
```

**Implementation:** Native `<select>` with custom styling (not a custom dropdown). This ensures maximum mobile compatibility -- iOS and Android render native pickers that are faster and more accessible than custom implementations.

```html
<div class="lineup-week-select">
  <label for="lineup-week" class="visually-hidden">Select week</label>
  <select id="lineup-week" class="lineup-week-select__input">
    <option value="12" selected>Week 12</option>
    <option value="13">Week 13</option>
    <option value="14">Week 14</option>
  </select>
  <svg class="lineup-week-select__icon" aria-hidden="true"><!-- chevron --></svg>
</div>
```

**Styling:**
```css
.lineup-week-select__input {
  appearance: none;
  background: var(--color-gray-50, #f9fafb);
  border: 1px solid var(--content-border, #e2e8f0);
  border-radius: var(--radius-md, 0.5rem);
  padding: 0.5rem 2rem 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-gray-700, #374151);
  cursor: pointer;
  min-height: 44px; /* touch target */
}
```

### Week Change Behavior

1. User selects a new week
2. Show a loading skeleton over the starters section (fade transition, 0.15s)
3. Fetch new week data via `fetch('/api/lineup?week=13')` (client-side API call)
4. If the user had unsaved changes on the previous week, show a confirmation: "You have unsaved changes for Week 12. Discard?"
5. Update all slot cards and bench rows with new week data
6. Clear any pending swap state
7. Persist selected week in `sessionStorage` (not `localStorage` -- week selection is session-scoped)

**Current week indicator:** The current NFL week option gets a bullet marker: "Week 12 (current)"

**Past weeks:** Show as disabled options in the select -- owners cannot set lineups for past weeks.

**Future weeks:** Available up to the extent MFL allows (typically current + 3 weeks).

---

## 7. Set Optimal Lineup UX

### Button Placement

In the toolbar row, left-aligned, below the page header and above the starters section.

```html
<button class="lineup-optimal" id="lineup-optimal"
        aria-label="Set optimal lineup based on projections">
  <svg class="lineup-optimal__icon" aria-hidden="true"><!-- magic wand icon --></svg>
  Set Optimal
</button>
```

**Button styling:** Ghost/tertiary style -- not a primary CTA. This is a utility action, not the main page action.
```css
.lineup-optimal {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-primary, #1c497c);
  background: transparent;
  border: 1px solid var(--color-primary, #1c497c);
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  min-height: 44px;
  transition: background 0.15s ease, color 0.15s ease;
}
.lineup-optimal:hover {
  background: rgba(28, 73, 124, 0.06);
}
.lineup-optimal:active {
  background: rgba(28, 73, 124, 0.12);
}
```

### Algorithm

**Ranking source priority:** If the owner has entered **custom rankings** (via the Custom Rankings feature), those rankings take precedence over MFL projected scores. The algorithm uses the player's custom rank as the primary sort key. If no custom rankings exist for the owner, fall back to MFL projections.

```typescript
function getPlayerScore(player: LineupPlayer): number {
  // Custom ranking takes priority (lower rank = better player)
  if (player.customRank != null) return 1000 - player.customRank;
  // Fall back to MFL projection
  return player.projection ?? 0;
}
```

1. For each slot, find the eligible bench player with the highest score (custom rank or projection)
2. QB: highest scored QB
3. RB: highest scored RB
4. WR: highest scored WR
5. TE: highest scored TE
6. PK: highest scored PK
7. DEF: highest scored DEF (if using projections, also weight by FPA rank)
8. FLEX slots: from remaining bench players (RB/WR/TE not already assigned), pick the 3 highest scored
9. **Tie-breaking:** When two players have identical scores, prefer:
   - Higher season average (more consistent)
   - If still tied, higher Last-3 average (recent form)
   - If still tied, alphabetical by last name (deterministic)

### Animation and Feedback

When "Set Optimal" fires:

1. **Button feedback:** Button icon rotates 360 degrees (0.4s ease-out). Button text briefly shows "Optimizing..." with a spinner.

2. **Cascade animation:** Each slot card updates sequentially with a 0.05s stagger delay:
   - Card briefly highlights with `background: var(--color-info-light, #dbeafe)` (light blue flash)
   - Player lockup cross-fades: old player fades out (0.15s), new player fades in (0.15s)
   - If the slot didn't change, no animation plays for that slot (skip unchanged slots)
   - Total cascade duration: 9 slots * 0.05s stagger = 0.45s max

3. **Completion:** Live region announces "Optimal lineup set. N changes made."

4. **No changes needed:** If the current lineup already matches the optimal, button briefly shows "Already optimal!" with a checkmark, then reverts. Live region announces "Lineup is already optimal."

### Locked Slots

Locked slots (game already started) are excluded from optimization. The algorithm works around them -- it only optimizes unlocked slots. If a locked slot has a sub-optimal player, it stays. The announcement includes: "2 slots locked (games in progress)."

---

## 8. Design Token Plan

All lineup-specific tokens use the `--lineup-` prefix and are defined at the component level (in `<style>` blocks within `lineup.astro`), not in `tokens.css`. They reference global tokens with fallbacks.

### Color Tokens

```css
:root {
  /* Slot states */
  --lineup-slot-bg: var(--card-bg, #ffffff);
  --lineup-slot-border: var(--content-border, #e2e8f0);
  --lineup-slot-active-bg: var(--color-gray-50, #f9fafb);
  --lineup-slot-locked-overlay: rgba(243, 244, 246, 0.7);
  --lineup-slot-empty-border: var(--color-gray-300, #d1d5db);
  --lineup-slot-swapped-accent: var(--color-secondary, #2e8743);

  /* Position badge colors */
  --lineup-pos-qb: var(--color-primary, #1c497c);
  --lineup-pos-rb: var(--color-secondary, #2e8743);
  --lineup-pos-wr: var(--color-franchise-tag, #7c3aed);
  --lineup-pos-te: var(--chart-color-2, #c0623a);
  --lineup-pos-flex: var(--chart-color-6, #5a6672);
  --lineup-pos-pk: var(--chart-color-5, #b8860b);
  --lineup-pos-def: var(--color-gray-700, #374151);

  /* FPA matchup rating */
  --lineup-fpa-good: var(--color-success-dark, #059669);
  --lineup-fpa-neutral: var(--color-gray-600, #4b5563);
  --lineup-fpa-bad: var(--color-error, #dc2626);

  /* Injury badges */
  --lineup-injury-O: var(--color-error, #dc2626);
  --lineup-injury-D: var(--color-warning-dark, #d97706);
  --lineup-injury-Q: var(--color-warning, #f59e0b);
  --lineup-injury-IR: var(--color-error-dark, #b91c1c);

  /* CDM */
  --lineup-cdm-bg: var(--card-bg, #ffffff);
  --lineup-cdm-handle: var(--color-gray-300, #d1d5db);
  --lineup-cdm-current-bg: var(--color-gray-50, #f9fafb);

  /* Submit bar */
  --lineup-submit-bg: var(--card-bg, #ffffff);
  --lineup-submit-border: var(--content-border, #e2e8f0);
  --lineup-submit-ready: var(--btn-secondary-bg, #2e8743);
  --lineup-submit-disabled: var(--color-gray-300, #d1d5db);
  --lineup-submit-error: var(--color-error, #dc2626);
  --lineup-submit-success: var(--color-success, #10b981);
}
```

### Spacing Tokens

```css
:root {
  --lineup-page-px: var(--spacing-md, 1rem);        /* Page horizontal padding */
  --lineup-slot-gap: var(--spacing-sm, 0.5rem);      /* Gap between slot cards */
  --lineup-slot-px: 0.625rem;                         /* Slot card internal padding */
  --lineup-slot-py: 0.625rem;
  --lineup-section-gap: var(--spacing-lg, 1.5rem);   /* Gap between sections */
  --lineup-cdm-px: var(--spacing-md, 1rem);          /* CDM internal padding */
  --lineup-submit-height: 68px;                       /* Fixed submit bar height */
}
```

### Touch Target Sizes

All interactive elements enforce minimum 44x44px:

```css
.lineup-slot__card { min-height: 64px; }   /* Slot card: well above 44px */
.lineup-cdm__row { min-height: 48px; }     /* CDM replacement row */
.lineup-optimal { min-height: 44px; }       /* Optimal button */
.lineup-submit { min-height: 48px; }        /* Submit button */
.lineup-week-select__input { min-height: 44px; }
.lineup-cdm__close { min-width: 44px; min-height: 44px; }
```

---

## 9. Accessibility Requirements

### ARIA Roles and Structure

**Slot cards -- `<button>` elements:**

Each slot card is a native `<button>`. Not a `role="radio"` or `role="option"` -- the slot is a single action ("open CDM for this slot"), not a selection from a group.

```html
<button class="lineup-slot__card"
        aria-label="Quarterback: Patrick Mahomes, Kansas City Chiefs. Projected 18.4 points vs Denver. Game at 4:25 PM. Tap to change starter."
        aria-describedby="lineup-slot-locked-msg"
        aria-disabled="false">
```

When locked:
```html
<button class="lineup-slot__card"
        aria-label="Quarterback: Patrick Mahomes, Kansas City Chiefs. Game in progress. Locked."
        aria-disabled="true">
```

**CDM -- `role="dialog"` with `aria-modal="true"`:**

```html
<div class="lineup-cdm" role="dialog" aria-modal="true"
     aria-label="Choose replacement quarterback" aria-hidden="true">
```

**CDM replacement table -- `role="listbox"`:**

The replacement player table uses listbox semantics because it's a single-select list:
```html
<table role="listbox" aria-label="Available replacement players">
  <tbody>
    <tr role="option" aria-selected="false" tabindex="0">
```

Each row is `role="option"` with `tabindex="0"` on the focused row and `tabindex="-1"` on others (roving tabindex pattern).

### Focus Management

**Opening CDM:**
1. Store `document.activeElement` as `previousFocus`
2. Open CDM (animation plays)
3. After animation completes (~300ms), move focus to the first replacement row (or close button if no replacements)
4. Activate focus trap (Tab/Shift+Tab cycles within CDM)

**Closing CDM:**
1. Close CDM (exit animation)
2. Return focus to `previousFocus` (the slot card button that opened the CDM)
3. Deactivate focus trap

**After swap:**
1. Close CDM
2. Return focus to the slot card that was changed
3. Announce swap via live region

### Keyboard Navigation

**Page level:**
- Tab moves between slot cards, toolbar buttons, week selector, submit button
- Enter/Space on a slot card opens CDM

**CDM level:**
- Tab: cycles through CDM controls (close button, sort headers, replacement rows, back to close)
- Arrow Up/Down: moves between replacement rows in the listbox
- Enter/Space: selects the focused replacement row (performs swap)
- Escape: closes CDM, returns focus to triggering slot
- Home/End: jump to first/last replacement row

### Screen Reader Announcements

**Live region element:**
```html
<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"
     id="lineup-announcer"></div>
```

**Announcement triggers:**

| Event | Message |
|-------|---------|
| Swap performed | "Swapped Patrick Mahomes out for Jalen Hurts at Quarterback." |
| Optimal lineup set | "Optimal lineup set. 4 changes made." |
| Already optimal | "Lineup is already optimal." |
| Submit success | "Lineup submitted successfully for Week 12." |
| Submit error | "Lineup submission failed. Please try again." |
| Week changed | "Showing Week 13 lineup." |
| Validation error | "Lineup is incomplete. Missing: Kicker, 1 Running Back." |
| CDM opened | "Choose replacement for Quarterback slot. 5 players available." |
| Slot locked | "This slot is locked. Game has started." |
| Shake to undo | "Undo: restored Patrick Mahomes to Quarterback." |
| Hot streak | (visual only — flame icon with title attribute, no disruptive announcement) |

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .lineup-slot__card,
  .lineup-cdm__sheet,
  .lineup-cdm__overlay,
  .lineup-submit,
  .lineup-optimal__icon {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
```

Under reduced motion:
- CDM appears/disappears instantly (no slide)
- Swap updates happen instantly (no cross-fade)
- Optimal cascade has no stagger (all update simultaneously)
- Empty slot dashed border does not pulse
- Submit success does not pulse

### Color Independence

All states communicate via multiple channels -- never color alone:
- Locked: opacity change + lock icon + "LOCKED" text
- Swapped: green accent + green dot + "changes" badge count
- Injury: colored badge + letter abbreviation (Q, O, D, IR)
- FPA: colored number + rank number (1-32)
- Empty: dashed border + "Tap to set" text
- Validation error: red flash + text message + aria announcement

---

## 10. Responsive Strategy

### Mobile-First Breakpoints

**Base (375px+):** The canonical design. Everything is optimized for this width.

**>=640px (desktop):**
Changes at this breakpoint:

| Element | Mobile | Desktop |
|---------|--------|---------|
| Page max-width | none (full width) | 480px centered |
| Page padding | 1rem | 1.5rem |
| Slot card padding | 0.625rem | 0.75rem |
| Player avatar | 36px (mobile player-cell default) | 40px |
| CDM behavior | Bottom-sheet (slide-up) | Centered modal (scale-in) |
| CDM width | 100vw | 480px |
| CDM max-height | 85vh | 70vh |
| CDM corners | Top only (1.5rem) | All corners (1rem) |
| CDM drag handle | Visible | Hidden |
| Submit bar | Fixed to viewport bottom | Fixed to viewport bottom (same) |
| Bench rows | Full width | Same, within 480px container |

### CDM Behavior Difference

The CDM detection uses a CSS media query check in JS:

```typescript
function isMobileSheet(): boolean {
  return !window.matchMedia('(min-width: 640px)').matches;
}
```

This determines:
- Whether to attach touch drag listeners (mobile only)
- Whether to show the drag handle (mobile only)
- Which entry/exit animation to use
- Whether to use `align-items: flex-end` (mobile) or `align-items: center` (desktop) on the overlay container

### Safe Areas (Notch/Home Indicator)

The fixed submit bar respects iOS safe areas:
```css
.lineup-submit-bar {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
```

---

## 11. Animation and Motion

### Haptic Feedback on Swap

Every swap action triggers haptic feedback on mobile devices for tactile confirmation:

```typescript
function hapticFeedback(style: 'light' | 'medium' | 'heavy' = 'medium') {
  if ('vibrate' in navigator) {
    const patterns = { light: 10, medium: 20, heavy: 40 };
    navigator.vibrate(patterns[style]);
  }
}
```

**Trigger points:**
- Tap a replacement player in CDM → `hapticFeedback('medium')` (swap executed)
- "Set Optimal" fires → `hapticFeedback('light')` per changed slot (staggered with cascade)
- Submit success → `hapticFeedback('heavy')` (confirmation)
- Shake-to-undo triggers → `hapticFeedback('medium')` (undo executed)

### Shake to Undo

The last swap can be undone by shaking the device. Uses the `DeviceMotionEvent` API:

```typescript
let lastSwap: { slotIndex: number; oldPlayerId: string; newPlayerId: string } | null = null;
let shakeThreshold = 15; // m/s² acceleration threshold
let lastShakeTime = 0;

window.addEventListener('devicemotion', (e) => {
  if (!lastSwap) return;
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;
  const force = Math.sqrt(acc.x! ** 2 + acc.y! ** 2 + acc.z! ** 2);
  const now = Date.now();
  if (force > shakeThreshold && now - lastShakeTime > 1000) {
    lastShakeTime = now;
    undoLastSwap();
    hapticFeedback('medium');
    announce('Undo: restored previous player.');
    lastSwap = null;
  }
});
```

**UX details:**
- Only the most recent swap is undoable (not a full undo stack)
- After undo, `lastSwap` is cleared — can't undo twice
- Show a brief toast: "Shake to undo" for 3 seconds after each swap (teaches the gesture)
- On desktop (no accelerometer), show an "Undo" ghost button in the toolbar that appears for 5 seconds after each swap, then fades
- `DeviceMotionEvent` may require permission on iOS 13+ — request on first page load if available

### Slot Swap Animation

When a player is swapped via CDM:

1. **Exit** (old player): The player lockup content slides left and fades out (0.15s ease-in)
2. **Enter** (new player): New player lockup slides in from right and fades in (0.2s ease-out, 0.05s delay)
3. **Card highlight**: Brief flash of `var(--color-info-light, #dbeafe)` background (0.3s), then fades back to white
4. **Green accent**: `box-shadow: inset 3px 0 0 var(--lineup-slot-swapped-accent)` animates in from left (0.2s)

```css
@keyframes lineup-swap-out {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(-16px); }
}

@keyframes lineup-swap-in {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes lineup-slot-flash {
  0%   { background: var(--color-info-light, #dbeafe); }
  100% { background: var(--lineup-slot-bg, #ffffff); }
}
```

### CDM Enter/Exit

**Mobile (bottom-sheet):**
```css
/* Enter */
@keyframes lineup-cdm-enter-mobile {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}

/* Exit */
@keyframes lineup-cdm-exit-mobile {
  from { transform: translateY(0); }
  to   { transform: translateY(100%); }
}
```
- Enter: 0.3s `cubic-bezier(0.32, 0.72, 0, 1)` -- iOS spring curve
- Exit: 0.25s ease-in

**Desktop (centered modal):**
```css
@keyframes lineup-cdm-enter-desktop {
  from { opacity: 0; transform: scale(0.96) translateY(12px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```
- Enter: 0.32s ease-out (matches ContractDemoOverlay pattern)
- Exit: 0.2s ease-in (opacity fade)

**Overlay:**
```css
@keyframes lineup-overlay-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```
- Duration: 0.25s ease-out

### Submit Success Feedback

```css
@keyframes lineup-submit-success {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.03); background: var(--color-success, #10b981); }
  100% { transform: scale(1); }
}
```
Duration: 0.4s ease-out. Plays once after successful submit.

### "Set Optimal" Cascade

```css
@keyframes lineup-optimal-flash {
  0%   { background: var(--color-info-light, #dbeafe); }
  100% { background: var(--lineup-slot-bg, #ffffff); }
}
```

Applied to each changed slot card with staggered `animation-delay`:
```javascript
changedSlots.forEach((slot, i) => {
  slot.style.animationDelay = `${i * 50}ms`;
  slot.classList.add('lineup-slot--optimizing');
});
```

### Motion Timing Summary

| Animation | Duration | Easing | Trigger |
|-----------|----------|--------|---------|
| CDM enter (mobile) | 0.3s | cubic-bezier(0.32, 0.72, 0, 1) | Tap slot |
| CDM exit (mobile) | 0.25s | ease-in | Close/swap |
| CDM enter (desktop) | 0.32s | ease-out | Tap slot |
| CDM exit (desktop) | 0.2s | ease-in | Close/swap |
| Overlay fade in | 0.25s | ease-out | CDM open |
| Overlay fade out | 0.2s | ease-in | CDM close |
| Swap out (old player) | 0.15s | ease-in | Swap |
| Swap in (new player) | 0.2s | ease-out, 0.05s delay | Swap |
| Slot flash | 0.3s | ease-out | Swap/optimize |
| Submit success | 0.4s | ease-out | Submit OK |
| Optimal icon spin | 0.4s | ease-out | Set Optimal |
| Optimal cascade stagger | 0.05s per slot | -- | Set Optimal |
| Haptic (swap) | 20ms vibrate | -- | CDM player tap |
| Haptic (submit) | 40ms vibrate | -- | Submit success |
| Haptic (undo) | 20ms vibrate | -- | Shake to undo |
| Flame pulse | 1.5s infinite | ease-in-out | Hot streak icon |
| Undo toast appear | 0.2s | ease-out | After swap |
| Undo toast fade | 0.3s, 3s delay | ease-in | Auto-dismiss |

---

## 12. Data Payload Design

### Serialized Payload Structure

```typescript
interface LineupPayload {
  /** Current MFL season/league year */
  leagueYear: number;
  /** Currently selected week number */
  week: number;
  /** Available weeks for the week selector */
  availableWeeks: { week: number; label: string; isCurrent: boolean; isPast: boolean }[];
  /** The owner's franchise ID */
  franchiseId: string;
  /** Current starter slots (ordered: QB, RB, WR, TE, FLEX, FLEX, FLEX, PK, DEF) */
  slots: LineupSlot[];
  /** All roster players (starters + bench) */
  roster: LineupPlayer[];
  /** NFL schedule data for this week */
  schedule: GameInfo[];
  /** Timestamp of last lineup submission for this week */
  lastSubmitted: string | null;
}

interface LineupSlot {
  /** Slot position (QB, RB, WR, TE, FLEX, FLEX, FLEX, PK, DEF) */
  position: string;
  /** Slot index (0-8, unique) */
  index: number;
  /** Player ID currently in this slot (null if empty) */
  playerId: string | null;
  /** Whether this slot is locked (game started) */
  locked: boolean;
}

interface LineupPlayer {
  /** MFL player ID */
  id: string;
  /** Player name */
  name: string;
  /** Headshot URL */
  headshot: string;
  /** Primary position */
  position: string;
  /** NFL team code (already normalized) */
  nflTeam: string;
  /** Eligible slot positions (e.g., ["RB", "FLEX"] for a running back) */
  eligibleSlots: string[];
  /** Projected points for this week */
  projection: number | null;
  /** Last 3 weeks scoring average */
  last3Avg: number | null;
  /** Full season scoring average */
  seasonAvg: number | null;
  /** Injury status (O, D, Q, IR, or null) */
  injury: string | null;
  /** Whether this player's game has started */
  gameLocked: boolean;
  /** Game info reference (index into schedule array) */
  gameIndex: number | null;
  /** Is on bye week */
  isBye: boolean;
  /** ESPN player ID (for headshot fallback) */
  espnId?: string;
  /** Custom ranking (from owner's Custom Rankings, lower = better). Null if no custom rankings entered. */
  customRank: number | null;
  /** Hot streak: number of consecutive above-average weeks (null if < 3) */
  streak: number | null;
  /** Last N weekly scores (for trend display in CDM) */
  recentScores: { week: number; score: number }[];
}

interface GameInfo {
  /** Game ID */
  id: string;
  /** Home team code */
  home: string;
  /** Away team code */
  away: string;
  /** Kickoff time (ISO string) */
  kickoff: string;
  /** Point spread (negative = home favored) */
  spread: number | null;
  /** Over/under total */
  overUnder: number | null;
  /** FPA rank vs QB/RB/WR/TE/PK/DEF for each team */
  fpaRanks: Record<string, Record<string, number>>;
  /** Game status: 'pre' | 'live' | 'final' */
  status: string;
}
```

### Payload Size Estimate

| Data | Est. per item | Count | Total |
|------|--------------|-------|-------|
| Slots | ~80 bytes | 9 | ~720 bytes |
| Roster players | ~300 bytes | 28 | ~8.4 KB |
| Schedule games | ~200 bytes | 16 | ~3.2 KB |
| Available weeks | ~60 bytes | 4 | ~240 bytes |
| Metadata | -- | -- | ~200 bytes |
| **Total** | | | **~13 KB** |

After JSON serialization and minification: ~10-12 KB. After gzip: ~3-4 KB.

This is well within acceptable limits for an inline `<script>` payload.

### Minimization Strategies

1. **Pre-normalize team codes** on the server. Don't send raw MFL codes that need client-side normalization.
2. **Index into schedule array** rather than duplicating game info per player. Each player gets a `gameIndex: number` pointing to the `schedule[]` array.
3. **Omit null/default fields** using a custom serializer. If `injury` is null, omit the key entirely.
4. **Pre-compute eligibleSlots** on the server. Don't send the full position eligibility matrix and compute client-side.
5. **Short property names** are not used (readability over bytes at this payload size).

### localStorage Persistence

Draft lineup state is persisted to `localStorage` to survive page reloads:

```typescript
const STORAGE_KEY = 'lineup-draft';

interface LineupDraft {
  franchiseId: string;
  leagueYear: number;
  week: number;
  slots: { index: number; playerId: string | null }[];
  savedAt: string; // ISO timestamp
}
```

**On load:** Check `localStorage` for a draft matching the current `franchiseId + leagueYear + week`. If found and `savedAt` is within the last 24 hours, restore it. Otherwise, use the server-provided lineup.

**On swap:** Write updated draft to `localStorage` immediately.

**On submit success:** Clear the draft from `localStorage`.

**On week change:** Do not carry over draft state -- each week has independent state.

---

## Implementation Notes

### File Structure

```
src/pages/theleague/lineup.astro          -- Main page (SSR)
src/pages/api/lineup.ts                    -- API: GET lineup data, POST submit lineup
src/styles/lineup.css                      -- All lineup-specific styles (imported in page)
src/utils/lineup-helpers.ts                -- Shared types + validation logic
```

The page should be a single `.astro` file with `<style>` block containing all lineup CSS (following the pattern of `rosters.astro` and `players.astro`). The CSS file path above is optional -- inline `<style>` in the Astro component is the established pattern for page-level styles in this codebase.

### MFL API Endpoints

| Action | Endpoint |
|--------|----------|
| Get roster | `GET /export?TYPE=rosters&L={leagueId}&FRANCHISE={franchiseId}&JSON=1` |
| Get weekly results | `GET /export?TYPE=weeklyResults&L={leagueId}&W={week}&JSON=1` |
| Submit lineup | `POST /import?TYPE=myStarters&L={leagueId}&FRANCHISE_ID={id}&W={week}` |

The submit uses the owner's MFL cookie (`getAuthUser(request)`) -- never the commish credential.

### Roster Page Cross-Link

Add a "Set Lineup" CTA button on the existing rosters page (`src/pages/theleague/rosters.astro`) that links to the lineup page. This is the primary discovery path.

**Placement:** In the roster page toolbar area, next to the view mode buttons (Roster / Coach / Analytics). Styled as a primary CTA button that stands out from the view toggles.

```html
<a href="/theleague/lineup" class="lineup-cta">
  <svg class="lineup-cta__icon" aria-hidden="true"><!-- clipboard/pencil icon --></svg>
  Set Lineup
</a>
```

```css
.lineup-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--btn-primary-text, #fff);
  background: var(--btn-primary-bg, #1c497c);
  border-radius: var(--radius-md, 0.5rem);
  text-decoration: none;
  min-height: 44px;
  transition: background 0.15s ease;
}
.lineup-cta:hover {
  background: var(--btn-primary-bg-hover, #164066);
}
```

**Also add to:** The homepage quick-links section and the nav config if applicable.

### Key Dependencies

- `PlayerCell.astro` + `player-cell.css` -- Player lockup (server)
- `buildPlayerCellHTML()` -- Player lockup (client)
- `initPlayerModalTrigger()` -- Click handler for player name -> modal
- `normalizeTeamCode()` -- NFL team code normalization
- `chooseTeamName()` -- Team name display (for opponent display)
- `getCurrentLeagueYear()` / `getCurrentSeasonYear()` -- Year logic
- `getAuthUser()` -- Auth for submit
- Custom Rankings data -- Owner's custom player rankings (if entered)
