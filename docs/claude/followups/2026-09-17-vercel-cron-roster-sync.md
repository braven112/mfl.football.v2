---
slug: vercel-cron-roster-sync
status: closed
severity: P1
opened: 2026-09-17
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1146
hotfix_sha: 2695ec2
followup_issue: 1147
followup_pr:
followup_session:
---

# Follow-up: the site stopped keeping up with the league, and the cron bridge was open

## What broke

Two things with one root.

**Freshness.** On 2026-09-16 TheLeague sat a full hour past the Wed 19:00 PT
waiver run still serving pre-waiver rosters. The page code was never wrong —
`resolveWaiverWindow` flips to `PROCESSED.` at 02:00Z on the calendar's own
`WAIVER_BBID`, verified at three timestamps before anything was edited. What
was missing was a **deploy**: the last roster sync landed at 18:20 PT, forty
minutes *before* waivers, and the next was hours out.

GitHub had been dropping this repo's scheduled events in bulk since
**2026-08-27** — a cliff, not a drift. Measured over 300 `roster-sync.yml`
runs: through 08-26 a 21–47 min median and 23–51 runs/day; from 08-27 a 2–5
**hour** median and 5–8 runs/day, against the 288 a five-minute cron requests.

**Security.** `src/pages/api/cron/roster-sync.ts` compared the bearer token
against a template literal holding `process.env.CRON_SECRET`. Unset, that
evaluates to the literal string `"Bearer undefined"`, which anyone could send —
on a route that dispatches a workflow committing to `main` with Actions
secrets. `CRON_SECRET` was in fact flagged as needing attention on Vercel at
the time, so this was live, not theoretical.

## What the hotfix did

A forward fix, not a revert — nothing regressed, a mechanism had been missing
for six months.

- `vercel.json` — restored the `crons` entry at 15 minutes.
- `.github/workflows/roster-sync.yml` — the GitHub `schedule` becomes the
  offset fallback it originally was, `7,37 * * * *`.
- `src/pages/api/cron/roster-sync.ts` — reads the secret into a local and
  returns 503 when falsy, matching `api/cron/push-fanout.ts` and
  `api/groupme/sync.ts`, which both already did this.
- `tests/vercel-cron-targets.test.ts` — new guard, both directions.
- `docs/claude/rules/storage-and-build.md` + `CLAUDE.md` — the rule and router
  line; `.claude/hooks/path-guard.json` routes the new guard.

**Verified in production:** the cron fired on its own at 05:30:40Z, forty
seconds after the tick, as `workflow_dispatch`, and the run succeeded. The
whole chain — Vercel cron → `CRON_SECRET` gate → `GH_PAT` → dispatch — works.

## Deferred items

- [x] **F1 — The 15-minute cadence has no spend ceiling** — done in #1155
      (`92d41d9`). Not the way this item assumed: a night of real data showed
      the flat cadence committing on ~every dispatch (43 commits from 42), so
      "well under 96" was wrong. The cadence is tiered in
      `src/utils/sync-cadence.ts` instead — 5 min for two hours after a waiver
      run, 15 during a game, 60 otherwise. Measured against the real feeds:
      35 dispatches/day in season, 24 in the offseason.
  - Source: Claude review, `/code-review` on PR #1146
  - Where: `vercel.json:5`
  - Why deferred: a spend judgement, not a defect, and a one-character dial.
    Shipping the freshness fix should not wait on a cost decision.
  - Detail: the PR text justified "deliberately not `*/5`" by measuring against
    288/day — a rate GitHub never actually delivered. Against the real 5–8/day
    baseline, 96 dispatches/day is a large increase, and **every sync commit to
    `main` is a production build**, which is 91% of the Vercel bill. Only runs
    where data actually changed commit (`--refresh-live` plus skip-if-unchanged
    writes), so the real build count is well under 96 — heavy on Sundays, near
    zero overnight — but nobody has measured it. **Check the Vercel build-minute
    trend about a week after 2026-09-17** and decide. `*/30` halves it and still
    caps staleness at 30 min against the hours we had. A smarter split is
    possible: Vercel accepts multiple `crons` entries on the same path, so
    tight during game windows and loose otherwise is expressible.

