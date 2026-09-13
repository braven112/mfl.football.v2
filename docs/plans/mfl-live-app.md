# MFL Live — the league-agnostic live scoring app at mfl.football

> Plan of record. Decisions below were made with Brandon on 2026-09-13; the
> "Open" section is the only thing still unanswered. Sibling plans:
> `docs/plans/live-scoring-broadcast.md` (the TV board),
> `docs/plans/sunday-ticket.md` (the planner).

## What it is

One page — `mfl.football/live` — that answers **"how are all of my fantasy
teams doing right now"** for every league the signed-in MFL account is in,
whether or not this site runs that league.

It is a **phone-first, installable** board: a compact row per matchup that
expands into the full starter breakdown, an NFL games rail across the top, a
cross-league scoring ticker, and a red-zone banner.

## What it is not

Three surfaces already read "every league you're in". This is a fourth, and
the difference has to stay legible or the next person unifies the wrong pair:

| Surface | Screen | Interaction | Scope |
|---|---|---|---|
| `/theleague/live-scoring` | laptop | full board, all league detail | ONE league |
| `/<league>/broadcast` | television, ten feet | zero-input, reveals rotate | all leagues |
| `/<league>/sunday-ticket` | laptop, pre-game | SSR planner, no island | all leagues |
| **`mfl.football/live`** | **phone, in hand** | **scan → tap to expand** | **all leagues** |

`/broadcast` is the closest relative and shares this board's whole data layer.
It is a display you set up once and stop touching; this is a thing you pull out
of your pocket at 10:40 on a Sunday. Same data, opposite interaction model.

## Decisions

| # | Question | Decision | Why / consequence |
|---|---|---|---|
| 1 | Relationship to existing boards | New page, reuse the `/live-scoring` visual system | `/broadcast` and `/sunday-ticket` are untouched. New chrome, borrowed data layer. |
| 2 | Who can sign in | Existing site owners; sign in via **TheLeague** by default | Works today on `staging.mfl.football`. The MFL cookie is account-wide, so the league chosen at login does not limit what the board reads. A league-less login is a later drop-in. |
| 3 | Board content | Scores only; tap to expand | Compact row = both totals, yet-to-play, projected final, win probability. Expanded = starter rows. Cheapest first paint, best on a phone. |
| 4 | Default league set | **All** leagues on; toggle off in settings | Deliberately NOT the other boards' default (home on, outside off). The promise is "all your leagues", so it has to be true on first load. Cost is real — see **Fan-out**. |
| 5 | Features in v1 | Core scores + starters, NFL games strip, scoring ticker, red-zone alerts | All four. The last two carry the per-NFL-game ESPN fan-out. |
| 6 | Device | Phone-first, installable (PWA) | The shared host carries no manifest today; this needs a neutral one. |
| 7 | Settings | Its own route, `/live/settings` | Room to grow past league toggles (ordering, which leagues alert). |
| 8 | Off-season / pre-kickoff | Honest empty state | No sample replay. Gate on `hasLiveSignal` so a zeros payload can never render as a real 0-0. |
| 9 | Shell | Full cross-league nav for the shared host | A neutral nav this page and every future `mfl.football` page share. |
| 10 | Push | Close finishes only | One narrow alert: a matchup of yours within N points, late. No red-zone or every-score push. |
| 11 | Branding | AFL's design language, **black where the AFL is navy**; **light AND dark themes** | New `data-league="mfl"` theme following the repo's existing token rules — `tokens.css` for light, `tokens-dark.css` under `html.dark`. Black is what navy is to the AFL: the dark theme's ground and the light theme's dark accent. NOT a black ground in both themes. See **Branding**. |
| 12 | Deploy | Feature branch + PR preview | `claude/multi-league-live-scoring-kimyws` → PR #1078. Previews are cancelled for a branch with no open PR, and `vercel-ignore-build.mjs` asks GitHub for one at build time — so a push made BEFORE the PR exists is skipped and does not retro-build when the PR opens. Open the PR first, or push again after. |
| 13 | Artwork for outside leagues | **NFL fallback**: a franchise whose name exactly matches an NFL team gets that club's logo + colors | Quality-of-life win — far more leagues get artwork instead of text. Exact whole-name match only, tuned after owner feedback. See **NFL artwork**. |

