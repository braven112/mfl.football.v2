# Viewer preferences — country and clock

Rules: `docs/claude/rules/viewer-preferences.md`. Built 2026-09-06 on branch
`claude/sunday-ticket-preferences-u2jpbd`, extending the Sunday Ticket board's
`?country=` chips into a site-wide preference. This file holds the reasoning
that is not a rule.

## 2026-09-06 — What the build taught

- **A "derived" setting is a real setting wearing a disguise.** Sunday Ticket
  had shipped country as a chip row and treated the CLOCKS as a property of the
  country: US → ET + PT, always. That is correct for exactly one owner in
  Denver and wrong for every other one. The tell is a lookup table whose value
  is a LIST of things a person would have opinions about — the moment you write
  `timeZones: [a, b]` per country, you have already decided something the
  viewer should be deciding. It cost one page and ~300 lines to un-derive; it
  would have cost nothing to build that way.

- **The second slot was never the viewer's to spend.** The first shape of this
  let an owner tick up to two zones. That is more freedom and a worse product:
  the second clock is not a preference, it is the LEAGUE's — Pacific, the clock
  lineup locks, auction windows and the 8:45 rollover already run on. Once it is
  appended rather than chosen, the picker collapses to one radio, the copy gets
  shorter, and a Sydney owner reads "Mon 3:00 AM AEST · 10:00 AM PT" — their
  clock and the one every deadline is quoted in. Ask what the second column is
  FOR before offering it as a choice.

- **The dedup for a Pacific viewer is an identity list, not an offset compare.**
  Los Angeles, Vancouver and Tijuana keep the same wall clock as each other
  year-round, DST flips included; other zones coincide with Pacific only on
  some dates. Computing "same offset right now" would silently start printing
  two clocks (or stop) on a DST boundary. `LEAGUE_CLOCK_EQUIVALENTS` is
  deliberately a hand-written set.

- **Radio groups revealed by CSS `:has()` need per-group NAMES.** The picker
  renders all three countries' clocks and shows one, so it never needs JS to
  switch. Radios sharing `name="zone"` across the hidden groups means only ONE
  radio on the whole page can be checked — the browser keeps the last `checked`
  in document order, so the visible group renders with nothing selected while
  Australia quietly holds the state. `zone-US` / `zone-CA` / `zone-AU`, and the
  route reads the chosen country's group. Guard the `:has()` block with
  `@supports selector(:has(*))` too: without it, a browser lacking `:has()`
  hides every group instead of showing them all.

- **Server-side filtering is what makes a no-JS picker honest.** Because
  `parseZoneSelection` resolves an id AGAINST a country, every stale tick from
  a group the viewer cannot see is dropped for free. No script has to clear
  them, and a hand-built URL cannot smuggle one in either. Design the parse so
  the wrong input is *unrepresentable* rather than writing JS to prevent it.

