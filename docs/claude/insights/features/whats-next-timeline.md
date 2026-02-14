# What's Next Timeline - Feature Insights

## 2026-02-14 - Dual-Year Resolution Required for League Year Transitions

**Context:** Building the "What's Next" timeline on the homepage that shows the current, next, and upcoming league events. Launched on Feb 14 — right at the league year boundary.

**Insight:** `getCurrentLeagueYear()` returns 2025 until Feb 14 @ 8:45 PM PT, but the next league year's events (starting Feb 1, 2026) are what owners care about seeing. Resolving events for only the current league year results in all events being in the past, rendering an empty timeline.

**Evidence:** On Feb 14 at 1:18 AM PT, `getCurrentLeagueYear()` returned 2025. All 14 events resolved to 2025 dates were past. The component's `hasEvents` check passed (current was the last past event) but there were no future events to show — the "What's Next" section appeared empty.

**Recommendation:** `getWhatsNextTimeline()` now resolves events for **both** the current and next league year, merges them, and selects the 3 most relevant. This ensures the transition period always shows upcoming events. Any feature that depends on "upcoming" or "next" events should consider the dual-year window.

---

## 2026-02-14 - ISO Date Strings Parse as UTC, Causing Off-By-One

**Context:** NFL Draft date is stored as an ISO string (`'2026-04-23'`) in `league-year-config.ts`. Resolving it with `new Date('2026-04-23')` created a UTC midnight date, which is April 22 in Pacific time.

**Evidence:** Test expected April 23 but got April 22. `new Date('2026-04-23')` = `2026-04-23T00:00:00Z` = April 22 at 5 PM PT.

**Recommendation:** Always parse date-only strings as local dates using `new Date(year, month - 1, day)` instead of `new Date(isoString)`. The resolver now splits the string and constructs a local date.

---

## 2026-02-14 - Sort Stability Matters for Same-Day Events

**Context:** Team Purchase Deadline (Feb 1 @ 8:45 PM) and Tagging Period (Feb 1 midnight) start on the same calendar day but at different times.

**Insight:** When sorting events chronologically, the time component matters. Tagging Period (midnight) sorts before Team Purchase Deadline (8:45 PM) even though they share the same calendar date. A secondary sort on `sortOrder` is used as a tiebreaker for truly identical timestamps.

**Evidence:** Test initially expected `team-purchase-deadline` as the first Feb 1 event, but `tagging-period` (midnight start) came first because its timestamp was earlier.

**Recommendation:** The sort uses `startDate.getTime()` as primary key and `definition.sortOrder` as tiebreaker. When defining events, be intentional about whether the start time is midnight (date-only) or a specific time.

---

## 2026-02-14 - Prerendered Pages Can't Use testDate Query Param

**Context:** The homepage has `export const prerender = true`. The `?testDate=` parameter is read by `getTestDateFromUrl()` which checks `window.location.search` — only available client-side.

**Insight:** Since the Astro component renders in frontmatter (server-side at build time), the `testDate` param has no effect on the What's Next timeline. A client-side `<script>` would be needed to re-resolve and re-render the cards.

**Recommendation:** For a future enhancement, add a client-side script to `WhatsNext.astro` that checks for `?testDate=`, re-resolves the timeline, and updates the DOM. Alternatively, make the page server-rendered (`prerender = false`) but that has broader implications.

---

## 2026-02-14 - Component Architecture Decisions

**Context:** Designing the data flow and component split.

**Insight:** Key architecture choices:
- **TypeScript files for event data** (not JSON) because `DateResolution` uses discriminated unions that can't be expressed in JSON.
- **Separate action/result links** on each event — `actionLinks` shown before/during, `resultLinks` shown after. Component checks `isPast` to pick which set.
- **URL template variables** (`{mflHost}`, `{year}`, `{leagueId}`) keep event definitions league-agnostic and allow the same event to link to the correct MFL year's pages.

**Evidence:** Files: `src/types/league-events.ts`, `src/data/theleague/league-events.ts`, `src/utils/league-event-resolver.ts`

**Recommendation:** When adding AFL events, create `data/afl-fantasy/league-events.ts` with AFL-specific definitions and pass them to the same resolver. The component would select events based on league context.