## Before any UI — one solved, one real

### Auth — mostly already works; the apex does not

**Verified live on 2026-09-13, not inferred.** An earlier draft of this plan
called auth "the biggest unresolved risk". That was wrong on both halves and is
corrected here.

**You can sign in to the shared host today.** `staging.mfl.football/login`
301s to `staging.mfl.football/theleague/login` (200), and `/afl-fantasy/login`
answers too. The redirect is RELATIVE, so it never leaves the host you started
on, and `createSessionCookie` sets `Path=/; HttpOnly; SameSite=Lax; Secure`
with **no `Domain` attribute** — host-only to the host you signed in on, which
is exactly what `/live` needs.

**Either league works as the default, and the choice is nearly cosmetic.**
Step 1 of login posts to `https://api.myfantasyleague.com/<year>/login` — the
ACCOUNT-wide host, not a league host — so the `MFL_USER_ID` it returns is an
account credential that works across MFL's numbered hosts. (Evidence: one
`secrets.MFL_USER_ID` reads `calendar` for both leagues, which live on `www49`
and `www44`; and `readOutsideLiveSnapshot` already sends the owner cookie to
arbitrary `league.host` values in production.) Whichever door you come through,
`myleagues` returns the same full list.

What the `leagueId` at login DOES decide, all session-local and none of it
visible on this board: `session.leagueId` + `session.franchiseId` (the "home"
league), which team-preference cookie is set, and a `fetchCommissionerSession`
hop that `mfl-login.ts` itself documents as inert. AFL's login page also
forwards a `seasonYear` from `getAflLeagueYear()` where TheLeague's forwards
none; that only changes the year segment of the login URL.

**Decision: default to TheLeague.** It is already `DEFAULT_LEAGUE_SLUG`, and
`/api/auth/login`'s `else setTheLeaguePreference(…)` fallback already assumes
it. Zero code change for v1.

**THE RULE THAT MAKES THAT DEFAULT SAFE — read the MFL cookie (`user.id`),
never `user.leagueId`.** The session's league is one of N and has no special
claim on this page. A board that leans on it is both wrong today and unable to
open to a stranger later.

#### staging is not the deploy target either

`staging` is a long-lived branch, 45 behind main and 14 ahead, and it reverted
a MERGE commit (`d08f51d`, the nav redesign). Git treats that content as
deliberately undone on staging's side, so merging main back in **silently drops
48 files main has** — `live-scoring-source.ts`, `nfl-week-starts.mjs`, all of
`/guides`, both `schedule.astro` pages, `site-analytics.ts` — with no conflict
markers. Six test suites then fail to COLLECT rather than to assert, which is
the tell. Restoring those 48 by hand still leaves ~97 source files divergent
from main, only 6 of them because staging is stale.

Nor is "revert the revert" the fix: main took the Schedule page and `/guides`
from that nav branch but NOT its Front Office nav, so no reconstruction of
staging's history lands on a tree that matches production. Whenever staging is
wanted back, resetting it to main plus whatever is genuinely wanted on it is
the cheap path. Attempted and abandoned 2026-09-13; nothing was pushed.

#### The real blocker is DNS, not code

`https://mfl.football/` returns **200 serving an unrelated 2018 "MFLaddons"
template page** (`last-modified: Sat, 01 Sep 2018`, Cloudflare in front); every
league path 404s there. Only `staging.mfl.football` is attached to this app.
Pointing the apex at the Vercel project is an ops task and a prerequisite for
the name in this plan's title — it is not something a branch can fix.

#### What is still genuinely missing

Small, and none of it blocks development:

