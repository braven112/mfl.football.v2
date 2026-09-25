# Custom-site demo — plan

Status: **planned, nothing built.** Owner decisions recorded 2026-09-25.

## Goal

Prospects for the $10k custom-site offer can try the real product — set a
lineup, add/drop, claim waivers, trade, manage contracts/IR/taxi — without any
real league data and without anything ever reaching MyFantasyLeague.

## Owner decisions

| Question | Decision |
|---|---|
| Whose data | **Fictional leagues only.** No TheLeague/AFL franchise names, owners, history, Schefter posts or chat. Real NFL players are fine. |
| Demo types | Four pre-built fictional leagues: **salary-cap auction dynasty** (TheLeague features), **keeper**, **large multi-conference, 50+ teams at launch** (AFL features), **redraft / best ball**. |
| Intake | Public self-serve questionnaire (format, team count, auction/draft, keepers, cap, scoring) → matched to the closest pre-built type. Answers stored as a lead. |
| Tailoring | Pre-built types, not generated per prospect. The answers feed the sales call. |
| Access | Submitting the form issues a private link, expiring (~14 days), no password. Prospect picks a franchise. |
| Writes | **Simulated success**, visible to that prospect only, reset at expiry. |
| Trades | Other team **auto-accepts** after a moment. |
| Lead alert | **Web push** to the owner's franchise; lead detail on an admin page. |
| Pitch | Demo banner + "What you get" page + inline "Custom for this league" tags. |
| Domain | `demo.mfl.football` (one subdomain per type, e.g. `dynasty.demo.mfl.football`). |

### Pitch copy to carry (owner's words, paraphrased)

The demo league is an example: it is a salary-cap league, so it has salary-cap
extras. A purchased site gets features specific to how *your* league works,
negotiated up front — not unlimited, but anything halfway reasonable can be
built — and existing components and patterns are adjusted to fit your league.

## Architecture — a separate demo deployment, same code, different data

Rejected alternatives (evidence gathered 2026-09-25):

- **New registry slugs per demo type** — 20 sibling routes are still forked
  (`tests/fixtures/page-fork-baseline.json`), including `rosters.astro` and
  `lineup.astro`, and they hardcode their league (`rosters.astro` reads
  `data/theleague/mfl-feeds/${year}` via `fs`). A new slug means copying forks
  (the fork ratchet fails) or unforking 20 pages first.
- **Per-request data override on the real site** — 86 files statically import
  league JSON; 99 `import.meta.glob` calls in `src/pages/theleague`. Not
  cheaply variable per request, and it would share production's secrets/Redis.
- **Pointing the registry `mflHost` at a mock** — reads don't use it:
  `buildMflExportUrl` defaults to `api.myfantasyleague.com`
  (`src/utils/mfl-url.ts`), the literal appears ~96 times in ~53 files.

**Chosen: a second Vercel project on the same repo** with `DEMO_PROFILE` set:

1. **Build-time data swap.** `scripts/demo/build-demo-data.mjs` replaces the
   network prebuild. It **deletes** `data/theleague`, `data/afl-fantasy`,
   `data/best-ball-1`, `src/data/theleague*` and league icon dirs, then writes
   synthetic MFL-shaped feeds to the same paths. Existing imports/globs/`fs`
   reads resolve to fiction with no page edits; a file the generator misses
   breaks the build instead of rendering real data. Nothing is committed.
2. **Registry profile overlay** (`src/config/demo-profiles.mjs`, merged when
   `DEMO_PROFILE` is set): fictional names, **distinct league ids** (so no Redis
   key can alias a real one), demo domains as canonical (slug hidden from
   URLs), Schefter/Roger/GroupMe/rules-chat features off.
3. **Fetch-layer MFL mock.** Installed from `src/middleware.ts` in demo mode:
   any `*.myfantasyleague.com` request is answered from the synthetic base
   export + the prospect's overlay. Writes (`/import`, `/add_drop`, `/csetup`)
   return `<status>OK</status>` and are recorded. Unknown TYPE → MFL-style
   `<error>`. Never touches the network. `mflFetch` short-circuits writes as a
   second layer.
4. **Per-prospect state.** Demo token carried in `AsyncLocalStorage`; the
   Upstash client is namespaced at its choke point (`src/utils/redis-client.ts`)
   so every key is `demo:{token}:…` with TTL = link expiry. That isolates the
   MFL overlay AND app-side Redis features (contract declarations, watch list,
   rankings), and makes MFL-derived caches per-prospect.
