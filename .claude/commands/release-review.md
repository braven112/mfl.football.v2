Stabilize `main` for the week's promotion: review everything queued on `staging`
at once for the things a per-PR review cannot see, rehearse the production
build, and return a **GO or NO-GO**. This is the gate — the promotion does not
run without a GO.

Run it Monday, so there is a day to act before Tuesday's promotion.
`/release-review`, or `/release-review --base main --head staging`.

## What this is, and what it is not

**Not a second correctness review, and not where quality gets decided.** Every
commit in range already passed `/live`'s full pass on its own PR — correctness
(5), cross-cutting (5b) and **quality (5c)** — plus CI, and ~228 guard suites
still gate the promotion. `staging` is held to production standards on the way
in; this pass is not the safety net for anything skipped there. Re-running those
lenses finds little and costs a lot.

**This is the week-scale lens**, and it exists because of one structural blind
spot: a reviewer handed a single PR cannot see the *other* PR from Tuesday that
wrote the same helper under a different name. Nobody can. Both diffs were
individually correct and the duplication is only visible from above.

So every finding here should be of a kind that is **invisible in any single
commit in the range**. If a finding would have been caught by reviewing one PR
in isolation, it is out of scope — note it and move on, don't pad the report.

Six things qualify:

| Lens | The shape of the finding |
|---|---|
| **Cross-feature duplication** | Two features each wrote the same date math / formatter / fetch wrapper / sort |
| **Reuse missed** | New code reimplements something already in `src/utils/` — 247 utils exist and nobody remembers all of them |
| **Sibling drift** | A change landed on one league's page and not its twin |
| **Altitude** | Several features each bolted a special case onto the same function, and the right answer is one abstraction |
| **Efficiency at scale** | The week's changes together grew the client bundle, added per-request work that belongs in prebuild, or introduced an N+1 |
| **Stored-shape compatibility** | Staging shares production's database while running a week ahead of it, so a changed key shape breaks production before it ships (step 1b — the one blocking lens) |
| **Release readiness** | Does the whole thing build and deploy — the full-prebuild rehearsal, the week's visual diffs, the ratchets (steps 6b, 6c) |

---

## Step 0: Resolve the range

```bash
git fetch origin main staging 2>/dev/null
```

Default range is `origin/main...origin/staging` — everything on the train and
not yet in production. Honor `--base` / `--head` if given.

**If `staging` does not exist yet** (the release train isn't built — see
`docs/plans/staging-release-process.md`), fall back to `origin/main...HEAD` and
say so in one line. The skill is useful against any accumulated branch.

Establish the shape before reading anything:

```bash
git log --oneline <base>..<head>
git diff --stat <base>...<head>
```

If the range is under ~200 changed lines or a single commit, say so and stop —
there is no week-scale signal in one feature, and `/code-review` is the right
tool. Don't manufacture findings to justify the run.

## Step 1: Mechanical inventory first

The repo's standing doctrine (CLAUDE.md, *Prefer the mechanical path*): run the
scripts, then judge. All of these are cheap and none of them need an LLM.

Run in parallel:

```bash
# Twins for every changed file, and whether the change reached them.
node scripts/sibling-drift.mjs --base <base> --json

# Did any ratchet move, and which direction?
git diff <base>...<head> -- tests/fixtures/page-fork-baseline.json \
                             tests/fixtures/typecheck-baseline.json \
                             tests/fixtures/clientrouter-init-baseline.json

# New files, which is where duplication hides.
git diff --diff-filter=A --name-only <base>...<head>

# Data-directory growth (serverless bundle pressure).
node scripts/check-bundle-size.mjs --src
```

**Reading the ratchets is the point, not passing them.** CI already fails if
`page-fork-baseline.json` grew. What CI cannot tell you is *why* a number moved,
and that is a finding:

- `page-fork-baseline.json` grew → a new forked sibling page landed. That is
  ~57,800 lines of accumulated fork talking; the shared-component shape is
  `src/pages/theleague/division-strength.astro`.
- `typecheck-baseline.json` rose → new type errors shipped. Check for
  `ts(2307) Cannot find module` specifically — CLAUDE.md flags it as urgent
  because an `import type` from a missing module is erased at build, so it has
  no runtime symptom while voiding every type in the file.
- `clientrouter-init-baseline.json` rose → a new script initializes on
  `DOMContentLoaded` only, and will go inert after the first in-site navigation.

## Step 1b: Stored-shape compatibility — the blocking check

**Staging and production share one Upstash database, and staging code runs up to
a week ahead of production code.** So every stored shape this release introduces
or changes will be written by staging and read by *current production* for the
whole week before promotion. Get this wrong and it presents as a production bug,
in code that did not change.

This is the one lens here that can block a release, so run it before the quality
lenses and give it a definite answer.

Find the candidates:

```bash
# New or changed Redis reads/writes in the range.
git diff <base>...<head> -U2 | grep -nE '^\+.*(kv|redis|Upstash|scopedKvKey|createKvFranchiseStore|\.hset|\.hget|\.set\(|\.get\(|\.lpush|\.sadd)'
```