- [x] **F2 — `schefter-scan` and `groupme-sync` are still on the dropped schedule**
      — done. Both now ride the bridge: `/api/cron/schefter-scan` on the same
      tiers as the roster sync (it commits, so every dispatch is a build), and
      `/api/cron/groupme-sync` on every tick (it commits nothing, so there is
      no spend to ration). Both workflows lost their `schedule:`; `schefter-scan`
      also moved to `cancel-in-progress: false`, because it posts to GroupMe and
      pushes to devices BEFORE committing the watermark that records it, so a
      cancel in between re-sends rather than merely losing a run. One correction
      to the note below: **`groupme-sync` does not carry the deadline reminders**
      — `scanEventReminders` lives in `scripts/schefter-scan.mjs`, so the
      owner-facing urgency belongs to the scan. `groupme-sync` only mirrors the
      chat into Redis.
      
      A second defect surfaced while measuring it: `schefter-scan` committed on
      EVERY run, because `resolved-events.json` (`computedAt`) and
      `groupme-suppressions.json` (`generatedAt`) were rewritten with a plain
      write each time. Both go through `writeJsonIfChanged` now, so a scan that
      found nothing leaves the tree byte-identical. Guard:
      `tests/cron-commit-churn.test.ts`. Without it, tiering the scan would have
      rationed a cost the job paid on every tick anyway.
  - Source: deferred at implementation
  - Where: `.github/workflows/schefter-scan.yml:5` (`*/15`),
    `.github/workflows/groupme-sync.yml:5` (`*/5`)
  - Why deferred: the hotfix fixed the symptom that was reported. Each extra
    bridge is more production builds, so it inherits F1's spend question and
    should be decided with it.
  - Detail: both degraded on the same 2026-08-27 cliff — `schefter-scan` was
    measured at 01:10, 22:52, 19:59, 16:58, 12:07, 06:36, i.e. the same 2–5 hour
    gaps. **`groupme-sync` is the one with real owner-facing consequences: it
    carries Roger's deadline reminders**, which are push-first and time-critical
    (`docs/claude/rules/roger.md`). A reminder that fires hours late is worse
    than a roster that updates late. The bridge pattern is now proven; adding
    one is a `crons` entry plus a route, and `tests/vercel-cron-targets.test.ts`
    already generalises over the `crons` array — add the route to
    `SCHEDULED_BRIDGES` and the orphan check covers it for free.

- [x] **F3 — The "no cron step inside a block comment" rule has no guard test**
      — done in #1155: `tests/block-comment-terminators.test.ts`. It earned its
      place immediately; the trap bit three times in one session, twice in files
      about cron cadence and once in the file documenting the rule.
  - Source: deferred at implementation
  - Where: `docs/claude/rules/storage-and-build.md` (the bullet added by this
    hotfix), `src/pages/api/cron/roster-sync.ts:8`
  - Why deferred: `astro check` already catches it, so this is a
    time-to-detection improvement rather than a correctness gap.
  - Detail: a cron step expression contains the two characters that close a
    block comment. Writing one into this route's JSDoc silently terminated the
    comment and handed the remaining prose to the compiler — **39 type errors in
    one file**, invisible to `pnpm test:unit` (which does not type-check) and to
    all 12,115 tests (nothing imports an API route). Cost a full CI cycle
    mid-hotfix. A scan asserting balanced block-comment markers across `src/`
    and `tests/` would catch it at edit time via path-guard instead. Judge
    whether that is worth a suite — `/guard-test` would write it.

## Context to start cold

**What was ruled out, so you don't redo it.** The page code was checked first
and is correct — don't go looking there. The GitHub throttling is not billing
(the repo is **public**, so Actions is free and unmetered), not a concurrency
cancellation (every conclusion was `success`, run numbers consecutive), and not
caused by anything in the repo (every commit touching `.github/workflows` from
Aug 10 – Sep 1 was read; the Aug 27 commit is owner names, Aug 28 is Storybook).
Push-triggered runs were never affected, so it is specifically the `schedule`
event being dropped.

**Why the bridge was dead.** It shipped 2026-03-21 (`6b0142f`) *with* its
`crons` entry, and `4179e14` removed the entry eleven hours later with the
message "unreliable on Hobby plan", leaving the route. That reason expired when
the account moved to **Vercel Pro**, which supports minute-granularity crons;
Hobby is daily-only and hour-accurate, which is exactly why it looked broken in
March. Nothing failed in between because nothing called it — and
`api/cron/push-fanout.ts` and `api/admin/schefter-announce.ts` both cite it in
their comments as the bridge shape to copy, so it read as live infrastructure
for six months.

**The mechanism that makes staleness an outage rather than a lag.** The
committed MFL feeds are pulled in with `import.meta.glob(..., { eager: true })`,
so they are baked at build time even though the pages are SSR
(`prerender = false`). A sync commit to `main` is what redeploys production.
No sync run → no commit → no deploy → the page cannot move. Any future "the
site is showing stale data" triage should start at *when did main last get a
sync commit*, not at the page.

**Three regressions the branch itself introduced**, all caught in review and
fixed before merge — worth knowing because they are the same shape any future
cadence change will hit. Changing the cadence changed assumptions in code sized
for a five-minute schedule: a `*/30` fallback whose slots were a strict subset
of the primary's (and which, through `cancel-in-progress`, could cancel a run
between the push fan-out and its Redis snapshot, **re-sending injury pushes to
owners' devices**); a daily ESPN backfill gated on a 5-minute window that only
the :00 dispatch could reach; and a guard that only understood `*/n` and so
would have skipped the offset list silently. If you touch the cadence again,
re-check anything gated on wall-clock minutes inside that workflow.

**Reviewer state at merge.** Claude review adjudicated 5 findings: 3 fixed, 1
overtaken by events (secrets got set mid-flight), 1 deferred as F1. Copilot
approved with a single nit — the stale "4-minute scheduling" comment — which
was already fixed in `eb79ce2` before merge. CodeQL was waited on deliberately
(this changes a server route's auth gate) and passed. Nothing new landed after
the merge.
