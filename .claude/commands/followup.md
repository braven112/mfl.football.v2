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

## Step 1: Find the work

You were probably started with both a brief path and an issue number
(`/followup docs/claude/followups/<file>.md #123`). They hold the same content on
purpose — read whichever is there:

1. **The brief**, if the file exists. Read it whole; it was written to be
   startable cold, and this session has none of the incident context.
2. **The issue**, if the brief is missing. `/hotfix` step 8c can fail to push,
   which is exactly why 8b writes the items into the issue body rather than
   linking to them. Run `git fetch origin main` first in case your clone predates
   the push; if the file still isn't there, read the issue with
   `mcp__github__issue_read` (or `gh issue view <n>`) and work from that. Say
   which source you used, and recreate the brief file as part of your PR so the
   repo copy exists again.
3. **Neither** — say what's missing and stop. Do not reconstruct the work from
   the hotfix PR diff alone: the value here is the reasoning that *isn't* in the
   diff, and guessing at it defeats the handoff.

With no arguments at all, take the oldest open brief:

```bash
grep -l "^status: open" docs/claude/followups/*.md | sort | head -1
```

If there are none, cross-check for issues whose brief never landed —
`gh issue list --label hotfix-followup --state open` — and say "No open
follow-ups." only if that is empty too.

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
2. **Close the issue** — but only once every item is either worked or explicitly
   dropped. If some shipped and others got deferred again, tick what's done,
   leave it open, and say what remains; a closed issue with unfinished items is
   worse than no issue, because it reads as repaid debt.

   ```bash
   gh issue comment <n> --body "Shipped in <followup PR url>. <one line on what landed / what was dropped and why>

   ---
   _Generated by [Claude Code](https://claude.ai/code)_"
   gh issue close <n> --reason completed
   ```

   Cloud sessions: `mcp__github__issue_write` with `method: "update"`,
   `state: "closed"`, `state_reason: "completed"`.

   **Close as `not_planned`, not `completed`, if every item was dropped.** The
   close reason is the audit signal for whether the fast lane got repaid or
   written off — don't blur them.
3. Comment once on the hotfix PR linking the follow-up PR, so the two halves are
   findable from either end.
4. Commit the brief update with the follow-up PR (or right after it merges).

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
Issue         #<n> closed (completed / not_planned) — or: left open, N items remain
PR            <followup PR url>  (merged / awaiting CI)
```

If you dropped more items than you worked, say so plainly. That's a signal about
the adjudication at hotfix time, and it's worth the user seeing it.
