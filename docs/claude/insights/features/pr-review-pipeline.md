# PR Review Pipeline

Insights for the advisory reviewer lineup behind `/live`
(`.claude/commands/live.md`), the external reviewer workflow
(`.github/workflows/pr-external-review.yml`), and its provider layer
(`scripts/pr-review-external.mjs`, `scripts/lib/pr-review-providers.mjs`).
Guard tests: `tests/pr-review-external.test.ts`.

## 2026-09-04 - A Reviewer Whose Output Cannot Be Parsed Reads As A Clean One

**Context:** PR #761 asked for the Gemini reviewer. What came back was a raw
reasoning trace — literally `wait, why did the author name the variable...` and
`Wait, but why was it like that?` — with no severity heading anywhere in it,
stopping mid-sentence on `The author refactored it to use the prop, but wrote:`,
under a bare `_Note: the diff was truncated - coverage is partial._`

It had found a **real bug nobody else caught**: a
`const defaultRankingSource = defaultSourceSelect?.value || defaultRankingSource`
in `DraftMockLobby.astro` — a `const` initialised from itself, which shadows the
outer binding and throws from the temporal dead zone whenever the left side is
falsy. The reviewer was working. The packaging was not.

**Insight 1 — "no findings" and "unreadable findings" were the same bytes to the
consumer.** `/live` tallies findings BY the `## Critical` / `## Important` /
`## Suggestions` headings. Prose containing none of them tallies as zero, which
is exactly what a clean review tallies as. This is the same class as the 2026-08
entry above — a reviewer that failed must not render like a reviewer that
passed — but one layer further in: that entry fixed the *transport* failing
silently, and this one is the *format* failing silently. Fixing one did not fix
the other, and the retry logic actively hid it (the comment said "3 attempts",
so the transport was visibly fine).

**Insight 2 — the reasoning leak had a mechanical cause, not a prompting one.**
Gemini returns its thinking in the **same** `parts` array as the answer, marked
`thought: true`. The provider did `parts.map(p => p.text).join('')`, so the
deliberation was concatenated onto the front of the review. No amount of "do not
narrate your reasoning" in the prompt fixes a client that is transcribing the
reasoning itself. Both were wrong and both were fixed; only one was a prompt.

**Insight 3 — enforcing a format must never cost a finding.** The obvious fix is
to reject unparseable output as "did not run". That would have thrown away
#761's TDZ bug — the single most valuable thing the reviewer produced all week.
So the recovery is graded: **one cheap reformat pass** (the model's own prose,
*no diff*, so it cannot invent a finding it never saw code for), and if that
fails the **original** notes are kept and rendered as an explicitly flagged
"output did not follow the review format" block inside `<details>`, where the
tally cannot read it but a human can. `/live` gained a row for that state which
deliberately does **not** collapse into "did not run" — that reviewer *has* seen
the diff.

**Insight 4 — byte-truncating a diff drops files by ALPHABET, which is the worst
possible ordering.** The cap was `diff.slice(0, 200_000)`. #761's filtered diff
was 276KB across 32 files, so it cut inside file #23 and dropped the nine after
it. Because `git diff` emits paths sorted, the dropped tail was
`src/pages/api/mock-draft/{list,delete}.ts`, `src/utils/mock-draft-scope.ts`,
`page-directory.json` and `nav-config.json` — the registry and call-site files
the cross-cutting lens exists to check. The truncation removed precisely the
evidence the reviewer was asked for, and the comment said only "coverage is
partial", never *which* part.

`capDiff` now packs **whole files** and **names** what it dropped, in the prompt
and in the PR comment. A useful side effect: packing whole files keeps going
after skipping an oversized one, so small tail files survive — at the *old*
200KB cap, #761 loses 3 files instead of 10.

**Watch for:** the cap is a backstop, not the filter. `EXCLUDED_PATHS` in
`scripts/pr-review-external.mjs` is what keeps generated feeds out; if a diff is
truncating, check whether a new generated path needs excluding before raising
the number again. And note what this PR could *not* verify — the live run on
#763 came back `503 UNAVAILABLE` after 4 attempts, so the new output paths are
proven by the 57 guard tests and stubbed end-to-end dry runs, not by a real
Gemini review. The first genuinely useful signal will be the next PR that asks
for it.

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
