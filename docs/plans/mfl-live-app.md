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
| 2 | Who can sign in | Existing site owners (TheLeague / AFL / BB1) for v1 | A league-less MFL login is a later drop-in — but the session/data layer must not assume `user.leagueId` is meaningful. See **Auth**, below: there is a real gap here. |
| 3 | Board content | Scores only; tap to expand | Compact row = both totals, yet-to-play, projected final, win probability. Expanded = starter rows. Cheapest first paint, best on a phone. |
| 4 | Default league set | **All** leagues on; toggle off in settings | Deliberately NOT the other boards' default (home on, outside off). The promise is "all your leagues", so it has to be true on first load. Cost is real — see **Fan-out**. |
| 5 | Features in v1 | Core scores + starters, NFL games strip, scoring ticker, red-zone alerts | All four. The last two carry the per-NFL-game ESPN fan-out. |
| 6 | Device | Phone-first, installable (PWA) | The shared host carries no manifest today; this needs a neutral one. |
| 7 | Settings | Its own route, `/live/settings` | Room to grow past league toggles (ordering, which leagues alert). |
| 8 | Off-season / pre-kickoff | Honest empty state | No sample replay. Gate on `hasLiveSignal` so a zeros payload can never render as a real 0-0. |
| 9 | Shell | Full cross-league nav for the shared host | A neutral nav this page and every future `mfl.football` page share. |
| 10 | Push | Close finishes only | One narrow alert: a matchup of yours within N points, late. No red-zone or every-score push. |
| 11 | Branding | AFL's design language, **black where the AFL is navy** | New `data-league="mfl"` theme. AFL gold/amber accents stay. See **Branding**. |
| 12 | Deploy | Feature branch + PR preview | `claude/multi-league-live-scoring-kimyws`, PR opened so Vercel actually builds a preview (previews are cancelled without an open PR). |

## Two problems to solve before any UI

### Auth — the session cookie does not reach mfl.football

This is the biggest unresolved risk and it is not a UI problem.

- **Session cookies are host-only.** An owner signed in at `www.theleague.us`
  is *not* signed in at `mfl.football`. CLAUDE.md already records this as the
  reason `leagueUrl()` must agree on one canonical host.
- **`mfl.football/login` does not exist.** `src/pages/login.astro` is a bare
  `301 → /theleague/login`. On the shared host that bounces a visitor into
  TheLeague's branded login and issues a cookie for TheLeague's apex, not for
  `mfl.football`.
- **Login is league-scoped.** `loginToMFL(user, pass, leagueId)` resolves a
  franchise by matching `leagueId` against the `myleagues` payload and errors
  `Your account is not a member of league <id>` otherwise. There is no
  "sign in and tell me my leagues" path.

Decision 2 says owners-only for v1, but that does not make this go away: an
owner still has to be able to *sign in on this host*. Minimum viable shape:

1. A real `/login` on the shared host — league-neutral chrome, MFL
   username + password.
2. Call the existing two-step (`/login?XML=1` → `MFL_USER_ID` cookie →
   `export?TYPE=myleagues`) with **no target league**.
3. Match the returned leagues against the registry. Exactly one registry
   league → mint today's session for it. More than one (Brandon is in all
   three) → the session picks a **primary** and the board uses the MFL cookie,
   not `leagueId`, for everything cross-league. Zero registry leagues → v1
   says "this app is for TheLeague/AFL owners today" (decision 2), and that
   branch is the seam decision 2's "open it later" swaps out.
4. `user.id` **is** the MFL cookie — that is what `fetchMyLeagues` already
   keys on, and it is what makes the whole cross-league read work with one
   sign-in.

**Rule for every new module here: read the MFL cookie (`user.id`), never
`user.leagueId`.** A board that leans on the session's league is a board that
cannot be opened to a stranger later, and it is also just wrong — the session
league is one of N and has no special claim on this page.

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

## Branding — AFL's language, black ground

The AFL theme is `html[data-league="afl"]`: `--afl-navy #0f1e2e` as the ground,
a navy elevation ramp in `tokens-dark.css`, and gold/amber accents
(`--afl-gold #d97706`, `--afl-trophy-gold #c9a44c`, `--afl-gold-text #b45309`).

