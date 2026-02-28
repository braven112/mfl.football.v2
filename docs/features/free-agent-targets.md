# Free Agent Target Prioritization

## Overview

A new admin-only section on the Free Agents page (`/theleague/players`) that ranks free agents by surplus value — the gap between what their production is worth in dollars and what they'll likely cost at auction. Highlights market inefficiencies: players whose production exceeds their price tag.

**Who sees it:** Admin only (franchise 0001/0000). Other users see the normal Free Agents page with no changes.

**Priority:** This is the **#1 user-requested feature** in the Dynasty Value Analysis system.

**Related docs:** [Surplus Value Calculator](surplus-value-calculator.md) | [Dynasty Value Analysis Index](dynasty-value-analysis-index.md)

---

## Dependencies

- **Surplus Value Calculator** (`src/utils/surplus-value.ts`) must be built first. This feature imports and uses `calculateAllSurplusValues()`.

---

## Architecture

Enhancement to the existing Free Agents page at `src/pages/theleague/players.astro`.

Since `players.astro` uses `prerender = true` (static), the admin gate must be **client-side**. The surplus value data is computed at build time for all free agents and embedded in the page, but the Targets UI section is hidden by default and revealed via JavaScript when the cookie check confirms admin franchise.

### Data Flow

```
Build Time (players.astro frontmatter):
  projectedScores + players + rosters + salaryAverages + adpDynasty
    → calculateAllSurplusValues()
    → filter to free agents with projected points > 0
    → serialize as JSON into page <script> tag

Client Side:
  Check theleague_team_pref cookie for franchise 0001/0000
    → if admin: show "Targets" view toggle, render surplus value table
    → if not admin: no visible change
```

---

## Data Sources

| Data | File Path | Usage |
|------|-----------|-------|
| All data already loaded by `players.astro` | `playerModules`, `projectedScoresModules`, `rostersModules`, `adpDynastyModules` | Existing globs |
| Salary averages (**new glob needed**) | `src/data/mfl-salary-averages-{year}.json` | Positional salary benchmarks for cost estimation |
| Custom rankings (optional) | localStorage `cr.localCache` | Improves cost estimates if available |

---

## Algorithm / Core Logic