5. **Secrets isolation is the primary control.** The demo project has its own
   Upstash DB and `JWT_SECRET`, and **no** MFL credentials, GroupMe, VAPID
   (except via the lead relay below), GitHub token or `CRON_SECRET`.

### Fail-closed guard

`isDemoDeploy()` in `src/utils/deploy-environment.ts`; `assertOutboundAllowed`
throws whenever it is true — **including `VERCEL_ENV=production`**, which is
the demo project's own production. Cron handlers in `vercel.json` return early
in demo mode.

### Demo session

`/start?t=<token>` (a **page**, so it may redirect and set cookies) looks up
`demo:tokens:{t}` → `{type, expiresAt, leadId}`, lets the prospect pick a
franchise, and mints a session JWT (`role: 'owner'`, `demo: true`, demo league
id, expiry = token expiry). `isCommissionerOrAdmin` returns false for demo
sessions and the admin-franchise fallback is empty in the profile. Expired →
`/expired` with a re-request link.

### Synthetic data generator

`scripts/demo/generate.mjs`, seeded PRNG (type + league year) → deterministic.
Real NFL player ids from the players feed (copied/filtered before the wipe —
NFL facts only). Fictional franchise/owner names, generated SVG crests. Emits
every file the build imports: league config/assets, rosters, salaries,
calendar, schedule, standings, weeklyResults, transactions, draft/auction
results, future picks, 1–2 seasons of history. Dates relative to build date so
the demo always looks current.

### Simulated writes

Overlay reducers per MFL import type, applied by the mock on read: `lineup`,
`fcfsWaiver` (add/drop), `waiverRequest`, trade propose → auto-accept, `salaries`
(contracts/extensions), IR, taxi.

### Lead capture

Questionnaire + pitch pages live on the demo deployment. Leads stored in demo
Redis (no TTL), rate-limited (`src/utils/rate-limit.ts`) + honeypot. Matching:
50+ teams or conferences → conference demo; best ball/redraft → bb; keepers →
keeper; else → dynasty. Owner alert: HMAC-signed POST from the demo project to
a production `/api/demo-leads` endpoint that calls `sendPushToFranchise` for
the owner (the demo project itself holds no push keys). Lead detail on an admin
page.

## Phases

- **P0 — rails, no UI.** `isDemoDeploy`, guard change, fetch-mock skeleton
  (fail-closed), Redis namespace wrapper, cron early-returns. Guards: demo
  profile + `VERCEL_ENV=production` still blocks; no real MFL fetch when the
  profile is set; every Redis key prefixed; `isCommissionerOrAdmin` false for
  demo.
- **P1 — salary-cap dynasty demo (TheLeague slot).** Generator,
  wipe-and-generate build, profile overlay, `/start`, CLI
  `scripts/demo/mint-link.mjs`, demo banner (modelled on `StagingBanner.astro`),
  simulated lineup + add/drop + contracts. **Leak guard:** build a denylist from
  the real configs (franchise, owner, GroupMe names, franchise history) before
  the wipe; after `astro build`, scan the output and fail on any hit.
  Generator determinism test.
- **P2 — sales funnel.** Questionnaire, pitch page, lead store + push relay,
  auto-issued links, admin lead page; trade/waiver/IR/taxi reducers;
  `<CustomForLeague feature=…>` tags driven by a profile list.
- **P3 — remaining types.** Best ball (bb1 slot; draft-only, cheap); keeper
  (second profile); **large conference at 50+ teams** — requires reworking the
  AFL code's two-12-team-conference assumptions (layouts, draft math, standings)
  first. Spike this before quoting a date.

## Risks

- Real content lives in **code**, not only data: rules pages,
  `src/data/theleague/league-events.ts`, nav config, throwback art, hero
  images, Schefter/Roger prompts. The post-build leak scan is the backstop; the
  audit is real work.
- 50+ team conferences: AFL code assumes 2×12.
- Fetch monkeypatching can miss non-`fetch` HTTP clients (7 files use
  https/undici-style helpers — verify or mock each).
- Cross-prospect bleed via module-level in-memory caches in a warm lambda —
  add a scan guard.
- A second Vercel project roughly doubles build minutes unless gated to a
  `demo` branch.
- Demo drifts behind main unless promoted with the weekly release.

## Open

- Build cadence for the demo project (on each weekly promote?).
- Link lifetime — 14 days assumed.
