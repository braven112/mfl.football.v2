# MFL Live as a store app — the product we sell to any MFL owner

> **Renamed MFL Football on 2026-10-27** (decision 15). The rest of this doc
> still says MFL Live where it describes history and code names.

> Vision of record, set with Brandon on 2026-10-24. Nothing here is built yet.
> Sibling plans: `docs/plans/mfl-live-app.md` (the web board this grows from),
> `docs/plans/mfl-live-league-boards.md`, `docs/plans/mfl-live-sleeper.md`.
> The "Open" section is the list of decisions still owed.

## What it is

A fantasy football app for **any MyFantasyLeague owner**, on Google Play and
the App Store, that competes with MFL's own app. It gives every owner the
experience TheLeague and the AFL already get from this site, sold to them
individually.

What makes it worth paying for over MFL's app:

- **Better UI and more graphics.** League logos, owner-set team colors,
  owner-uploaded logos. Being visual is the differentiator.
- **More data visualizations.** Live scoring, live standings, charts.
- **History and rivalries.** Head-to-head records against every owner, graphs
  of past games, streaks — the franchise-history work, for any league.
- **An AI league reporter** writing recaps, trade grades and articles about
  YOUR league — a new persona, not "Schefter" (see Legal).

## Decisions

| # | Question | Decision | Why / consequence |
|---|---|---|---|
| 1 | Where the code lives | **This repo**, `apps/mobile` | The workspace already globs `apps/*` and `packages/*`; the MFL fetcher, shared types and league utils are imported, never copied. No restructure of the site first. |
| 2 | App tech | **Expo (React Native)** | One codebase for Android and iOS; native push, offline cache and (later) widgets. |
| 3 | Build environment | **Cloud only** — GitHub Actions + Expo EAS | The owner works entirely from a phone, no computer. Same shape as `android-tv` (`.github/workflows/android-tv.yml`). Claude sessions write code; Actions build and submit. |
| 4 | Platform order | **Android first, iOS next** | Owner's phone is Android. iOS ships from the same code once an Apple Developer account exists. |
| 5 | Play account | Existing **personal** developer account (the one that published the Android TV app) | The $25 fee is per account, already paid. Personal accounts created after 2023-11-13 need a closed test of **12 testers for 14 straight days per app** before production — league members are the tester pool; start the clock at the first build. |
| 6 | Business entity | **None yet** — publish personally, form an LLC before charging | Apps can be transferred to an organization account later. A personal account selling subscriptions may have to show contact details publicly. Not legal/tax advice; confirm with a professional. |
| 7 | V1 scope | **Port MFL Live**: live scoring + live standings, league logos, owner-editable league logos and team colors | Live scoring is the minimum worth releasing. |
| 8 | Who pays | **Both**: an owner subscription, or a league plan the commissioner buys at a discount | League-wide features (the reporter) run for a league when a league plan exists or (to decide) when any owner in it subscribes. The single entitlement check is `hasMflLivePro` (`src/utils/mfl-live-pro.ts`) — a paid entitlement is OR-ed in there. |
| 9 | How the app gets its data (2026-10-26) | **Through our server**, not MFL from the phone | The app signs in at `/api/auth/login` (`scope: 'mfl-live'`, `client: 'mfl-live-app'`), which returns the session token in the body for that client only; the app keeps it in the device keystore and sends it as `Authorization: Bearer`, which `getMflLiveUser` alone accepts (`tests/mfl-live-app-auth.test.ts`). It polls `/api/live-board?source=mfl`. Calling MFL directly would mean porting scoring and matchup logic first; revisit when the app must serve owners outside our leagues. |
| 10 | Store-safe board (2026-10-26; Sleeper added 2026-10-27) | `?source=mfl` = **MFL data, plus the viewer's linked Sleeper leagues** | No ESPN fetch at all (no games strip, ticker, red zone), no headshots, no NFL club marks or colours. Scores, projections and yet-to-play are unchanged. Sleeper leagues (owner, 2026-10-27, reversing this row's original "no Sleeper") are clocked from MFL's own `nflSchedule` export instead of ESPN (`src/utils/sleeper/store-clock.ts`) and sit behind one switch, `SLEEPER_IN_STORE_APP` (see Legal). `tests/mfl-live-board-store.test.ts`. |
| 11 | Android package id (2026-10-26, changed 2026-10-27) | **`football.mfl.app`** | `football.mfl.live` is the Google TV app's id (`android-tv/`), and Play allows one app per id, so the phone app has its own id, listing and closed test. It was `football.mfl.live.mobile` until the rename to MFL Football (decision 15); nothing had been uploaded to Play, so the owner dropped "live" from the id too. Permanent once uploaded to Play. The iOS bundle id stays `football.mfl.live`. Expo project: `mfl` under the `fantasysports.dev` account (id `45e0bbdf-e3b3-408d-8e0b-ac9950292d58`). |
| 12 | First build (2026-10-26) | Three PRs off staging: server store mode → `apps/mobile` (sign-in + matchups screens) → GitHub Actions `eas build --no-wait` | Standings is the next screen after. Proposal: https://claude.ai/artifact/5BWWrQvew8dhEUo3Lu2mne |
| 13 | Look (2026-10-27) | **MFL Live's black and red, one theme; Vend Sans** | The web board's `html.dark[data-league="mfl"]` colours (ink `#14161a`, red `#d81b41` / `#ef5350`) and its font, bundled with `@expo-google-fonts/vend-sans` (OFL). No light theme until the core features are right; `apps/mobile/src/theme.ts` is the only place colours live, so one can be added there later. |
| 14 | Feature order (2026-10-27, draft for owner review) | See **Phone app feature plan** | Correctness of the core live features first, then reach, then what needs a licensed data feed. |
| 15 | Name (2026-10-27) | **MFL Football** (was MFL Live) | Another app is already called MFL Live. The phone app's display name, sign-in screen and Play listing say MFL Football; the website and the TV app are renamed in their own thread. Code identifiers (`MflLive*`, `mfl-live-*` files and routes) stay as they are. |
| 16 | Launch gate (2026-10-27) | **No Play upload until every table-stakes feature works** | The owner: not worth selling or posting to the closed test without them. See **Launch gate: table stakes**. Manage your team (lineups, adds/drops, waivers, trades, chat, team page, commissioner actions) moves from proposed to required, and the app must act in any MFL league the account is in. |
| 17 | Draft room scope (2026-10-27) | **Pick-by-pick AND auction drafts, both before launch** | The owner chose auctions too (decision card in the draft room thread). Order: the pick-by-pick room (board, queue, making a pick: #1548 and the next PR), then an auction room (nominate, bid, budgets), then the "you're on the clock" alert through the push package's one-minute checker. A pick counts as made only when the re-read board shows it; MFL's `live_draft` command had not been driven by this repo before. |
| 18 | Server address (2026-10-27) | **`https://mfl.football`** (was `v2.mfl.football`) | The owner: the app and its docs use the apex, not v2. The apex is attached to the same Vercel production project with no redirect, and the app's sign-in returns a Bearer token rather than a cookie, so nothing depends on the host. Set in `apps/mobile/app.json` (`extra.apiOrigin`) and the fallback in `apps/mobile/src/api.ts`; reaches phones with the next build. Privacy policy for Play: https://mfl.football/privacy. The site-wide `SHARED_APP_ORIGIN` is a separate change. |
| 19 | Outside chat (2026-10-27) | **A league that talks in GroupMe sees its GroupMe in the Chat tab instead of MFL chat. GroupMe first, Slack later.** Connection is **both**: the commissioner connects the group once so every owner can read it, and an owner posts **as themselves**: the first time they tap Send, the app asks them to sign in to GroupMe, and from then on they post freely. No bot posting for owners (owner, 2026-10-27). | The owner's leagues never use MFL chat. Slack waits because Slack throttles history reads for apps outside its Marketplace (about 1 call a minute, 15 messages) and listing means a Slack review. Steps, one PR each: (1) TheLeague and the AFL, the GroupMe the site already reaches, read live with the service token (`src/utils/live/league-groupme-chat.ts`); a post answers `groupme-sign-in`; (2) the owner's GroupMe sign-in on first Send, then posting as themselves (`src/utils/live/groupme-owner-auth.ts`; our GroupMe application, created by the owner, calls back to `https://mfl.football/api/mfl-live/groupme/callback`, so the start route is on mfl.football too; the token is stored encrypted per MFL account, so one sign-in covers every league); (3) any other league connects a GroupMe group in the app ("Switch chat" on the Chat tab; `/api/mfl-live/chat-source`, `src/utils/live/league-groupme-connection.ts`). **Only the league's commissioner** may change it (the owner, 2026-10-27; it shipped first as any owner). The check is MFL's own: `TYPE=league` fetched with the owner's cookie carries `lastVisit` / `commish_username` only for the commissioner (`src/utils/live/mfl-commissioner.ts`, shared with the commissioner tools, answers commissioner / not / unknown and fails closed). The tab shows who connected it, and the group is read with that commissioner's own GroupMe sign-in. A commissioner with no team in the league can't reach it yet, since every app endpoint acts as a team; (4) report / hide a message (store UGC rule). Research: `/mnt/project-files/mfl-live-app/outside-chat/groupme-slack-research.md`. |
| 20 | Team logos (2026-10-27) | **A prompt builder, not an image generator.** The owner picks a style, one or two team colors (a grid of 18 including white and black, or any hex; every prompt also offers white and black as needed) and an icon, banner or SVG; we write the prompt and they paste it into ChatGPT, Gemini or Claude. Next step: upload the result and save it as the team's MFL icon and banner. An in-app Generate button may come later as a Pro feature. | The rival MFL Live app's "Franchise Image Studio" (v2.0, 2026-10-13) generates art with OpenAI. A builder has no running cost, no AI-content moderation for Play, and reuses our logo rules (`src/utils/team-logo-prompt.ts`, which also writes the Brand Book's prompt). App: My Team → Create team logo (`/api/mfl-live/logo-prompt`); web: `/live/team-logo`. The owner asked for free color choice instead of fixed pairs, and for accessible colors: suggested pairs whose two colors clear 3:1 against each other (WCAG graphics contrast, pinned by `tests/team-logo-prompt.test.ts`) and a live note when two picked colors are too close. 2026-10-28: capped at two team colors; white and black can be one of them (red and black, black and white), and every prompt also offers whichever of them is not picked, since nearly every logo uses them for outlines and lettering. |

## Legal — what a wide-distribution app can and cannot carry

Not legal advice; every line below needs a lawyer's confirmation before money
changes hands. It is a map, not a ruling.

- **Player names + stats: generally usable.** A 2006 federal ruling (C.B.C.
  Distribution v. MLB Advanced Media) found fantasy use of names with stats
  was not a right-of-publicity violation. It did not cover photos.
- **The league's own MFL data** (rosters, contracts, trades, standings):
  usable via the MFL API, **but MFL's terms for a commercial competing app are
  unconfirmed.** This is the single biggest dependency — contact MFL early.
- **ESPN data: must be replaced.** Stats are facts, but the unofficial ESPN
  endpoints break ESPN's terms. Swap to a licensed provider (below).
- **NFL team logos, player headshots: not without a license.** Both stores
  reject unlicensed league marks; a "not affiliated" disclaimer does not help.
  Use team abbreviations with our own styling. This overrides
  `mfl-live-app.md` decision 13 (the NFL-artwork fallback) for the store build.
- **Sleeper data: fine for the free test, needs Sleeper's OK before we charge**
  (checked 2026-10-27). Sleeper's public API needs no key, but its General
  Terms of Use (last updated 2026-10-06, support.sleeper.com article 5486620)
  license the service for "personal and non-commercial use" (section 9.2) and
  connect third-party products through a separate written agreement as an
  "Approved Integration Partner" (section 2.9). So: ask Sleeper for partner
  approval before the paid launch, and if they decline, set
  `SLEEPER_IN_STORE_APP = false` (`src/utils/sleeper/store-clock.ts`), which
  takes Sleeper out of the app and leaves the web board as it is.
- **The reporter persona needs an original name.** "Schefter" is a real
  journalist; a paid product using his name invites a publicity claim.

## What MFL Live depends on that the store build must swap

From `docs/plans/mfl-live-app.md` and `docs/claude/rules/live-scoring.md`:

| Feature | Today's source | Store build |
|---|---|---|
| Fantasy scores, matchups, standings | MFL | Keep |
| Faster-than-MFL score movement (`src/utils/live/espn-overlay.ts`) | ESPN box scores | Licensed feed, or MFL-only at launch |
| NFL games strip, game clocks, red zone, scoring ticker | ESPN scoreboard / summary / plays | Licensed feed, or cut from v1 |
| Franchise artwork rung 2 (NFL name match) | `public/assets/nfl-logos/` | Remove; rung 3 (text) plus owner-uploaded logos |

Rule that still holds with any provider: **never fabricate a game clock**
(`live-scoring.md`).

## Licensed stats — options and cost (researched 2026-10-24)

| Provider | Price | Notes |
|---|---|---|
| BallDontLie | $9.99–$39.99/mo | Basic coverage |
| API-American-Football | $19–$39/mo | Basic, free tier |
| SportsDataIO Discovery Lab | $99–$149/mo | Next-day delayed — not live |
| SportsDataIO / Sportradar real-time | custom; ~$500–$1,000+/mo estimated | Headshots offered — check usage rights |

Genius Sports holds the NFL's exclusive official-data rights (since 2021).
Plan: launch on MFL data plus a cheap feed, no logos; buy a real-time feed
once subscriptions cover it. Sources:
[Highlightly](https://highlightly.net/blogs/best-nfl-apis-in-2026),
[SportsData.io review](https://sportsapis.dev/apis/sportsdata-io),
[Sportradar review](https://sportsapis.dev/apis/sportradar).

## The app's install (2026-10-26)

`apps/mobile` is excluded from the root pnpm workspace (`'!apps/mobile'`) and
is its own pnpm workspace with its own lockfile, so React Native never enters
the website's install on Vercel or in CI. It still REUSES the shared packages,
through `import type` only (tsconfig `paths`), which is erased at build time.
The wire contract is `packages/shared-types/src/mfl-live-app.ts`; the site's
`MflLiveBoard` must stay assignable to it, which
`src/types/mfl-live-app-contract.ts` asserts under `pnpm test:types`. A future
need for shared RUNTIME code is the point to revisit this.

EAS Build's pnpm refuses a lockfile entry published less than a day before the
build. The first build failed on exactly that, because 24 Metro packages had
shipped that morning. So the app's `pnpm-workspace.yaml` sets
`minimumReleaseAge: 1440`, and the lockfile is resolved under the same rule.
Preview builds start on pushes to `staging` only. A release fast-forwards `main`
to a commit staging already built.

## Phone app feature plan (2026-10-27, draft for owner review)

What the web app (`mfl.football/live`) does, in the order the phone app gets it.
The owner's rule: get the core functionality right before theming or extras.

**P0, the core (each one checked against the web board for the same week):**

1. **Matchups, correct and live.** Every league the account is in; score,
   projection, yet-to-play, win probability; starters with points and status
   on tap; refresh on the NFL clock (the web's `shouldPollLive` cadence, not a
   fixed timer), pull to refresh, last-updated time, clear error and
   offseason states. Exists in a first form; this item is making it match.
2. **App navigation.** A bottom tab bar (Matchups, Standings, Leagues) so the
   next screens have a home. Every route is declared once in
   `apps/mobile/src/navigation/types.ts` with a placeholder screen, so each
   feature replaces its own screen file and never edits the navigator; screens
   call the server through `apiGet` / `apiPost` (`src/api.ts`) and read the
   session from `useSession()`.
3. **League board.** Tap a league for every matchup in it plus the week's top
   scorers (`/live/league/<id>`, `/api/league-board`, which already accepts
   the app's Bearer sign-in). Needs a store-safe `source=mfl` mode like the
   board's.
4. **Standings.** Every watched league's table with the Live / Projected /
   Final switch (`/live/standings`, `/api/live-standings`). Same store-safe
   mode needed.
5. **Which leagues to watch.** The `/live/settings` switches. The web keeps
   the choice in a cookie (`/api/live-leagues`); the app needs it kept per
   account on the server so phone and web agree.
   *Server half built (Oct 27):* stored in Redis under the hashed MFL username
   (`live:leagues:<viewer>`, `src/utils/mfl-live-selection-store.ts`), the key
   the Sleeper link and TV settings already use. The account's choice beats
   the cookie; a cookie with nothing stored is copied up once. Every MFL Live
   surface reads it through `readMflLiveSelection`. The app GETs
   `/api/live-leagues` (MFL leagues only) and POSTs `{ league, enabled }`; the
   server applies the last-league and collapse-to-default rules and keeps any
   Sleeper leagues switched on for the web. A paired TV keeps its own cookie.

**P1, reach:**

6. **League and team identity.** League logos, team colours and owner logos
   wherever the web already has them; text marks otherwise. No NFL marks.
7. **Pair a TV from the phone.** Scan the TV's QR code and approve it in the
   app instead of a browser (`/live/broadcast/pair`).
8. **Push notifications** (owner 2026-10-27: "a very important feature"):
   native push via `expo-notifications`, reusing the site's notification
   categories. First alerts: lineup reminder, close game, final.
   Built as a second transport behind the site's one send door
   (`sendPushToFranchise`): the app registers its Expo push token at
   `/api/push/expo-register` (Bearer), tokens are stored per MFL ACCOUNT
   (hashed username, never the cookie) with a per-league index of the
   account's teams rebuilt from `myleagues` on every launch (`push:expo:*`,
   src/utils/push-expo.ts), and every alert the site sends reaches the app
   under the owner's existing notification settings, one Android channel
   per settings group. For any MFL league (launch gate): actions taken in
   the app alert instantly, and the owner chose (2026-10-27) a server
   checker that reads MFL EVERY MINUTE for actions taken on MFL's own site,
   keeping each owner's MFL sign-in on the server, encrypted. That checker
   is `/api/cron/push-watch` (src/utils/push-watch.ts): it reads only the
   leagues an app phone is registered in, records a league's first read
   without alerting, and skips trade OFFERS in TheLeague and the AFL, whose
   site already sends them.
9. **Sleeper** (owner 2026-10-27): the web's Sleeper leagues
   (`docs/plans/mfl-live-sleeper.md`) on the app's board, and Sleeper
   leagues in standings on the web and the app. This reverses decision 10's
   "no Sleeper" for the store build; no Sleeper headshots, and Sleeper's API
   terms for commercial use get checked first.
10. **Manage your team** (approved 2026-10-27, now part of the launch gate
    below): set lineups through the server with the owner's own MFL session,
    as `/api/lineup` already does for TheLeague and the AFL; then adds, drops
    and waivers.

**P2, needs a licensed data feed first (store rules: no ESPN data):**

11. NFL games strip with game clocks.
12. Cross-league scoring ticker and red-zone banner.
13. Faster-than-MFL score movement.

**Not coming to the phone:** the TV broadcast board and its overlay (TV app),
and site analytics and the Sleeper player-fix review (admin-only).

**After the launch gate below:** light theme, iOS, then the roadmap below (history and
rivalries, the reporter, subscriptions).

## Launch gate: table stakes (owner 2026-10-27)

The owner's rule: the app is not worth selling, or even posting to the Play
closed test, until it has every table-stakes feature. "Table stakes" is what
every app built for MyFantasyLeague already does (competitor research,
https://claude.ai/artifact/KJzUueSwE2YmnG3TEEkvLG: MFL Live by Treeport, MFL
Mobile, MFL Platinum, MFL Modern, plus Sleeper, Yahoo and ESPN). All of it runs
on MFL data, so none of it waits on a licensed feed.

Before the first Play upload, the app must do all of these, natively (no web
views; "pages bounce to the website" is a named complaint about MFL apps):

1. **Live matchups, league board and standings** (P0 items 1-5 above).
2. **Set lineup**, with a "who's out" warning before kickoff.
3. **Add and drop, and waiver claims with blind (FAAB) bids**, plus your
   pending claims and cancelling one.
4. **Player search and free agents**, sortable by projection, points and
   owned %, with a player card (status, bye, recent scores). No headshots.
   *Built (package K, 2026-10-27):* `GET /api/mfl-live/players` (free agents,
   all players, trending; sort `proj`/`pts`/`owned`) and `/api/mfl-live/player`
   (the card, every scored week), assembled in `src/utils/live/mfl-players.ts`,
   contract `mfl-live-app-k.ts`. Projections and points are the league's own
   scoring; owned % and added % are MFL-wide (`topOwns`/`topAdds`). Free agency
   is the account's own unit. The Add button appears once add/drop plugs into
   `apps/mobile/src/players/player-actions.ts`.
5. **Trades**: build and propose one, see pending offers, accept, reject or
   counter.
6. **League chat** with unread badges.
7. **Transactions feed** for the league (adds, drops, trades, waivers).
8. **Your team page**: roster with status and byes, cap and contracts where
   the league has them, draft picks.
9. **Commissioner actions** in leagues the account runs: approve trades,
   set a lineup for an owner, and the like.
10. **Push alerts** (P1 item 8) for lineup reminders, trades offered or
    accepted, waiver results and chat messages, arriving in seconds (late
    alerts are a named complaint).
11. **Draft room** with "you're on the clock" alerts and making a pick, for
    pick-by-pick AND auction drafts (decision 17). MFL leagues draft in the
    summer, so this can land last, but it is in the gate.

League and team identity (P1 item 6), pairing a TV (7) and Sleeper (9) stay
planned but are not part of the gate. Every write uses the owner's own MFL
cookie, never the server's credentials (`tests/auth-league-scope.test.ts`), and
the app must work for any MFL league the account is in, not just TheLeague and
the AFL.

## Roadmap

1. **V1 — live.** Live scoring, live standings, league logos, owner-set logos
   and team colors. Android closed test, then production.
2. **History and rivalries.** Head-to-head, past-game charts, streaks.
3. **The reporter.** Original persona; weekly recaps, trade grades, articles.
   Budget the AI cost per league per week into the price.
4. **Subscriptions on.** Owner plan + league plan, through store billing
   (stores take a cut; small-developer rate believed to be 15%).
5. **iOS**, then widgets (needs small native Swift/Kotlin extensions).

## Open

- MFL's answer on commercial API use.
- The reporter's name and voice.
- Prices for the owner plan and the league plan; whether one owner's
  subscription turns on league-wide features for everyone in that league.
- Which licensed stats feed, and whether v1 ships the NFL games strip at all.
- Apple Developer account ($99/yr) timing.

## Parallel work (2026-10-27)

The plan above is split into work packages that run as separate threads, each
owning its own files: `/mnt/project-files/mfl-live-app/parallel-work-packages.md`
in the project's shared files. Two rules keep them apart: each package adds its
own wire-contract file (`packages/shared-types/src/mfl-live-app-<pkg>.ts`)
rather than editing the shared one, and only the shell (F), push (H) and TV
pairing (G) packages add npm dependencies to `apps/mobile`.

Round 2 (same day) splits the launch gate into packages J to R: set lineup,
players and free agents, add/drop and waivers, trades, league chat, the
transactions feed, the team page, commissioner actions and the draft room,
on a shared foundation (F2) that resolves which league and team the account
is acting in. App endpoints for these live under `src/pages/api/mfl-live/`,
call `getMflLiveUser`, and verify the league with `resolveOwnerLeague` before
any MFL call; the site's own TheLeague/AFL endpoints stay as they are.