1. **In frontmatter:** Call `calculateAllSurplusValues()` for all players
2. **Filter:** Keep only free agents (not rostered) with `projectedPoints > 0`
3. **Sort:** By `surplusValue` descending (biggest bargains first)
4. **Client-side table columns:**
   - Rank (by surplus value)
   - Player (via `buildPlayerCellHTML()`)
   - Projected Points
   - Dollar Value (what their production is worth)
   - Est. Cost (what they'll likely cost at auction)
   - Surplus $ (green if positive, red if negative)
   - Surplus % (percentage over/under)

### Client-side admin detection

```javascript
function isAdminFromCookie() {
  try {
    const cookie = document.cookie.split(';')
      .find(c => c.trim().startsWith('theleague_team_pref='));
    if (!cookie) return false;
    const pref = JSON.parse(decodeURIComponent(cookie.split('=')[1]));
    return pref.franchiseId === '0001';
  } catch { return false; }
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/styles/free-agent-targets.css` | Styles for the Targets section (value badges, surplus color coding, bar indicators) |

### Modified Files

| File | Change |
|------|--------|
| `src/pages/theleague/players.astro` | Add salary averages glob import, call `calculateAllSurplusValues()` in frontmatter, serialize surplus data as JSON, add hidden Targets section in HTML, add client-side JS for admin detection + Targets rendering |

---

## Key Patterns

- **Admin detection (client-side):** Read `theleague_team_pref` cookie → parse JSON → check if `franchiseId` is `"0001"`. This mirrors how the existing players page is prerendered but personalizable via cookies.
- **Player display:** Use `buildPlayerCellHTML()` from `src/utils/player-cell-html.ts` with `initPlayerModalTrigger()` for click-to-modal support
- **Table rendering:** Follow the existing pattern in `players.astro` — build HTML strings in `<script>` tag, inject into table body via `innerHTML`
- **Data loading:** Follow the existing `import.meta.glob` eager loading pattern already used in `players.astro`
- **Color coding:** Use `--undervalued` (`#059669`) for positive surplus, `--overvalued` (`#dc2626`) for negative surplus (consistent with auction predictor design system colors in `docs/features/auction-predictor-design.md`)
- **Currency formatting:** Use `formatCurrency()` from `src/utils/formatters.ts`

---

## Access Control

Client-side cookie check. The surplus value data is computed at build time and embedded in the page HTML. This is acceptable because:

1. The data is derived from publicly available MFL feeds (projections, ADP)
2. The admin gate controls **UI visibility**, not data secrecy
3. Any league member could derive the same calculations manually

---

## UI Design

```
┌─────────────────────────────────────────────────────────────┐
│  Free Agents                                                 │
│  312 available players                                       │
├─────────────────────────────────────────────────────────────┤
│  [All] [QB] [RB] [WR] [TE] [K] [DEF]                       │
├─────────────────────────────────────────────────────────────┤
│  Search...    View: [Stats] [Rankings] [Targets]             │
│                                        ↑ admin only          │
├─────────────────────────────────────────────────────────────┤
│ When "Targets" view is active:                               │
│                                                               │
│  VALUE TARGETS — sorted by surplus value                     │
│  ┌─────┬──────────────┬──────┬──────┬──────┬────────────┐  │
│  │  #  │ Player       │ Proj │ Val$ │ Cost │ Surplus    │  │
│  ├─────┼──────────────┼──────┼──────┼──────┼────────────┤  │
│  │  1  │ ○ J. Smith   │ 245  │ $3.2M│ $1.5M│ +$1.7M ██ │  │
│  │     │  KC · WR     │      │      │      │  +113%     │  │
│  ├─────┼──────────────┼──────┼──────┼──────┼────────────┤  │
│  │  2  │ ○ T. Jones   │ 198  │ $2.6M│ $1.2M│ +$1.4M █  │  │
│  │     │  BUF · TE    │      │      │      │  +117%     │  │
│  ├─────┼──────────────┼──────┼──────┼──────┼────────────┤  │
│  │  3  │ ○ M. Brown   │ 180  │ $2.3M│ $2.0M│ +$0.3M    │  │
│  │     │  ARI · WR    │      │      │      │  +15%      │  │
│  └─────┴──────────────┴──────┴──────┴──────┴────────────┘  │
│                                                               │
│  Showing 50 of 152   [Load more]                             │
└─────────────────────────────────────────────────────────────┘
```

### Mobile layout

Cards instead of table rows:

```
┌──────────────────────┐
│ #1 VALUE TARGET      │
│ ○ J. Smith  WR · KC  │
│ Projected: 245 pts   │
│ Worth: $3.2M         │
│ Est. cost: $1.5M     │
│ Surplus: +$1.7M      │
│ ██████████  +113%    │
└──────────────────────┘
```

---

## Testing

1. **Integration:** Verify `calculateAllSurplusValues()` produces valid results (tested in surplus-value-calculator)
2. **Admin cookie detection:** Test with cookie present (returns true), cookie absent (returns false), malformed cookie (returns false)
3. **Visual:** Targets tab only visible when admin cookie is present
4. **Sort order:** Highest surplus value appears first
5. **Position filter:** Works with Targets view (e.g., show only WR targets)
6. **Edge case:** No projected scores available → table shows "No projected data available" message
7. **Edge case:** All free agents have negative surplus → table still renders, sorted by least-negative

---

## What's New

Add entry to `src/data/whats-new.json`:
- **category:** `new-feature`
- **excludeFromHero:** `true` (admin-only feature)
- **copy direction:** Something about "your auction cheat sheet" — finding the gap between what players produce and what they'll cost, turning spreadsheet gymnastics into a single ranked list. "The difference between overpaying for a name and finding the guy nobody's talking about."
