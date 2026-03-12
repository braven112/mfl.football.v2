# Phase 1: Homepage News Feed

## Overview
Add a news feed column to the league homepage below the WhatsNext row. The existing page category sections move into a left column (2/3 width on desktop), and a new news feed occupies the right column (1/3 width). On mobile, the news feed stacks below the existing content.

## Data Sources
1. **Sleeper Trending Players** — `GET https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=25` returns player_ids + add counts. Resolve names via the cached all-players endpoint (`/v1/players/nfl`).
2. **ESPN Team News** — Already implemented in `scripts/fetch-player-news.mjs`, saved to `data/theleague/nfl-news-week{n}.json`.

> Note: Sleeper has no dedicated "news" API. Trending adds/drops is the closest signal. We'll combine it with ESPN articles for a richer feed.

## Files to Create/Modify

### 1. New Component: `src/components/theleague/NewsFeed.astro`
- Standalone sidebar component that renders:
  - **Sleeper Trending** section: top 10 trending adds with player name, position, team, and add count (fetched client-side from Sleeper API)
  - **Latest News** section: ESPN articles from the pre-fetched JSON data (passed as prop or fetched client-side)
- Styled to match existing design tokens (card bg, shadows, typography)
- Scrollable with max-height on desktop so it doesn't push page content
- Each trending player shows: rank, name, position, NFL team, add count
- Each news article shows: headline, date, source badge, truncated description
- Loading/empty states for both sections

### 2. Modify: `src/pages/theleague/index.astro`
- Import the new `NewsFeed` component
- Wrap the existing page category sections (`Object.entries(pages).map(...)`) in a new 2-column grid layout:
  ```
  <div class="home-content">
    <div class="home-content__main">
      {/* existing page-category sections */}
    </div>
    <aside class="home-content__sidebar">
      <NewsFeed />
    </aside>
  </div>
  ```
- Add CSS for the 2-column layout:
  - Desktop (>768px): `grid-template-columns: 2fr 1fr`
  - Mobile (<=768px): single column, sidebar stacks below
- Hero banner and WhatsNext remain full-width above this grid (unchanged)

### 3. New API route: `src/pages/api/news/trending.ts` (optional, for proxy)
- Proxies calls to Sleeper's trending endpoint to avoid CORS issues
- Returns merged/formatted data
- OR: fetch directly from client-side since Sleeper API allows CORS

## Layout Changes (Visual)

### Desktop (>768px)
```
┌──────────────────────────────────────────────┐
│  Hero Banner (full width, unchanged)         │
├──────────────────────────────────────────────┤
│  WhatsNext Timeline (full width, unchanged)  │
├─────────────────────────┬────────────────────┤
│  Team Management        │  News Feed         │
│  League Management      │  ┌──────────────┐  │
│  Salary & Contracts     │  │ Trending     │  │
│  Trading & Analysis     │  │ 1. Player A  │  │
│  Assets & Resources     │  │ 2. Player B  │  │
│  (2/3 width)            │  │ ...          │  │
│                         │  ├──────────────┤  │
│                         │  │ Latest News  │  │
│                         │  │ Article 1    │  │
│                         │  │ Article 2    │  │
│                         │  │ (1/3 width)  │  │
│                         │  └──────────────┘  │
└─────────────────────────┴────────────────────┘
```

### Mobile (<=768px)
```
┌─────────────────────┐
│  Hero Banner        │
├─────────────────────┤
│  WhatsNext          │
├─────────────────────┤
│  Team Management    │
│  League Management  │
│  ...                │
├─────────────────────┤
│  News Feed          │
│  Trending + News    │
└─────────────────────┘
```

## Implementation Steps

1. Create `NewsFeed.astro` component with:
   - Client-side fetch to Sleeper trending API
   - Display of ESPN news from pre-fetched data (or client-side fetch from a local API route)
   - Styling consistent with existing page-card design
   - Loading skeleton and empty states

2. Update `index.astro`:
   - Add the 2-column grid wrapper around the page categories
   - Import and place `NewsFeed` in the sidebar
   - Add responsive CSS for the grid layout

3. Test responsive behavior at various breakpoints

## Styling Approach
- Use existing design tokens: `--content-bg`, `--shadow-card`, `--color-primary`, `--font-size-sm`, etc.
- News feed card style matches `.page-card` aesthetics
- Sticky sidebar on desktop so news stays visible while scrolling categories
- Section headers match `.page-category h2` styling but slightly smaller

## Phase 2 Preview (not implemented now)
- "My Players" filter using auth `franchiseId` → roster lookup → filter trending/news to only roster players
- Toggle between "All News" and "My Players"
