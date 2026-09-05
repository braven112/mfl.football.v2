# PR Review Pipeline

Insights for the advisory reviewer lineup behind `/live`
(`.claude/commands/live.md`), the external reviewer workflow
(`.github/workflows/pr-external-review.yml`), and its provider layer
(`scripts/pr-review-external.mjs`, `scripts/lib/pr-review-providers.mjs`).
Guard tests: `tests/pr-review-external.test.ts`.

## 2026-08-28 - A Reviewer That Fails Most of the Time Costs More Than It Gives

**Context:** The Gemini reviewer ran on every `opened` / `synchronize` and
"mostly failed". Checking the actual PR comments rather than the workflow
conclusions: PRs #639, #644 and #646 — every PR in a four-hour window — all
carried the identical section:

```
⚠️ Reviewer failed to run — Gemini API 503: {
  "message": "This model is currently experiencing high demand.",
  "status": "UNAVAILABLE"
}
```

**Insight 1 — the workflow conclusion is not the health signal.** Every one of
those runs is `conclusion: success`. That is deliberate: the script never exits
non-zero, because an advisory reviewer must not be able to block a merge on a
bad quota day. The consequence is that the failure is invisible from
`gh run list` and visible only in the sticky comment body. Anyone auditing this
by run status will conclude it is fine. Read the comments.

**Insight 2 — it was 503, not 429, and that changes the diagnosis.** The
comments were legible the whole time and said `UNAVAILABLE / high demand`, which
is model overload, not quota exhaustion. Overload is explicitly *retryable* and
the script fired exactly one request. The reviewer was not out of budget; it was
giving up on the first busy minute. Reaching for "disable it, we're out of
quota" would have been a correct-feeling fix to a problem we did not have.

**Insight 3 — both halves are needed, and the second is the load-bearing one.**
Retry alone would leave a per-push reviewer competing with itself for free-tier
capacity on diffs where it has nothing to say. Opt-in alone would silently drop
the cross-cutting lens, which is the exact regression class this pipeline was
built to prevent (see the Codex no-op that motivated moving reviewers into
Actions in the first place). So:

- **Retry transient failures** (408/429/5xx, `Retry-After` honoured, capped at
  30s) — but never a *permanent* one. A 404 model id is dead on attempt four
  too, and backing off only turns an actionable error into a slow one. The two
  render differently in the PR comment now: ⚠️ transient ("weather, re-request
  it") vs ⛔ permanent ("this will fail for every future PR until fixed").
- **Make the reviewer opt-in** (`external-review` label or `workflow_dispatch`)
  and hand its lens to Claude as a mandatory `/live` step 5b.

**The transfer is an upgrade, not a downgrade.** Cross-cutting consistency is
the one lens that *needs* the repo rather than the diff — "you missed a call
site" is unanswerable from a diff alone, and the two-league sibling-page drift
that recurs here is invisible in a diff that touches only one side. An API
reviewer is handed a patch and a paragraph of conventions; the in-session
reviewer can grep. Step 5b is written to demand that: enumerate the callers,
open the sibling page, name the count.

**Watch for:** the failure mode of a mandatory-but-unverifiable step is that it
becomes a sentence someone writes without doing. Step 5b requires evidence in
the adjudication table ("7 callers, all updated"), and
`tests/pr-review-external.test.ts` asserts the step still exists in `live.md`
with its checklist intact — because deleting it and re-adding `synchronize` to
the workflow both restore the old failure without anything going red.