1. **The form always sends a leagueId.** `LoginForm.astro` defaults
   `leagueId = DEFAULT_LEAGUE_ID` and the client reads
   `dataset.leagueId || DEFAULT_LEAGUE_ID`, so the league-less branch never runs
   from the UI. A stranger gets `Your account is not a member of league 13522`
   → 401. Irrelevant while v1 is owners-only.
2. **`leagueList[0]` is an arbitrary pick.** `loginToMFL` already supports a
   league-less call (`const targetLeague = leagueId ? find(…) : leagueList[0]`),
   but MFL array order is nondeterministic. Opening up means replacing that with
   a deliberate choice — prefer a registry league in registry order, else the
   first from `myleagues`.
3. **`/api/auth/login`'s preference fallback is `else setTheLeaguePreference(…)`**
   — anyone not in AFL/BB1 gets TheLeague's cookie, including someone with no
   TheLeague team.
4. **Cosmetic:** the login wears `TheLeagueLayout` and redirects to
   `/theleague`. Phase 1 gives it MFL Live chrome and a `/live` return path.

### Fan-out — "all leagues on" is unbounded

Decision 4 turns an opt-in fetch into a default one. An owner in twelve
leagues costs, per poll: 12 × `liveScoring`, plus a projections read per
league (TTL-cached 10 min), plus the shared ESPN scoreboard, plus one ESPN
box-score/plays fetch per NFL game in progress. The ESPN half does **not**
scale with league count — it is per NFL game and already shared — so the
league count only multiplies the MFL half.

Mitigations, all of which exist already and must be used rather than
reinvented:

- `mapWithConcurrency` (`src/utils/fan-out.ts`) + `Promise.allSettled`.
  **Partial results are the point** — one dead league must not blank the board.
- The per-event TTL cache (25s live / 5min final); a PARTIAL read is never
  cached.
- `PROJECTION_TTL_MS` (10 min) and `PROJECTION_EMPTY_TTL_MS` (60s) —
  a projection is a number for the WEEK, and re-fetching an empty one every
  poll is how a board gets itself throttled harder.
- A per-league **failure badge** on the card, not a silent drop. An owner
  toggling a league ON and seeing nothing must be able to tell "no games" from
  "we could not read it".

If a real account turns out to be in 20+ leagues, the fallback is decision 4's
rejected option — everything on up to a cap, the rest as off-chips — and that
is a one-line change in the default selector, not a redesign.

## Branding — AFL's language, black where the AFL is navy

The AFL theme is `html[data-league="afl"]`: `--afl-navy #0f1e2e` as the brand
colour, a navy elevation ramp under `html.dark[data-league="afl"]`, and
gold/amber accents (`--afl-gold #d97706`, `--afl-trophy-gold #c9a44c`,
`--afl-gold-text #b45309`).

MFL Live gets `html[data-league="mfl"]`: the same structure, the navy family
replaced by a neutral near-black ramp, gold accents kept.

**It has a light theme AND a dark theme, by the repo's existing rules** — light
tokens on bare `html[data-league="mfl"]`, the dark ramp under
`html.dark[data-league="mfl"]`, resolved by the same theme script every other
page uses. Black is what navy is to the AFL: the dark theme's ground and the
light theme's dark accent. It is *not* a black ground in both themes, and this
board invents no theming mechanism of its own.

Three traps, all of which this repo has already paid for:

- **A `var(--x)` with no definition renders its fallback in BOTH themes.**
  Light looks perfect, dark ships white-on-black. The new theme needs a
  COMPLETE token set in `tokens.css` *and* `tokens-dark.css` — not a partial
  override of the AFL block. `docs/claude/rules/theming-and-assets.md`.
- **Near-black franchise colours still need `ensureFieldOn`, in the dark
  theme.** `toBroadcastPair` only ever DARKENS, so it cannot make a colour
  visible; seven TheLeague franchises are `#181818`, already 1.14:1 against the
  broadcast board's `#05070b`. Against this board's dark ground they vanish the
  same way. `ensureFieldOn` (`team-color-contrast.ts`) is the fix, applied
  against THIS board's ground value — and the ground differs by theme, so it is
  resolved per theme, not once. The same applies to the near-black NFL
  primaries rung 2 introduces (LV `#101820`, CHI `#0b162a`, NO `#101820`).
