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

---

## 2026-06-25 - Timeline Is Forward-Looking (No More "Most Recent" Past Anchor)

**Context:** The section is titled "What's Next" but `selectWhatsNextTimeline` used to fall back to the *most recently completed* event for the lead slot whenever nothing was active — with no recency cutoff. In late June a Rookie Draft that finished ~54 days earlier was sitting at the front of the homepage labeled "Most Recent."

**Insight:** The lead slot is now forward-looking. The selection builds `ordered = activeEvent ? [activeEvent, ...futureEvents] : futureEvents` and takes the first three. A past event is *never* surfaced. NOTE: this supersedes the older notes above that describe `current` as "the last past event" (e.g. the Feb 14 empty-timeline note) — the `hasEvents` guard now passes only when there's an active or future event, not a trailing past one.

**Labels moved to the caller.** The pill text is no longer derived inside `WhatsNextCard` from `position` + `isActive` (which hardcoded "Most Recent"). The card takes an explicit `label` prop; `WhatsNext.astro` and `AflWhatsNext.astro` compute the triple: `Happening Now / Up Next / Coming Soon` when an event is live, else `Up Next / Coming Soon / Later`. The card keeps a position-derived fallback for safety.

**Single-year unit tests can now legitimately be empty.** `selectWhatsNextTimeline` over one year's events at end-of-December returns all-null (no future events) — that's correct. Production never hits this because `getMergedResolvedEvents` spans current + next league year. Tests that asserted a trailing past event as `current` were updated.

**Evidence:** `src/utils/league-event-resolver.ts` (`selectWhatsNextTimeline`), `src/components/theleague/WhatsNext.astro`, `src/components/afl/hp-sections/AflWhatsNext.astro`, `tests/league-event-resolver.test.ts`.

---

## 2026-08-20 - The NFL Draft Tracks the Super Bowl, Not the April Calendar — "4th Thursday" Is a Coincidence That Breaks in 2027

**Context:** `getNflDraftDate()` falls back to `getNthDayOfMonth(year, 3, 4, 4)` — the 4th Thursday of April — when neither `nfl-draft-dates-fetched.json` nor `HARDCODED_OVERRIDES` supplies the year. For 2027 that yields Apr 22. The real date is Apr 29.

**Insight:** The draft is anchored to the Super Bowl, not to April. **Draft Thursday = Super Bowl Sunday + 74 days** (10 weeks + 4 days, i.e. the 11th Thursday after). That holds exactly for every year 2022-2027. Before the 17-game season it was a constant 81 days (2016-2021); the Super Bowl moved a week later and the draft did not, so the gap shrank by exactly one week and has been stable since.

The 4th-Thursday heuristic agrees only because the Super Bowl is the 2nd Sunday of February and the arithmetic usually lands in the same week. It diverges whenever February starts late enough to push the 2nd Sunday to Feb 14 — the latest it can fall. Feb 1, 2027 is a Monday, so SB LXI is Feb 14 and the draft slides to the **5th** Thursday, Apr 29. Checked across 2022-2035, **2027 is the only divergence** — which is why it went unnoticed. 2021 (Apr 29) failed the same way and for the same reason.

**Evidence:** Verified against actual draft dates 2015-2027 — SB gap is 74 days for every year 2022-2027 with no exceptions. ESPN's core API returns `2027-04-30T00:00Z` (Apr 29 Eastern). The repo's own `src/data/theleague/schefter-archive/2026.json` already carried "Save the dates: The 2027 NFL Draft in Washington DC will be held April 29 — May 1."

Downstream, `getRookieDraftDate()` is `saturday-after-next-week` off the NFL date (Thursday + 9 days), so the wrong date silently moved the league's own Rookie Draft from May 8 to May 1.

**Recommendation:** Do not "improve" the 4th-Thursday fallback into a cleverer calendar rule — it is the wrong anchor entirely. Pin the year in one of the two sanctioned sources. If a future fallback is ever wanted, derive it from the Super Bowl (2nd Sunday of February + 74 days) rather than from April.

---

## 2026-08-20 - A Test That Asserts a Calculation Back at Itself Ratifies the Bug

**Context:** `tests/hero-resolver.test.ts` had a 2027 draft probe commented `// 2027: NFL Draft = Apr 22 (4th Thu), Mon after = Apr 26`, probing `new Date(2027, 3, 27)`.

**Insight:** That expectation was not independent — it was the output of `getNflDraftDate()`'s own 4th-Thursday fallback, written back as the assertion. The test therefore passed *because* the date was wrong, and would have kept passing forever. A green suite was actively evidence for the bug. This is distinct from a weak test: it does not merely fail to catch the defect, it certifies it.

**Evidence:** After pinning 2027 to Apr 29, the probe had to move to May 4 (Monday after is May 3). Removing the 2027 override now fails the test with `expected 'draft-live' to be 'draft-announced'` — before the fix, the same removal was a no-op.

**Recommendation:** When a test's expected value is a date, count, or ordering that the code under test computes, source it from somewhere the code cannot reach — a published fact, a fixture, a hand-worked example — and say in a comment where it came from. If you cannot state an origin other than "what the function returns", the test is a change-detector. Mutation-check it: break the production value and confirm the test goes red.
