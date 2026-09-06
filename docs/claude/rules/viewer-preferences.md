# Viewer preferences — country and clocks

Two values a viewer sets once and every page can read: the **country** whose
channels they see, and the **clocks** kickoff times print in. Shipped Sep 2026
with `/preferences` in both leagues; Sunday Ticket is the first reader.

**Files.** `src/utils/viewer-preferences.ts` (pure: catalog, parsing, defaults)
· `src/utils/viewer-preferences-page.ts` (cookies, precedence, the Redis
mirror — route-only) · `src/utils/viewer-preferences-store.ts` (the mirror) ·
`src/components/shared/preferences/PreferencesPage.astro` + the two thin
routes. Guard: `tests/viewer-preferences.test.ts`.

## The rules

**Resolve it in the ROUTE, never in a component.** `resolveViewerPreferences`
WRITES cookies, and `Astro.cookies.set()` from an imported component runs after
the response headers are committed — it throws `ResponseSentError` and blanks
the page. That is not a theoretical trap: the Sunday Ticket board's country
chips shipped exactly that bug on their first click. The route resolves; the
component takes `prefs` as a prop.

**The cookie beats the account mirror, always.** A device is where "show me
Sydney time" is true. An owner watching from a hotel in Chicago must not have
the laptop at home overwrite their choice on the next render. The mirror is
read only when the device has no cookie at all — and is then written to the
cookie, so it costs one Redis read per device rather than one per render.

**Zone ids are parsed AGAINST a country, never on their own.** `ET` and `PT`
exist in the US and Canada and nowhere else; Australia has none of them. A
country switch leaves the old ticks in the form, and `parseZoneSelection`
dropping them is what makes the zero-JS picker honest. It also guarantees a
non-empty result — an empty zone list would render a board with no clock on it.

**The defaults must equal the pre-preferences board.** `DEFAULT_ZONE_IDS` is
pinned against `countryTimeZones()` (the mapping file's pair) per country, so
an owner who never opens the picker sees exactly what they saw before the
feature existed. Changing a default is changing every such owner's board.

**Both leagues have a franchise 0001.** The mirror key is
`vprefs:<registry slug>:<franchiseId>` — the same rule as `watch-list-keys.mjs`
and `rankings-scope.ts`. The slug comes from the SESSION's league id, never
from a request parameter.

**A country added to the registry needs a CSS rule in the picker.** The page
renders every country's clocks and reveals one with `:has()` — one rule per
country, inside `@supports selector(:has(*))` so a browser without `:has()`
shows all the groups rather than none. `tests/viewer-preferences.test.ts`
fails on a country with no rule, and on the `@supports` guard being removed.

**`st_country` is read-only legacy.** The Sunday Ticket board's original
country cookie is still read as a fallback so nobody loses the country they
picked; `rememberSundayTicketChoices` no longer writes it. Do not re-add a
second writer — two cookies for one value diverge the first time someone
changes it on the board.
