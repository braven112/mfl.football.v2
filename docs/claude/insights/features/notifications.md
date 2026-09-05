# Notifications — the per-category command center and its senders

Web push, the category registry, and the cron senders behind it. Reference:
`docs/features/web-push.md`. The registry is
`src/config/notification-categories.ts`.

## 2026-09-04 — A push `url` is unverifiable at send time, and only fails on a phone

The service worker resolves a notification's `url` against the origin the
subscription was made on (`new URL(url, self.location.origin)`), and each
league sits on its own apex domain — so a sender writes the BARE path
(`/lineup`, `/news`) and the root catch-all maps it into that league's page.

Nothing in that chain can tell you the path is wrong. The fan-out accepts it,
the API accepts it, the notification is delivered correctly, and the failure
happens when an owner taps it, on their phone, after the moment has passed.
The game-day alerts shipped pointing at `/live` when the route is
`live-scoring.astro`; it was caught by writing the What's New article, not by
any test, review or run.

`tests/push-notification-urls.test.ts` now scans every `url: '/…'` literal in
`scripts/` against the real Astro routes. Two rules it enforces:

- The path must resolve in **every league that can receive push**, defined as
  every league with a `/notifications` page. Derived rather than listed: Best
  Ball has no such page, therefore no subscribers, therefore its missing
  `/lineup` and `/news` are not failures. Adding the page to a league
  automatically starts checking its routes.
- The path must **not** be league-prefixed. `/theleague/lineup` resolves for
  one league's readers and sends the other league's owners into a league they
  are not in — the same failure `whats-new-links.test.ts` exists to catch.

## 2026-09-04 — `live: false` plus a source-scanning guard is what stops dead toggles

A notification category can look completely healthy — it renders on the
settings page, an owner flips it on, the preference saves — and still never
fire, because nobody wrote the sender. Nothing at runtime complains. The owner
concludes the page is broken.

The registry carries a `live` flag; a category with `live: false` is hidden
from the settings page entirely, because a switch that silently does nothing is
worse than an absent one. `tests/notification-preferences.test.ts` then walks
`src/` and `scripts/` and fails if a `live: true` category's id appears nowhere
that sends. That guard caught **seven** across two sessions — the whole
transaction, rumor, deadline, player-news and game-day set was marked live
before any sender existed.

The corollary: flipping `live: true` is the LAST step of wiring a category, not
the first. If you flip it early the guard goes green on the registry entry
naming itself, which is why the test explicitly skips
`notification-categories.ts` when building its haystack.

## 2026-09-04 — `HSET`-only state cannot express a removal

The game-day poller stores per-matchup state in a Redis hash and writes it back
with `HSET`, which can only add and overwrite. The detector cleared a matchup's
`leader:` field by deleting it from the returned object — which is invisible to
`HSET`, so the pre-tie leader stayed on the server and the next poll compared
against a leader the game no longer had.

The fix is to make removal explicit rather than implied by absence:
`detectGamedayAlerts` returns `{ alerts, nextState, removed }` and the caller
issues an `HDEL` for `removed`. Any "diff produces the next state" helper
writing through a merge-only primitive has this bug latent in it.

## 2026-09-04 — Feed directories are LEAGUE-year; live results are SEASON-year

`scripts/fetch-mfl-feeds.mjs` writes `data/<league>/mfl-feeds/<year>/` under
**`currentLeagueYear`**. Both new senders originally read that path using
`getSeasonYear()`, which is a different clock (CLAUDE.md, "Year rollover").

The two agree for most of the calendar, which is exactly what makes it
dangerous: they diverge Feb 1–14, where the wrong clock reads a directory that
does not exist yet, `readJson` returns null, and the script logs "no feed —
skipping". It looks like a quiet week, not a bug, and it lasts a fortnight.

Use `getCurrentYears()` from `scripts/lib/league-years.mjs` and take
`currentLeagueYear` for anything reading the feeds on disk,
`currentSeasonYear` for anything asking MFL for results.

## 2026-09-04 — The dry-run guard belongs in the shared fan-out, not at the call sites