- **`SplashLayout` sets no `data-league`**, so `mfl.football` renders
  TheLeague's default blue tokens today. The new shell sets the attribute; the
  splash page stays as it is (decision 1), so: new layout, splash untouched.

**NFL marks on the dark theme are already solved.** `nfl-logo-dark-css.ts`
generates a `html.dark`-keyed swap to the mirrored `500-dark` cut for every
mark that carries dark outlines (Raiders, Steelers, Jets, Bengals), plus a
white-ring filter for black-bodied marks via `NFL_DARK_STROKE_CODES`. Because
this board has a real `html.dark` rather than a permanent black ground, that
machinery applies unchanged — which is a direct argument for the light/dark
decision over a single black theme. Include `NflLogoDarkStyles.astro` in the
new layout's head and inherit it; do not write a second swap.

Logo/wordmark for the installed app icon: a neutral "MFL" mark, not any
league's crest. That asset does not exist yet — see **Open**.

### League identity on the cards — a three-rung ladder

1. **TheLeague / AFL / Best Ball** — their existing crests and franchise icons,
   read through `getLeagueTeamBrands` / `resolveBroadcastCrest`, exactly as
   `/broadcast` does. Never overridden by rung 2.
2. **Any franchise whose name IS an NFL team** — that club's logo and brand
   colors from this repo. See below.
3. **Everything else** — text only. League and franchise names from the
   `myleagues` payload, a neutral surface, no invented colour and no generated
   monogram. This is already how `broadcast-board.ts` treats an outside league;
   reuse that path, do not write a second one.

Rung 1 always wins. A TheLeague franchise called "Cowboys" keeps its own crest.

## NFL artwork — matching a fantasy team name to a real club

Everything needed already exists in the repo; the only new code is the lookup.

| Asset | Where |
|---|---|
| 32 full names by code | `NFL_TEAM_NAMES` (`src/utils/nfl-logo.ts`) |
| Primary + secondary brand colors | `NFL_TEAM_COLORS` (`src/utils/nfl-team-colors.ts`) |
| Local SVG marks | `public/assets/nfl-logos/` (53 files, legacy code aliases included) |
| Dark-optimised marks | `public/assets/nfl-logos/dark/` + `nfl-dark-logos-manifest.json` |
| Code normalisation | `normalizeTeamCode`, `TEAM_CODE_MAP`, `canonicalNflCode` |

**What does not exist: a name → code reverse lookup.** That is the new module.

### The rule

Match only when the **entire** franchise name resolves to an NFL club, after:
lowercase → strip punctuation to spaces → drop a leading `the` → collapse
whitespace. Accept the full name (`dallas cowboys`) or the bare nickname
(`cowboys`). A name that merely *contains* a nickname never matches.

**All 32 nicknames are unique** — verified, no collisions — which is what makes
the bare-nickname rung safe.

### Verified against real data

Run over all 40 live franchise names in TheLeague and the AFL, where every
candidate is a false positive:

```
OUR 40 FRANCHISES -> matches: 0
```

Correctly rejected: `Cowboy Up`, `The Boondock Saints`, `Titsburgh Feelers`,
`Music City Mafia`, `Get off my Ditka`, `Bills Mafia`, `Chiefs of Staff`,
`Lions Den`. Correctly matched: `Cowboys`, `The Cowboys`, `Dallas Cowboys`,
`DALLAS COWBOYS`, `49ers`, `San Francisco 49ers`.

### Relocations and renames map to the current club

An explicit table, not an algorithm — `TEAM_CODE_MAP` already does this for
legacy CODES, so this extends an existing idea to legacy NAMES:

`Oakland Raiders` / `Los Angeles Raiders` → LV · `San Diego Chargers` → LAC ·
`St. Louis Rams` → LAR · `Houston Oilers` / `Tennessee Oilers` → TEN ·
`Washington Redskins` / `Washington Football Team` → WSH

