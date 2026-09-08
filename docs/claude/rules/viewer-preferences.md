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
routes · `src/config/leagues-data.mjs` (`officialClock`, per league) +
`leagueClock(slug)` in `src/config/leagues.ts`. Guards:
`tests/viewer-preferences.test.ts`, `tests/viewer-clock.test.ts`,
`tests/league-official-clock.test.ts`, `tests/nav-account-menu.test.ts`.

**Who reads it.** Sunday Ticket (channels + kickoffs), the draft hub's start
time, the waiver window on both `/players` pages and in the claim modal, the
owners-poll deadline, the mock-draft lobby, the AFL keeper-analysis freshness
stamp, the waiver-priority footnote, the game-day matchup heroes' channels,
and — since Sep 2026 — the TV network on every NFL game surface: the games
rail on all three `/live-scoring` pages and the opponent line on both
`/lineup` pages (`.net-badge`, `src/styles/network-badge.css`).
`/preferences` reaches the nav through the drawer's account menu
(`NavFooter.astro`, under the team name), which also PRINTS the chosen clock —
the one place a viewer sees what they picked without opening the page. It was
pinned at the TOP of the drawer until Sep 2026; that pin is gone, so the footer
is now the only nav route to it, and the signed-out row there is not optional
(the page has no auth gate, and a signed-out visitor has no account menu).

Two things the newest readers add to the pattern, because neither is a
page that shows a clock:

- **Only the COUNTRY is read**, via `readViewerClock(...).prefs.country`, and
  it feeds `resolveChannel` rather than a time format. A viewer who has chosen
  nothing gets the US default — which is what those surfaces showed before they
  named a channel at all, so the "pre-preference floor" rule holds unchanged.
- **A page that reads it inside a client island passes it as a PROP.** The
  games rail is React; it cannot read the cookie itself without duplicating
  the resolver, so all three routes resolve and hand it down
  (`tests/network-badge.test.ts` pins that). And on the lineup pages the read
  is STARTED before the page's nine MFL fetches and awaited after them — on a
  device with no cookie this is an Upstash GET with no timeout of its own, and
  awaiting it up front gated every one of those 8s-abort fetches behind it.

## The rules

**The nav reads the COOKIE, never the resolver.** `NavFooter` renders on every
page, so it does the read by hand — `Astro.cookies.get(COUNTRY_COOKIE/ZONE_COOKIE)`
into `parseViewerPreferences` — and never touches
`viewer-preferences-page.ts`. Two reasons, and both bite: `resolveViewerPreferences`
WRITES cookies, which from a component throws `ResponseSentError` and blanks
every page on the site; and `readViewerClock` reads Redis whenever the device
has no cookie, which in the nav is a round-trip per page view rather than the
once-per-device the mirror was designed for. The cookies are written only by an
explicit choice, so their presence is the same `explicit` signal — and no
cookie means the menu says "League time (PT)", which is the honest pre-preference
floor rather than a guess. `tests/nav-account-menu.test.ts` pins this.

**In that one row the FLAG and the CLOCK sit on different floors.** The flag
always renders, falling back to `DEFAULT_VIEWER_PREFERENCES.country`: the
country HAS a real default, and Sunday Ticket, the network badges and the
game-day heroes have all been resolving on it for anyone who never opened the
picker — so the flag reports what the site is already doing for them rather
than guessing. The clock must NOT follow, because there is no default clock to
report: the LEAGUE's own clock alone is what every league surface prints until
the viewer names a zone, and it comes from `leagueClock(slug)`, not a constant.
This is the two-floor rule below applied inside a single line of UI, and it is
easy to "fix" wrongly — defaulting the zone here too would have put an Eastern
clock in the drawer for every viewer who never opened the picker, back when the
US default was Eastern. Cookies are
per apex domain, which is also why a country chosen on theleague.us shows no
choice of its own on afl-fantasy.com until it is chosen there: the nav reads
the cookie by design, and the mirror is a route-only read.

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

**There are TWO floors, and they stay two even now that both answer PT.**
Sunday Ticket prints the COUNTRY's default clock (`kickoffZonesFor`, starting
from `DEFAULT_VIEWER_PREFERENCES`); every league surface prints the LEAGUE's
official clock alone (`eventZonesFor`), adding the viewer's own only once they
have named one. As of Sep 2026 both resolve to PT for a US viewer who has
chosen nothing — but by coincidence, not by merger: a country default answers
"where is this viewer", a league clock "where does this league keep its time",
and either can move without the other. Collapsing them because today's answers
match is how an Eastern clock comes back onto every waiver deadline in the
league the next time a country is re-examined.
`tests/viewer-clock.test.ts` pins the two paths as distinct by checking a
country whose default is NOT the league clock (CA → `ET · PT`).

