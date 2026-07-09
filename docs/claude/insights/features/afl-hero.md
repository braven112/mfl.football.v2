# AFL Homepage Hero

Insights for the AFL homepage hero system (`src/utils/afl-hero-resolver.ts`,
`src/components/afl/AflHero.astro`, `src/components/afl/AflEventHero.astro`).

---

## 2026-07-05 - Composite player models: view.model attached post-resolve

**Context:** The AFL hero now casts composite player models (transparent ESPN
cutout over a team-color glow) on every non-bespoke state — same photo
direction as TheLeague's composite heroes, but through the ONE unified
`AflEventHero` rather than per-phase components.

**Architecture:**
- `EventHeroView` gained an optional `model?: HeroModel | null` field. The
  resolver stays fs-free: `src/pages/afl-fantasy/index.astro` calls
  `castAflHeroModel(heroState, …)` (`src/utils/afl-hero-casting.ts`) AFTER
  resolution and attaches the result to `heroState.view.model`. The casting
  map (keeper → cornerstone, draft → best available, trade window → on the
  block, recap → week's top scorer, standings → leader's headliner, etc.) is
  documented in [player-composites.md](player-composites.md) Shipped Use
  Cases #6. The standings leader is computed in index.astro from `h2hwlt`.
- The composite panel lives in `AflEventHero.astro`: the model's NFL team
  primary color drives a radial glow via `getNflTeamColors` + `hexToRgba` —
  alpha **0.22 light / 0.42 dark** (`--ev-model-glow-light` /
  `--ev-model-glow-dark`, resolved by `html.dark`).
- **Gold-border semantics unchanged** — `bordered` still means "there's a
  clock on this"; the model is orthogonal and appears on bordered and
  ambient states alike.
- Headshot 404 → `onerror` adds `.afl-event-hero--no-model`, hiding
  cutout+caption and revealing a theme-paired AFL logo silhouette
  (`/assets/logos/afl-logo.svg` + `afl-logo-dark.svg`). The flank never sits
  empty; card text is unaffected.
- `randomHeroPlayer` webp art survives ONLY as the casting-failure fallback
  (`model === null`). Bespoke phases (trade-deadline day, active playoffs,
  championship) never cast — their components own the visual.

**Testing:** the sweep dates below still apply — composites now appear on
every non-bespoke state, so each date should show a cast player (or the logo
silhouette on 404), never an empty flank.

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

**Review follow-ups (Codex caught both):**

1. **Production Vercel runs in UTC — verified live.** The pills used
   `toLocaleString(..., timeZoneName: 'short')`, which rendered
   "12:00 AM UTC" in prod (and would have rendered "9:00 AM UTC" — a wrong
   claim — after the time fix). League times are DEFINED in PT and the
   resolver constructs dates with local setters, so the safe pattern is
   formatting from the Date's **local fields with a hardcoded "PT" label** —
   exactly what `event-date-formatter.ts#formatEventDate` does. Never use
   `timeZoneName` on resolver-constructed dates. (`AflHero.astro` and
   `AflConferenceDraftPreview.astro` both fixed. The deeper prod issue —
   `isActive` windows shifted ~7h because the whole resolver runs in server
   TZ — is fixed in code: `src/utils/ensure-pt-timezone.ts` pins
   `process.env.TZ = 'America/Los_Angeles'` and is imported first by
   `src/middleware.ts` (SSR runtime) and `astro.config.ts` (build /
   prerender). The assignment is unconditional because Lambda presets
   `TZ=:UTC`; regression test: `tests/ensure-pt-timezone.test.ts`. A
   dashboard `TZ` env var on the Vercel project is no longer required —
   the code pin makes prod match the PT-pinned test suite regardless of
   project settings.)

2. **`daysUntilStart` is timestamp-ceil, not calendar days.** Giving the
   drafts a 9 AM start made What's Next / calendar cards read "2 days out"
   at 8:59 AM Saturday for a Sunday-9 AM draft. `ResolvedLeagueEvent` now
   carries `daysUntilStartCalendar` (midnight-to-midnight) — display code
   uses it (cards render "Today" on day-of pre-start); the ceil variant
   stays for the urgency/lead-picker `> 0` gates, which NEED "started but
   not past" to count as 0 — switching those to calendar days would drop
   the draft from hero candidacy on draft morning.

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
- `2026-07-18` draft lead (countdown owns the keeper→draft window) ·
  `2026-08-29`/`08-30` AL day (12:30 PM) / NL day (9 AM)
- `2026-09-04` kickoff lead · `2026-09-10` kickoff day
- in-season slot rotation: `2026-09-19` game-day, `09-20` Sunday live, `09-21`
  Monday standings, `09-22` Tuesday recap, `09-23` Wednesday waivers
- `2026-11-12` trade lead · `2026-11-18` trade DAY (bespoke TradeDeadlineHero)
- `2026-12-05` playoffs lead · `2026-12-12` playoffs phase (bespoke bracket)
- `2026-12-31` championship phase (bespoke matchup, Week 17) · `2027-01-08` champion crowned
- `2027-05-25` new-season lead (rollover is June 1)

The page footer renders `<code>Hero: KIND · priority P · ref ISO</code>` — grep
it to assert the resolved kind. Calendar events carry `afl-event-hero--bordered`
on the `<section>`; everything else doesn't. `class="hero-banner"` must never
appear on the AFL homepage.

---

## 2026-07-08 - Draft countdown owns the keeper→draft window; calendar times corrected to MFL

**Draft-countdown window.** The conference-draft hero now leads the whole
keeper-deadline → draft stretch instead of the generic offseason hero.
Mechanism (both in `afl-hero-resolver.ts`):
- `URGENCY_OVERRIDES` gives `afl-al-draft` / `afl-nl-draft` a **50-day** lead-up
  window (drafts land Aug 23–30, so 50 days always reaches back past Jul 15).
  The keeper hero still leads until its deadline because `pickLeadCalendarEvent`
  sorts candidates by date and keeper is earlier — the draft only surfaces once
  keeper is `isPast`.
- **Conference-aware lead:** the AL (Sat) and NL (Sun) windows open together, so
  the earlier-dated AL draft would lead for *everyone*. `pickLeadCalendarEvent`
  now swaps the lead to the viewer's own conference draft (`userConferenceId`
  `00`→AL, `01`→NL); guests keep AL. Both drafts are still surfaced in What's
  Next (homepage passes `excludeEventId={heroIsDraft ? undefined : heroEventId}`
  so the hero's own draft isn't filtered out during the draft window).
- The old `AflHero.astro` `afl-draft-pills` under the hero and the
  `AflConferenceDraftPreview` section were both removed — draft details live in
  What's Next only now.

**Calendar times corrected to match MFL** (`league-events.json` +
`league-event-resolver.ts`), verified against MFL's Existing Events calendar:
- **AL draft 12:30 PM** (was 9 AM), NL draft 9 AM — sourced from historical
  first-pick timestamps (see mfl-api.md 2026-07-08).
- **Championship = NFL Week 17** (`16*7` after kickoff → Thu Dec 31 2026), was
  Week 16 (`15*7` → Dec 24) — a week early. `afl-championship-week` rule fixed.
- **Keeper deadline 8:45 PM** (was 8:00), still July 15 (constitution date).
- **New-season rollover June 1** (was Feb 15), matching the AFL league-year
  rollover in `leagues-data.mjs`.
