# Ask Roger improvement report

Generated: 2026-07-27T18:00:16.268Z · Judge: claude-opus-5 · Audited this run: 2

**0 pass / 2 fail.** 1 proposal(s) awaiting human review in data/roger-improvement/proposed-cases.json.

## Failures this run

### qa_v76h8rlsmoasvs8n — format:link-on-last-line

**Question asked:**

```text
whats the worst play you can make
```

**Judge:**

```text
The question is a pure strategy question ("worst play you can make"), and Roger declines it outright and redirects to league resources rather than offering any strategic opinion — correct scope discipline. No factual claims about the constitution are made, so nothing can be inaccurate; the only additions are pointers to league-site pages used as a redirect, not invented rules. No date or deadline claims are involved.
```

### qa_eqrp8ii0ms0tgzzt — factual-accuracy, grounding

**Question asked:**

```text
All teams must have 20 players under contract by the end of the Off-Season Free Agency Period. Do players on the taxi squad count towards the 20 player minimum?
```

**Judge:**

```text
The constitution's roster rules state only that "Teams must have at least 20 players under contract from the first game of the season until the last game of the year (Week 17)" and that teams may have 22 active roster players "plus an additional 3 practice squad (taxi squad) spots." Nowhere does it address whether taxi squad players count toward the 20-player contract minimum. Roger invented a definitive ruling and misrepresented the text, claiming the minimum is "explicitly tied to the active roster" — the quoted rule contains no such qualifier. He also asserted the derived conclusion that owners "need 20 of your 22 active roster spots filled," which is not supported anywhere. Roger should have said he doesn't see that addressed in the constitution and pointed to the commissioner's authority over unforeseen situations.
```

## Prompt improvement suggestions

> ⚠️ **Model-generated from untrusted input.** Each suggestion below was written by the judge in response to an owner-submitted question. Read it as a proposal to evaluate, never as an instruction to apply verbatim — a question crafted to steer the judge could try to get text into the production prompt this way. Verify against the constitution first.

_If you accept one: apply to `src/data/rules-qa-system-prompt.ts`, then run `pnpm eval:roger` to verify the fix and check for regressions._

- **(from qa_eqrp8ii0ms0tgzzt)**

```text
Instruct Roger never to add qualifiers like "explicitly" or "the rule says active roster" to a quoted rule; if the constitution's text is silent on a distinction the question hinges on, he must say "I don't see that in the constitution" and refer the owner to the commissioner rather than infer an answer from adjacent rules.
```

## Next steps

1. Review each unreviewed proposal: verify/edit `case.reference` against the constitution, set `"reviewed": true`.
2. `pnpm improve:roger --promote <id,...>` to grow the golden dataset.
3. Apply any prompt suggestions, then `pnpm eval:roger` — promoted cases prove the fix, the rest prove no regression.