**The US default is a DELIBERATE break with the pre-preferences board.**
`DEFAULT_ZONE_IDS.US` was `ET`, so Sunday Ticket opened on `ET · PT` for anyone
who never touched the picker — the board's own history. It is `PT` now, because
most owners in both leagues are on the west coast and leading with Eastern led
with the wrong clock for the majority. Since PT is also every league's official
clock, `kickoffZonesFor` drops the duplicate and that viewer sees `PT` alone.
CANADA deliberately did NOT follow: the argument is about where THIS league's
owners live and does not transfer to a country nobody has re-examined.

Do not read `CA: 'ET'` as a second landing default — **it is not one.** A
viewer who has chosen nothing lands on `DEFAULT_VIEWER_PREFERENCES`, which is
US/PT and nothing else; the other `DEFAULT_ZONE_IDS` entries are only reached
once someone has actively picked that country and needs a zone within it. The
one thing that CAN put an owner somewhere other than US/PT on a first visit is
a SEED (below), which is deliberate and is kept. The
older rule below — defaults must equal the pre-preferences board — still governs
every other country; this is the one place it was overridden on purpose, and
`tests/viewer-preferences.test.ts` pins the departure explicitly so it cannot
read as an accident.

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

**The league's clock is a REGISTRY SETTING, appended — never chosen.** Each
league declares `officialClock` in `src/config/leagues-data.mjs` (both are
Pacific: lineup locks, auction windows, the 8:45 rollover), read with
`leagueClock(slug)` from `src/config/leagues.ts`. A viewer picks ONE zone;
`kickoffZonesFor` adds the league's after it. The exception is a viewer already
on that clock — printing "1:00 PM PT · 1:00 PM PT" helps nobody — decided by
`isLeagueClock`, which matches the clock's zone or one of its declared
`equivalents`. That list is an IDENTITY list (Los Angeles, Vancouver, Tijuana
keep the same wall clock year-round), NOT a snapshot of today's offsets — never
compute it from a current offset.

**`LEAGUE_CLOCK` is the FALLBACK, not the setting.** `viewer-preferences.ts`
deliberately does not import the registry — it is in Storybook's rendering
graph, and pulling the registry in would wake every Sunday Ticket snapshot on
any registry edit — so the clock travels IN as a value and that constant is
only what a caller with no league falls back to. Anything holding a slug must
pass that league's clock: `readViewerClock(cookies, user, leagueSlug)` attaches
it to the `ViewerClock`, which is what spares `formatForViewer`,
`viewerClockZone` and `waiver-window` a signature apiece. A browser has no
registry to ask, so client islands take it as a PROP
(`clockZonesFromCookie(cookie, clock)`, the poll's `officialClock`) and the two
JSON-blob scripts — the waiver-priority modal and the transaction hub — carry it
in their config. `tests/league-official-clock.test.ts` pins every league having
one, the two `LeagueClock` shapes agreeing, and the registry staying out of
`viewer-preferences.ts`; `tests/nav-account-menu.test.ts` pins the drawer
calling `leagueClock(slug)` rather than the fallback.

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

**Seeded defaults are a FALLBACK, never a write — and they are KEPT.** They are
the only exception to "everyone starts US/PT", re-confirmed Sep 2026 when the
default moved to Pacific: three owners land on their real clock on a first
visit instead of converting from PT, and every other owner in both leagues
starts US/PT. The known cost of keeping them is that the NAV disagrees with the
rest of the page for exactly those owners — the drawer reads cookies only, so a
seeded owner sees "League time (PT)" beside a waiver deadline in their own
clock, until they save a preference for real. That is accepted, not overlooked;
closing it means letting the nav read the mirror, which is the round-trip-per-
page-view the first rule in this doc rejects. `SEEDED_PREFERENCES` holds
the owners we already know are off the league's clock, keyed
`<registry slug>:<franchiseId>`. It is consulted only when the device has no
cookie and the owner has stored nothing, and it is deliberately not persisted:
that way a correction here still reaches them, and their own choice outranks it
the moment they make one. Add one from the owner telling you or the franchise
saying so itself — never inferred from a team name.

**The defaults must equal the pre-preferences board — with ONE declared
exception.** `DEFAULT_ZONE_IDS` is pinned against `countryTimeZones()` (the
mapping file's pair) per country, so an owner who never opens the picker sees
exactly what they saw before the feature existed. Changing a default is
changing every such owner's board. The US was changed anyway, on purpose, in
Sep 2026 (`ET` → `PT`, see above); its test asserts the departure rather than
the pair. Every other country stays pinned, and a second exception needs the
same treatment — a stated reason and a test that names it — not a quiet edit.

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
