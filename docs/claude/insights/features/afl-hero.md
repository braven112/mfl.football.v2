# AFL Homepage Hero

Insights for the AFL homepage hero system (`src/utils/afl-hero-resolver.ts`,
`src/components/afl/AflHero.astro`, `src/components/afl/AflEventHero.astro`).

---

## 2026-09-05 - An upcoming countdown is filler: it pools with What's New, one slot each

**Context:** With NFL kickoff five days out, the AFL homepage showed the
`afl-season-start` countdown on every visit while a day-old `new-feature`
tagged for the AFL never appeared.

**Insight:** The AFL resolver's P1 tier is a *lead-up* window (7 days for
season start, 30 for the keeper deadline, 50 for the conference drafts) and
it sat strictly above the P2 fresh-feature check. Every one of those windows
is longer than the 7-day fresh window, so any launch that landed inside a
countdown expired before the countdown did — the whole stretch of calendar
that matters for launches was unreachable for What's New. The owner's framing:
a countdown to something that has not happened yet is FILLER, not an event,
and filler ranks *on par with* a What's New article, not above it.

**Recommendation:** `resolveAflHeroState` takes an injectable `rng` (default
`Math.random`). When the lead is P1 and fresh AFL-tagged entries exist, the
hero is one uniform per-visit draw from `[countdown, ...fresh]`: five fresh
articles → the countdown and each article show 20% of loads; one article →
the same `rng() < 0.5` boundary TheLeague's Cut Watch flip uses; no article →
the countdown at 100% and `rng` is never called. P0 (an ACTIVE event: draft
day, deadline day, kickoff itself) never pools, and the regular-season slot
rotation is untouched. "Active" is judged on the CARD, not the lead's own
priority: on AL draft day an NL owner's lead is swapped to their not-yet-live
NL card (P1) whose secondary link is the only homepage path to the live AL
board, so a live sibling draft (`conferenceDraft.al.live || nl.live`) blocks
pooling too — the first review of this PR caught exactly that. In the pooled path the article is chosen per VISIT
(that is the point of the pool); the standalone P2 path, with no countdown
competing, keeps its per-PT-day `dailyPick`.
`tests/afl-hero-lead-event-flip.test.ts` pins the exact slot boundaries with a
600-draw uniform sweep, the no-article short-circuit, and the P0 exemption.
Note for curl-diff verification: `/afl-fantasy` now has the same "hero
lottery" noise as `/theleague` during a lead-up — sample the same server twice
before blaming a refactor (see `docs/claude/insights/domains/frontend.md`,
2026-07-14).

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

## 2026-08-02 - Wrapping footer orphans the count/CTA divider on mobile

**Symptom:** a stray 1px vertical line through the hero player's face on
phones. **Cause:** the footer (`count · divider · CTA`) is `flex-wrap: wrap`
with a fixed-size 1px × 54px divider; when the CTA wraps to its own row, the
divider stays at the end of the count row as a floating line over the player
art (content z-index sits above the photo). Fix: `display: none` the divider
below a wrap breakpoint — **em-based (`40em`), not `640px`**, because the
footer is rem-sized: user font scaling >100% wraps it above the px
breakpoint while a px media query stays put. Three components share the
pattern and were all fixed: `AflEventHero.astro`, TheLeague's
`EventHeroShell.astro`, and `ChampionCrownedHero.astro`. The shell's
**paneled variant needs a wider hide (`55em`)** — its 264px side panel
narrows the content column so the footer wraps through tablet widths, not
just phones. The composite heroes (Preseason/Auction/Recap) are immune: their
footers don't `flex-wrap` and their dividers are `align-self: stretch`.
General rule: a decorative separator inside a wrapping flex row needs a
wrap-breakpoint hide, since flexbox gives no "hide me when the row wraps"
primitive — and the breakpoint must account for every layout that narrows
the row's container, not just the viewport.

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
- `2026-12-12` playoffs lead · `2026-12-19` playoffs phase (Week 15 QF, bespoke bracket)
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

## 2026-08-28 - Leading with the viewer's own conference stranded the live board

