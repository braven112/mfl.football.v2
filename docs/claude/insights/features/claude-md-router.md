# CLAUDE.md router restructure — Insights

## 2026-08-21 - Verify a doc split by token diff, not by reading it back

**Context:** Splitting CLAUDE.md (84 KB, 1,381 lines, 33 sections) into a 13 KB
router plus nine `docs/claude/rules/*.md` domain files. CLAUDE.md's own
merge-conflict rule 5 says docs changes are additive and "never drop a section"
— but a *split* is the case where content goes missing silently, because the
file it left is supposed to shrink.

**Insight:** Prose review cannot catch this. Re-reading a 71 KB extraction to
confirm nothing was lost is exactly the task attention fails at, and the losses
are not whole sections — they're precision inside sentences you *thought* you
were preserving. Diffing the set of backticked tokens does catch it:

```bash
git show HEAD:CLAUDE.md > /tmp/orig.md
grep -o '`[^`]\+`' /tmp/orig.md | sort -u > /tmp/orig-tokens.txt
cat CLAUDE.md docs/claude/rules/*.md > /tmp/new-corpus.md
while IFS= read -r t; do
  grep -qF -- "$t" /tmp/new-corpus.md || echo "MISSING: $t"
done < /tmp/orig-tokens.txt
```

**Evidence:** 630 unique tokens in the original. First pass reported 15 missing
— every one a place where a section was *kept* but paraphrased during
tightening, so no section-level review would have flagged it: the
`max(pin, calendarYear - 1)` clamp formula collapsed to the words "floor-only
and self-heal"; `resolveHeroState` / `src/utils/hero-resolver.ts` dropped from
the What's New hero rule; the second function name in
`getCurrentSeasonYear()` / `currentSeasonYear()` lost; the three full feed paths
in merge-conflict rule 3 abbreviated. It also caught a formatting bug — a
backtick span I had line-wrapped across a newline
(`` `data/<league>/\n   mfl-feeds/**` ``), which renders as literal backticks.

Final state: 627/630 verbatim. The 3 remaining were checked by hand and are
deliberate — an invented placeholder (`SCHEFTER_FOO_ENABLED`) and two anecdotes
whose *rules* were kept.

**Recommendation:** Run the token diff on any doc split or large tightening
before committing, and state the surviving ratio in the commit message so the
next reader knows the check ran. Do the extraction mechanically too — split by
heading with `awk` and concatenate, rather than retyping sections into their new
homes. Retyping is what introduces the paraphrase drift in the first place.

## 2026-08-21 - Nothing tests the pointers from `.claude/` into CLAUDE.md

**Context:** Same restructure. Before moving sections, checked what else in the
repo references CLAUDE.md by section name, expecting to have to update them.

**Insight:** `.claude/commands/feature.md` instructed the pipeline to pass
agents "the relevant editorial design standard section from CLAUDE.md" and to
embed the "Editorial Design Standard" section for UI work. **That section has
never existed in CLAUDE.md.** The editorial design standard lives in
`docs/claude/loading-standards.md` and `docs/claude/components.md`. So every
`/feature` run either silently passed nothing or had the model improvise the
standard from adjacent context — and because the failure is a *missing* input
rather than a wrong one, the output still looked plausible every time.

**Evidence:** `grep -rln "Editorial Design Standard" --include=*.md .` returns
seven files; CLAUDE.md is not among them, and never was. Same sweep found
`tests/design-token-guard.test.ts:26` citing a CLAUDE.md section by name (that
one was real, and moved to `docs/claude/rules/theming-and-assets.md`).

**Recommendation:** Cross-references from `.claude/agents/`, `.claude/commands/`
and test comments into CLAUDE.md are unenforced string literals — no guard test
covers them, and a section rename breaks them invisibly. When touching CLAUDE.md
structure, sweep for them explicitly:

```bash
grep -rn "CLAUDE\.md" --include=*.md --include=*.ts --include=*.mjs \
  .claude/ docs/ tests/ scripts/ .github/
```

Prefer pointing those files at a stable file path (`docs/claude/rules/<domain>.md`)
over a section title — a moved file breaks loudly on open, a renamed section
does not. If this class recurs, a guard test asserting every CLAUDE.md section
title referenced elsewhere actually exists would be cheap.
