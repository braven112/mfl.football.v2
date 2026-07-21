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
