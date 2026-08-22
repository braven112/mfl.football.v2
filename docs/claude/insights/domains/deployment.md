## 2026-03-08 - Vercel Preview Hostnames Can Be Recovered From GitHub Check Metadata

**Context:** Pushing `codex/roster-performance-refactor` and trying to benchmark the branch's Vercel preview deployment against the live site.

**Insight:** When Vercel's commit status only exposes a dashboard URL, the actual preview hostname can still be recovered from GitHub check metadata. In this repo, the `Vercel Preview Comments` check output included a `vercel.live/open-feedback/...` link whose hostname matched the preview deployment. That let us derive the preview URL even without local Vercel CLI auth.

**Evidence:** For commit `1b8f59cd12ac464da46321045e83be6977b25382`, `GET /repos/braven112/mfl.football.v2/commits/{sha}/check-runs` returned a check whose summary linked to `https://vercel.live/open-feedback/mflfootballv2-git-codex-roste-cd5785-brandons-projects-90cd4041.vercel.app?...`. Hitting that hostname directly returned `401`, confirming the deployment existed but was preview-protected.

**Recommendation:** If future work needs a branch preview URL and only the GitHub-side integrations are available:
1. Query the commit status for the Vercel dashboard link.
2. Query the commit check runs and inspect `Vercel Preview Comments` output for the preview hostname.
3. Expect preview protection to block automated benchmarking unless preview auth/bypass is available.

## 2026-03-08 - Custom Domain Routing May Not Be A Reliable Performance Benchmark Target

**Context:** Attempting a branch-preview-versus-live Lighthouse comparison for the roster page.

**Insight:** The public custom domain can be healthy at `/` while still failing on the route you want to benchmark. During this comparison attempt, `https://www.theleague.us/` returned `200`, but `https://www.theleague.us/rosters` and related variants returned `404`, even though the homepage HTML linked to `/rosters`.

**Evidence:** `curl -I https://www.theleague.us/` returned `200`, while `curl -I https://www.theleague.us/rosters` and `curl -I https://www.theleague.us/rosters?view=planner` returned `404`. The homepage HTML still contained multiple `href="/rosters"` links.

**Recommendation:** For future remote perf comparisons, prefer:
1. The actual Vercel deployment URL for `main`, or
2. A verified public route known to resolve directly,
instead of assuming the custom domain route is a valid benchmark target.

## 2026-07-07 - An Invalid Workflow File Presents As "0 Jobs / event=push / conclusion=failure"

**Context:** Debugging why Schefter went silent. The `schefter-scan.yml` scan step's `env:` map had defined `GROUPME_AFL_ROGER_BOT_ID` twice.

