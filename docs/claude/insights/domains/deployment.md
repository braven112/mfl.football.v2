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

**Recommendation:** If a page has no per-request logic (no `getAuthUser`, cookies,
or `Astro.url.searchParams`), make it `prerender = true`. Prerendered pages run
their globs at **build time** and their data never enters the function — the page
becomes a static snapshot that refreshes on every deploy (this repo redeploys
hourly on cron data-sync commits, so freshness is fine for browse/research
pages). This is why `/theleague/players` stays SSR (it gates admin columns on
`getAuthUser`) but the cap-free AFL sibling can prerender. Caveat: apex-domain
league-prefix routing is middleware-based (`context.rewrite`), which doesn't run
for statically-served routes the same way — verify apex behavior when
prerendering a league-prefixed page.