The conference-aware lead (2026-07-08 above) fixed one problem and created
another. The hero leads with the viewer's OWN conference draft, and the two
conferences draft on different DAYS — AL Saturday 12:30, NL Sunday 9 AM. So on
AL draft day an NL owner led with a not-yet-live NL card whose CTA pointed at
the draft order, while the AL board was live at that moment and unreachable
from the homepage. Reversing it (lead with whichever is live) just recreates
the original bug in the other direction: an NL owner staring at the AL card.

The fix is a SECOND link, not a different lead. `pickLeadCalendarEvent` now
attaches `view.secondaryLinks` for every conference whose draft `isActive`,
rendered by `AflEventHero` as a ghost CTA with a live dot. Three things make it
behave:

- **Deduped against `view.link`.** When the viewer's own conference is live the
  CTA already IS that board, and a secondary link repeating it is noise. The
  dedupe is what makes one rule produce the right output for all four cases
  (own-live, sibling-live, both, neither) without branching on who is viewing.
- **LIVE only.** A board for a draft that has not started is 108 empty slots,
  which is exactly why the pre-draft CTA points at the draft order instead.
- **Attached post-resolve, not in the view builder.** A builder in `EVENT_VIEW`
  only receives its own event, so it cannot know the sibling's live state. The
  pairing already existed one level up. (Amended 2026-08-29: a builder MAY now
  add a secondary link about its OWN event, and the two sets MERGE through
  `mergeSecondaryLinks`. What a builder still cannot do is speak for the
  sibling conference.)

**`conferenceDraft` was dead-but-tested data for seven weeks.** The 2026-07-08
entry above removed the `afl-draft-pills` that consumed it, but the resolver
kept computing it and `tests/afl-conference-draft-pills.test.ts` kept pinning
it. Worth knowing before you delete something that "nothing renders": the
pairing logic (and its anchor-on-rawEvents fix) was still correct and ready.

### A conditional type on a union silently resolves to `never`

The field was typed:

```ts
conferenceDraft?: AflHeroState extends { kind: 'calendar-event' }
  ? AflHeroState['conferenceDraft'] : never;
```

`AflHeroState` is a discriminated UNION, so `AflHeroState extends {kind: 'x'}`
asks whether the WHOLE union is that member — always false. The field was
`never`. Nothing caught it because nothing consumed the field: the assignment
type-checked as an error nobody was looking at (it sat in the 1913-error
ratchet), and the first read of `.al` off it added two more. Use `Extract`:

```ts
conferenceDraft?: Extract<AflHeroState, { kind: 'calendar-event' }>['conferenceDraft'];
```

Applies to any per-variant field on the `AflHeroState` / `HeroState` unions.
The general shape of the trap: a conditional type is only a narrowing when the
checked type is a naked type PARAMETER (`T extends … ? …`), where it
distributes over the union. Written against a concrete union it evaluates once,
against the whole thing.

## 2026-08-29 - Draft day: three links and none of them let you pick

The morning of the AL draft the hero counted down `0 DAYS TO AL DRAFT` and
offered one button — our own draft order. Every destination the draft hero
knew about was one of OURS, and on the one day that matters none of them is
where the draft happens:

| Ours | What it is | Good for |
|---|---|---|
| `/draft-predictor` | the order | before draft day (it is settled post-NIT, never a "prediction" in this window) |
| `/draft-broadcast` | read-only TV board | while picks land |
| — | | **making a pick: nowhere** |

The room is MFL's. So on draft day the CTA becomes MFL's own page and our
pages step down to secondary links. Two things about that switch:

- **The gate is the calendar DAY, not `isActive`.** `event.isActive` means the
  draft has started (12:30 PM); owners open the homepage hours earlier to get
  set up, and both MFL pages accept them before the first pick. Gating on
  `isActive` leaves the whole morning-of hero — the exact state in the
  screenshot that prompted this — with no route to the draft. Use
  `live || days === 0`.
- **The year comes from `event.startDate.getFullYear()`, not the clock.** The
  MFL URL carries a year path. Deriving it from "now" would be right by
  accident today and wrong for a hero resolved against next year's draft.