**Insight:** A duplicate key in a workflow-file mapping (or any YAML that fails GitHub's workflow validation) is a **startup failure**, not a runtime failure. The tells in the Actions API, when the *scheduled* workflow you're debugging never actually ran:
- `list_workflow_jobs` returns `total_count: 0` and `get_job_logs(failed_only)` finds no failed jobs — there are no logs because no job ever started.
- The run's `conclusion` is `failure` but its `event` is **`push`, not `schedule`** — when the file is invalid GitHub can't evaluate its `on:` triggers, so the cron never fires; failed startup runs only surface when a commit lands. A healthy scheduled workflow (compare `groupme-sync.yml`) shows `event: schedule`. So `event=push` on a workflow that only declares `schedule`/`workflow_dispatch` is a reliable signature that the file itself is broken.

**Evidence:** All 30 recent `schefter-scan.yml` runs: `conclusion=failure`, `event=push`, `jobs.total_count=0`. The sibling `groupme-sync.yml` (valid file) showed `event=schedule` with a real failed job whose logs carried the actual runtime error.

**Recommendation:** When a scheduled job "stopped running," first check whether it's a startup failure vs a runtime failure. If runs show 0 jobs and `event=push`, validate the YAML with a **duplicate-key-detecting** parser (Python `yaml.safe_load` silently keeps last-wins and will NOT catch this — add a custom constructor that throws on repeat keys) rather than reading job logs that don't exist.

## 2026-07-07 - A Vercel HTML 502 With No Runtime Error = A Hung `await`, Not A Crash

**Context:** The admin `POST /api/admin/schefter-announce` "send" path returned
`502 Bad Gateway` with `Content-Type: text/html` (a Cloudflare/Vercel platform
page, via `Cf-Ray`), while the sibling "preview" action on the same route
returned `200` fine. The endpoint handler was already fully wrapped in
`try/catch` returning JSON, so a JS throw was ruled out.

**Insight:** A **platform** 502 (HTML body, not your JSON) with **nothing in the
Vercel runtime logs** — `get_runtime_logs level=[error,fatal]` empty AND
`get_runtime_errors` empty — is the signature of a **hung `await` that runs into
the function `maxDuration`**, not an exception. `try/catch` cannot rescue it
because nothing ever throws; the platform kills the process and substitutes its
own error page. The tell is differential: the request variant that hangs is the
one doing an unbounded network `await` the working variant doesn't.
- Here, `preview` did pure computation; `send` added `checkRateLimit` (an
  Upstash Redis call with **no timeout**) and a GitHub `fetch` guarded only by
  `AbortSignal.timeout`. `AbortSignal` aborts the *request* but does not always
  interrupt a socket stuck in connect/TLS, so a hang can still outlive it.

**Recommendation:** For any serverless handler that makes outbound calls, bound
**every** `await` with a hard external race (`Promise.race([p, timeout])`), not
just `AbortSignal` — cap each well under `maxDuration` (astro.config's Vercel
adapter sets it to 30s globally) so the handler always returns a JSON error
instead of a platform 502. Make non-critical calls (rate-limit) fail open on
timeout. Add breadcrumb `console.log`s around each step and `console.error` in
the catch — a hang leaves no error otherwise, so the breadcrumbs are how you
learn which `await` stalled. To diagnose live, use the Vercel MCP
(`get_runtime_logs` / `get_runtime_errors`) filtered to the route; "no logs
found" is itself the diagnosis (timeout, not throw).

## 2026-07-07 - Return Handled Errors As 200+`{ok:false}` — The Edge Eats Origin 5xx

**Context:** Same admin `POST /api/admin/schefter-announce` send path. After
bounding the awaits (previous insight), the breadcrumb logs showed the real
failure: `dispatch response 401` — the GitHub `workflow_dispatch` was rejected
because `GH_PAT` had expired. The endpoint returned that as HTTP **502** with a
JSON body + actionable `hint`. But the browser STILL saw a bare `text/html`
`502 Bad Gateway` (via `Cf-Ray`) — the JSON never arrived.

**Insight:** When the origin sits behind Cloudflare (and/or Vercel), a **5xx**
status returned by your function can be **replaced by the platform's own HTML
error page**, discarding your JSON body. So a carefully-crafted `return json({
error, hint }, 502)` is useless — the client sees the platform's page, not your
message. This is why a "resilient, always-returns-JSON" handler can still
present as an opaque 502 in the browser: the status code, not the body, decides
whether the edge intercepts it.

**Recommendation:** For **operational** failures you want the client to read
(upstream API rejected you, dependency misconfigured, unhandled catch), return
**HTTP 200 with `{ ok: false, error, hint, ... }`** instead of a 5xx, and have
the client branch on `data.ok === false` (not just `res.ok`). Reserve real 4xx
for client-fixable input (`400` validation, `403` forbidden, `429` rate-limit —
these pass through the edge fine). Distinguish upstream auth failures in the
hint: GitHub **401** = the token itself is bad (expired/revoked); **403/404** =
valid token, missing permission/scope. (Here: `GH_PAT` expired ~2026-03-21 —
the last successful Vercel-cron→`roster-sync.yml` dispatch — so every
Vercel→Actions bridge using it had been silently dead for months.)

## 2026-07-08 - SSR Pages That `import.meta.glob(..., {eager:true})` Bloat The 250MB Function

**Context:** New `/afl-fantasy/players.astro` shipped as SSR
(`prerender = false`, mirroring the other AFL pages) and eager-globbed every
year of AFL feeds — `data/afl-fantasy/mfl-feeds/*/players.json` (~24MB across
24 years) plus `weekly-results-raw.json` (~38MB). The build **succeeded** but
the Vercel deploy **errored** with: *The Vercel Function "_render" is 256.09mb
uncompressed which exceeds the maximum uncompressed size limit of 250mb.* This
is easy to miss — the build log says `Complete!`; only the post-build "Deploying
outputs" step fails, and the deployment sits in state `ERROR` while the branch's
old server keeps serving (looks like a stale/caching issue, but it's a failed
deploy).

**Insight:** With `output: 'server'`, a page is on-demand (SSR) unless it exports
`prerender = true`. Everything an SSR page imports — including all files matched
by an eager `import.meta.glob` — is bundled into the single shared `_render`
serverless function. Historical data feeds multiply fast (per-year JSON × 24
years) and the whole repo already runs near the 250MB ceiling, so one new SSR
page that globs multi-year feeds can tip it over. `du -sh
.vercel/output/functions/_render.func` after `pnpm build:apps` reproduces the
size locally (local measured ~7MB higher than Vercel's number, so leave margin).
Note dynamic `fs`/`readFileSync` paths (e.g. draft-predictor reading
`weekly-results-raw.json` by year) get traced in for **all** years too, since
nft can't resolve the dynamic segment.

**Recommendation:** Do NOT reflexively reach for `prerender = true` on a
league-prefixed page — it trades a size problem for a routing outage. Prerendered
pages run their globs at build time (data never enters the function), BUT a
prerendered page under a league prefix is emitted as a static CDN file with no
SSR route, so the apex-domain middleware rewrite (`context.rewrite`,
`www.afl-fantasy.com/players` → `/afl-fantasy/players`) can't resolve to it and
404s to the default (TheLeague) 404 page. That is exactly what happened: the AFL
Free Agents page was prerendered to dodge the 256MB deploy, which silently broke
`afl-fantasy.com/players` on the apex domain (2026-07-08).

The durable fix for a browse page that globs multi-year feeds is **keep it SSR
and move the multi-year read into a build-time compute script** that emits ONE
small derived JSON, which the page imports. Node `fs` reads inside a
`scripts/compute-*.mjs` run at build are NOT traced into the serverless function,
so 24 years of feeds stay out of `_render` while the page stays server-rendered
(apex routing works). Pattern: `scripts/compute-afl-free-agents.mjs` →
`data/afl-fantasy/derived/free-agents.json`, imported by
`src/pages/afl-fantasy/players.astro`; wired into `scripts/prebuild.mjs` +
`package.json` `compute:afl-free-agents`, regenerated every deploy. Measured
impact: the page contributes ~0.4MB (the derived file) to `_render` instead of
~15MB of eager globs — so the SSR fix is deploy-neutral (315MB vs the 314MB
prerendered baseline) rather than the +15MB a naive SSR revert would add.

**Addendum (2026-08-09, keeper-report-card):** hit the same wall again
(260.74MB) with bare `*/` globs on `keeper-analysis.astro`. When a page only
ever needs a bounded year range, a **year-filtered glob pattern** is a lighter
fix than a compute script: `import.meta.glob('.../mfl-feeds/20{2[4-9],[3-9][0-9]}/rosters.json')`
matches 2024–2099 (Vite globs are micromatch — brace + character-class syntax
works), cutting ~55MB of pre-era JSON to ~7MB with zero build steps. Use the
compute-script pattern when the page genuinely folds ALL years; use the
year-range glob when old years are unrenderable by design. Diagnosis shortcut:
deployment state `ERROR` with a green build → check the Vercel build log's
"Deploying outputs..." tail (`mcp__Vercel__get_deployment_build_logs`).

Note the shared `_render` function is already ~314MB locally (near the ceiling)
before this page, driven by OTHER pages' dynamic `fs.readFileSync(join(cwd, …,
year, …))` reads that nft can't resolve and so traces for all 24 years (e.g.
`afl-fantasy/draft-predictor.astro` reading `weekly-results-raw.json`). Local
`du` runs a touch higher than Vercel's measured number, but if you need real
headroom, the highest-leverage cut is converting those dynamic per-year `fs`
reads to build-time derived snapshots too. `/theleague/players` stays SSR anyway
because it gates admin columns on `getAuthUser`.

## 2026-07-13 - `actionlint` Binary Downloads Are Blocked By The Session Proxy For Unregistered Repos

**Context:** Phase 5 workflow refactor (extracting composite actions under
`.github/actions/`) needed to validate 20 edited workflow YAML files. The task
called for `actionlint` first, falling back to YAML-parse + manual diff review
if unavailable.

**Insight:** `pnpm dlx actionlint` fails (`ERR_PNPM_DLX_NO_BIN` — there's no
npm package, only the Go module/binary). The official
`download-actionlint.bash` script and a direct `curl` of the GitHub Releases
asset (`github.com/rhysd/actionlint/releases/download/...`) both fail too —
not a network error, but a `403` JSON body: `"GitHub access to this repository
is not enabled for this session. Use add_repo to request access."` The agent
proxy's GitHub allowlist is scoped to repos explicitly added to the session
(`add_repo`), and applies even to anonymous public-release-asset downloads,
not just git clones/API calls against private repos.