A push is the one side effect a `--dry-run` must never have, and six scripts
now send. The guard started at each call site, which is six chances to forget —
and one had already forgotten: the rumor scanner's `pushRumor` ran *before* its
dry-run check, so `--dry-run` would have buzzed the entire league.

`sendPushFanout({ dryRun })` owns it now, and
`tests/push-fanout.test.ts` pins "a dry run NEVER reaches the network". A rule
that has to be remembered at N call sites is a rule that will be broken at one
of them; move it to the single door instead.

## 2026-09-04 — `log = console` types the parameter as the whole `Console`

`function f({ log = console })` infers `Console` for `log`, so any caller
passing a two-method stub (`{ log, warn }`) is a type error — which cost +12 on
the typecheck ratchet before it was traced. Default to a narrow object literal
holding only the methods actually called:

```js
const DEFAULT_LOG = { log: (...a) => console.log(...a), warn: (...a) => console.warn(...a) };
```

Fix it at the definition rather than casting at the test — the stub is the
legitimate caller here, and the too-wide type is the defect.

## 2026-09-05 — A notification `badge` is an ALPHA STENCIL, so an opaque icon is a white square

Reported as "the AFL test notification shows a white screen while TheLeague
shows its logo", with a screenshot in which the AFL football rendered
perfectly. Both halves of that were true and they were two different bugs.

Android draws `showNotification({ badge })` by **discarding RGB entirely** and
using only the image's **alpha channel** as a stencil, which it then tints. So
the failure mode of pointing `badge` at a normal app icon is not "slightly
wrong art" — it is a **solid filled block**, and the more opaque the icon, the
more completely it fails. The service worker had `badge: DEFAULT_NOTIFICATION_ICON`,
i.e. `/assets/icons/pwa/icon-192.png`, which is PNG **color type 2** — no alpha
channel at all — so it rendered as a featureless square for every league.

Two things follow, and neither is visible in a code diff:

- **Badges are a distinct asset class, not a smaller icon.** They are
  white-on-transparent silhouettes (`badge-96.png`, generated from each
  league's favicon by `scripts/generate-notification-icons.mjs`). Deriving
  alpha from **inverted luminance** is what makes them readable: the light
  parts of a mark — the AFL wordmark, TheLeague's stars — punch through as
  holes instead of filling in.
- **`file` is the diagnostic.** `PNG image data, 192 x 192, 8-bit/color RGB`
  vs `RGBA` is the whole bug, one shell command, and it beats staring at the
  image — the two icons look identical on screen and behave completely
  differently on a phone.

## 2026-09-05 — What the BROWSER sees is the apex path, so a manifest scoped to the route path is discarded

The same report's second half. `public/assets/afl/favicons/site.webmanifest`
declared `start_url` and `scope` of `/afl-fantasy/` — which is the **internal
Astro route**, not any URL that domain serves. On afl-fantasy.com the
middleware rewrites `/rosters` → `/afl-fantasy/rosters` invisibly, and
`vercel.json` 301s `/afl-fantasy/*` → `/*`, so that scope covered **zero** real
URLs.

A manifest whose `scope` does not cover the document that links it is not
partially applied — it is **thrown away**. No install prompt, no WebAPK, no app
icon, and therefore no app identity behind a notification. TheLeague's
`manifest.json` was fine only because its scope happened to be `/`.

The general rule this is an instance of: **anything a browser reads by URL must
use the PUBLIC apex path, never the `src/pages/` route path.** The two are
equal for TheLeague and different for every other league, which is exactly the
shape that ships an AFL-only bug nobody sees. The same trap already has
precedent here — push `url`s must be bare for the same reason (see the
2026-09-04 entry above) — so treat manifest scope, `start_url`, and any
declared URL as members of that family.

`tests/push-notification-icons.test.ts` pins both: every manifest's `scope` and
`start_url` are `/`, every badge has real transparency and no non-white pixels,
no league reuses its icon as its badge, and the committed art matches the
generator's `--check`.
