# Intel Page — Daily Fantasy News Digest

## Context

Brandon wants a daily-check blog-style page showing fantasy football news and RSP sleeper tracking. A scheduled task (`fantasy-news-scanner`) already runs at 7 AM PT to scan news sources and cross-reference with the RSP sleeper watchlist. This page is the **output surface** — where Brandon reviews the daily intel each morning.

**Admin-only** — visible only to franchise 0001 (Pacific Pigskins) via `"visibility": "admin"` in nav-config.

## Architecture

**Pure Astro page** (no React island needed — read-only content, no client-side filtering). SSR (`prerender = false`) for auth gating and fresh data reads.

**Data format: JSON** — The scheduled task will write structured JSON (not markdown) to `data/fantasy-expert/news/YYYY-MM-DD.json`. This matches the What's New pattern and avoids adding a markdown rendering dependency.

**Data flow:**
```
Scheduled Task (7 AM PT) → writes JSON → data/fantasy-expert/news/YYYY-MM-DD.json
Page Load (/theleague/intel) → auth gate → fs.readdir + JSON.parse → render sections
```

## Files to Create

| # | File | Purpose |
|---|------|---------|
| 1 | `src/types/intel.ts` | TypeScript interfaces for digest data |
| 2 | `src/utils/intel-helpers.ts` | Load digests, format dates, color helpers |
| 3 | `src/styles/intel.css` | Editorial design standard styles |
| 4 | `src/pages/theleague/intel/index.astro` | Main listing page (admin-gated SSR) |
| 5 | `src/pages/theleague/intel/[date].astro` | Per-date detail page with prev/next nav |
| 6 | `data/fantasy-expert/news/sample-2026-03-19.json` | Seed data for development (rename/remove later) |

## Files to Modify

| File | Change |
|------|--------|
| `src/config/nav-config.json` | Add intel nav entry with `"visibility": "admin"` |
| `.claude/scheduled-tasks/fantasy-news-scanner/SKILL.md` | Update output format from markdown to JSON |
| `data/fantasy-expert/README.md` | Document the news JSON schema |

## Data Schema

```typescript
// src/types/intel.ts
export interface IntelDigest {
  date: string;                          // YYYY-MM-DD
  scannedAt?: string;                    // ISO 8601 timestamp of when news was scanned
  alerts: IntelAlert[];                  // Actionable player alerts
  sleeperWatch: Record<string, IntelSleeper[]>;  // Keyed by draft year
  generalNews: IntelNewsItem[];          // Broader NFL news
  strategicNotes: string[];              // Market observations
}

export interface IntelAlert {
  player: string;
  position: string;
  nflTeam: string;
  headshot?: string;
  rspTier?: string;        // A-F
  rspValue?: string;       // "Under 14", "Par", etc.
  rspTypes?: string[];     // ["U", "↑"]
  news: string;            // What happened
  impact: string;          // Why it matters
  action: 'bid' | 'watch' | 'trade' | 'hold' | 'sell';
  leagueStatus: 'free-agent' | 'rostered' | 'taxi' | 'ir';
}

export interface IntelSleeper {
  name: string;
  position: string;
  nflTeam: string;
  headshot?: string;
  tier: string;
  value: string;
  types: string[];
  news: string;            // "No updates" or latest intel
  leagueStatus: string;
}

export interface IntelNewsItem {
  headline: string;
  summary: string;
  source: string;          // "Rotoworld", "ESPN", etc.
  impact: 'low' | 'medium' | 'high';
}
```

## 24-Hour Freshness Requirement

All news surfaced on the Intel page must be from the last 24 hours. This is enforced at multiple levels:

1. **Scanner side:** The fantasy-news-scanner agent only surfaces news from the last 24 hours (uses `tbs=qdr:d` for Google, date filters for APIs). Older results are discarded.
2. **Data side:** Each digest includes a `scannedAt` ISO 8601 timestamp recording when the scan ran.
3. **Display side:** The Intel page shows a freshness badge ("3h ago", "18h ago") next to the date header. If the latest digest is older than 24 hours, a stale warning banner appears: "Stale intel — last scan was Xd ago."
4. **Helpers:** `getDigestAge(digest)` returns a human-readable age string. `isDigestStale(digest)` returns true if older than 24 hours. Both fall back to assuming a 7 AM PT scan time if `scannedAt` is missing.

## Page Design

### Listing Page (`/theleague/intel`)

**Layout:** Single column, max-width 800px (matches What's New detail pattern)

**Sections per digest day:**

1. **Date Header** — Full date ("Wednesday, March 19, 2026") styled as editorial section title with left-border accent
2. **Actionable Alerts** — Cards with PlayerCell lockup + RSP badges + news + action pill badge
   - Action badge colors: BID=green, WATCH=blue, TRADE=purple, HOLD=gray, SELL=red
   - Left border colored by action type
3. **Sleeper Watch** — Two tables (2025 Class, 2024 Class) with editorial table styling
   - PlayerCell in first column, RSP tier/value badges, news snippet
   - Sticky uppercase headers (0.625rem)
4. **General News** — Simple list with headline, summary, source badge, impact dot
5. **Strategic Notes** — Italic text block with left-border accent

**Latest digest expanded, older digests collapsed** using `<details><summary>` (CSS-only, no JS needed). Summary shows date + alert count.

**Empty state:** "No intel digests yet. The scanner runs daily at 7 AM PT."

### Detail Page (`/theleague/intel/[date]`)

Same four sections rendered in full, plus:
- Back link to listing
- Prev/Next date navigation at bottom

### Admin Gate (reuse existing pattern)

```astro
import { getAuthUser } from '../../../utils/auth';
import { isAdminFranchise } from '../../../config/nav-config';

export const prerender = false;

const user = getAuthUser(Astro.request);
if (!user || !isAdminFranchise(user.franchiseId)) {
  return Astro.redirect('/theleague');
}
```

### Navigation Entry

```json
{
  "id": "intel",
  "label": "Intel",
  "icon": "binoculars",
  "path": "/intel",
  "external": false,
  "visibility": "admin",
  "description": "Daily fantasy intel digest with RSP sleeper tracking"
}
```

## Key Reusable Patterns

| Pattern | Source | Usage |
|---------|--------|-------|
| Admin gate | `src/pages/theleague/cr.astro` lines 14-27 | Auth + redirect |
| `isAdminFranchise()` | `src/config/nav-config` | Franchise check |
| `PlayerCell.astro` | `src/components/theleague/PlayerCell.astro` | Player lockup in alerts & tables |
| Editorial section titles | CLAUDE.md design standard | 0.75rem uppercase + left border |
| Editorial tables | PlayerDetailsModal pattern | Sticky headers, hover rows, tabular-nums |
| `formatEntryDate()` | `src/utils/whats-new-helpers.ts` | Date formatting reference |
| `player-cell.css` | `src/styles/player-cell.css` | Player cell styles |

## Implementation Sequence

1. Types (`intel.ts`)
2. Sample data JSON for dev
3. Helpers (`intel-helpers.ts`)
4. Styles (`intel.css`)
5. Listing page (`index.astro`)
6. Detail page (`[date].astro`)
7. Nav config update
8. Update scheduled task output format to JSON
9. Update README

## Verification

1. `pnpm dev` — start dev server
2. Log in as admin (franchise 0001)
3. Verify `/theleague/intel` loads with sample data
4. Verify non-admin users get redirected to `/theleague`
5. Verify "Intel" appears in nav only for admin
6. Check responsive layout at mobile/tablet/desktop breakpoints
7. Verify detail page `/theleague/intel/2026-03-19` renders correctly
8. Verify prev/next navigation works
9. Verify empty state renders when no digest files exist
10. `pnpm build` — confirm production build succeeds
