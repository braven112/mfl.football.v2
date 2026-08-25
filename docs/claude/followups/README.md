# Follow-up briefs

One file per hotfix, written by `/hotfix` step 8, worked by `/followup`.

A brief is the receipt for a trade: `/hotfix` shipped past valid review findings
because production was broken, and it is allowed to do that **only** because the
findings land here instead of evaporating. A deferral that isn't captured is
just skipping review with extra steps.

Which means these files are also the audit trail for whether the fast lane gets
repaid. The whole audit:

```bash
grep -l "^status: open" docs/claude/followups/*.md
```

If that list only ever grows, the hotfix workflow isn't a hotfix workflow — it's
a quality-skipping machine, and that's worth knowing.

## Naming

`<YYYY-MM-DD>-<slug>.md` — the date the hotfix shipped, and the same slug used
for the `hotfix/<slug>` branch.

## Schema

```markdown
---
slug: live-scoring-null-crash
status: open                 # open | in-progress | shipped | dropped
severity: P0                 # the hotfix's triage severity
opened: 2026-08-24
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/612
hotfix_sha: a1b2c3d
followup_pr:                 # filled in by /followup step 7
followup_session:            # session id from /hotfix step 8b, for tracing
---

# Follow-up: live scoring crashed on a null athlete id

## What broke
One or two sentences. The user-visible symptom and when it started.

## What the hotfix did
What actually shipped — a revert, or the specific forward fix. Name the files.
If it was a revert, the real fix is an item below.

## Deferred items

- [ ] **F1 — Guard test for the null athlete id path**
  - Source: deferred at implementation (no test shipped with the fix)
  - Where: `tests/live-scoring.test.ts`, `src/utils/live-scoring.ts:210`
  - Why deferred: writing the ESPN fixture would have taken ~20 min mid-outage
  - Note: F1 is never optional — see `/followup` step 4

- [ ] **F2 — The null guard is duplicated in three call sites**
  - Source: Claude review, `/code-review`
  - Where: `src/utils/live-scoring.ts:210`, `:288`, `src/pages/api/live.ts:64`
  - Why deferred: valid, but extracting a shared helper widens the diff on a
    P0 fix

- [ ] **F3 — AFL sibling page has the same shape and wasn't checked**
  - Source: cross-cutting lens, step 5
  - Where: `src/pages/afl-fantasy/live.astro`
  - Why deferred: not reproducing there; needs a real look, not a guess

## Context to start cold
Anything the next session needs that isn't in the diff — what you ruled out,
what the ESPN payload actually looked like, which theory was wrong. This is the
section that makes the brief worth more than the PR link.
```

## Rules

- **Every item names a `file:line` and a source.** "Clean this up" is not an
  item; a future session can't act on it and won't.
- **Every deferral records *why*.** Not the finding's severity — the reason it
  lost to the clock. That's what `/followup` re-validates against.
- **Items get dropped, not deleted.** If it turns out to be wrong or overtaken,
  mark it and say why. A silently vanished item is indistinguishable from an
  unworked one.
- **A revert always leaves an item.** The real fix is follow-up work by
  definition.
- **Post-merge reviewer findings belong here too.** Gemini, Copilot and CodeQL
  usually land minutes after a hotfix merges; `/hotfix` doesn't wait for them,
  so it folds them in at step 8 and `/followup` re-reads the PR comments at
  step 2.
