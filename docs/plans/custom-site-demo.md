# Custom-site demo — plan

Status: **P1 (rails), P2 (dynasty demo) and P3 (sales funnel) built** on
`claude/custom-site-demo-page-5z2r0h`, verified end to end locally (2026-09-26).
Nothing deployed yet — needs the owner setup below. Owner decisions recorded
2026-09-25.

## Where it stands

Verified in a throwaway checkout (`DEMO_BUILD_DISPOSABLE_CHECKOUT=1`), built
with `astro build` and driven in Chromium against `scripts/demo/mock-upstash.mjs`:

- The demo prebuild wipes every real league file, simulates six seasons of a
  fictional 16-team salary-cap dynasty league (real NFL players and weekly
  points only), and runs the site's own derivation chain over it — every
  consistency check in that chain passes.
- The post-build leak scan finds none of the ~330 real franchise and owner
  names in the output (static pages, client and server bundles).
- A minted link → team picker → owner session; home, standings, rosters,
  lineup and transactions render the fictional league; the header reads
  "Demo League"; AFL routes 404.
- Through the site's real API routes: lineup submit ("Lineup Saved" on
  reload), cut, waiver claim (verified by the route's own read-back), trade
  (auto-accepted, players swapped) — each visible on the next page load, and
  invisible to a second prospect on the same franchise.

### Owner setup to go live

1. Create an Upstash database for the demo (free tier).
2. In Vercel (same project), create branch `demo` from this work, and add
   branch-scoped Preview variables: `DEMO_PROFILE=dynasty`,
   `DEMO_JWT_SECRET` (any long random string), `DEMO_REDIS_REST_URL`,
   `DEMO_REDIS_REST_TOKEN`.
3. Assign `demo.mfl.football` to the `demo` branch; CNAME it in Cloudflare.
   One host, no nested subdomains: each demo league is a PATH on it.
4. Set `DEMO_LEAD_RELAY_SECRET` (one long random string) on BOTH the `demo`
   branch and Production — it signs leads to production and link actions back.
5. Links issue themselves from the questionnaire at demo.mfl.football; issue
   one by hand from /theleague/admin/demo-leads, or
   `DEMO_REDIS_REST_URL=… DEMO_REDIS_REST_TOKEN=… node scripts/demo/mint-link.mjs --label "Acme League" [--path redraft]`.
   A token opens every demo; the path only picks where the link lands.

### Phase 3 (built)

- demo.mfl.football/ is the pitch ("Custom sites from $10,000") and the
  questionnaire (`src/pages/demo/index.astro`). Submitting it
  (`/api/demo/lead`) issues the link on the spot, matches the league to the
  closest demo (`matchDemo`: 30+ teams or conferences → bigleague,
  redraft/best ball → redraft, cap-less keeper → keeper, else dynasty; an
  unbuilt demo falls back to dynasty and says so), keeps a copy in the demo
  Redis, and relays the lead signed to production.
- Production `/api/demo-leads` stores it and pushes TheLeague 0001
  (`ops-demo-lead`, admin-only, on by default). `/theleague/admin/demo-leads`
  lists leads with extend / revoke / issue-by-hand, each a signed call to the
  demo's `/api/demo/links` — production never holds the demo's database keys.
- Revoking or expiring a link ends its sessions on the next request.
- "Custom for this league" tags on the Front Office hub and pages, and
  Franchise Tags.

### Phase 4 — `/redraft` (built)

- The Best Ball slot carries a fictional 12-team best-ball league
  (`scripts/demo/lib/bestball.mjs`): config, assets, and a completed 25-round
  (300-pick) snake draft by MFL redraft ADP with noise, padded past ADP's end
  by last season's points. `demo.mfl.football/redraft` → `/best-ball-1`.
- The official draft lives in PartyKit, a live service the demo must not
  touch: on the demo the session id is prefixed `demo-` and
  `fetchOfficialDraftSession` serves the generated file instead;
  `/draft-room` sends prospects to mock drafts (bots, run in their browser).
- Each demo has its own picker (`/<path>/demo-start`, one shared
  `DemoStartPage` component); `/<path>/login` goes to that demo's picker.
- The MFL stand-in answers only for the dynasty league's id — any other `L=`
  gets MFL's own "Invalid league ID." error.
- The banner's pitch line names the demo's own extras (draft tools for best
  ball, salary-cap tools elsewhere).

### Phase 4 — `/keeper`, the fourth league slot (built)

- A demo-only registry entry, `keeper` (`leagues-data.mjs`, inside the
  `isDemoEnv()` block): production's crons, push senders and sync scripts
  enumerate the registry, so a slot they could see is one they would poll MFL
  for. Off the demo the middleware 404s `/keeper/*` and `/api/keeper/*`
  (`isDemoOnlyPath`), and every route re-checks `keeperLeague()`.
- Its pages are the AFL's, SHARED rather than copied: the lineup, standings,
  players, rosters (keeper planner included), keepers hub and trade builder
  moved into `src/components/afl-family/*Page.astro`, and `/afl-fantasy/*` is
  now a thin route wrapper around each — AFL HTML parity checked before and
  after every move (only the new `data-controller="afl-family"` marker
  differs). The Front Office hub was already shared. The keeper home is its own
  small component (`components/keeper/KeeperHomePage.astro`): the AFL's home is
  built around AFL-only machinery (hero calendar, tiers, conference drafts).
- League-aware helpers take the league with an AFL default, so no existing
  caller changed: `afl-conference` (`AflFamilySlug`), the AFL scoring/planner
  loaders (a `dataPath`), the Front Office keeper loader, the live free-agent
  roster cache (keyed by league), `compute-afl-free-agents.mjs --league`.
- Nav: its own `navSlug` (`keeper`), an allowlist of the nav links it has
  (`navLinks`), and `isAflFamily()` for AFL-tagged links. The demo's league
  switcher lists only slots with a `demoPath`.
- Data: `scripts/demo/lib/keeper.mjs` + `simulateLeague({ mode: 'keeper' })` —
  twelve teams, one conference, two divisions; every offseason each team keeps
  its best seven and a straight draft (worst first) refills the roster; no
  salaries. The MFL stand-in answers each league id from its own feeds and
  state (`standinLeague`, an AsyncLocalStorage scope per call).
- `/api/afl-keepers` serves any AFL-family league, storing a plan under the
  SESSION's league — so it is no longer refused on the demo.

### Known gaps (next)

- The AFL DATA files stay in the demo bundle (54 shared modules
  import them) — scrubbed of every name and never routed, but a fictional
  conference league (P4) should replace them.
- Two modules build their own Redis clients (`schefter-news-loaders.ts`,
  `mfl-trade-bait-cache.ts`) and so bypass the per-prospect namespace; both
  are read caches, shared between prospects.
- Trades move players, not draft picks; What's New, the Pecking Order and the
  owners' poll are empty; the league's rules pages keep their prose with
  names swapped.
- P4: `/bigleague` (96 teams, 8 conferences × 12, in the AFL slot) — the
  AFL-family components are the base; `afl-conference` still types a
  conference id as `'00' | '01'`.
- The keeper slot has no Schefter feed, rules, calendar, playoffs or live
  scoring pages; its nav and header offer only what it has.

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
| Domain | `demo.mfl.football`, one host, a **path** per demo type: `/dynasty` now; `/bigleague` (conference) and `/redraft` (best ball) later. No double subdomains (owner, 2026-09-26). |

### Pitch copy to carry (owner's words, paraphrased)

The demo league is an example: it is a salary-cap league, so it has salary-cap
extras. A purchased site gets features specific to how *your* league works,
negotiated up front — not unlimited, but anything halfway reasonable can be
built — and existing components and patterns are adjusted to fit your league.

## Architecture — a `demo` branch deployment, same code, different data

Alternatives considered (evidence gathered 2026-09-25):

- **New registry slugs per demo type** (rejected) — 20 sibling routes are still forked
  (`tests/fixtures/page-fork-baseline.json`), including `rosters.astro` and
  `lineup.astro`, and they hardcode their league (`rosters.astro` reads
  `data/theleague/mfl-feeds/${year}` via `fs`). A new slug means copying forks
  (the fork ratchet fails) or unforking 20 pages first.
- **Per-request data override on the real site** (rejected) — 86 files statically import
  league JSON; 99 `import.meta.glob` calls in `src/pages/theleague`. Not
  cheaply variable per request, and it would share production's secrets/Redis.
- **Pointing the registry `mflHost` at a mock** (rejected) — reads don't use it:
  `buildMflExportUrl` defaults to `api.myfantasyleague.com`
  (`src/utils/mfl-url.ts`), the literal appears ~96 times in ~53 files.

**Chosen: a `demo` branch in the SAME Vercel project** — exactly how
`staging.mfl.football` is pinned to `staging` — with `DEMO_PROFILE` set as a
branch-scoped Preview variable. (A separate project was the first draft; the
branch wins because the deployment is a preview, so the existing outbound guard
and "crons only run on production" already apply, and there is one project to
manage. Decided 2026-09-25.)

The cost of the same project is that a branch INHERITS every Preview variable —
production's MFL, GroupMe, VAPID and GitHub secrets and production's Redis.
Inheritance fails open (next year's new secret silently reaches the demo), so
the demo does not rely on the dashboard being right:

1. **Environment scrub at boot** (`src/utils/ensure-demo-isolation.ts`, imported
   first by `src/middleware.ts` and `astro.config.ts`, like
   `ensure-pt-timezone`). In demo mode it DELETES every variable matching a
   denylist of credential families (MFL, GroupMe, VAPID, GitHub, Redis, cron,
   Blob, Anthropic, the JWT secret), then maps the demo's own
   `DEMO_REDIS_REST_URL`/`TOKEN` and `DEMO_JWT_SECRET` into the names the code
   reads. Missing demo values fail closed: no Redis (degraded storage), and
   `session.ts` refuses to mint sessions on Vercel without a secret.
2. **Fetch guard.** Every server-side MFL call goes through `globalThis.fetch`
   (including `mflFetch`), so demo mode wraps it: any `*.myfantasyleague.com`
   request is answered by the demo MFL stand-in and never reaches the network;
   GroupMe, GitHub, push-service and Anthropic hosts are refused outright.
3. **Outbound guard.** `assertOutboundAllowed` throws whenever `isDemoDeploy()`
   — even if the demo were ever served from a production deployment.
4. **No elevated roles.** `isCommissionerOrAdmin` is false on a demo deploy.

Demo mode = `DEMO_PROFILE` set OR the deployment's branch is `demo`, so the
branch is protected even if the variable is forgotten.

Later phases build on those rails:

- **Build-time data swap.** `scripts/demo/build-demo-data.mjs` replaces the
  prebuild. It **deletes** `data/theleague`, `data/afl-fantasy`,
  `data/best-ball-1`, `src/data/theleague*` and league icon dirs, then writes
  synthetic MFL-shaped feeds to the same paths. Existing imports/globs/`fs`
  reads resolve to fiction with no page edits; a file the generator misses
  breaks the build instead of rendering real data. Nothing is committed.
- **Registry profile overlay** (`src/config/demo-profiles.mjs`): fictional
  names, **distinct league ids** (no Redis key can alias a real one), demo
  domains as canonical, Schefter/Roger/GroupMe/rules-chat off.
- **MFL stand-in.** The fetch guard's MFL branch answers `/export` from the
  synthetic base export + the prospect's overlay; writes return
  `<status>OK</status>` and are recorded.
- **Per-prospect state.** Demo token in `AsyncLocalStorage`; Redis keys
  namespaced `demo:{token}:…` with TTL = link expiry, so prospects never see
  each other's moves.
- **A separate Upstash database** for the demo (free tier expected), set only on
  the `demo` branch as `DEMO_REDIS_REST_URL`/`DEMO_REDIS_REST_TOKEN`.

### Vercel / DNS setup (owner, when phase 2 is ready)

- Create the `demo` branch; add branch-scoped Preview variables:
  `DEMO_PROFILE`, `DEMO_JWT_SECRET`, `DEMO_REDIS_REST_URL`,
  `DEMO_REDIS_REST_TOKEN`. No need to blank inherited secrets — the scrub does.
- Assign `demo.mfl.football` to the `demo` branch; CNAME it in Cloudflare.
  Each demo league is a path: the registry's `demoPath` on a league slot
  (`theleague` → `dynasty`) makes the demo serve that slot at
  `/<demoPath>/…`, redirect the slot's own `/<slug>/…` there, and rewrite
  page links to match (`resolveDemoPath` / `rewriteDemoHtml` in
  `src/utils/demo-isolation-core.mjs`). A new demo type is a `demoPath` on
  its slot plus its fictional data.
- `scripts/vercel-ignore-build.mjs` exempts `demo` from the no-PR gate, as it
  does `staging`.

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
keeper; else → dynasty. Owner alert: HMAC-signed POST from the demo deployment
to a production `/api/demo-leads` endpoint that calls `sendPushToFranchise` for
the owner (the demo deployment's push keys are scrubbed). Lead detail on an admin
page.

## Phases

- **P1 — rails, no UI.** ✅ built. `isDemoDeploy`, environment scrub, fetch guard with
  a fail-closed MFL stand-in skeleton, outbound-guard change, no elevated
  roles, `demo` branch build exemption. Guards for each.
- **P2 — salary-cap dynasty demo (TheLeague slot).** ✅ built (see Where it stands). Generator,
  wipe-and-generate build, profile overlay, `/start`, CLI
  `scripts/demo/mint-link.mjs`, demo banner (modelled on `StagingBanner.astro`),
  simulated lineup + add/drop + contracts. **Leak guard:** build a denylist from
  the real configs (franchise, owner, GroupMe names, franchise history) before
  the wipe; after `astro build`, scan the output and fail on any hit.
  Generator determinism test.
- **P3 — sales funnel.** ✅ built (see Phase 3). Questionnaire, pitch page, lead store + push relay,
  auto-issued links, admin lead page; trade/waiver/IR/taxi reducers;
  `<CustomForLeague feature=…>` tags driven by a profile list.
- **P4 — remaining types.** Best ball (bb1 slot; draft-only, cheap); keeper
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
- Build minutes: the `demo` branch builds on each push to it — push only when
  refreshing the demo (e.g. with the weekly promote).
- Inherited Preview secrets — covered by the boot scrub, which is denylist-by-
  family; a credential with a brand-new name prefix would slip through.
- Demo drifts behind main unless promoted with the weekly release.

## Open

- Build cadence for the demo project (on each weekly promote?).
- Link lifetime — 14 days assumed.
