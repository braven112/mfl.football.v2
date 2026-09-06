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