- **A cookie must outrank the account, not the other way round.** The obvious
  precedence (account wins, it's the "real" preference) is wrong for anything
  location-shaped: an owner watching from a hotel in Chicago sets CT on that
  browser, and their laptop at home would overwrite it on the next render. The
  device is where "show me this clock" is TRUE. The mirror exists to seed a new
  device, and writing it to the cookie on first read keeps it to one Redis read
  per device rather than one per page.

- **Seeded defaults are a fallback, never a write.** Three owners were seeded by
  franchise (`SEEDED_PREFERENCES`) so their first visit is right. Persisting a
  seed would make it indistinguishable from a choice — you could never correct
  it, and you would be silently claiming the owner picked it. Left unpersisted,
  the table stays editable and the owner's own pick outranks it permanently.
  Source a seed from the owner or from the franchise saying so itself
  (Maverick's own loader quips run on Sydney time) — never from a team name.

- **`?country=` moved owners, and the old cookie stayed readable.** The board's
  chips still write the preference, but through `resolveViewerPreferences`, not
  `rememberSundayTicketChoices`. Two writers for one value diverge the first
  time someone changes it in the other place; the old `st_country` is read-only
  legacy so nobody loses a pick they already made. When a feature-local setting
  goes site-wide, move the WRITE and leave the read.

## 2026-09-06 — Taking the preference site-wide

Sunday Ticket was the only reader for a month. Widening it to the draft hub,
the waiver windows, the poll deadline, the mock lobby, the keeper stamp and the
game-day heroes turned up four things the original build could not have known.

- **One default cannot serve two readers, and that is not a wart.** The stored
  default is US/ET *because* it keeps the Sunday Ticket board byte-identical to
  its pre-preferences self. Every other surface printed the league's PT alone,
  and two (the poll deadline, the mock lobby) printed the DEVICE's clock. Reusing
  the one default would have put an Eastern clock on every waiver deadline in the
  league on the strength of a fallback nobody chose. The rule that came out of it
  generalizes: **the floor is whatever THAT surface printed before**, so adopting
  a preference is invisible to anyone who has not set one. `eventZonesFor` is the
  league-surface floor; `clockZonesFromCookie` returning `null` is the device one.

- **"Has the viewer chosen?" is not `isDefaultViewerPreferences`.** A stored
  `{US, ET}` is indistinguishable from the fallback, so the answer has to come
  from WHERE the value was read, not what it is. `readViewerClock` reports
  `explicit` — true for a cookie, an account mirror, or a seed; false for the
  bare catalog default. Client islands get the same signal for free from the
  cookie's mere presence, because only an explicit choice ever writes one. Any
  future "did they mean this or did we guess?" question wants this shape.

- **Outside the US, never say "Sunday Ticket".** The catalog's own notes are
  worded to avoid the phrase — "DAZN carries every game in Canada", "Kayo
  carries every game via ESPN" — because Sunday Ticket is a US product and the
  rest of the world buys something else. A generated string like `Sunday Ticket
  via ${provider.name}` reintroduces the error the notes were written to dodge,
  and it reads as a product that does not exist. The honest short form is the
  CHANNEL a game is on (`resolveChannel`, visible text); the carrier needs the
  note, and the note needs the room the board has. Caught in review after the
  game-day heroes tried to badge themselves with the carrier's mark.
  (`PreferencesPage.astro` still builds that phrase — US-framed context, but it
  is the same construction and worth revisiting.)

- **A shared page component may read the preference; only WRITING is
  route-only.** The hazard was always `Astro.cookies.set()` after headers commit,
  which is `resolveViewerPreferences` alone. Threading a `clock` prop through
  routes that do nothing else with it is ceremony — and on `draft/mock/index.astro`
  it added enough lines to trip `tests/page-fork-ratchet.test.ts`, which is how
  the ceremony got noticed. Page components read for themselves; nested display
  components (the heroes) take a prop, because they are not the page.

## 2026-09-08 — Making the league clock a setting, and moving the default to PT

- **"No Redis" and "no knowledge" are different bans, and conflating them cost
  a whole feature.** The nav's rule reads "read the COOKIE, never the
  resolver", and both the doc and I took that to mean the drawer simply cannot
  know a stored preference — so the drawer printing "League time (PT)" beside a
  waiver deadline rendered in Sydney got written up twice as an accepted cost.
  It was not. The rule exists to stop a Redis round-trip on every page view;
  `seededPreferencesFor` is a pure lookup in a static map and costs nothing.
  One line (`cookiePrefs ?? seededPrefs`) closed a disagreement two rounds of
  documentation had already rationalised. When a rule forbids a *mechanism*,
  separate the cost it is guarding from the capability it appears to deny —
  they are rarely the same set.

- **Once absence is a signal, seeding someone onto the default stops being a
  no-op.** Nine of the thirteen seeds added here are `{US, PT}` — the exact
  value the site already falls back to, so nothing those owners see changes.
  They are still load-bearing, because the new hint pulses at anyone the site
  has no answer for: a seed is an ANSWER, and the absence of one is a QUESTION.
  Before this feature, "seed an owner onto the default" would have been dead
  config. Adding any UI that keys on "we don't know" retroactively gives every
  redundant-looking default a job.

- **Look for a value already being threaded before adding a parameter to N
  functions.** Making the league clock configurable looked like a signature
  change across `eventZonesFor` → `formatForViewer` → `viewerClockZone` →
  `waiver-window` → their callers. But `ViewerClock` was already flowing
  through all of them, so the clock rode along as a field on it and only
  `readViewerClock` grew an argument. The prefs-only entry points
  (`kickoffZonesFor`, `zoneSummary`) took an optional second parameter, and the
  three client islands took a prop because a browser has no registry to ask.
  Two signatures instead of six.

- **A time-boxed spotlight and a state hint share a stylesheet, not a
  mechanism.** `FEATURE_SPOTLIGHTS` answers "is this new" — it expires on a
  date and dismisses into localStorage. The preferences nudge answers "have you
  told us where you are", and wiring it through the spotlight registry would
  have un-nudged someone who still had not set a clock a week later while
  pulsing at someone who had. Reuse `.spotlight-pulse` (it is global on purpose);
  drive it from the state. The cookie is the honest dismissal.

- **A guard test that hardcodes an example rots when the example becomes real
  data.** `tests/viewer-preferences.test.ts` proved the seed lookup keys on
  league AND franchise by asserting `afl-fantasy:0009` was null — "a different
  team entirely". Then 0009 (Vitside Mafia) got seeded, and the test failed for
  a reason with nothing to do with the rule it guards. It now DERIVES an
  unseeded twin from the map itself. Any guard whose fixture is a real id from
  live config should compute its counter-example rather than name one.

- **Two defaults converging on the same value is not a reason to merge them.**
  Sunday Ticket's floor (the COUNTRY's default clock) and every league
  surface's floor (the LEAGUE's official clock) both answer PT now that the US
  default moved. They stay two reads: one asks where the viewer is, the other
  where the league keeps its time, and either can move without the other. The
  test pins the distinction by checking a country whose default is NOT the
  league clock (CA → `ET · PT`), because an assertion that only exercises the
  converged case would pass just as happily against a merged implementation.