For each hit, answer explicitly: **can code currently on `main` read what this
writes?**

- New key, nothing on main reads it → fine.
- Existing key, additive field → fine.
- Existing key, changed shape / renamed field / changed serialization →
  **blocks promotion** unless it is expand/contract: writes both shapes, reads
  the new one, and drops the old *a release later*.

Two repo-specific traps that belong in this check:

- **Scope.** `src/utils/rankings-scope.ts` owns the per-league key decision, and
  both leagues have a franchise `0001` — a new bare key is ambiguous the moment
  the second league writes to it. Same rule for the Board (`boardScope(user)`)
  and the watch-list mirror.
- **The `auctionPredictor.*` legacy keys are unscoped and TheLeague's alone.**
  Anything new touching them needs the same bail-out the existing helpers have.

If nothing in the range touches storage, say so in one line and move on.

## Step 2: The duplication sweep

This is the core of the skill and the reason it beats reading the diff yourself.

Reading the full range in-session costs context proportional to the *diff*.
Asking `gemini-ask` costs context proportional to the *answer* — and its explore
mode greps the repo itself, so it can compare the new code against the 247
existing utils without you naming them.

**Budget: two or three questions, not a sweep.** The quota is shared with
`.github/workflows/pr-external-review.yml`; a heavy run here degrades a PR
review to "did not run". Ask questions whose answers you could not cheaply get
with a Read.

Get the changed-file list first, then ask:

```bash
node scripts/gemini-ask.mjs -p "In these files, are any two of them implementing
the same logic under different names — the same date math, formatting, sorting,
fetch wrapper, or normalization? List each pair with path:line for both sides.
Only report genuine duplicates, not superficially similar code." <changed files>
```

```bash
node scripts/gemini-ask.mjs -p "Do any of these new functions reimplement
something that already exists in src/utils/? For each, name the existing util
and the new duplicate with path:line."  <new files>
```

**Treat every answer as a lead, never a fact.** It is a different model with no
CLAUDE.md priors. It cites `path:line` precisely so you can verify — Read both
sides of every claimed duplicate before it goes in the report. A false positive
that reaches Brandon costs more trust than a missed finding costs code.

## Step 3: Sibling drift, judged

Launch the `sibling-drift-checker` agent over the range. The script from step 1
gives the mechanical twin list; the agent does the judgment half — for each
unchanged twin, *should* this change have reached it?

At week scale there is a second-order finding the per-PR run cannot produce:
**three features each touching one league's copy of the same page** is not three
drift findings, it is one signal that the page pair should be unified. Say that
instead of listing three.

## Step 4: Altitude — the pass with no tool

Read the range's structure, not its lines. The question is not "is this code
correct" but "given all of it at once, is this the right shape?"

What to look for:

- **One function that grew several new branches this week.** Six special cases
  added by six features is an abstraction asking to exist. Name the abstraction.
- **A concept that appeared in three places** without a shared definition — a
  new status, a new eligibility rule, a new date window.
- **A rule that got written down this week** in a comment or a doc, but not in a
  test. That belongs in step 6.
- **Anything that re-grew a boundary the repo already collapsed.** The named
  ones: `buildAttributor` in `src/utils/owner-tenures.mjs` (five copies once
  existed, two disagreed), `rankings-scope.ts` for per-league storage keys,
  `leagueUrl()` for absolute URLs, `leaguesForStagedChange()` for changelog fan-out.
  Guards exist for most of these and will fail — but a *near*-miss that the
  guard's glob doesn't cover is exactly this step's job.

This step has no script and cannot be delegated to a scanner. It is the highest
value in the skill and the easiest to skip. Do not skip it.

## Step 5: Efficiency

Launch `astro-performance-expert` over the changed pages and components, scoped
to the week's diff. Its lens: hydration directives, SSR vs. prerender, bundle
impact, data loading.

Add the cross-feature question a single-PR run cannot ask: **did the week's
changes together push more work to the client or to request time?** Three
features each adding a `client:load` island is a page that now hydrates three
times on load, and no one of those PRs looked wrong.

Also check whether anything new fetches at request time that could be a prebuild
step — `scripts/prebuild.mjs` picks new steps up off the step list with no extra
wiring, so the cost of moving work there is low.

## Step 6: Guard gaps

For any rules doc the range touched, run the `guard-gap-auditor` agent, or
directly:

```bash
node scripts/guard-gap.mjs <doc> --json
```

A rule the week established in prose but not in a test is a bug waiting to
re-ship. Rank by how badly the rule has already bitten. Closing one is
`/guard-test`, which writes both the test and its `path-guard.json` map entry.

Do not open gaps that predate the range — they are not this release's findings.

## Step 6b: The production build rehearsal

Staging runs the **slim** prebuild all week (`VERCEL_ENV=preview` — 19 of 21
steps skipped, committed data artifacts read instead). That is the right default
for cost, and it leaves one real hole: **a change to a compute or fetch script
is never exercised on staging.** Its first real run would be on production,
during Tuesday's deploy.

