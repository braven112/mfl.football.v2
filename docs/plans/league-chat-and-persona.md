# League chat providers + commissioner-editable news persona

Status: Phases 1 and 2 done (PR #1255, `claude/slack-integration-groupme-ttsw77`): Slack, the persona everywhere, onboarding 10105 as `archies`, the platform super admin, the branding editor and the league's own logo. Phase 3 (Archie's look and homepage) is done except the MFL calendar sync, which waits on co-commissioner access. Phase 4 (the Pecking Order at 99 teams, with a homepage card) is done.

## Why

The standard custom package offers ONE chat integration per league, GroupMe or
Slack, and lets the league rename the news writer. The first client is MFL
league **10105** (Archie's Fantasy Football League). It is Slack-only, and it
wants just one thing in the chat: the weekly strength-of-schedule column,
**The Gauntlet**. It keeps the same name every other league uses, so no
per-league column naming is needed (decided 2026-09-28; an earlier draft
called it "the Guillotine").

## Phase 1 — platform (done)

**Chat provider, from the registry.** `chat` on a league's entry in
`src/config/leagues-data.mjs`:

```js
chat: { provider: 'groupme', botEnv: 'GROUPME_SCHEFTER_BOT_ID' }
chat: { provider: 'slack', tokenEnv: 'SLACK_<LEAGUE>_BOT_TOKEN', channelEnv: 'SLACK_<LEAGUE>_CHANNEL_ID' }
```

The entry holds only env var names; the tokens are secrets. `scripts/lib/chat.mjs`
holds the Slack sender (`postToSlack`, `toSlackText`, `slackSenderFor`). The
queued-announcement sender (`scripts/schefter-announce-pending.mjs`) routes a
Slack league's promo through the same daily cap as GroupMe, via the new `send`
parameter on `postToGroupMeCapped`. GroupMe leagues take exactly the path they
took before.

Slack traps, pinned in `tests/league-chat-slack.test.ts`:
- `chat.postMessage` returns HTTP 200 with `ok: false` for most failures, so
  success means `ok === true` and nothing less.
- Links go out as `<url>`, so trailing punctuation never joins the URL. The
  GroupMe link-punctuation sanitizer is pinned to the GroupMe lanes and stays
  out of this path.
- `username` and `icon_url` come from the persona on every message, which needs
  the `chat:write.customize` scope.

**Persona.** `src/utils/persona.mjs` resolves a persona in this order:
1. The commissioner's saved override, in Redis at `persona:<registry slug>`.
2. The registry's `persona` default.
3. Claude Schefter.

The commissioner edits it on `/<league>/admin/news` (News Ops; the old `/admin/schefter` URL 301s there via vercel.json) (`PersonaEditor.astro`,
`/api/admin/persona`). The API always takes the league from the session, never
from a parameter.

`buildCachedSystem` keeps `BASE_SYSTEM_PROMPT` byte-for-byte for the default
persona, so an untouched league writes exactly as before. A custom persona gets
`PERSONA_NEUTRAL_RULES`: the same rules with no named writer, cached and shared
across personas. The persona's name and voice go in the uncached block, fenced
as tone-only. Every article type forwards `persona`, and
`tests/league-persona.test.ts` fails on any type that drops it.

## Slack app setup (per client)

The client creates an app from this manifest in their own workspace
(api.slack.com/apps → Create New App → From a manifest), installs it, invites
the bot to the channel (`/invite @<bot>`), then sends us the **Bot User OAuth
Token** (`xoxb-…`) and the **channel ID**. Those go in as the two secrets named
by the league's `chat` block, set in Vercel AND in GitHub Actions, because the
announce job runs in Actions.

```yaml
display_information:
  name: League News
features:
  bot_user:
    display_name: League News
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - chat:write.customize
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

## Phase 2 — onboard 10105 (done: `archies`, mfl.football/archies)

What landed, and where the next package league plugs in:
- **Registry** (`leagues-data.mjs` → `archies`): every feature flag set
  explicitly, `chat: slack`, June 1 rollover, and the package-league fields:
  `optInNav`, `advertiseOnSharedHost: false`, `shortName`, `logo`,
  `themeColor`. The shared header, layout, footer and nav READ these, so the
  next package league needs no edits in those files.
- **Suggested branding**: `node scripts/suggest-league-branding.mjs --league <slug> --write`.
  Names are derived by rule; colours come from the MFL art, weighted by
  coverage × chroma, because this package's art is busy illustration where
  the most common colour is the background. MFL's `icon` and `logo` are the
  same 1500×636 banner, so the banner is used as-is and a 128px centre crop
  becomes the icon (`public/assets/<slug>/icons/`). The script refuses to
  overwrite edited branding without `--force`.
- **Pages** (thin routes under `src/pages/archies/`): the home page, standings,
  rosters, transactions, news, the news article page (`news/[id]`),
  schedule-strength (The Gauntlet), the brand book and team brand pages,
  login, forbidden, and admin/news. The shared bodies live in
  `src/components/shared/package-league/` and `SchefterArticlePage.astro`.
  The view models are in `src/utils/package-league.ts`; standings are GROUPED
  by division and never re-sorted.
- **Sync**: the archies row in `roster-sync.yml`. The Gauntlet runs on
  Wednesdays in `schefter-articles.yml`. `scripts/lib/article-leagues.mjs`
  limits archies to that one article type, and posts go to Slack through the
  announce step (`SLACK_ARCHIES_BOT_TOKEN`, `SLACK_ARCHIES_CHANNEL_ID`).
- **Findings the guards surfaced**:
  - Seven archies franchises are named exactly for NFL clubs. That is allowed
    in `tests/nfl-name-match.test.ts`: the name fallback is MFL-Live-only.
  - Its bids are FAAB dollars with cent increments, so the transaction-parse
    invariant takes a per-league budget.
  - The shared parser rounds bids to whole dollars, so a $15.01 bid shows as
    $15. That parser also feeds TheLeague's contract math, which is why it has
    not changed yet.

Still open for archies:

- 99 franchises in 9 divisions, each division its own player pool
  (`playerLimitUnit: DIVISION`). Anything roster- or free-agent-scoped must be
  keyed per division, generalizing the AFL's two-conference split to N pools.
  This is the main risk.
- Set the two Slack secrets (Vercel + GitHub Actions) once the client installs the app.
- Confirm the league's time zone and trade deadline (both TODO in the registry).
- ~~Show the persona's name and avatar on the news byline~~ — done (Phase 2,
  persona everywhere).
- Other chat senders (Roger reminders, the rumor mill) still post
  GroupMe-only. Route each through `chatConfigFor` when a Slack league turns
  that feature on. (The Pecking Order already reaches Slack — Phase 4.)

### Phase 2 — the persona everywhere an owner sees it

The News Ops page (renamed from Schefter Ops) already names the league's
persona. Owner-facing surfaces still say Schefter and must read the persona
before 10105 launches:
- the main nav's "Tip Schefter" item and the tip form
- the Schefter-branded news pages, the byline and the post cards
  (`SCHEFTER_AUTHORS`)
- the page-directory titles and the OG images that say Schefter

The resolver is `resolvePersona`. Build-time surfaces use the registry
default; SSR surfaces use the commissioner's override.

### Phase 2 — commissioner-editable team branding

Decisions (2026-09-28):
- **Commissioner only.** Owners do not edit their own team's branding.
- **Everything is suggested first, then edited.** When a league is onboarded,
  each team starts from a generated draft:
  - name and logo from MFL
  - `nameMedium` (15 characters or fewer), `nameShort` (10 or fewer),
    `abbrev`, `aliases` and loader quips proposed by Claude
  - `colorPrimary`, `colorSecondary`, `colorTertiary` and `colorQuaternary`
    extracted from the MFL logo
  - the dark variants (`colorPrimaryDark`, `colorSecondaryDark`) computed
    with the Brand Book's ground rules, never guessed
  The commissioner reviews and edits the draft rather than starting blank.
  With 99 teams in 10105, that is the difference between usable and not.
- **Image uploads.** Icon, dark icon, banner and chat crest go to Vercel
  Blob, reusing the suggestion box's uploader (`ImageUploader.tsx`,
  `/api/suggestions/upload`). The MFL logo is the starting suggestion.
- **Every league, behind a registry flag** (`features.brandingEditor`): on for
  10105 and new leagues, off for TheLeague and the AFL until chosen, because
  their branding is hand-curated.
- **Publishing takes 2–3 minutes.** Save dispatches a workflow
  (`src/utils/workflow-dispatch.ts`, the announce composer's pattern) that
  writes the league's `src/data/<league>.config.json`, commits it and lets
  the deploy rebuild. Branding is read at build time in hundreds of places,
  so the committed file stays the single source of truth; a live override
  would reach only the SSR pages and split the site.
- **Validation happens before commit:**
  - name limits (`MAX_TEAM_NAME_LENGTH`, `MAX_SHORT_NAME_LENGTH`)
  - hex colours, and the contrast rules in
    `docs/claude/rules/theming-and-assets.md`
  - https image URLs on our Blob host only
  - a new or retired name also updates `aliases`, because Schefter's
    redaction must cover every name a team has had
    (`docs/claude/rules/schefter.md`)
- **Throwback eras are out of scope** for the first cut. The editor changes
  only the CURRENT identity. Era rewrites have their own recompute chain
  (`docs/claude/insights/features/throwback-week.md`).

### Platform super admin (done)

The site owner edits every league's settings, as that league's commissioner
would. `src/utils/league-admin.ts`:
- `isPlatformAdmin` matches the MFL account name in the signed session,
  case-insensitively, against `PLATFORM_ADMIN_USERNAMES`. Only the login route
  writes that name, and only after MFL accepts the password.
- `canAdministerLeague` gates the News Ops pages.
- `resolveAdministeredLeague` gates the settings APIs (`/api/admin/persona`,
  `/api/admin/schefter-stats`). A commissioner is held to their own session
  league, and a `?league=` that names another league is refused. A platform
  admin may name any league.

Scope is league settings only. MFL-write routes (lineups, contracts,
accounting) act AS a franchise and stay session-scoped. The branding editor
will use the same gate.

### Branding editor (done)

`/<league>/admin/branding` is live for archies behind `features.brandingEditor`,
and off for TheLeague and the AFL. It is gated by `canAdministerLeague`: the
commissioner or a platform admin.
- **Validation:** `src/utils/branding-edit.mjs` validates and applies. Names
  must fit the site limits, colours are hex, and images must be a Vercel Blob
  upload, the current value, or the league's own `/assets/<league>/` path. A
  rename keeps the old name as an alias.
- **Publishing:** `PUT /api/admin/branding` dispatches
  `.github/workflows/branding-edit.yml`. That workflow runs
  `scripts/apply-branding-edit.mjs`, which validates AGAIN (the workflow can be
  run by hand), writes the config and commits. The change is live after the
  deploy, about 2–3 minutes later.
- **Pending state:** edits still in flight sit in Redis
  (`branding:pending:<slug>`) so the editor can show them as "Publishing". Each
  is cleared once the published config matches.
- **Uploads:** `POST /api/admin/branding-upload` takes JSON with base64 image
  data. It is not multipart, because Astro's origin check rejects a form-typed
  POST from a browser that omits Origin. Needs `BLOB_READ_WRITE_TOKEN`.
- **Secrets:** needs `GH_PAT` (the existing dispatch token) and `DEPLOY_KEY`
  (existing).

### Persona on owner surfaces (done)

- **Label helpers:** `personaLabels` (src/utils/persona.mjs) derives every
  owner-facing label ("The Schefter Report", "Tip Schefter", the column byline)
  from the persona. `getPersonaLabels` / `postByline`
  (src/utils/persona-server.ts) read it server-side, cached for a minute.
- **Default persona:** the original wording, so a league that never renamed
  its writer sees no change.
- **Bylines:** posts carry their `league`, so each card resolves its own
  persona. Only the persona's author id (`claude`) is renamed; ESPN wire items,
  Roger and guest writers keep theirs.
- **Guard:** `tests/persona-literal-guard.test.ts` fails if a page hardcodes
  "The Schefter Report" / "Tip Schefter" again.
- **Deliberately unchanged:**
  - the site-level 404/500 pages and the What's New writer, which belong to no
    league
  - the static page-directory search titles
  - `afl-hero-resolver.ts`'s desk byline (a synchronous, pure resolver)

## Phase 3 — Archie's look and homepage (done, one item waiting)

Added 2026-09-28 at the owner's request. Archie's launched on a deliberately
small homepage (`PackageLeagueHome`) and TheLeague's navy chrome. This phase
gives it its own look and the same homepage experience TheLeague and the AFL
have.

1. **A colour scheme of Archie's own.** A palette built from the league's art
   (the blue of the wordmark and Archie's shirt), applied to the header, nav,
   links, buttons and cards in both light and dark. Today only `themeColor`
   and the logo are per-league; the rest is TheLeague's tokens.
   - Define it as tokens (`docs/claude/rules/theming-and-assets.md`: every
     `var(--x)` needs a definition in BOTH themes, or dark ships the fallback).
   - Scope it to the league (a league class on the layout), driven by a
     registry field, so the next package league gets a scheme by adding an
     entry rather than editing the layout.
2. **The TheLeague/AFL homepage layout on Archie's.** Replace
   `PackageLeagueHome` with the same homepage structure the two full leagues
   use: the season hero, the news rail, the team snapshot, compact standings,
   quick links, and the rest.
   - Build it as a SHARED component the leagues use, not a third fork of a
     ~1,000-line page (`tests/page-fork-ratchet.test.ts` fails on a new forked
     sibling; see "Second league's copy of a page" in CLAUDE.md).
   - Sections that depend on features Archie's does not run (contracts,
     auctions, unsigned free agents, keepers) are gated with
     `leagueHasFeature`, not deleted from the shared layout.
3. **The homepage's key features, for Archie's.** Every feature the
   TheLeague/AFL homepage carries that makes sense for a 99-team redraft
   league.
   - **The calendar (What's Next)** must be FILLED OUT for Archie's: its
     deadlines, waiver runs, trade deadline, playoffs and draft, from the
     league's real MFL calendar. It is empty without them. It depends on the
     time zone and trade deadline, which are still TODO in the registry.
   - Anything scoped to rosters or free agents inherits the per-division
     player-pool risk (Phase 2, "Still open").
4. **What's New at the bottom, as today.** A dedicated What's New section at
   the bottom of Archie's homepage, the same row TheLeague and the AFL show,
   so Archie's owners see new platform features as they ship.
   - The weekly changelog rollup expands `both` to the FULL-MANAGEMENT leagues
     only (`BOTH_LEAGUES` in `scripts/lib/weekly-changelog-format.mjs`).
     Whether a platform-wide change reaches Archie's automatically, or needs
     `archies` tagged explicitly, is a decision this phase has to make.

Decided 2026-09-28: the logo blues; every platform update; all sections; a
NEW shared hero (not a port of TheLeague's); the calendar from MFL's own feed
via co-commissioner access; What's New from now on (no backfill); the Owners'
Poll stays off (its slot is in the layout).

What landed:
- **Colour scheme:** `html[data-league="archies"]` in `tokens.css` + its dark
  twin, as PALETTE → SEMANTIC tokens (the owner's rule: recolour by editing
  the palette alone). Guard: `tests/league-palette-tokens.test.ts`.
- **Homepage:** `PackageLeagueHome` now has the TheLeague/AFL shape (main
  column + news rail): `PackageLeagueHero`, the Owners' Poll slot (registry
  gated), `PackageTeamSnapshot`, What's Next, the viewer's division (or every
  division's top three), transactions, quick links, What's New, and the rail.
  View models in `src/utils/package-league-home.ts`; the hero looks forward
  out of season (`isSeasonWindowOpen`), and every "this week" is a list
  because archies plays doubleheaders.
- **Calendar:** `src/utils/package-league-events.ts` reads MFL's
  `calendar.json` (draft, trade deadline, keepers, auction, custom events;
  waiver noise skipped) and derives kickoff, playoffs, championship week and
  the new league year. `/archies/calendar` lists them all.
  `WhatsNext.astro` takes a `timeline` + `calendarHref` so any league can
  pass its own.
- **What's New:** `/archies/whats-new` (+ detail) on the shared pages; the
  homepage row always renders, with an empty state until the first Monday
  rollup. `both` already expands to archies (`BOTH_LEAGUES`); the
  `/update-whats-new` doc now says so.
- **Fixes on the way:** the news rail's "View all" link and persona label were
  two-league ternaries (archies got TheLeague's); QuickLinks listed the
  homepage on itself.

Waiting:
- **MFL calendar sync.** `braven112` IS co-commissioner now (confirmed by
  the owner 2026-09-29). `calendar.json` is fetched with the `MFL_USER_ID`
  cookie by the archies row of `roster-sync.yml`, which only exists on this
  branch — so the first sync after PR #1255 merges brings the draft / trade
  deadline / custom dates onto the homepage, calendar page and the Free
  Agents waiver-window line. Don't dispatch roster-sync on the branch to get
  it sooner: the job rebases onto main, pushes, and fires gameday pushes.

Follow-ups noticed (not in scope):
- TheLeague's and the AFL's What's Next resolvers are two copies, and the AFL
  copy resolves on TheLeague's Feb 14 league-year clock rather than its own
  June 1. `getAflWhatsNextTimeline` / `getAllResolvedAflEvents` in
  `src/utils/league-event-resolver.ts`.

## Phase 4 — the Pecking Order for Archie's (built; first issue the Tuesday after a completed week)

Decided 2026-09-28:
- **Scope:** the column ranks and writes up the league's TOP 25 overall, plus a
  compact ranked list inside each of the 9 divisions, so every owner sees where
  they stand without a 99-blurb column.
- **Slack:** each weekly issue is announced in Archie's channel, like The
  Gauntlet.
- **Day:** Tuesday, the TheLeague/AFL slot (after Monday night is final, a
  day before The Gauntlet).

What landed:
- **Generator** (`scripts/generate-pecking-order.mjs`): archies joins
  `VALID_LEAGUES`; the registry's `peckingOrder.topN` (25) cuts the write-up —
  all 99 ranked, blurbs only for 1..25; `{id, name}` divisions read.
- **Derived standings** (`enrichStandingsFromResults`,
  `scripts/lib/pecking-order-math.mjs`): archies' MFL export has no all-play,
  streak or PA, so they are computed from the weekly scores — only where
  missing, so TheLeague's and the AFL's issues are byte-identical (checked).
  Doubleheaders: all-play and PA are per week (MFL's `pf` basis), the margin
  and streak per game.
- **Voice**: the column is written by the league's persona (`loadLeaguePersona`
  → `buildCachedSystem`); a renamed writer loses the Schefter lines; the fact
  sheet says redraft, carries only the top 25 plus award teams.
- **Pages**: `/archies/pecking-order` (+ permalinks) on the shared landing /
  issue components: top-25 cards, then every division's teams in pecking order
  with their league-wide rank (replacing the 99-row standings and all-play
  tables). Team links go to the brand book (archies has no franchise pages).
- **Delivery**: Tuesday in `schefter-articles.yml`; the queued announcement has
  no GroupMe bot, so the drainer posts it to Slack as the persona.
- Nav, page directory, footer and article-link destinations list it.

## Later

- ~~Pecking Order at 99-team scale~~ — done (Phase 4).
- **Per-division player pools** (the main risk, see Phase 2 "Still open"):
  Phase 5, view-only part DONE. Decided 2026-09-28: the first page it powers
  is a **free agents page scoped to the viewer's division**, **view only** —
  moves link out to MFL.
  - Pools: `buildPoolStructure` (src/utils/afl-conference-rosters.mjs) reads
    MFL `playerLimitUnit` — LEAGUE → one pool, CONFERENCE → the AFL's, DIVISION
    → one per division. `poolOfFranchise` / `freeAgencyIsLeagueWide`
    (waiver-claim.ts), `lockedUnitKey` (DIVISIONnn) and draft availability
    now honour DIVISION; before this, all of them read archies as ONE pool
    (190 of its 213 rostered players are on several rosters, never twice in
    one division). Registry: archies `duplicatePlayers: true`.
    Guard: `tests/player-pools.test.ts`.
  - Page: `/archies/free-agents` — first built as a lite page; replaced in
    Phase 7 by the shared Free Agents page (below).
- **Phase 6 — the free agents page is FUNCTIONAL** (built 2026-09-28): the
  row ⋮ opens the shared action sheet (WatchListBridge) → the shared claim
  form (WaiverClaimModal inside PlayerDetailsModal) → /api/waiver-claim, which
  files into the owner's OWN division; rows are claimable only in that
  division. Filed claims via WaiverClaimsPanel; signed-out visitors get
  SignInModal and the claim resumes after sign-in.
  - Decided with the owner: **cent bids on** (`BBID_AMT` sent as "12.50" in a
    cents league via `formatBidAmount`; whole-dollar leagues still send bare
    integers — UNPROVEN against a live archies claim, so watch the first
    real one) and **$0 bids allowed** where the league has no minimum.
  - Fixed on the way: `bid % increment` refused almost every cents bid
    (`isBidMultiple`, server and form); balances were floored to whole dollars
    (`bidBalance`); /api/waiver-claim had no rate limit (30/min per user).
  - Not verified live: the first real claim (the environment has no owner
    session); the waiver window reads "unknown" until the MFL calendar syncs
    (co-commissioner access), which files a queued claim — the safe default.
- **Phase 7 — the real pages, shared** (owner's rule, 2026-09-29): custom
  leagues must render the SAME shared components as TheLeague and the AFL,
  never a lite look-alike. The first Archie's Free Agents, Rosters, Standings
  and Transactions pages were lite versions and are being replaced:
  - **Free Agents — DONE (2026-09-29).** The AFL players page is now
    `src/components/shared/free-agents/FreeAgentsPage.astro`; the AFL route
    (`/afl-fantasy/players`) and `/archies/free-agents` are thin wrappers that
    hand in the derived snapshot, the league/calendar globs and (AFL only) the
    conference crests. Pools are MFL's `playerLimitUnit`, so Archie's switcher
    is its nine divisions. `scripts/compute-free-agents.mjs --all` builds
    every league's snapshot (`SHARED_FREE_AGENT_LEAGUES`), with the league's
    own starting positions. Before/after HTML of the AFL page (signed out,
    signed in, `?conf=NL`) differs only by the intended changes below. The
    lite page and `package-free-agents.ts` are deleted.
    - One behaviour change, both leagues: a row browsed in a pool that is not
      the viewer's own is no longer offered as claimable, because the claim
      files into the viewer's OWN pool (an AL owner browsing the NL could
      previously start a claim that MFL refuses).
    - Import Rankings: `/archies/import-rankings`, a thin route over the
      shared ImportRankingsPage (its own `archies` bucket, built-in sources
      seeded on first load), linked from the league nav. It feeds the Free
      Agents Rankings view and My Rank editor. No Custom Rankings board (`/cr`)
      for Archie's yet (`hasCustomRankings={false}`).
  - **Homepage hero — DONE (2026-09-29).** One hero system for every league
    (`src/utils/league-hero/`, `components/shared/league-hero/LeagueHero.astro`).
    The owner's brief: "one system any league can use — every league's
    features available to the others"; a league with an auction gets the
    auction heroes, a league that only drafts gets the draft heroes, one with
    both gets both.
    - Shape: one resolver (`resolveLeagueHeroState`) that climbs a LADDER of
      rungs; each league is a PROFILE (`profiles.ts`) naming its rungs, its
      calendar (roles on events, or constitution `clock` hooks), its
      capabilities (read from the registry where it knows: `liveScoring`,
      `powerRankings`…) and the facts its copy names. Nothing shared names a
      league (`tests/league-hero.test.ts`).
    - The AFL moved onto it whole (its resolver, casting, router and page
      plumbing became the shared ones; AL/NL drafts are the generic
      `pool-draft` rung). TheLeague's DECISIONS moved too — its contract
      offseason (auction, rookie draft, tags, UDFA, cut watch, breaking story,
      What's New fallback) is `contract-steps.ts`, rungs any league can list —
      while its twenty bespoke components still render them, through
      `toSeasonHeroState` (`season-state.ts`).
    - Parity: both homepages' HTML diffed before/after at 24 dates × signed
      out/in (offseason, auction, draft, keeper, kickoff, every weekday slot,
      trade deadline, playoffs, championship, champion crowned). Identical
      except the pages' own per-visit random picks (a What's New pool, the
      champion copy), which differ between two unchanged runs too.
    - Archie's gets, at launch: the weekly rotation (game day, Tuesday recap,
      Monday standings, waivers, news), **Tuesday afternoon = the Pecking
      Order** (only when THIS week's issue is out), **Wednesday night = The
      Gauntlet** (only when there is one), the calendar heroes its MFL export
      carries (a league-wide draft, auction, trade deadline, kickoff,
      playoffs, title game), What's New, the default card. Divisions are its
      player pools, so the owner's glow/crest is scoped to their division.
    - No live scoring yet: the live windows show an honest "games are on /
      the scores are in" card. The page already builds the scoreboard when
      the registry flips `liveScoring` — the separate live-scoring session
      (`claude/archies-live-scoring`) only has to flip it.
    - Retired: `PackageLeagueHero` and `resolvePackageHero` (the lite hero).
    - Not yet shared: TheLeague's bespoke components still read TheLeague's
      data (StandingsHero, WaiverWireHero, MatchupPreviewHero, ArticleHero,
      RecapHero, the enrichers in `offseason-hero-data.ts`). Another league
      that lists a contract rung renders it on the shared event card (every
      capability state carries a `view`) until those take a `league`.
  - Rosters, Standings, Transactions: one separate session each, same
    approach, stacked on this branch.
- Two-way Slack (mentions → tips) through the Events API, if a client wants it.
