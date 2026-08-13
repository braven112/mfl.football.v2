# Ask Roger — Eval Harness & Improvement Loop

Companion to the CLAUDE.md "Ask Roger eval" section (which covers *what to run
and when*). This file records the non-obvious implementation gotchas.
Methodology write-up for humans: `docs/evals-explained.md`.

## 2026-07-26 — Verify prompt extraction is BYTE-identical, don't eyeball it

**Context:** Extracting the inline `SYSTEM_PROMPT` from `src/pages/api/rules-qa.ts`
into `src/data/rules-qa-system-prompt.ts` so the eval tests the real prompt.

**Insight:** A prompt extraction is not a normal refactor. One changed
character silently (a) changes model behavior and (b) invalidates the
Anthropic prompt cache key, and neither failure shows up in a test or a type
check. Copy-paste through an editor can normalize whitespace or smart quotes
without you noticing.

**Evidence:** Verified by extracting both template literals — old one from
`git show HEAD:src/pages/api/rules-qa.ts`, new one from the module — slicing
each to the `${LEAGUE_CONSTITUTION}` marker, and comparing with `===` in a
node one-liner, printing the first differing index on mismatch.

**Recommendation:** Any future prompt extraction/move gets the same
programmatic byte-diff against `git show HEAD:<old-path>` before commit.
"It looks the same" is not verification.

## 2026-07-26 — Paid/nondeterministic tests: `.eval.ts` + a second vitest config

**Context:** The live eval costs ~$1 per run and samples at temperature 0.3,
so it must never run in `pnpm test:unit` or CI.

**Insight:** The exclusion is structural, not a flag. Root `vitest.config.ts`
includes `tests/**/*.test.ts` only, so naming the file `roger.eval.ts` keeps
it out of the default suite automatically — no `exclude` entry to maintain and
no chance of it being picked up by a future glob widening. `vitest.eval.config.ts`
then includes `tests/eval/**/*.eval.ts` with its own long timeouts and a
`maxConcurrency` cap that keeps API rate limits happy.

**Recommendation:** Reuse this shape for any future paid eval (AFL Roger,
Schefter voice). Extension = opt-in, not a maintained exclude list. Pair it
with a free `*.test.ts` meta-test that validates the fixture so the eval
itself can't rot unnoticed.

## 2026-07-26 — Eval `globalSetup` must hydrate `process.env` like astro.config does

**Context:** `generateRulesAnswer` reads `process.env.ANTHROPIC_API_KEY`, and
locally that key lives in the `vercel env pull`-generated `.env.local`.

**Insight:** Vitest does NOT load `.env` files into `process.env` — Vite only
exposes them to `import.meta.env`. So the eval fails with "not configured"
even right after a successful `vercel env pull`, which looks like a credential
problem but is a wiring problem. `astro.config.ts` already solves this for the
dev server; the eval needs the same bridge.

**Evidence:** `tests/eval/eval-global-setup.ts` mirrors the `loadEnv(...)` +
`process.env[key] ??= value` loop from `astro.config.ts` (real env always wins).

**Recommendation:** Any node/vitest entry point that reads `process.env` for
secrets outside the Astro server needs this bridge. `scripts/roger-improvement-loop.ts`
does the same at module top-level.

## 2026-07-26 — Grace margins keep graders from being flaky

**Context:** Roger's prompt says "under 300 words"; the eval grades word count.

**Insight:** Grading a soft LLM instruction at its exact stated value produces
false failures — a 305-word answer is compliant in spirit, and a suite that
flags it trains everyone to ignore red. `WORD_LIMIT` is 320 against a 300-word
instruction on purpose.

**Recommendation:** When a grader checks a fuzzy instruction, set the
threshold where a violation is unambiguous, not where the prompt states the
target. Hard contracts (anchor whitelist, link present) get no margin.

## 2026-07-26 — Inject dates at 20:00 UTC to land safely mid-day in PT

**Context:** Date-sensitive eval cases pin "today" via an injectable `now`.

**Insight:** A fixture date is a PT *calendar day*, but `now` is a `Date`.
Constructing it as `${iso}T00:00:00Z` lands on the previous PT day, and
`T12:00:00Z` drifts across DST. `${iso}T20:00:00Z` is noon PST / 1pm PDT —
unambiguously the intended PT day year-round.