So the rehearsal happens here, once, before the promotion:

```bash
PREBUILD_FULL=1 pnpm prebuild
```

What you are looking for:

- **A step that fails.** Blocking, obviously.
- **A derived file whose content changed beyond its `generatedAt` stamp.** That
  means a compute script in this range genuinely changes its output — check
  that every reader of that file expects the new shape, and that the committed
  copy gets regenerated as part of the promotion rather than drifting.
- **A step that got noticeably slower**, or a new network fetch with no timeout.

If the range touches nothing under `scripts/` or `src/**/*.mjs`, the pipeline
cannot have changed — say so in one line and skip the run rather than spending
the network fetches.

## Step 6c: Visual diffs land at the promotion

Chromatic does not run on staging PRs — it runs on the promotion, where the
whole week's snapshots are reviewed at once and a human accepts or rejects in
the Chromatic UI. Two consequences for this pass:

- **Expect a batch, and help with attribution.** Fifteen changed snapshots with
  no context is the known cost of this placement. If the range touched anything
  in the story import closure (`.github/workflows/chromatic.yml` lists it, and
  `scripts/chromatic-story-deps.mjs` generates it), name those commits in the
  report so the diffs can be matched to features rather than guessed at.
- **A visual regression has been live on staging all week.** Real owners use
  those hosts. If anything in the range looks like it could have changed
  rendering and nobody mentioned it, that is worth a direct look rather than
  waiting for the Chromatic run.

## Step 7: Adjudicate

**This pass gates the promotion**, so it ends in a verdict, not a list. Every
candidate finding gets sorted into exactly one bucket first. Be strict; a report
where everything is urgent gets read once.

| Bucket | Bar | What happens |
|---|---|---|
| **Blocks promotion** | A stored-shape incompatibility (step 1b), a correctness or security regression, a failed build rehearsal, or a ratchet that moved the wrong way and can't be explained | Fix before Tuesday, or pull the feature off the train |
| **Fix before promotion** | Cheap and local — a duplicate helper collapsed, a missed util swapped in, a drifted twin updated | Do it now, in one commit, on `staging` |
| **Follow-up** | Real, but a refactor with its own blast radius — unify a page pair, extract an abstraction, close a guard gap | File it. Do **not** hold a working feature for it |

### The verdict

**GO** — no unresolved *blocks promotion* findings, and the *fix before
promotion* bucket has been applied and is green.

**NO-GO** — anything in the blocking bucket still stands. A NO-GO must name the
specific item, the specific change that would clear it, and whether the fix or
pulling the feature is the shorter path. "Needs more review" is not a NO-GO.

Filing a follow-up is a deliberate **GO** decision, not a deferred NO-GO. That
distinction is what keeps this gate from degenerating: if every unfixed finding
blocked, the gate would be waved through within a month. The reviewer's judgment
about which findings must clear before Tuesday *is* the gate — say it out loud,
with reasons, so the call is reviewable.

The follow-up bucket matters most. A reuse opportunity found on Monday should
not delay a finished feature, and it should also not evaporate — that is the
failure mode this whole skill exists to prevent, one level up.

Discard anything you could not verify with a Read. Discard anything a single-PR
review would have caught. Say "nothing at week scale this release" if that is
the truth — it will be, some weeks, and it is a real result.

## Step 8: Write the report

`docs/claude/releases/YYYY-MM-DD-release-review.md`:

```markdown
# Release review — <date>

**Verdict: GO** (or **NO-GO** — and what must change)

**Range:** `<base>..<head>` — N commits, N files, +N/-N
**Features on the train:** one line each, linking the PR

## Blocks promotion
(or "None.")

## Stored-shape compatibility
<Every storage write in the range, and whether current production can read it.
"Nothing in range touches storage" is a valid, and common, answer.>

## Build rehearsal
<PREBUILD_FULL result, or why it was skipped.>

## Fix before promotion
- **<finding>** — `path:line` and `path:line`. <Why it is one thing, not two.>

## Follow-up filed
- **<finding>** — <what and why deferred>

## Ratchets
| Baseline | Before | After | Why |

## Checked, nothing found
<Which lenses ran clean. Brief — this is what makes the report trustworthy
next week.>
```

Commit it. It becomes the record of what shipped and what was knowingly
deferred, which is what makes a later "what went out that Tuesday?" answerable
in a minute.

## Step 9: Act

Apply the **fix before promotion** bucket in one commit on the head branch
(`/simplify` is the right tool if the fixes are purely reuse and
simplification). Run the affected guard suites, plus `pnpm test:unit`.

File the **follow-up** bucket — `docs/claude/followups/` is where `/hotfix`
already puts deferred work, so it is the same shelf.

Report to the user: the verdict first, then the three buckets, what you fixed
and what you filed. On a NO-GO, lead with the one thing that must change and the
shorter of the two paths to clearing it — fix, or pull the feature off the
train.
