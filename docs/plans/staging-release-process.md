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

The point is not ceremony. It is that a week of accumulated features gets one
review pass that can see *across* features — the duplicate helper two PRs each
wrote, the second forked sibling page, the util three features re-implemented —
which no per-PR review can see by construction.

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

## Workflow changes required

Concrete, and none of them are optional — several are silent failures.

### CI does not currently run on `staging` PRs

`ci.yml` and `codeql.yml` both declare `pull_request: branches: [main]`. A PR
targeting `staging` runs **neither**. Both need `[main, staging]`. Until that
lands, every feature PR ships with no unit tests and no security scan — strictly
worse than today.

`mfl-integration-test.yml` and `pr-external-review.yml` need the same audit.

### Chromatic moves to the promotion

Currently: path-filtered on PRs into any branch, plus `push` to `main` with
`--auto-accept-changes`. Under the train, per Brandon's call:

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

**[OPEN]** Whether the snapshot budget prefers this. Batching should *reduce*
total snapshots (one run a week instead of one per feature PR), which is the
right direction against the 5,000/month plan.

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

**Output:** a written report, not auto-applied fixes. Findings split into
*blocks the release* (rare — correctness or a security regression), *fix before
promotion*, and *file as follow-up*. The last bucket is important: a reuse
opportunity found on Tuesday should not hold a working feature, but it should
also not evaporate.

**When:** Monday, so there is a day to act on it before Tuesday's promotion.

**Shape:** a `/release-review` skill. It is runnable today against
`main...<any branch>` — it does not need staging to exist, which makes it the
sensible first thing to build.

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

Vercel scopes environment variables per environment, so the lever exists —
Preview-scoped values differ from Production-scoped ones. What needs deciding:

**[OPEN]** Separate Upstash database for Preview, or shared? Separate is safer
and means staging can't corrupt the Board; shared means staging shows real data,
which is most of what makes staging useful for a data-heavy site. A middle path
is a shared *read* connection and a code-level refusal to write.

**[OPEN, strongly recommended regardless]** A single `isStagingDeploy()`
predicate in the registry or a util, derived from the request host matching a
`stagingDomains` entry — **not** from `VERCEL_ENV`, since every PR preview is
also `preview`. Everything that reaches the outside world checks it and refuses:
MFL writes, GroupMe posts, push sends. One predicate, one guard test that fails
if a new outbound path skips it. This is the `/guard-test` shape exactly.

Also needed, smaller:

- **`noindex` on staging hosts.** Three real subdomains of real domains will
  otherwise get crawled, and duplicate content on `staging.theleague.us` is a
  genuine SEO problem for `theleague.us`.
- **A visible staging banner.** Owners will end up on these hosts. They should
  never wonder which site they're on.
- **Staging runs the slim prebuild** (`VERCEL_ENV=preview`), so it reads
  committed data artifacts and skips 19 of 21 steps. Worth knowing: a feature
  that changes a compute script is *not* exercised end-to-end on staging unless
  `PREBUILD_FULL=1` is set for that branch. The diff-touches-`scripts/` escape
  hatch covers most of it automatically.

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

- **Redis writes.** A release that changes a stored shape leaves the new shape
  behind. Any such change should be expand/contract — write both shapes, read
  the new one, drop the old a release later — so that a rollback lands on data
  the old code can still read.
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

7. **Expand/contract for every stored-shape change.** Stated under Rollback, but
   it deserves to be a rule rather than a reminder — it is the difference
   between rollback working and rollback making things worse.

8. **A staleness rule for `staging`.** A feature that sits unmerged on staging
   for three weeks is a merge conflict factory and a review blind spot.
   Anything on staging at promotion time either ships or is reverted off.

9. **Don't let the train become the only path.** The most common failure of a
   weekly release is that the bypass lane quietly widens until everything is a
   hotfix. Worth actually measuring: if more than a third of releases are
   bypasses, the cadence is wrong, not the discipline.

## Build order

1. `/release-review` skill — useful immediately, needs nothing else.
2. Land #1047.
3. CI branch filters (`ci.yml`, `codeql.yml`, and the audit of the other two).
4. `isStagingDeploy()` + outbound-write guards + guard test. **Before** anyone
   is invited to use staging.
5. `noindex` + staging banner.
6. `staging` branch, merge-down automation, branch protection.
7. Promotion workflow; move the What's New rollup behind it.
8. Chromatic retarget.
9. Smoke tests, version stamp, error monitoring.

Steps 1–5 are worth doing regardless of whether the weekly cadence sticks.
