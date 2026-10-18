# Site Search Insights

The header's inline search panel (`src/components/shared/search/HeaderSearch.astro`)
and the `/search` page (`SearchPage.astro`). Both find pages and players.

---

## 2026-10-17 - One index, one matcher, two surfaces

**Context:** The header glass used to be a link to `/search`; it now opens a panel in place.

**Insight:** The page index has ONE builder (`src/utils/page-search-index.ts`:
league scoping via `pathBelongsToLeague`, hrefs via `resolveDirectoryHref`,
usage ranking) and ONE matcher (`page-search-match.ts`). `/search` renders it
server-side; the panel fetches it from `/api/page-search?league=`. Player search
is likewise one prerendered file per league (`/api/player-search/<league>.json`)
and one client helper (`player-search-client.ts`) that both surfaces call, so a
player links to the same place from either.

**Recommendation:** A new search surface reads these, never its own copy of
`page-directory.json` — `tests/stats-hub-links.test.ts` keeps the consumer list.

---

## 2026-10-17 - The glass toggle must listen in the CAPTURE phase

**Context:** The panel opened, but the page still navigated to `/search`.

**Insight:** The ClientRouter's own `document` click listener follows links in
the bubble phase before a later-registered bubble listener can
`preventDefault`. The toggle listens with `{ capture: true }` and stops
propagation; cmd/ctrl/shift-click is let through so "open in new tab" still
opens the search page.

---

## 2026-10-17 - A roster deep link needs a full page load

**Context:** Tapping a rostered player in the panel landed on the roster with no sheet.

**Insight:** Through a ClientRouter swap, TheLeague's roster consumed
`?player=` before its sheet was wired. Player rows that open a roster carry
`data-astro-reload`. Free Agents pages page their rows client-side, so
`player-search-deeplink.ts` types the name into the page's own filter first and
then polls for the row.

---

## 2026-10-17 - Script-built DOM gets no scoped styles

**Context:** Player cards added to `/search` by its script rendered unstyled.

**Insight:** Astro scopes component CSS with a `data-astro-cid-*` attribute that
only server-rendered elements carry. Style script-built nodes through a scoped
parent: `.directory__player-grid :global(.directory__player)`.
