# MFL Live as a store app — the product we sell to any MFL owner

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
| 10 | Store-safe board (2026-10-26) | `?source=mfl` = **MFL data only** | No ESPN fetch at all (no games strip, ticker, red zone), no Sleeper, no headshots, no NFL club marks or colours. Scores, projections and yet-to-play are unchanged. `tests/mfl-live-board-store.test.ts`. |
| 11 | Android package id (2026-10-26) | **`football.mfl.live.mobile`** | `football.mfl.live` is the Google TV app's id (`android-tv/`), and Play allows one app per id, so the phone app has its own id, listing and closed test. Permanent once uploaded to Play. The iOS bundle id stays `football.mfl.live`. App name "MFL Live". Expo project: `mfl` under the `fantasysports.dev` account (id `45e0bbdf-e3b3-408d-8e0b-ac9950292d58`). |
| 12 | First build (2026-10-26) | Three PRs off staging: server store mode → `apps/mobile` (sign-in + matchups screens) → GitHub Actions `eas build --no-wait` | Standings is the next screen after. Proposal: https://claude.ai/artifact/5BWWrQvew8dhEUo3Lu2mne |

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
