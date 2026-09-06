# Viewer preferences — country and clocks

Two values a viewer sets once and every page can read: the **country** whose
channels they see, and the **one clock** kickoff times print in. Shipped Sep
2026 with `/preferences` in both leagues; Sunday Ticket was the first reader,
and the league surfaces below joined it in the same month.

**Files.** `src/utils/viewer-preferences.ts` (pure: catalog, parsing, defaults)
· `src/utils/viewer-preferences-page.ts` (cookies, precedence, the Redis
mirror — route-only) · `src/utils/viewer-preferences-store.ts` (the mirror) ·
`src/utils/viewer-clock.ts` (rendering a LEAGUE moment in those clocks) ·
`src/utils/zone-label.ts` (the one `auto`-label resolver, a leaf module) ·
`src/components/shared/preferences/PreferencesPage.astro` + the two thin
routes. Guards: `tests/viewer-preferences.test.ts`,
`tests/viewer-clock.test.ts`.

**Who reads it.** Sunday Ticket (channels + kickoffs), the draft hub's start
time, the waiver window on both `/players` pages and in the claim modal, the
owners-poll deadline, the mock-draft lobby, the AFL keeper-analysis freshness
stamp, the waiver-priority footnote, and the game-day matchup heroes'
channels. `/preferences` is pinned in the nav beside Notifications.

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

**There are TWO floors, and the difference is the whole design.** One default
cannot serve both readers. Sunday Ticket has always printed the COUNTRY's
default pair (ET · PT in the US) — that is why `DEFAULT_VIEWER_PREFERENCES` is
US/ET, and `kickoffZonesFor` starts there. Every league surface has always
printed the league's PT alone; handing those the same default would put an
Eastern clock on every waiver deadline in the league on the strength of a
fallback nobody chose. So `eventZonesFor` starts from PT and adds the viewer's
clock only once they have actually named one. The rule underneath both: **a
viewer who has chosen nothing must see exactly what they saw before the
preference existed** — per surface, not globally.

**`explicit` is the signal, and it is not `isDefaultViewerPreferences`.** A
stored `{US, ET}` is indistinguishable from the fallback, so the answer has to
come from WHERE it was read: `readViewerClock` returns `explicit: true` for a
cookie, an account mirror, or a SEED (a fact we were told about that owner) and
`false` for the bare catalog default. Client islands get the same signal from
the cookie's mere presence (`clockZonesFromCookie` — the cookies are written
only by an explicit choice), and return `null` for "carry on using the device",
which is the pre-preference floor for the owners-poll deadline and the
mock-draft lobby.

**`formatKickoffZones` and `formatForViewer` anchor on different days.** The
kickoff renderer anchors the weekday on EASTERN, because a game's identity is
its Eastern kickoff — "the Sunday 1pm window" is 1pm ET whoever is watching. A
league event has no Eastern identity, so `viewer-clock.ts` anchors on the
viewer's own clock and flags the trailing PT when it lands on a different day.
That is what makes a Sydney owner's line read `Thu 1:00 PM AEST · Wed 8:00 PM
PT` rather than a seven-hour gap on one Wednesday.

**Not every timestamp takes the preference, and the exclusions are reasoned.**
`SeasonDailyHero`/`WaiverWireHero` compute a next-Wednesday-8pm-PT deadline in
PT — that is league date MATH feeding a countdown, not a printed clock, and
converting it breaks the arithmetic. The Pecking Order's first-issue date stays
PT because the copy beside it says "every Tuesday" and a Sydney render would
say Wednesday. `MatchupPreviewHero`'s slot labels stay `1:00 PM ET` / `4:25 PM
ET` because those are the NFL's names for its windows, not a clock. Chat
timestamps, the custom-rankings save indicator and the playoffs "last updated"
stamp stay on the device: they answer "how long ago", which is a question about
the device you are holding.

**The league's clock is PT, appended — never chosen.** The league keeps its own
time in Pacific (lineup locks, auction windows, the 8:45 PT rollover), so it is
the shared reference beside every viewer's own clock. A viewer picks ONE zone;
`kickoffZonesFor` adds `LEAGUE_CLOCK` after it. The exception is a viewer
already on Pacific — printing "1:00 PM PT · 1:00 PM PT" helps nobody, so it is
dropped for them. `LEAGUE_CLOCK_EQUIVALENTS` is an identity list (Los Angeles,
Vancouver, Tijuana keep the same wall clock year-round), NOT a snapshot of
today's offsets — never compute that from a current offset.

**Zone ids are parsed AGAINST a country, never on their own.** `ET` and `PT`
exist in the US and Canada and nowhere else; Australia has none of them. A
country switch leaves the old pick in the form, and `parseZoneSelection`
dropping it is what makes the zero-JS picker honest. It also guarantees a
non-empty result — no zone would render a board with no clock on it.

**Each country's radios need their OWN name** (`zone-US`, `zone-CA`, …). The
picker renders all three groups and reveals one with `:has()`; a single shared
radio name would let only one radio on the entire page be checked, so the
group the viewer can actually see would render with nothing selected. The
route reads `zone-<chosen country>` and ignores the rest — which is also what
stops the two invisible groups from deciding someone's clock.

**Seeded defaults are a FALLBACK, never a write.** `SEEDED_PREFERENCES` holds
the owners we already know are off the league's clock, keyed
`<registry slug>:<franchiseId>`. It is consulted only when the device has no
cookie and the owner has stored nothing, and it is deliberately not persisted:
that way a correction here still reaches them, and their own choice outranks it
the moment they make one. Add one from the owner telling you or the franchise
saying so itself — never inferred from a team name.

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

**The `auto` label has ONE resolver, in a leaf module.** `zone-label.ts`
imports nothing, and both renderers import it. That shape is forced:
`sunday-ticket-slate.ts` is reachable from a Storybook story, so everything it
can reach is a Chromatic rendering file — importing the resolver from
`viewer-preferences.ts` would drag the catalog, the seeds and the registry into
that graph and wake every board snapshot on a seed edit. A second copy would
drift the first time a country with an `auto` zone is added. (`waiver-window.ts`
DOES now pull `viewer-clock.ts` in, which is why the three new files are listed
in both `chromatic.yml` trigger blocks — they really can change a snapshot.)

**READ anywhere, RESOLVE only in a route.** The hazard is `Astro.cookies.set()`
after the headers are committed, and only `resolveViewerPreferences` calls it —
`readViewerClock` is side-effect free, so a component may call it. Which to use:

- A shared **page component** (`DraftHubPage`, `DraftMockLobby`) reads it
  itself. It IS the page body; threading a prop through a route that does
  nothing else with it is ceremony, and on the mock-draft routes it was enough
  added lines to trip `tests/page-fork-ratchet.test.ts`.
- A **nested display component** (the matchup heroes, three levels below
  `index.astro`) takes it as a prop, because it is not the page and should not
  reach for a request.
- An Astro `<script>` with `define:vars` is INLINE and cannot import at all:
  its component resolves the zone with `viewerClockZone` and hands the script
  an id and a label (the mock-draft lobby is the worked example).

**`st_country` is read-only legacy.** The Sunday Ticket board's original
country cookie is still read as a fallback so nobody loses the country they
picked; `rememberSundayTicketChoices` no longer writes it. Do not re-add a
second writer — two cookies for one value diverge the first time someone
changes it on the board.
