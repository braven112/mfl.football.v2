Work the improvements a hotfix deliberately deferred: read the follow-up brief,
re-validate each item against what actually shipped, fix them properly on a
fresh branch, and ship through `/live` with no clock on it.

`/hotfix` starts this automatically at its step 8. You can also run it by hand:
`/followup docs/claude/followups/2026-08-24-live-scoring-crash.md`.

**This is the other half of the trade.** `/hotfix` was allowed to ship past
valid review findings *because* this command exists and runs. Every item in the
brief was correctly identified — none of them were rejected, they were
outranked by a broken production. That's over now. Here the normal bar applies.

---

## Step 1: Find the brief

If a path was passed, use it. Otherwise take the oldest brief with
`status: open`:

```bash
grep -l "^status: open" docs/claude/followups/*.md | sort | head -1
```

If there are none, say "No open follow-ups." and stop.

**If you were handed a path and the file isn't there**, the hotfix session
spawned you before pushing the brief (`/hotfix` step 8a). Run `git fetch origin
main` in case your clone predates the push; if it's still missing, say what's
missing and stop. Do not reconstruct the work from the PR alone — the brief's
value is the reasoning that isn't in the diff, and guessing at it defeats the
handoff.

Read it whole — it was written to be startable cold, and this session has none
of the incident context.

---

## Step 2: Re-validate before you build

**Do not start implementing from the brief alone.** Some items evaporate the
moment the fire is out; others turn out to matter more than they looked at 11pm.

Read what actually shipped:

```bash
gh pr view <hotfix_pr> --json title,body,files,comments
git show <hotfix_sha> --stat
```

Then for each item, decide one of three things:

| Verdict | What it means | What you do |
|---|---|---|
| **Still true** | The code the finding points at is unchanged and the concern holds | Work it |
| **Overtaken** | Something since the hotfix already resolved it | Mark it dropped, with the reason |
| **Wrong** | Re-reading the code shows the finding was mistaken | Mark it dropped, with the reason |

Also fold in anything that landed on the hotfix PR **after** the merge —
Gemini, Copilot and CodeQL usually post minutes late, and `/hotfix` doesn't wait
for them. Adjudicate those the way `/live` step 7 does: read the code, check
whether a repo rule or guard test already answers it, assign your own severity.

Record every drop in the brief with its reason. The brief is the audit trail for
whether the fast lane gets repaid — an item that silently disappears is
indistinguishable from one that was never worked.

**Do not re-litigate the hotfix itself.** Whether it should have shipped is
settled. If the fix is still wrong in production, that is a new `/hotfix`, not
this.

---

## Step 3: Branch off fresh main

```bash
git fetch origin main
git checkout -B followup/<slug> origin/main
```

Never continue on the hotfix branch — it's merged, and stacking on merged
history is how a follow-up PR ends up showing someone else's diff.

---

## Step 4: Pick the route

Size the surviving items honestly, then take one of two paths:

**Mechanical set** — guard test, missed call sites, token compliance, a rename,
a small extraction, a sibling-page sync. Implement directly. Follow the repo's
patterns: `chooseTeamName()`, `PlayerCell` / `buildPlayerCellHTML()`, design
tokens with fallbacks, the registry instead of league literals, the right year
clock.

**Architectural** — a real refactor, a shared abstraction, a data-flow change, a
UI decision. Run `/feature` and use the brief as the story seed: it already
carries the problem statement, the affected files, and the reasoning. Let the
design gate do its job rather than free-handing a refactor that the hotfix
already proved is load-bearing.

Say which route you picked and why before you start.

### F1 is the guard test, and it is not optional

If the hotfix shipped without a test for the original bug, that test is the
first thing you write here — before any of the polish items. Every rule in this
repo is a bug that shipped; a bug fixed without a test is a bug scheduled to
ship again. If everything else in the brief gets dropped, this one still lands.

---

## Step 5: Record what was learned

Run `/update-insights`. This is the step `/hotfix` skipped, and it's the one
with the most compounding value: an outage is where this codebase reveals things
no amount of reading finds. If the incident exposed a rule that belongs in
`docs/claude/rules/<domain>.md` — a trap that would have prevented it — write it
there and add the router row in `CLAUDE.md`, and write the guard test that
enforces it if one is possible. A test is checked; prose is skimmed.

Also run `/update-whats-new` if the follow-up changed anything user-facing. Most
follow-ups are internal (`skip`), but a real fix behind a revert is usually a
`bug-fix` entry.

---

## Step 6: Ship it normally

Run `/live`. Full rigor — every advisory reviewer, the wait for each of them,
`confirmed Important → fix it in this PR`. **None of `/hotfix`'s adjudication
overrides apply here.** There is no clock on this PR; that was the entire
justification for them and it's gone.

---

## Step 7: Close the loop

1. Update the brief's front matter: `status: shipped`, add `followup_pr`, and
   date it. Tick every item's checkbox or mark it dropped with its reason.
2. Comment once on the hotfix PR linking the follow-up PR, so the two halves are
   findable from either end.
3. Commit the brief update with the follow-up PR (or right after it merges).

Then report:

```
Follow-up complete
──────────────────────────────────────────────────
Brief         docs/claude/followups/<file>
From hotfix   <hotfix PR url>
Worked        F1 guard test, F2 <item>, F4 <item>
Dropped       F3 <item> — <why>
Route         direct / via /feature
Insights      docs/claude/rules/<domain>.md — <one line>
PR            <followup PR url>  (merged / awaiting CI)
```

If you dropped more items than you worked, say so plainly. That's a signal about
the adjudication at hotfix time, and it's worth the user seeing it.