### Deliberately NOT in v1

- **No fuzzy or substring matching.** The whole win is that the rule cannot be
  wrong; a substring rule puts the Saints' mark on `The Boondock Saints`.
- **No nickname aliases** (`Niners`, `Bucs`, `Pats`, `Da Bears`). The alias
  table is the extension point and ships holding only the relocations above.
  Owner feedback decides what gets added — that was the explicit call.
- **No MFL-hosted franchise icons.** Reading an outside league's own uploaded
  icon (one anonymous `TYPE=league` read per league) is a follow-up, not this.

### Guard test

`tests/nfl-name-match.test.ts`: asserts **zero** matches across every franchise
name in every league config, asserts the 32 nicknames stay collision-free, and
pins the accept/reject lists above. A future alias that breaks the zero-false-
positive property fails the build — which is exactly the review anyone adding
an alias should have to pass.

## Architecture

### Routes

```
src/pages/live/index.astro       → mfl.football/live      (SSR, prerender false)
src/pages/live/settings.astro    → mfl.football/live/settings
src/pages/login.astro            → real league-neutral login on the shared host
src/pages/api/live-app.ts        → the poll endpoint
```

`/live` is unclaimed by any league, so on the shared host the middleware does
nothing and it resolves directly. On a league apex (`theleague.us/live`) the
middleware rewrites to `/theleague/live`, which does not exist → 404.

**Decide deliberately:** either add `/live/` to `SKIP_REWRITE_PREFIXES` in
`src/utils/league-host-map.ts` so the app answers on every host, or leave it
shared-host-only and have the league navs link the absolute
`SHARED_APP_ORIGIN + '/live'`. Recommendation: **leave it shared-host-only**.
Serving it from three hosts means three host-only session cookies for one app,
which is the confusion this page is supposed to end. One host, one login.

### Data layer — reuse, do not fork

The assembler already exists. `broadcast-board.ts` is documented as "the ONE
implementation, called two ways" precisely so a third caller is cheap:

| Need | Existing module | Change |
|---|---|---|
| Which leagues am I in | `utils/my-leagues.ts` (`fetchMyLeagues`) | none |
| League list + registry fold | `broadcast-live-source.ts` (`buildBoardLeagues`) | none |
| My matchups in a league | `findOwnerMatchups` | none |
| Live snapshot (registered) | `loadLeagueSnapshot` | none |
| Live snapshot (outside) | `readOutsideLiveSnapshot` | none |
| Projections | `loadLeagueProjections` | none |
| Scoring | `scoreLeague` | none |
| Plays → moments | `broadcast-moments.ts` (`buildBroadcastMoments`) | none |
| Red zone | `selectRedZoneAlerts` | none |
| NFL slate | `nfl-scoreboard-source.ts` | none |
| Assembly | `broadcast-board.ts` (`assembleBoard`) | **generalize**: its `mode: 'full' \| 'poll'` and its panel-building are broadcast-shaped |
| League selection | `sunday-ticket-selection.ts` | **new default**: all-on (decision 4) |

The one genuinely new server module is the **view model** — `broadcast-board`
produces reveal queues and takeover panels for a television. This board wants a
flat, ordered list of compact matchup rows with an expandable detail payload.
Plan: extract the league-loop from `assembleBoard` into a shared
`loadCrossLeagueSnapshot()` that both boards call, and let each board own its
own view assembly on top. That is one refactor of an existing file, not a fork.

### Client

- **One island**, `LiveAppBoard.tsx`, subscribing to `live-poll-store.ts` — the
  module-scope store both existing islands already share. It runs at the
  MINIMUM interval any subscriber asks and KEEPS the last good data on a failed
  poll while flipping `status` to `'error'`. Do not add a second poller.
- **Cadence** comes from `shouldPollLive(nflSlate, isLive)` — the real NFL
  clock. A server `isLive` hint may RAISE cadence, never lower it, and may
  never decide whether to poll at all (the 2026 Wednesday opener).