MFL Live gets `html[data-league="mfl"]` — the same structure with the navy
family replaced by a neutral near-black ramp, gold accents kept.

Three traps, all of which this repo has already paid for:

- **A `var(--x)` with no definition renders its fallback in BOTH themes.**
  Light looks perfect, dark ships white-on-black. The new theme needs a
  COMPLETE token set in `tokens.css` *and* `tokens-dark.css` — not a partial
  override of the AFL block. `docs/claude/rules/theming-and-assets.md`.
- **A black ground makes the franchise-colour problem worse, not the same.**
  `toBroadcastPair` only ever DARKENS, so it cannot make a colour visible;
  seven TheLeague franchises are `#181818`, which was already 1.14:1 against
  the broadcast board's `#05070b`. Against a black MFL ground every one of
  them disappears. `ensureFieldOn` (`team-color-contrast.ts`) is the fix and
  it must be applied to this board's ground value, not the broadcast's.
- **`SplashLayout` sets no `data-league`**, so `mfl.football` renders
  TheLeague's default blue tokens today. The new shell sets the attribute; the
  splash page either moves onto it or stays as-is (decision 1 leaves the splash
  unchanged, so: new layout, splash untouched).

Logo/wordmark for the installed app icon: a neutral "MFL" mark, not any
league's crest. That asset does not exist yet — see **Open**.

### League identity on the cards

Per the brief:

- **TheLeague / AFL / Best Ball** — their existing crests and franchise icons,
  read through `getLeagueTeamBrands` / `resolveBroadcastCrest`, exactly as
  `/broadcast` does.
- **Every other league** — text only. League name and franchise names from the
  `myleagues` payload, a neutral surface, no invented colour and no generated
  monogram. This is already how `broadcast-board.ts` treats an outside league
  ("an outside `myleagues` entry has real names and no artwork") — reuse that
  path, do not write a second one.

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

**Phase 0 — auth on the shared host.** League-neutral `/login`, league-less
MFL sign-in, session minted for `mfl.football`. Nothing else can be tested
without it. Guard test: the shared host never serves a league's manifest, and
`/live` 302s to `/login` when signed out.

**Phase 1 — the shell.** `MflAppLayout`, `data-league="mfl"` tokens in both
`tokens.css` and `tokens-dark.css`, the cross-league nav, the manifest. Ship
this with a placeholder board so the branding can be reviewed on a preview
before any data work lands.

**Phase 2 — the board, MFL data only.** `loadCrossLeagueSnapshot` extracted,
compact rows, expansion, all-leagues-on default, per-league failure badges, the
honest empty state gated on `hasLiveSignal`. No ESPN.

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

- `src/data/page-directory.json` entries for `/live` and `/live/settings`,
  10+ tags each (`tests/page-directory-data.test.ts` enforces the minimum;
  nothing tells you to add the entry).
- A staged one-line change in `src/data/weekly-changelog-staging.json`,
  `league` tagged. `heroWorthy` is a human call — ASK, do not decide.
- A `/guides` page: this is a new top-level feature and a one-line bullet
  cannot carry it.
- `tests/page-fork-ratchet.test.ts` — this adds no forked sibling (one page,
  one host), so the baseline should not move. If it does, something got copied.
- `path-guard` map entry if a new domain of files appears.
- `pnpm test:types` re-measured before the PR.

## Open

1. **The neutral MFL mark.** No asset exists. Wordmark only, or a mark?
   Needed for the install icon, the nav, and the empty state.
2. **`/live/settings` persistence** — cookie (per device, zero new storage) or
   Redis against the MFL user id (follows you across devices, needs a scoped
   key). Decision 7 chose the *route*, not the *storage*.
3. **Close-finish thresholds** — how many points, and how late? "Within 10 with
   your last starter playing" is a different alert from "within 10 at the two
   minute warning".
4. **Signed-out `/live`** — bounce to `/login`, or a public demo state? The
   honest empty state (decision 8) gives us a page that renders with no data,
   which makes a demo cheap if it's wanted.