**Evidence:** `ptNoon()` in `tests/eval/roger.eval.ts`; the inverse
(`ptDateOf`) in `scripts/lib/roger-improvement.ts` converts a stored Q&A's
`createdAt` back to the PT date Roger actually saw, so a live date bug is
reproducible after the fact.

**Recommendation:** Never convert a PT calendar date to a `Date` with a
midnight or noon UTC literal. Same trap as the reminder-window bug in CLAUDE.md.

## 2026-07-26 — Ground truth stays human-owned; enforce it in code, not docs

**Context:** The improvement loop's judge drafts eval cases from failed live
answers.

**Insight:** A judge that both proposes ground truth and ratifies it will
slowly fill the golden dataset with its own mistakes, and the eval becomes
confidently wrong. A README note asking humans to review is not a control —
people skip it under time pressure.

**Evidence:** `promoteCases()` in `scripts/lib/roger-improvement.ts` refuses
any proposal with `reviewed: false` and returns it as an error string; covered
by "refuses unreviewed proposals — the human gate is mechanical" in
`tests/roger-improvement-loop.test.ts`.

**Recommendation:** Keep promotion mechanical and keep the test. If a future
session wants to automate promotion for "obvious" cases, that's a redesign
conversation, not a flag.

## 2026-07-26 — Promotion must enforce the same invariants the CI meta-test checks

**Context:** Promoting a proposal appends a case to
`tests/fixtures/roger-eval-cases.json`.

**Insight:** Without duplicated validation, a promotion can produce a fixture
that fails `tests/roger-eval-cases.test.ts` — the loop would break CI as a
side effect of its own success path. `promoteCases()` therefore re-checks id
collisions, category validity, reference presence on judged cases, and `now`
presence on date-sensitive cases.

**Recommendation:** When adding a field or rule to the fixture meta-test, add
the matching guard to `promoteCases()` in the same commit. They're two halves
of one contract.

## 2026-08-13 — A `mustNotMatch` on the wrong answer can fire on a RIGHT answer

**Context:** Writing regression cases for two rules bugs — taxi/IR players
counting toward the 20-player minimum, and the 5th-year option paying the top
10 positional average (Rookie Extensions pay top 5).

**Insight:** The obvious deterministic guard for "Roger said no, the answer is
yes" is `mustNotMatch: ["does not count"]`, and for the taxi case that's safe:
no correct answer needs the phrase. But the same instinct applied to the
team-option case — `mustNotMatch: ["top 5"]` — would fail the *best* answers.
The two rules are adjacent and mutually exclusive, so a genuinely good answer
contrasts them explicitly ("top 10, not the top 5 the extension formula uses"),
and the guard cannot tell that from a cross-wired one. `mustNotMatch` matches
substrings, not claims.

**Evidence:** `team-option-salary-top10` deliberately ships with only
`mustMatch: ["top\\s*(10|ten)"]` plus `judge: true`, while
`taxi-counts-toward-minimum` and `ir-counts-toward-minimum` carry
`mustNotMatch` guards on the "does not count" phrasings that actually shipped.

**Recommendation:** Before adding a `mustNotMatch`, ask whether a *correct*
answer might quote the wrong value to contrast against it. If yes, drop the
regex and push the discrimination into the judge — and write the `reference`
so it names the confusable wrong answer ("do not confuse this with the Rookie
Extension formula, which uses the top 5"). A judge told what the trap is
catches cross-wiring; a judge told only the right answer tends to accept any
response containing it.

## 2026-08-13 — The "I don't see that in the constitution" instruction only covers silence

**Context:** Both August 2026 rules bugs were Roger asserting a confident wrong
ruling, despite a prompt that says to answer ONLY from the constitution and to
say "I don't see that in the constitution" otherwise.

**Insight:** That instruction is read as a test for *absence*, and neither bug
was an absence. The 20-player rule was present but ambiguous — it said "20
players under contract" without stating whether taxi/IR counted — so the model
resolved the ambiguity by reasoning from the adjacent 22-man roster limit and
produced a fluent, well-argued, wrong answer. Ambiguity does not trip the
honesty guard; it invites inference. This means an eval that only probes for
*missing* rules (the `not-in-constitution` category) cannot surface this class
at all.

**Recommendation:** When triaging a Roger bug, first classify it: wrong recall
(fix the answer), absence (fix the refusal), or ambiguity (fix the rulebook).
Only the third is a constitution edit, and it's the one that looks most like a
model failure. A fixture case alone leaves the trap armed for the next phrasing
of the question.