- **Expansion is client-side from data already fetched.** The compact row and
  its starter rows arrive in the same payload; tapping does not fire a request.
  Rationale: on a phone, a spinner on tap is worse than a slightly larger
  payload, and the poll already carries the rows for the ticker.

### PWA

`public/manifest.json` is TheLeague's and `public/sw.js` is its service worker.
Both are served from the site root, and `/manifest.json` is in
`SKIP_REWRITE_PREFIXES`. TheLeague's layout already carries a comment about a
league manifest never being served on another league's apex — the same rule
applies here in reverse: **the shared host must not serve TheLeague's
manifest.** MFL Live needs its own (`/live/manifest.webmanifest`, distinct
`id`, `scope: "/live"`, neutral icons) linked only from the new shell.

## Phases

**Phase 0 — not a blocker.** Sign-in on the shared host already works via
`/theleague/login`; develop against `staging.mfl.football`. Two items carry
forward rather than gating: point the apex at the Vercel project (ops), and
guard that the shared host never serves a league's manifest and that `/live`
302s to a login when signed out.

**Phase 1 — the shell. DONE — PR #1078.** `MflAppLayout` (sets `data-league="mfl"`,
gates the manifest on `isSharedAppHost`, inherits `NflLogoDarkStyles`),
complete `mfl` token blocks in `tokens.css` and `tokens-dark.css`, the bar with
league links + theme toggle + sign-out, a `/live`-scoped PWA manifest with
placeholder icons, and `/live` rendering a placeholder board. Verified: both
token blocks are complete against the AFL's (74/74 dark tokens, no light gaps),
11 contrast pairs pass, and the page renders signed-in and signed-out in both
themes.

Two things Phase 1 established that were not in the original plan:

- **`/live` does not redirect when signed out.** `/theleague/login` validates
  `?redirect=` with `startsWith('/theleague')`, so a bounce from here cannot
  come back here. The signed-out state renders the shell and a sign-in CTA
  instead — which is also what makes the branding reviewable on a preview
  without a session.
- **The manifest guard needed splitting, not relaxing.**
  `tests/push-notification-icons.test.ts` asserted `scope === '/'` for every
  manifest in `public/`, which is right for a league apex and exactly wrong for
  the shared host — a `/` scope there makes an installed MFL Live claim
  `/theleague/*` too. The league rules now run over league manifests only, and
  a new describe block pins the shared-host manifest's inverse rules. It also
  surfaced a latent bug: `LEAGUE_DIR` was keyed on BASENAME, and
  `site.webmanifest` is not unique, so a second one silently resolved its
  shortcuts against the AFL's pages. Now keyed on the public-relative path.

**Phase 2 — the board, MFL data only.** `loadCrossLeagueSnapshot` extracted,
compact rows, expansion, all-leagues-on default, per-league failure badges, the
honest empty state gated on `hasLiveSignal`. No ESPN. Includes the three-rung
identity ladder and the NFL name matcher + its guard test — artwork is what
makes an outside league feel like a real card rather than a row of text.

**Phase 3 — `/live/settings`.** League toggles, ordering, persistence. Cookie
or Redis is still open (see below).

**Phase 4 — ESPN layer.** NFL games strip, cross-league scoring ticker,
red-zone banner. Carries the AFL duplicate-player attribution rules
(`playerId -> fid[]`, and the opposite dedupe for a merged matchup list) and
the DEF-joins-by-team rule.

**Phase 5 — close-finish push.** New cross-league notification category. Note
`NOTIFICATION_CATEGORIES` entries carry `requiresFeature` against a *league's*
feature flags, so a cross-league category is a genuine new shape there, not a
new row.

## Rules this board inherits (each one is a bug that shipped)

From `docs/claude/rules/live-scoring.md` and
`docs/claude/insights/features/live-broadcast.md` — read both before Phase 2:

- **A page must never fetch its own API to render itself.** Call the assembler
  in-process. `tests/live-scoring-self-fetch-guard.test.ts`.