**Recommendation:** Don't burn time retrying `curl`/`wget` variants against
`github.com` for a tool that isn't part of the working repo's own remotes —
it's a session-scope block, not a transient network issue. Either
`add_repo(owner, repo)` for the tool's repo first (if it's worth the session
overhead) or go straight to the documented fallback: `python3 -c
"import yaml; yaml.safe_load(open(f))"` (or `js-yaml` in Node) over every
changed workflow/action file, **plus** a manual line-by-line diff read —
`yaml.safe_load` won't catch GitHub Actions-specific mistakes (e.g. a step
missing a required composite-action input, `uses:` typos, duplicate keys
under `permissive` PyYAML defaults) so pair it with an explicit check that
every `uses: ./.github/actions/foo` call supplies that action's `required:
true` inputs (cross-reference against the action's own `action.yml`).

## 2026-07-13 - Composite Actions Can't Contain `actions/checkout`; Some Workflows Skip `pnpm install` On Purpose

**Context:** Same Phase 5 refactor — consolidating the pnpm/Node/install
preamble duplicated across ~20 workflow files into one composite action.

**Insight:** Two things worth knowing before doing this refactor again:
1. `actions/checkout` cannot run from inside a `uses: composite` action (it
   needs to operate on the runner's checkout of the *calling* workflow before
   the composite's steps execute) — so checkout has to stay a normal step in
   every caller, immediately before `uses: ./.github/actions/setup`. This
   isn't a soft convention, it's a hard limitation of composite actions.
2. Not every workflow that runs `node scripts/*.mjs` actually installs
   dependencies first. `apply-pending-contracts.yml`, `schefter-announce.yml`,
   `schefter-articles.yml`, and `schefter-scan.yml` call `actions/setup-node`
   with **no** `pnpm/action-setup` and **no** install step at all — those
   scripts apparently only touch built-in Node modules. Separately,
   `schefter-rumor-scan.yml` and `schefter-trade-speculation.yml` install via
   `npm ci --omit=dev --ignore-scripts || npm install --omit=dev
   --ignore-scripts` instead of pnpm. Both are genuine, deliberate deviations
   from the "standard" preamble, not copy-paste drift — folding them into a
   pnpm-flavored composite action would add an install step (or swap package
   managers) that wasn't there before and could change behavior/CI minutes
   for reasons unrelated to the refactor.

**Recommendation:** Before consolidating a CI preamble across many workflows,
diff the *exact* step sequence per file rather than assuming they're all the
same because the job names match — grep for `actions/setup-node` across
`.github/workflows/*.yml` and check what precedes/follows each hit. Files
missing `pnpm/action-setup` or using `npm` instead are signals of intentional
divergence; leave them out of the composite and note why, rather than
"fixing" them to match the majority pattern.

## 2026-07-21 - The Vercel Adapter's Fallback Route Forces `status: 404` Onto Every Clean Apex URL

**Context:** Schefter's GroupMe tip link (`afl-fantasy.com/schefter/tip?target=0014`)
dead-ended for every logged-out owner. Runtime logs showed the smoking gun:
`GET /rosters 404` entries whose attached render logs proved the full rosters
page had rendered (roster cache fills, trade-bait fetches) — correct body,
wrong status. Clean apex URLs match no explicit route in
`.vercel/output/config.json`, so they fall through to the adapter-generated
fallback `{"src": "^/.*$", "dest": "_render", "status": 404}`, and that
route-level `status` **overrides whatever the function returns**. Astro's
`context.rewrite()` sets `this.status = 200` internally, so the middleware
host-rewrite was blameless — Vercel's edge stamped 404 on the way out.

**Insight:** A route-level `status` in the Build Output config wins over the
lambda's response status. Pages "worked" for browsing because browsers render
404 bodies, so the whole site ran on 404s invisibly (and un-SEO-ably) for
weeks. The failure only became user-visible where the response had no body to
fall back on: `Astro.redirect()` (302 + Location + empty body) clobbered to
404 = dead page. If a redirect-on-load page 404s on the apex domain but works
league-prefixed, check which Vercel route the path actually matches before
debugging the middleware.

**Recommendation:** Keep `src/pages/[...path].astro` (root catch-all,
`prerender = false`). Its presence puts a real `^(?:/(.*?))?/?$` route with no
forced status into the manifest ahead of the fallback, so middleware-rewritten
pages keep their true 200/302, and genuinely unknown paths render the styled
404 page with an explicit `Astro.response.status = 404`. `tests/root-catch-all.test.ts`
locks this contract — don't delete the page or flip it to prerender (a
prerendered catch-all leaves the SSR manifest and resurrects the bug). To
verify after routing changes: `pnpm build`, then confirm the spread route
precedes the `status: 404` fallback in `.vercel/output/config.json`.

## 2026-08-10 - Cloudflare Fronts the Apex Domains and Browser-Caches 404s (Root of "Fixes That Don't Take")

**Context:** The recurring "missing team images" bug — broken NFL logo icons on roster/player pages that kept coming back despite repeated fixes.

**Insight:** `www.afl-fantasy.com` / `www.theleague.us` are Cloudflare-proxied in front of Vercel. Cloudflare's Browser Cache TTL setting was overriding Vercel's `cache-control: max-age=0, must-revalidate` with `max-age=14400` — on ALL responses, including 404s. So one broken deploy window poisoned every visitor's browser cache for up to 4 hours *after* the origin was fixed, making each fix look like it failed. A missing static asset also doesn't get a plain 404: the SSR catch-all returns a ~100KB HTML page (which renders as the broken-image icon inside an `<img>`). Fixed 2026-08-10 by Brandon setting Browser Cache TTL → "Respect Existing Headers"; verified 200s and 404s now pass through `max-age=0`.

**Evidence:** Same asset fetched two ways minutes apart: via `*.vercel.app` → `cache-control: public, max-age=0, must-revalidate`; via the apex → `server: cloudflare`, `cache-control: public, max-age=14400, must-revalidate`. A probe of a nonexistent logo path returned a 404 HTML page with the same 4h header.

**Recommendation:** When a "fixed" asset bug keeps reappearing on phones, suspect client-side 404 caching before suspecting the fix. Diagnose with `mcp__Vercel__web_fetch_vercel_url` — the sandbox egress proxy blocks both the apex domains and `*.vercel.app` for curl/WebFetch, but the Vercel MCP fetch tool reaches both and returns full headers (`cf-cache-status`, `x-vercel-cache`, `age`). Compare apex vs `mflfootballv2-git-main-...vercel.app` responses to isolate Cloudflare's contribution. Page HTML fetches through Cloudflare hit a bot challenge; asset fetches don't.

## 2026-08-10 - Git History Was Squashed on 2026-08-08; Archaeology Bottoms Out at d4f32d9

**Context:** Tracing when `public/assets/nfl-logos/*.svg` entered the repo to explain why production 404'd them.

**Insight:** The repo's history begins at `d4f32d9` (2026-08-08, authored "Schefter Bot") — a root commit that adds every file at once. `git log --follow`, `--diff-filter=A`, and `-S` searches all bottom out there and will misattribute long-existing code to that commit. Anything that "first appears" in d4f32d9 may be years old. Corollary discovered the same day: assets referenced by code but living only in local working trees (never committed) shipped as production 404s for weeks — `tests/nfl-logo-assets.test.ts` now guards the logo case by scanning every committed players feed for team codes and requiring a committed SVG for each.

**Recommendation:** Don't date features by first-commit in this repo; treat d4f32d9 as an event horizon. For "does production have file X" questions, check `git ls-files` (tracked ≠ exists locally) and probe the deployed URL — not the working tree.

## 2026-08-14 - The Apex-Prefix Strip Is a Producer Problem, Not Just a Router One

**Context:** Every owner-facing link Roger and Schefter posted to GroupMe read
`theleague.us/theleague/calendar` / `afl-fantasy.com/afl-fantasy/news`. Six
independent producers had each hand-rolled the same concatenation —
`` `${leagueOrigin(reg)}${post.link}` ``, `` `${league.baseUrl}${link}` ``,
`` `${PUBLIC_BASE_URL}${path}` ``, plus two hardcoded strings in the
August-cut touches and a prefixed `newsPath` in the announce targets.

**Insight:** The prefix duplication is invisible to every test that checks
"does the link work," because vercel.json 301s `/theleague/:path*` → `/:path*`
on the apex hosts. It only shows up by *reading* the posted message. That is
why it survived: the routing layer (middleware rewrite + 301) was built and
tested to make both forms resolve, which quietly removed the pressure on
producers to emit the right one. Two forms of the same URL are both correct to
the router and only one is correct to a human.

The asymmetry that makes this subtle: internal routes MUST stay prefixed in
stored data (`post.link`) — the Schefter cards render `post.link` raw, and an
unprefixed path 404s on the shared host (verified locally: `/schefter/tip` →
404, `/theleague/schefter/tip` → 302). Only the *absolute* form gets stripped.
So "just store the clean path" is the wrong fix and creates the inverse bug —
which the feed's tip link already has today.

Same class of bug as the `domains[0]` vs `leagueOrigin` cookie-safety rule, and
they travel together: a file that hand-built one usually hand-built the other.
`scripts/lib/schefter-leagues.mjs` had both (bare-apex `baseUrl` AND prefixed
concatenation).

**Recommendation:** `leagueUrl(league, path)` in `leagues-data.mjs` is the only
sanctioned builder — it strips the league's OWN slug (never a cross-league one:
`/afl-fantasy/*` inside a TheLeague post must keep its prefix to resolve) and
pins the canonical www host. Path-only leagues (no apex domain) fall back to
`SHARED_APP_ORIGIN` and KEEP their prefix. Where a base URL is env-overridable
(`SCHEFTER_PUBLIC_BASE_URL` for preview deploys), strip ONLY when the base is
this league's apex — a preview host needs the prefix. `tests/league-url-prefix.test.ts`
guards it by running the real builders and asserting no `<domain>/<slug>` pair
appears; a source-grep-only guard would have missed the hardcoded strings.
When auditing this class, grep for the *shape* (`}${post.link}`, `}${path}`,
`}${link}`) rather than for any one domain literal — five of the six sites had
no domain literal in them at all.

## 2026-08-16 - A Middleware `context.redirect()` Is In The Same 404-Fallback Blast Radius As A Page Redirect

**Context:** Adding a middleware 302 that trims a trailing `.` off a request
path (`/theleague/rosters.` → `/theleague/rosters`), to rescue chat links whose
autolinker swallowed the sentence's period.

**Insight:** The 2026-07-21 entry above is written around page-level
`Astro.redirect()`, which reads as a page concern — but the failure mode is
about the *response shape*, not where it came from. A middleware redirect
returned before `next()` is also a 3xx with an empty body, so it is exactly as
vulnerable to a route-level `status: 404` overriding it, and exactly as
invisible when it happens (dead page, no body to fall back on). Any unmatched
path — which is precisely what a punctuation-suffixed URL is — depends on
`src/pages/[...path].astro` putting a no-forced-status spread route ahead of
the adapter fallback.

**Evidence:** After `pnpm build`, `.vercel/output/config.json` has 208 routes:
206 is `{"src":"^(?:/(.*?))?/?$","dest":"_render"}` (no status) and 207 is
`{"src":"^/.*$","dest":"_render","status":404}`. 206 matching first is the only
reason the 302 survives.

**Recommendation:** Treat "does my 3xx keep its status" as a build-output
question, not a middleware question. After any routing or middleware change
that can emit a redirect on an unmatched path, re-run `pnpm build` and confirm
the spread route still precedes the `status: 404` fallback.

## 2026-08-16 - Localhost Dev Silently Rewrites The Requests You Need To Test Middleware With

**Context:** Trying to verify an open-redirect guard and apex-host behavior for
a new middleware path-normalization redirect.

**Insight:** Three layers rewrite the request before your middleware sees it,
and all three fail open — you get a plausible-looking pass that proves nothing.
(1) Vite's dev stack collapses `//` in the path, so `//evil.com.` arrives as
`/evil.com.` and a protocol-relative guard never fires; the `Location` you
observe is an already-safe `/evil.com`. (2) `curl` also normalizes `//` unless
given `--path-as-is`. (3) `curl -H 'Host: www.theleague.us'` is rejected with
403 by Vite's `allowedHosts`, so apex-host middleware behavior is not
reachable on localhost dev at all. Related parsing trap: `new URL('//x.', base)
.pathname` is `'/'` — the `//` is read as an authority — so a unit test that
round-trips through `new URL` loses the very input it meant to assert on.

**Recommendation:** Unit-test path helpers on raw strings, not on `new URL`
output. Use `--path-as-is` for any curl that carries an unusual path. Treat a
clean localhost run as evidence about the happy path only, and verify
host-dependent or normalization-dependent behavior on a Vercel preview.

## 2026-08-16 - The Vercel Function Ships `data/` Twice, And One Copy Is The Whole Tree

**Context:** Every deploy on a branch failed with "The Vercel Function
`_render` is 254.49mb uncompressed which exceeds the maximum uncompressed size
limit of 250mb". The branch added ~3.9 MB of recovered AFL schedules, so the
obvious read was "this PR is too big" — and the obvious fixes (minify the
committed JSON, trim the new data) were both wrong.

**Insight:** A local `pnpm exec astro build` and `du -sh
.vercel/output/functions/_render.func` is the only way to see this, and it told
a different story: 262 MB, of which **165 MB was a raw copy of `data/`** sitting
on top of the 78 MB `dist/` bundle that already contained the same JSON
compiled into chunks. The data shipped twice, and `main` was itself at ~250 MB
— one cron feed sync from breaking production deploys on its own.

The raw copy exists because Vercel traces files with `@vercel/nft`, and several
utils read feeds through paths it cannot resolve statically —
`join(process.cwd(), dataPath, 'mfl-feeds', String(year))`, and a `readdirSync`
of a `process.cwd()` directory. nft's fallback for an unresolvable path is to
include the whole directory, so twenty years of archived feeds rode along on
every request. Two things follow that are easy to get backwards:

- **Removing one unresolvable read does not help.** There were a dozen. The
  function stayed at 263 MB after the `readdirSync` was gone.
- **`import.meta.glob` feeds are NOT what needs the raw copy.** A glob compiles
  the JSON into `dist/server/chunks/` at build time, so excluding the raw file
  cannot affect a globbed page. Only the `fs` readers need `data/` on disk —
  and every one of them reads the current or prior season
  (`rosters.astro`'s `feedYears` is `[leagueYear, seasonYear]`, `schefter-og`
  tries `[year, year - 1]`, live-scoring scans newest-first and stops at the
  first complete season). Historical seasons were being shipped for nobody.

Grepping for "is this filename referenced in `src/`" is the wrong test — it
cannot tell a glob reference from an `fs` reference, and it only found 13 MB.
The right question is which *`fs` readers* need which *years*.

**Recommendation:** The adapter's `excludeFiles` (`@astrojs/vercel` v11) takes
explicit paths — no globs — so generate the list at config time from what's on
disk rather than pinning years, and it needs no maintenance at either league's
rollover. `scripts/lib/archived-feed-files.mjs` keeps the newest three seasons
per league and drops the rest: 263 MB → **152 MB**. Keep *three*, not two — a
new year's directory is created at rollover before it holds real data, and with
a two-season window that stub would evict a season `schefter-og` still reads.

Two related lessons. **Check the right check**: this branch was reported green
for several rounds because "Vercel Preview Comments" (a different check that
does pass) was being read instead of the "Vercel" commit status. And **treat
immutable history as a build artifact**: `getGlobalPlayerMap()` was unioning 32
seasons of `players.json` — 23.5 MB of I/O per cold start — to produce a 3,794
row table that cannot change, now precomputed to 0.37 MB by
`scripts/compute-player-identity-union.mjs`.

## 2026-08-20 - A Drift Audit That Rewrites a Timestamp Can Never Pass — And a Permanently-Red Alarm Hides the Drift It Watches For

**Context:** `.github/workflows/roger-date-audit.yml` runs daily to catch the
NFL Draft date drifting away from what's committed. Its detection method is:
re-run `scripts/fetch-nfl-draft-date.mjs`, then fail if
`git status --porcelain src/data/theleague/nfl-draft-dates-fetched.json`
is non-empty.

**Insight:** The script wrote `_fetchedAt: new Date().toISOString()`
unconditionally on every run — including the "nothing changed" path, which
re-bumped it deliberately with the comment *"Still bump the timestamp so CI
logs show the run happened."* That makes the output file different on every
single run, so the porcelain check is **always** dirty and the audit's pass
condition is unsatisfiable. It had been failing daily regardless of drift.

The second-order damage is the real lesson. The audit existed specifically to
catch a missing/incorrect draft year, and a genuinely missing 2027 date sat
behind it unnoticed for months — because a real signal was indistinguishable
from the daily false alarm. An alarm that always fires is worse than no alarm:
no alarm at least leaves you knowing you are unmonitored.

**Evidence:** Two consecutive runs with no upstream change produced a diff of
exactly one line (`_fetchedAt`). `dates` was `{}` in the committed file while
ESPN had been answering `2027-04-29` the whole time.

**Recommendation:** Any check of the form "regenerate the artifact and fail if
git says it changed" requires the generator to be **byte-deterministic** for
unchanged inputs. Keep timestamps, run IDs, and ordering out of the artifact,
or exclude them from the comparison. `_fetchedAt` now means "when a date last
changed" and is preserved when nothing did; the run is still evidenced by
stdout in the Actions log, which is where that belongs.

Corollary worth applying beyond this workflow: when a monitor has been red for
a long time, treat "why is it red" as a real question before adding another
monitor. A check nobody can act on is a check nobody reads.

## 2026-08-22 - In The Cloud Sandbox, Node's `fetch` Ignores `HTTPS_PROXY` — The Dev Server Renders With Every External Feed Empty

**Context:** Verifying a Set Lineup styling change by driving the local dev server with Playwright. The page rendered, but not one player row showed a matchup line — no `vs`/`@`, no opponent crest, on any week.

**Insight:** The failure looked like "there's no schedule data for the offseason," and that reading is wrong. Claude Code's remote sandbox routes outbound HTTPS through a proxy at `HTTPS_PROXY`, and **Node's built-in `fetch` (undici) does not read that variable** — so every server-side `fetch` in an SSR page silently fails and every `.catch(() => null)` fallback quietly returns nothing. `curl` works fine from the same shell (it honors the proxy), which makes the endpoint look reachable while the app can't reach it. Nothing errors: `lineup.astro`'s `loadLiveOdds()` swallows the failure, `schedule` comes back `[]`, and every matchup line just isn't rendered.

**Evidence:** `curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=10&seasontype=2"` → `200`, 14 events. The same URL fetched by the dev server → nothing; the rendered page contained 0 `lineup-slot__opp-logo` elements (the 2 matches in the HTML were the CSS rule text, not markup). Restarting the server as `NODE_USE_ENV_PROXY=1 pnpm dev` → 9 slots and 9 bench rows with real week-10 opponents.

**Recommendation:** Start the dev server with `NODE_USE_ENV_PROXY=1` (requires Node ≥ 22.21; this repo runs 22.22) whenever a page you're verifying does server-side fetches — MFL, ESPN odds, weather. Before concluding "there's no data for this week," grep the rendered HTML for the markup class and confirm you're counting elements rather than CSS. `/root/.ccr/README.md` lists the same accommodation for other clients that skip the proxy (aiohttp, Ruby bundler, hand-rolled Go dialers).

## 2026-08-22 - `public/assets/nfl-logos/dark/` Is Prebuild Output And Is Empty In A Fresh Clone

**Context:** Screenshotting a dark-mode change to the lineup rows. Every NFL crest rendered as a flat colored block instead of a logo.

**Insight:** The dark-mode logo swap is a CSS `content: url(...)` keyed on the light `src` (`nfl-logo-dark-css.ts`), and it points at `/assets/nfl-logos/dark/{CODE}.png` for any team listed in `src/data/nfl-dark-logos-manifest.json`. Both the directory and the manifest are generated by `scripts/fetch-nfl-dark-logos.mjs` at prebuild — **a fresh clone has an empty directory and `{"codes": []}`**, so every team falls through to the ESPN CDN URL, which a sandboxed Chromium (no proxy) cannot reach. `content: url()` has no error fallback, so the result is a broken-image block, not the light logo. This is indistinguishable from "the change I just made broke the logos."

**Evidence:** Fresh clone: `ls public/assets/nfl-logos/dark/ | wc -l` → `0`, manifest `{"codes": []}`. After `NODE_USE_ENV_PROXY=1 node scripts/fetch-nfl-dark-logos.mjs` → `32 fetched, 0 failed`, and the same screenshot rendered real Raiders/Jets/Commanders crests.

**Recommendation:** Run `scripts/fetch-nfl-dark-logos.mjs` before any dark-mode screenshot that includes NFL logos, then **revert the generated directory and manifest before committing** — they're prebuild artifacts and the manifest is tracked, so leaving them staged puts 32 binaries and a churned JSON file in the diff.
