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

**Limitation — the token diff is a smoke test, not proof.** `grep -o` pairs
backticks left-to-right *within a line*, so anything that desynchronizes the
pairing silently corrupts the token list: a code span wrapped across a newline,
an odd backtick, and above all ```` ``` ```` fences, which this file has several
of. Downstream of a desync you get junk "tokens" and real ones go unreported.

It missed a live one. `` `impact`: `user | admin` `` in the What's New section
was condensed to `` `impact` ``, dropping an enum that
`tests/whats-new-data.test.ts` enforces via `VALID_IMPACTS` — so a session
following the router would write a staging entry and fail the build with no idea
which values were legal. The check reported 627/630 clean while that was sitting
in the diff. Unwrapping the file first (`tr '\n' ' '`) does not fix it; it makes
it worse, because one unmatched backtick then desyncs the entire document.

**Recommendation:** Use the token diff as a first pass — it is cheap and it did
catch 15 real drops. But do not treat its ratio as a completeness claim. The
rigorous check is narrower and comes in two halves:

1. **Verbatim moves** — `diff` each extracted section against its source. Byte
   identity is a real proof, and it covers most of the volume.
2. **Tightened sections** — the only genuine risk surface, and there are few of
   them. Read each one against its original, specifically hunting for dropped
   *enumerations, formulas, and identifiers*. That is where condensation does
   its damage: the sentence still reads correctly with `user | admin` removed,
   which is exactly why prose review slides past it.

Do the extraction mechanically too — split by heading with `awk` and
concatenate, rather than retyping sections into their new homes. Retyping is
what introduces the paraphrase drift in the first place.

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
does not.

**This is now enforced:** `tests/claude-md-references.test.ts` asserts that every
`CLAUDE.md "<Title>"` citation names text actually present in CLAUDE.md, that
every referenced `docs/claude/rules/*.md` path resolves, and that the router
table's own rows point at real files. Deliberately-superseded citations go in its
ALLOWLIST with a reason.

Two things learned writing it, both worth keeping if you extend the pattern:

- **The regex has to cross newlines.** Citations wrap (`CLAUDE.md's "fixing the\n
  * constitution does NOT..."`), and comment gutters (` * `, `# `, `// `) must be
  stripped before matching or they end up inside the captured title. A
  newline-free first version passed three genuinely dangling citations.
- **But the gap must be connectors only** (`'s`, `→`, `:`, `(`, `,`, dashes) —
  never sentence text. A version that merely counted characters between
  `CLAUDE.md` and the next quote paired "(CLAUDE.md rule)." in a workflow header
  with a cron string two lines below it. Widen for newlines, tighten for grammar;
  doing only one of the two gives you either false negatives or false positives.

`docs/claude/insights/`, `docs/plans/` and `.claude/plans/` are deliberately NOT
scanned — they are dated journals recording what CLAUDE.md said at the time, and
rewriting them to track a later reorganization would falsify the record.