- **`res.ok` is not "the data is good"**, on MFL's routes or ours. MFL answers
  a throttled request with HTML under a 200; our own routes answer 200 with
  `ok: false` and `{}` is truthy.
- **An unplayed week is a full payload of zeros, not an error.** Only
  `hasLiveSignal` (starters present) can tell it from a real 0-0.
- **`host` is a hint; `L` is the answer.** Never put a hostname in a
  caller-controlled query string — a datacenter IP plus a `host=` param reads
  as SSRF to a WAF and gets 403'd at the edge with nothing in our logs.
- **Never ship an ESPN athlete id to the client**; translate to MFL player ids
  before the response boundary. A college athlete id and an NFL one are both
  plain digits, so a bad join resolves the wrong person instead of failing.
- **A projection belongs to a player IN A LEAGUE.** A shared player map on a
  cross-league board cannot hold one — that is what pinned every win-probability
  bar to 100%.
- **Bench rows travel in their own map**, never in `players` with a flag.
- **Doubleheaders come from the FEED, never the calendar.** A franchise can
  legitimately appear in two rows.
- **`wallclock` is the only honest basis for staleness** — the game clock stops.
- **Never fabricate a clock.** With no ESPN game, print the state and no
  numbers.
- **Sort merged plays on the shared game clock** (`comparePlaysChronologically`),
  never on `sequenceNumber`, which orders within one game only.
- **`isRedZone` belongs to the team WITH THE BALL.**
- Season year for everything results-shaped (`getCurrentSeasonYear`), and the
  league year only where a league's own feeds are read.
- **ClientRouter lifecycle**: init on `astro:page-load`, no module-scope DOM
  capture, listeners replaced not stacked. Run `clientrouter-lifecycle-auditor`
  on the island before it ships.

## Repo chores this feature owes

- **NOT `src/data/page-directory.json`** — this chore was listed on a wrong
  assumption and is deliberately skipped. The directory's paths are resolved
  PER LEAGUE (`resolveLeaguePath`): a bare `/live` entry becomes
  `/theleague/live` on TheLeague's apex, which the middleware rewrites and
  404s, so an entry would put a broken link in both leagues' site search. No
  entry uses an absolute URL and the schema has no notion of one. If `/live`
  should be findable from the league sites, the mechanism is a `leagueUrl()`
  link in the nav or a directory that understands absolute hrefs — a change
  to the directory, not a row in it.
- A staged one-line change in `src/data/weekly-changelog-staging.json`,
  `league` tagged. `heroWorthy` is a human call — ASK, do not decide.
- A `/guides` page: this is a new top-level feature and a one-line bullet
  cannot carry it.
- `tests/page-fork-ratchet.test.ts` — this adds no forked sibling (one page,
  one host), so the baseline should not move. If it does, something got copied.
- `path-guard` map entry if a new domain of files appears.
- `tests/nfl-name-match.test.ts` — the zero-false-positive guard (see **NFL
  artwork**), wired into the path-guard map.
- `pnpm test:types` re-measured before the PR.

## Open

1. **The neutral MFL mark.** No asset exists. Wordmark only, or a mark?
   Needed for the install icon, the nav, and the empty state. Blocking for
   Phase 1; a plain wordmark stands in until decided.
2. **Which NFL nickname aliases to add**, once owners have used it. The table
   ships holding relocations only. Candidates when feedback arrives: `Niners`,
   `Bucs`, `Pats`, `Da Bears`, `Hawks`, `Jags`.
3. **`/live/settings` persistence** — cookie (per device, zero new storage) or
   Redis against the MFL user id (follows you across devices, needs a scoped
   key). Decision 7 chose the *route*, not the *storage*.
4. **Close-finish thresholds** — how many points, and how late? "Within 10 with
   your last starter playing" is a different alert from "within 10 at the two
   minute warning".
5. **Signed-out `/live`** — bounce to `/login`, or a public demo state? The
   honest empty state (decision 8) gives us a page that renders with no data,
   which makes a demo cheap if it's wanted.