**The two conferences need two different pages**, and this is the part that is
easy to get wrong from the AL screenshot alone: they share one MFL league id,
but the AL meets LIVE (`ajax_ld`, the draft applet) while the NL runs a slow
EMAIL draft (`options?O=52`) that never opens that applet. One "draft link" is
a dead end for one of the two conferences on its own draft day. See the
mfl-api head for the URL shapes.

**Secondary links now merge instead of overwrite.** `pickLeadCalendarEvent`
used to assign `view.secondaryLinks` outright, which was safe only while no
builder set them. Now the AL/NL builders set one (the displaced draft order,
pre-first-pick) and the post-resolve pass adds the live sibling boards;
`mergeSecondaryLinks` concatenates and dedupes against `view.link`. That
dedupe is what keeps the live case right: the CTA is the MFL room now, so the
viewer's own board is no longer a duplicate of it and correctly rides along.

## 2026-09-02 - The owner's franchise as hero backdrop: two traps neither theme catches

`resolveHeroFranchiseBackdrop` (`src/utils/hero-franchise-backdrop.ts`) paints
the signed-in owner's `broadcastGradient` behind the card with their crest
centred, for both `AflEventHero` and TheLeague's `EventHeroShell`. Reading the
config and swapping the background is the easy half. Two things are not.

**A flat `--ev-surface` overlay cannot blend a photo into a GRADIENT.** Both
shells feather the rectangular player photo's left edge by painting
`--ev-fade-left` — a `color-mix` ramp from the surface colour — on top of it.
That works only because the card behind it is one flat colour. Against a
gradient the overlay is one colour and the card is a different colour at every
x, so the photo panel picks up a hard vertical seam down the middle of the
card. It is obvious in a screenshot and invisible in the CSS.

Fix is a **mask**, not a better colour: an alpha mask has no colour to get
wrong, so the photo dissolves into whatever is actually behind it. Mirror the
fade's stops inverted (the overlay is opaque where the photo should vanish; the
mask is transparent there) and hide the `__fade` spans. One layer only — the
bottom fade would need a second mask layer plus `mask-composite: intersect`,
which falls back to a **union** where unsupported, and a union paints the left
edge back at full opacity, i.e. exactly the seam being removed. Losing the
bottom softening costs far less; the photo meets the card's rounded edge anyway.

**A modifier class loses to the theme block on TheLeague's shell.**
`:global(html.dark) .tl-event-hero` re-declares `--ev-surface` at (0,2,1);
`.tl-event-hero--franchise` is (0,1,0). Ship only the modifier and the gradient
paints in both themes while the fades keep blending toward navy in dark mode
alone — a theme-split bug from a rule that never mentions a theme. The override
needs the paired selector:

```css
.tl-event-hero--franchise,
:global(html.dark) .tl-event-hero--franchise { … }
```

They tie on specificity and win on source order, so the block must sit BELOW
the theme blocks. AflEventHero needs no pair — its card is navy in both themes,
so it has no `html.dark` surface rule to outrank.

**Which crest resolver:** `resolveDarkSurfaceCrest`, *not* the broadcast's
`resolveBroadcastCrest`. The resolution-first order exists for a 68vh crest on
a TV, where a 7x upscale of a 100px dark cut is the more visible failure. A
hero crest is ~300px, so the dark cut costs nothing and is simply right.

**Who does NOT get it:** the heroes that are *about* another franchise —
playoff bracket, champion crowned, live scoring, matchup split, recap
composite. Those already wear whoever is in them. Keeping the backdrop opt-in
per call site rather than resolving it inside the shell is also what keeps it
off `EventHeroShell`'s two non-hero consumers, `WhatsNextCard` and
`CalendarEventCard`.

### Whose franchise the backdrop paints: the SESSION, not the page's team preference

The AFL homepage resolves `userTeam` from `?myteam=` / a cookie / the session,
and every personalized card on it follows that — My Team, the standings
highlight, the spotlight tile. The hero backdrop deliberately does NOT. It
reads `authAflFranchiseId` alone.

The distinction is what the surface is claiming. Those cards say "here is a
team"; a hero painted in someone's colours says "this site is yours", and that
should rest on having signed in rather than on a query param anyone can set. It
also keeps the two homepages answering one question the same way — TheLeague
has no team picker at all, so a preference-driven AFL hero would have been the
only asymmetry between them. (Brandon's call, Sep 2026; the first cut followed
`userTeam` and was changed before merge.)

