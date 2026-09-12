# The staging release train

**Status:** plan, not built. Decisions marked **[DECIDED]** came from Brandon;
**[OPEN]** ones need a call before implementation starts.

Related: PR #1047 (`claude/vercel-per-league-test-sites-f3rk7w`) already builds
the staging hosts this plan sits on top of. **That PR is the prerequisite — none
of this works until it lands.**

## The idea

New features stop going straight to production. They land on a `staging` branch,
serve from the staging hosts for up to a week, and promote to production in one
batch every Tuesday. Bugs, cron data and pipeline fixes keep going straight to
prod exactly as they do today.

The point is not ceremony, and it is not that quality gets reviewed later —
quality is settled on each PR, before it reaches `staging`. It is that a week of
accumulated features then gets one pass that can see *across* features — the
duplicate helper two PRs each wrote, the second forked sibling page, the util
three features re-implemented — which no per-PR review can see by construction.

## Decisions already made

| Question | Answer |
|---|---|
| What rides the train | **New features only** [DECIDED] |
| What bypasses it | **Bugs; anything time-sensitive to the league calendar; cron and data-pipeline fixes** [DECIDED] |
| Cron/roster/Schefter data commits | **Unchanged — keep committing to `main`** [DECIDED] |
| Release day | **Tuesday** [DECIDED] |
| Staging infra | **Same Vercel project, staging subdomains** [DECIDED — built in #1047] |
| Chromatic | **Runs on the promotion to prod, not on feature builds** [DECIDED] |
| Weekly review | **A code-efficiency and reuse pass over the whole week's diff** [DECIDED] |
| Staging database | **Shared with production — no separate Upstash DB** [DECIDED] |
| Staging's standard | **Production-level. Full CI, full review, full quality pass on every PR into it** [DECIDED] |
| Per-PR review | **Code review AND code-quality review, on every individual PR** [DECIDED] |
| The weekly pass | **Blocking — a clean `/release-review` gates the promotion** [DECIDED] |
| Staging prebuild | **Slim during the week; one full rehearsal before promotion** [DECIDED] |

## What #1047 already gives us

Worth stating plainly, because the branch model below depends on all of it:

- Three stable hosts — `staging.theleague.us`, `staging.afl-fantasy.com`,
  `staging.mfl.football` — pinned to the **`staging` branch's** latest
  deployment. Stable hostnames are what keep the session cookie alive across
  deploys; a `*.vercel.app` URL changes every push and logs you out.
- A `stagingDomains` registry field wired into `buildHostToSlugMap()` **and
  nothing else**. `leagueOrigin()` deliberately does not see it, so every
  absolute URL the app emits — nav switches, GroupMe text, OG tags — still
  points at production hosts.
- `scripts/vercel-ignore-build.mjs` exempts the `staging` branch from the
  no-open-PR build gate, as a code constant.
- `best-ball-1` gets no staging host, because it lives under a path prefix on
  the shared host.

## The branch model

```
main       ──●──●───────●──●──────────●══════●──▶   production (theleague.us, …)
              ↑  ↑       ↑  ↑          ↑      ↑
           hotfix │  cron data │    Tue promote (fast-forward)
                  │            │          ↑
staging    ───────●────────────●──────────●──▶      staging.theleague.us, …
                  ↑            ↑
              feature PR   feature PR
```

- **`main` is production and stays production.** Nothing about its current
  behavior changes: bots commit data to it, hotfixes land on it, every push
  deploys.
- **`staging` is the train.** Feature branches cut from `staging`, PR into
  `staging`, merge to `staging`.
- **`main` merges down into `staging` continuously** — on every push to `main`,
  automated. This is the load-bearing mechanic and the reason to prefer it over
  the alternatives.

### Why merge-down, and why promotion is a fast-forward

If `staging` always contains every commit on `main`, then Tuesday's promotion is
a **fast-forward** — `main` simply advances to `staging`'s tip. No merge commit,
no conflict resolution on release day, no possibility of a botched three-way
merge shipping something nobody reviewed.

The alternative — letting the two diverge and doing a real merge on Tuesday —
means resolving a week of drift on the one day of the week you least want
surprises, against a `main` that has absorbed ~30 bot data commits and a handful
of hotfixes since the last release.

Merge-down (not rebase-down) specifically: `staging` is a shared branch that
feature branches are cut from. Rebasing it force-pushes history out from under
every open feature branch. This is the one place the repo's standing
"always rebase" rule (CLAUDE.md, *Merge conflicts*) does **not** apply, and the
plan should say so explicitly in that section when it lands.

Conflicts on merge-down should be near-zero: `main`'s traffic is data files
(class 3 — take main's copy whole) and hotfixes to code that `staging` usually
isn't touching. The one recurring exception is
`tests/fixtures/typecheck-baseline.json` — class 6, neither side is right,
re-measure with `pnpm test:types`.

**[OPEN]** After Tuesday's fast-forward, `staging` and `main` are identical.
Leave `staging` in place (recommended — it's a stable ref the Vercel domains are
pinned to and feature branches cut from), don't delete and recreate it.

## What rides, what bypasses

The bar is **"is this new surface area?"**, not "how big is the diff."

| Class | Path | Why |
|---|---|---|
| New page, new feature, new API route | **Train** | New surface is where a week of soak actually buys something |
| Enhancement to an existing feature | **Train** | Same |
| Bug fix | **Straight to prod** | A week of a known bug is worse than the risk of the fix |
| League-calendar-time-sensitive | **Straight to prod** | Lineup deadlines, waiver windows, draft day, Feb 14 / Labor Day rollovers — a week late is worthless |
| Cron, workflow, data-pipeline fix | **Straight to prod** | The crons write to `main`; a pipeline fix that waits for Tuesday means a week of bad data committed |
| Site down, auth broken, wrong data during games | **Straight to prod** | Obviously |
| Refactor / tests / docs | **Either** | Prefer the train if it touches rendering; straight to prod otherwise |

The judgment call worth naming: a *fix* that requires new surface area to
deliver is a feature. It rides.

## Staging is production-level

`staging` is not a lower-standards branch that gets cleaned up on Tuesday. Real
owners use `staging.theleague.us`, it writes to production's database, and
`main` fast-forwards to it — so whatever is wrong there is wrong in production a
week later, at the latest.

Everything that gates a merge to `main` today gates a merge to `staging`:

- **Full CI** — unit tests and CodeQL, which currently do not run on `staging`
  PRs at all (see below; this is the one item that would make the train worse
  than no train).
- **Full review on every PR** — `/live`'s correctness (5), cross-cutting (5b)
  and quality (5c) passes.
- **Code-quality review per PR, not deferred.** Reuse, simplification,
  efficiency, altitude. Safe findings — swapping in an existing util, deleting
  dead code — get applied in the PR; anything touching behavior or a stored
  shape is reported for Brandon's call; a real refactor becomes a follow-up
  rather than growing the PR.

**So what is the weekly pass for?** Two things a per-PR pass structurally
cannot do:

1. **See across features** — the same helper written twice by two PRs that did
   not know about each other, three features each adding a special case to one
   function, drift that only reads as a pattern in aggregate.
2. **Rehearse the release** — the full prebuild, the week's visual diffs, the
   ratchets, and the stored-shape compatibility question that only exists
   because staging runs a week ahead of production against shared data.

It is **blocking**: the promotion does not run without a GO from
`/release-review`. The one caveat, recorded so the gate does not quietly
degenerate: filing a follow-up is a deliberate GO decision, not a deferred
NO-GO. If every unfixed finding blocked, the gate would be waved through within
a month.

## Workflow changes required

Concrete, and none of them are optional — several are silent failures.

### CI on `staging` PRs — **done**

`ci.yml` and `codeql.yml` both declared `pull_request: branches: [main]`, so a
PR targeting `staging` would have run **neither** — every feature PR merging
with no unit tests and no security scan, which is strictly worse than no train
at all. Both are now `[main, staging]`.

CodeQL's `push` trigger stays main-only on purpose: that run populates the
Security tab baseline for the default branch, and a second branch scanning into
the same tab duplicates alerts for code about to fast-forward into main anyway.
The PR trigger is what gates the merge.

Audited and needing no change: `mfl-integration-test.yml` and
`pr-external-review.yml` both declare `pull_request` with no `branches` filter
(path-filtered and label-triggered respectively), so they already cover
`staging` PRs.

**Branch protection is the other half.** Required status checks only work once
the workflow actually triggers on the branch — a check required but never
reported leaves the PR blocked forever rather than protected. Wire the required
checks for `staging` only now that these triggers exist.

### Chromatic moves to the promotion — **done**

Its `pull_request` trigger had no `branches` filter, so it would have fired on
feature PRs into `staging`. Now `branches: [main]`, which means the only PR it
runs on is the promotion (`staging` → `main`). Per Brandon's call:

- **Feature PRs into `staging`:** no Chromatic run.
- **The promotion PR (`staging` → `main`):** Chromatic runs, diffs pending, a
  human accepts or rejects in the Chromatic UI. This becomes the visual review
  gate for the whole week.
- **Push to `main`:** unchanged, `--auto-accept-changes`, moving the baseline.

Two things to hold onto, both from the long comment block in `chromatic.yml`:

1. **The promotion PR must actually capture before the merge.** The entire
   reason `synchronize` is in that workflow's trigger list is that a commit
   whose first capture happens on the `main` push gets blessed unreviewed by
   `--auto-accept-changes` — "a visual test that certifies the bug." Moving
   capture to the promotion PR preserves that property only if the promotion
   really is a PR with a Chromatic run, not a direct push.
2. **A week of diffs arrives at once, and attribution gets harder.** Fifteen
   changed snapshots on Tuesday, and working out which of six features caused
   which is real work. The `visual-check` label escape hatch already exists —
   keep it, and use it on any feature PR that touches a component in the story
   closure so its diff is reviewed in isolation while the context is fresh.

**The accepted cost, stated plainly** [DECIDED]: `staging` is otherwise held to
production standards, but visual regressions are the one class that can sit
there unreviewed for a week — real owners are on those hosts. This was chosen
knowing that, for the snapshot budget: one run a week instead of one per feature
PR is the right direction against a 5,000/month plan. `/release-review` step 6c
compensates by naming which commits touched the story closure, so Tuesday's
batch can be attributed to features rather than guessed at.

### The What's New rollup fires before the release

`weekly-changelog-rollup.yml` runs `0 4 * * 2` — **Monday 8pm PT**. It publishes
the week's What's New article and pushes the `site-update` notification to
owners who opted in.

Under a Tuesday release, that article announces features that are not live yet.
Owners get a push notification, tap through, and the feature isn't there.

Two ways out, and this needs a call:

- **[OPEN, recommended]** Move the rollup to fire *after* Tuesday's promotion —
  either shift the cron a day (`0 4 * * 3`, Tuesday 8pm PT) or trigger it from
  the promotion workflow so it can never run ahead of the deploy.
- Or move the release to Monday morning and leave the rollup where it is.

Triggering from the promotion is strictly better than a cron shift: it makes the
ordering structural rather than two schedules that happen to agree.

### `/live` targets the wrong branch

The `/live` skill creates the PR against `main` and enables auto-merge. It needs
a target-branch notion — default `staging`, `--to main` for the bypass classes
in the table above. `/hotfix` correctly stays on `main`.

### The promotion itself

A workflow, not a habit. `promote-to-production.yml`:

- `workflow_dispatch` plus a Tuesday cron, so it is repeatable and logged.
- Refuses to run if `staging` is not a strict descendant of `main` (i.e. if the
  promotion would not be a fast-forward). That failure means merge-down is
  broken, and it should stop the release rather than resolve it.
- Refuses to run if CI is not green on `staging`'s tip.
- Opens the promotion PR (for the Chromatic gate above), or fast-forwards
  directly if the decision below says no PR.

**[OPEN]** Cron-and-announce vs. one-button `workflow_dispatch`. Given the whole
point is deliberate releases, a human pressing the button on Tuesday morning
after reading the review seems right — but a cron with a cancel window is less
likely to slip.

## The weekly review

This is the piece that justifies the train, so it deserves more than "run the
existing reviewer over a bigger diff."

**Target:** `git diff main...staging` — a week of features, typically several
thousand lines across a handful of PRs, each of which already passed its own
per-PR review.

**Premise:** everything a single-PR review can find has already been found. What
survives is only visible at week scale:

| Lens | What it looks for | Existing tooling to build on |
|---|---|---|
| **Cross-feature duplication** | Two features that each wrote the same helper, formatter, date math, or fetch wrapper under different names | `gemini-ask` explore mode over the changed file set; this is exactly the "across all of X" shape it exists for |
| **Reuse missed** | New code that reimplements something already in `src/utils/` — 247 utils exist and nobody remembers all of them | `gemini-ask`, then verify each hit with a Read before acting |
| **Sibling drift** | A change applied to one league's page and not its twin | `sibling-drift-checker` agent, `scripts/sibling-drift.mjs` |
| **New forks** | A second copy of a page instead of a shared component | `tests/page-fork-ratchet.test.ts` already fails the build on this — the review should read *why* a baseline moved, not just that it passed |
| **Guard gaps** | Rules the week's work established in prose but not in a test | `guard-gap-auditor` agent |
| **Efficiency** | N+1 fetches, work done per-request that could be prebuild, client bundles that grew | `pnpm check:bundle` delta, `astro-performance-expert` agent |
| **Altitude** | Six features that each added a special case to the same function, where the right answer is one abstraction | Judgment. No tool. This is the one that most needs a human or a careful agent pass |

Two lenses beyond the table, both consequences of decisions elsewhere in this
plan:

| Lens | What it looks for | Tooling |
|---|---|---|
| **Stored-shape compatibility** | A key shape staging writes that current production cannot read — the shared-database consequence, and the one lens that reliably blocks | `git diff` grep over storage calls; expand/contract is the test |
| **Release readiness** | Does the whole thing build — the `PREBUILD_FULL=1` rehearsal that closes the slim-preview hole, plus the week's Chromatic batch | `pnpm prebuild`, the three ratchet baselines |

**Output:** a **GO or NO-GO**, then a written report to
`docs/claude/releases/YYYY-MM-DD-release-review.md`. Findings split into *blocks
promotion*, *fix before promotion* (applied on `staging`), and *file as
follow-up*. The last bucket matters: a reuse opportunity found on Monday should
not hold a working feature, but it should also not evaporate.

A NO-GO must name the specific item, the change that clears it, and whether
fixing or pulling the feature off the train is the shorter path. "Needs more
review" is not a NO-GO.

**When:** Monday, so there is a day to act on it before Tuesday's promotion.

**Shape:** the `/release-review` skill — **built**,
`.claude/commands/release-review.md`. Runnable today against
`main...<any branch>`; it does not need staging to exist.

## Staging safety — the sharp edge of a same-project staging

The staging sites are Vercel **preview** deployments on stable hostnames. Same
project means **same environment variables unless deliberately scoped**, and
that is the single biggest risk in this whole plan. A staging deploy that shares
production's secrets can:

- write to production Redis — the Board, rankings, watch lists, owner state;
- write to **MFL itself** — lineups, contracts, waivers, in the real league;
- send push notifications to real owners, using the production VAPID keys;
- post to GroupMe.

None of that is hypothetical: the app has working write paths for all four.

Vercel scopes environment variables per environment, so the lever exists for
each of these independently.

### The database is shared [DECIDED]

Staging reads and writes **production's Upstash**. No separate DB. That is the
right call for a data-heavy site — a staging environment showing empty rosters
and an empty Board tests almost nothing — but it has one consequence that
reshapes several other decisions in this plan, so it needs stating outright:

> **Staging code runs up to a week ahead of production code, against the same
> data.** Every release cycle, staging writes shapes that production code must
> be able to read.

That makes **expand/contract mandatory, not advisory**. Any change to a stored
shape must: write both old and new, read the new, and drop the old *a release
later*. A staging feature that writes a shape only staging understands corrupts
production for a week — and it will look like a production bug, because it is
one, in code that didn't change.

Three consequences worth carrying forward:

1. **Rollback gets more fragile, not less.** Reverting production code to last
   Tuesday's deployment lands it on data written by this Tuesday's code. Under
   expand/contract that's survivable; without it, rollback breaks the site.
2. **The weekly review needs a stored-shape lens.** Any new or changed Redis key
   shape in the week's diff is a release-blocking question: can current
   production code read this? Worth adding explicitly to `/release-review`.
3. **Owner-visible writes from staging are real.** A test post on the Board, a
   test poll ballot, a test watch-list entry — owners see them in production.
   Discipline, not tooling, unless a specific surface proves it needs a guard.

### Outbound writes must be blocked [OPEN — recommended]

Reads and Redis writes are the accepted trade above. Everything that leaves the
system is not, because none of it can be undone:

- **MFL writes** — lineups, contracts, waivers, in the real league.
- **Push notifications** — production VAPID keys, real owners' devices.
- **GroupMe posts.**
- **Suggestion-box GitHub issue filing.**

**Built** — `src/utils/deploy-environment.ts`, guarded at four choke points,
pinned by `tests/staging-outbound-guard.test.ts`. Full write-up in
`docs/claude/staging-sites.md`.

One correction to what this section originally proposed, recorded because the
reasoning matters more than the conclusion. The plan said to derive the
predicate from the request host matching a `stagingDomains` entry, and
explicitly **not** from `VERCEL_ENV`, "since every PR preview is also
`preview`". That objection is right for identifying staging *specifically* —
which is why `isStagingHost` still exists and still drives the banner and the
noindex header — and backwards for *blocking outbound writes*: every PR preview
carries the same production credentials and has no staging hostname, so a
host-only predicate would have left every preview able to mutate the real
league. Over-matching is the correct direction here. `VERCEL_ENV` also needs no
plumbing, which matters because not every write site has a hostname in scope.

The guard fails OPEN when `VERCEL_ENV` is unset — GitHub Actions and `pnpm dev`
— so it protects against a deployed staging or preview site, not a
misconfigured script.

Also needed, smaller:

- **`noindex` on staging hosts.** Three real subdomains of real domains will
  otherwise get crawled, and duplicate content on `staging.theleague.us` is a
  genuine SEO problem for `theleague.us`.
- **A visible staging banner.** Owners will end up on these hosts. They should
  never wonder which site they're on.
- **Staging runs the slim prebuild** (`VERCEL_ENV=preview`), reading committed
  data artifacts and skipping 19 of 21 steps — kept, for cost. The hole it
  leaves is that a compute-script change is never exercised on staging, so its
  first real run would be Tuesday's production deploy. Closed by a single
  `PREBUILD_FULL=1` rehearsal in `/release-review` step 6b, before the
  promotion. [DECIDED]

## Release day mechanics

**[OPEN]** Time. Tuesday morning PT is the default — far from Sunday's lineup
deadline (`lineup-reminders.yml` fires 9:15am PT Sundays), and it gives the
whole day to notice a problem. Avoid Tuesday *evening* if the What's New rollup
moves to Tuesday 8pm PT: ship in the morning, announce at night.

**Blackout windows** — dates where the answer is "not this week":

- Any Sunday during the NFL season, and Monday before games conclude.
- The week of each league's draft.
- Feb 14 (new MFL league year) and Labor Day (season rollover) — the two
  year-transition clocks. Both have shipped bugs; neither is a day to also
  change code.
- Waiver processing, which is per-league-calendar rather than a fixed day —
  the release workflow should read the calendar rather than hardcode a rule.

**[OPEN]** Whether blackouts are advisory (documented, human-enforced) or
mechanical (the promotion workflow refuses). Mechanical is better and is not
much more work, since the league calendar is already queryable.

## Rollback

Vercel can instantly promote a previous production deployment, which reverts
**code** in seconds. That is the primary rollback and it should be documented as
one named procedure, not rediscovered under pressure.

What rollback does **not** undo, and what therefore needs forward-fix planning:

- **Redis writes.** Sharpened by the shared-database decision above: a rollback
  lands production code on data that a week of staging code has already been
  writing. Expand/contract is what makes rollback survivable, which is why it is
  a requirement here rather than a recommendation.
- **MFL writes.** Irreversible by definition. This is an argument for gating any
  new MFL write path behind a code-level flag that ships off and is turned on in
  a separate release.
- **Sent notifications.** A push or GroupMe post cannot be recalled.
- **Committed data files.** A `git revert` on `main`, which then has to survive
  the next cron write.

**[OPEN]** Whether the promotion workflow should record the previous production
deployment ID somewhere durable, so rollback is "run this with that ID" rather
than "find the right deployment in the dashboard."

## Other practices worth adopting

Ranked by what this repo specifically lacks, not by general merit.

1. **Version stamping.** Expose the deployed commit SHA — a `<meta>` tag, or a
   tiny `/api/version`. With two environments the question "is my fix live?"
   goes from guesswork to one look. Cheap, and it makes every other item here
   easier to verify.

2. **Post-deploy smoke tests.** A handful of Playwright checks over the critical
   routes in both leagues — homepage, rosters, standings, login — run against
   staging on merge and against production after promotion. The repo has
   Chromium preinstalled and Storybook already; there is no e2e smoke suite
   today beyond `tests/e2e-cookie-test.mjs`. A release process without one is
   trusting that unit tests imply a working site.

3. **Feature flags as code consts.** Lets a risky feature ride the train to
   production dark and be enabled in a separate, instantly-reversible step —
   which is a far better rollback story than redeploying. CLAUDE.md already
   forbids `vars.*` gates in workflows; a `const` in the module is the
   sanctioned shape and this fits it exactly.

4. **Branch protection on both branches.** Require the (newly-wired) CI on
   `staging` as well as `main`. A train that can be pushed to directly isn't a
   train.

5. **Runtime error monitoring for the site.** `job-failure-watch.yml` watches
   *crons* and is good. Nothing watches the site's own runtime errors. A
   release process's most valuable signal is "error rate after this deploy vs.
   before," and that signal doesn't exist yet. Vercel runtime logs plus a
   threshold alert is the minimum version.

6. **A standing release checklist.** One issue or doc per release, listing what
   promoted, the review findings deferred, and what to watch. Cheap, and it is
   what makes a post-incident "what shipped Tuesday?" answerable in a minute.

7. **Expand/contract for every stored-shape change.** No longer in this list as
   a suggestion — the shared-database decision promotes it to a hard
   requirement, and `/release-review` step 1b is where it gets enforced. Listed
   here only so the reason travels with the other practices: it is the
   difference between rollback working and rollback making things worse.

8. **A staleness rule for `staging`.** A feature that sits unmerged on staging
   for three weeks is a merge conflict factory and a review blind spot.
   Anything on staging at promotion time either ships or is reverted off.

9. **Don't let the train become the only path.** The most common failure of a
   weekly release is that the bypass lane quietly widens until everything is a
   hotfix. Worth actually measuring: if more than a third of releases are
   bypasses, the cadence is wrong, not the discipline.

## Build order

1. ~~`/release-review` skill~~ — **done**.
2. ~~`/live` step 5c (per-PR quality review) and its `staging` default~~ —
   **done**.
3. Land #1047.
4. ~~CI branch filters (`ci.yml`, `codeql.yml`) and the audit of the other
   two~~ — **done**.
5. ~~Chromatic retarget~~ — **done**.
6. ~~Outbound-write guards + guard test~~ — **done**.
7. ~~`noindex` + staging banner~~ — **done**.
8. `staging` branch, merge-down automation, branch protection (required checks
   for `staging`, now that the workflows report on it).
9. Promotion workflow (fast-forward check, CI-green check, the `/release-review`
   GO gate); move the What's New rollup behind it.
10. Smoke tests, version stamp, error monitoring.

Steps 1–7 are done, and were worth doing regardless of whether the weekly
cadence sticks. What remains (8–10) is the train itself.
