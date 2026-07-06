# AFL Homepage Hero

Insights for the AFL homepage hero system (`src/utils/afl-hero-resolver.ts`,
`src/components/afl/AflHero.astro`, `src/components/afl/AflEventHero.astro`).

---

## 2026-06-24 - Unified hero: AflEventHero renders every state; border is a signal

**Context:** Moved the remaining AFL homepage hero states (in-season daily slot
rotation, fresh What's New, default/offseason) off the editorial `HeroBanner`
and onto the branded `AflEventHero`. HeroBanner is no longer used on the AFL
homepage at all.

**Architecture:**
- `resolveAflHeroState` returns a discriminated union. Every non-bespoke `kind`
  (`calendar-event`, `regular-season`, `event`, `feature`, `default`) now carries
  a `view: EventHeroView` — a flat props bag the resolver builds and `AflHero.astro`
  spreads straight into `<AflEventHero {...state.view}>`.
- Two parallel builder maps: `EVENT_VIEW` (keyed by calendar event id, signature
  `(event, ctx)`) and `SLOT_VIEW` (keyed by synthetic keys `slot:live-scoring`,
  `feature`, `default`; signature `(ctx)`). Keeping them separate is intentional —
  different inputs, different dispatch.
- Three bespoke components still own their active day/phase because they do things
  the promo card can't: `TradeDeadlineHero` (live JS countdown, `client:idle`),
  `AflPlayoffsHero` (bracket), `AflChampionshipHero` (matchup). In the LEAD-UP to
  each, `AflEventHero` takes over via a calendar-event view.

**The gold border is now semantic, not decorative.** `AflEventHero` takes a
`bordered?: boolean` prop (default false). Only `kind === 'calendar-event'` sets
it true. Border = "there's a clock on this"; no border = ambient state. The CSS
moved from the base `.afl-event-hero` rule into a `.afl-event-hero--bordered`
modifier. Design review's caveat worth remembering: a 2px border is a *quiet*
signal — it's reinforced by the countdown chip (calendar events set `countValue`,
most ambient slots don't), which is the louder differentiator. Don't rely on the
border alone to communicate urgency.

**Voice:** in-season slots use Claude Schefter voice (ALL CAPS, present tense,
≤24-char headline + ≤6-char accentWord). The copy lives in `SLOT_VIEW`.

---

## 2026-06-24 - Cross-year event resolution: use rawEvents, not deduped, for phase checks

**Context:** Multi-week phases (regular season, playoffs, championship) were
falling through to the wrong hero in mid-September / late-December because of how
calendar events get resolved across year boundaries.

**The gotcha:** `getAllResolvedAflEvents` resolves events for a single league
year. The hero resolver pulls three years (`calYear-1`, `calYear`, `calYear+1`)
and `dedupeEvents()` collapses each event id to ONE occurrence — preferring the
soonest *upcoming* one. So by mid-September, the *current* season's
`afl-season-start` is already `isPast` and dedup has promoted *next* year's
kickoff into the single slot. A naive `findEvent(events, 'afl-season-start')`
then returns a date 12 months away, and the "is regular season active?" check
returns false.

**The fix:** phase-window checks must scan the **raw (pre-dedup) event list** and
pair each phase-start occurrence with the next phase-end occurrence of a later
date. See `isRegularSeasonActive`, `isInPlayoffsPhase`, `isInChampionshipPhase`,
`isChampionCrownedWindow` — they all `events.filter(id).find(later start)` rather
than trusting a single deduped entry. The resolver keeps both `rawEvents` (for
phase checks) and `events = dedupeEvents(rawEvents)` (for the single-lead picker).

**Rule of thumb:** dedup is correct for "what's the next thing to promote?"
(the lead-event picker). It's WRONG for "are we currently inside phase X's
window?" — that needs the un-collapsed list so a just-passed start still pairs
with its end.

---

## 2026-07-05 - Dedup gotcha strikes again: sibling-event lookups need rawEvents too

**Context:** The dual AL/NL conference-draft pills showed "Sat, Aug 28" for the
AL draft when viewed on NL draft day (Aug 30, 2026) — that's 2027's AL draft
date, rendered without a year, on a weekend where Aug 28 is a Friday.

**The gotcha (third victim):** the phase-check rule above also applies to
**sibling-event lookups**. `pickLeadCalendarEvent`'s conferenceDraft block did
`events.find('afl-al-draft')` against the deduped list; once the AL draft was
`isPast`, dedup had promoted 2027's occurrence into the slot. Fix:
`nearestOccurrence(rawEvents, id, lead.startDate)` — pair siblings from the raw
list anchored on the lead event's date (occurrences across years are ~364 days
apart vs. 1 day for the true sibling, so nearest-wins is unambiguous).

**Bonus root cause:** `resolveDateForYear` only applied the `time` field for
`fixed` date resolutions — `computed` rules silently dropped it, so both drafts
(defined with `"time": "09:00"`) resolved to midnight and the pills rendered
"12:00 AM PDT". `computed` now supports `time` (type + resolver). Note the
endDate default (8:45 PM same day for single-day events) still applies to
computed-with-time events since `hasExplicitTime` remains fixed-only — which is
what the drafts want: `isActive` spans 9:00 AM–8:45 PM on draft day, not the
9:00 instant.

Regression suite: `tests/afl-conference-draft-pills.test.ts` (sweeps Aug 26/29/30).

---

## 2026-06-23 - Hero player images: explicit list, day-seeded random, optimize on add

**Context:** Hero player cut-outs in `public/assets/hero-players/`.

- `HERO_PLAYERS` in `afl-hero-resolver.ts` is an explicit `as const` array of
  basenames (not `import.meta.glob`) so the set is greppable and URLs are stable.
  **Adding an image = drop the `.webp` in the folder AND append the basename here.**
- `randomHeroPlayer(seed)` picks by day-of-year modulo, so the image is stable
  within a given SSR day and re-rolls daily. Same date → same player (verified by
  QA: two fetches of the same testDate return the same image).
- **Optimize new images on add.** Source drops were 200KB–1MB each; a sharp pass
  (`resize ≤900px inside, webp quality 78, effort 6`) took the 21-image set from
  ~4.6MB to ~785KB (-83%) with no visible quality loss. Only one image renders per
  page load, and it's the above-the-fold LCP element — `loading="eager"` +
  `fetchpriority="high"` on the `<img>`.

---

## Testing the hero across the season

The AFL homepage accepts `?testDate=YYYY-MM-DD`. Sweep these to cover every state:
- `2026-04-10` offseason (default, no border)
- `2026-07-01` keeper lead (calendar-event, bordered)
- `2026-08-26`/`08-29`/`08-30` draft lead / AL day / NL day
- `2026-09-04` kickoff lead · `2026-09-10` kickoff day
- in-season slot rotation: `2026-09-19` game-day, `09-20` Sunday live, `09-21`
  Monday standings, `09-22` Tuesday recap, `09-23` Wednesday waivers
- `2026-11-12` trade lead · `2026-11-18` trade DAY (bespoke TradeDeadlineHero)
- `2026-12-05` playoffs lead · `2026-12-12` playoffs phase (bespoke bracket)
- `2026-12-26` championship phase (bespoke matchup) · `2027-01-02` champion crowned
- `2027-02-10` new-season lead

The page footer renders `<code>Hero: KIND · priority P · ref ISO</code>` — grep
it to assert the resolved kind. Calendar events carry `afl-event-hero--bordered`
on the `<section>`; everything else doesn't. `class="hero-banner"` must never
appear on the AFL homepage.