Practical consequence: `authAflFranchiseId` already carries the leagueId check,
so routing the backdrop through it also stops a TheLeague session browsing the
AFL from being handed the AFL's franchise 0001. Resolving from `userTeam` had
no such guard.

### The whole card in the owner's palette, held to measured contrast floors

`resolveHeroFranchiseBackdrop` now returns the accent, pill ink, CTA ink and a
theme-pair of border colours alongside the gradient and crest, so the accent
word, countdown numeral, star chip, pill and border are all the franchise's and
the CTA is neutral white. Four things here are not obvious and each cost a
round:

**Measure against the surface that is actually rendered.** The accent sits on
the gradient UNDER `.hero-fb__wash`, not on the raw gradient — so the check
composites the wash's black (0.33 over the copy column, the thinnest cover any
headline character gets) before measuring. A contrast figure computed against
the un-washed gradient is a figure that does not hold where the text is.

**Which gradient stop is the background depends on the ANGLE.** The first cut
took the LIGHTEST stop to avoid parsing CSS — conservative in the abstract,
destructive in practice. Midwestside's gold is a 7% wedge at the bottom right
of a card that is black everywhere the copy goes, so measuring against the gold
demanded an accent no gold can reach: the lift ran to pure white and the accent
disappeared into the headline it was meant to punctuate. Every other franchise
came back a pastel for the same reason. CSS angles increase clockwise from
0deg=up, so 0-180 puts the FIRST stop at the left edge and 180-360 the LAST;
all 40 configs are `linear-gradient(115deg|315deg, …)`. Unparseable values
(radial, conic, multi-layer — all legal `broadcastGradient`s) keep the
lightest-stop fallback.

**Two bounds, not one.** Contrast alone passes a near-white accent that is
perfectly legible and invisible AS an accent inside a white headline;
perceptual distinctness alone passes a deep brand colour nobody can read on a
dark card. The accent must clear 3:1 against the washed gradient AND ΔE ≥ 18
from `#ffffff`. Order matters: lift for contrast FIRST, then test distinctness,
because the lift is what moves a colour toward white.

**3:1 is the correct floor, not a relaxed one.** Everything the accent touches
is large display type (the headline word at clamp(2.2rem,4.4vw,3.25rem)/700,
the countdown numeral at clamp(2.6rem,5vw,3.1rem)) or non-text UI, which is
exactly what WCAG's large-text bar covers. Holding it to the 4.5 body bar is
not extra safety — it drove every accent so far toward white that the brand
colour stopped being recognisable. The pill IS held to 4.5: its label is
0.8125rem, genuinely small text.

**Greyscale franchises need a CONSTRUCTED grey, not a selected one.** Four have
no hue anywhere (TITS, BADD, Bring The Pain, Wabs). Selecting from their stops
rejected the near-white one on distinctness and fell through to the near-black
one, which then had to be lifted — landing on a mid-grey DARKER than the white
around it, which reads as disabled text. Walking down from white to the first
shade clearing ΔE 18 lands ~#bfbfbf: as distinct, and brighter than it is dark.
It also makes all four agree, where selection split them two-and-two.

### `--ev-accent` must be set in FRONTMATTER, never in the stylesheet

Both shells write `--ev-accent` into the section's inline `style` attribute. An
inline declaration beats every rule in the sheet, so a
`.x--franchise { --ev-accent: var(--hero-fb-accent); }` override looks right,
cascades correctly, and is silently ignored — the accent word stayed league-gold
on a fully team-coloured card and nothing errored. Resolve it as
`backdrop?.accent ?? accent` in the component frontmatter instead.

Corollary for the border: `--ev-cta-bg` / `--ev-cta-ink` ARE re-declared by
`html.dark .tl-event-hero` at (0,2,1), so overriding those from a modifier class
genuinely does need the paired `:global(html.dark)` selector — unlike the
`--ev-surface` pairing removed earlier, which was inert because that variable
had no consumer under the modifier. Same-looking rule, opposite verdict; check
whether the variable is actually read before deciding.
