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

## 2026-08-21 - "Is this doc used?" is two questions, and the write side lies

**Context:** Asked whether `docs/claude/insights/` was available and actually
used. The write side looked healthy — every one of the five domain files had a
dated entry within two days, 27 of 41 feature files had one since July, and four
separate files pointed at the tree (CLAUDE.md, four agent definitions, and the
`/feature` and `/update-insights` commands). By every reachability measure it
was fine.

**Insight:** It was fine, and it was still not working, because *written* and
*read* are independent and only one of them leaves evidence. Three domain files
had grown to 151 KB, 141 KB and 129 KB — 32-38k tokens each, every one larger
than the 84 KB CLAUDE.md that had just been split for exactly this reason. The
instructions layered on top had quietly stopped being executable: `/feature`
step 1 said to read `frontend.md` **"(always)"**, and `mfl-api-expert` said
"Before each task: Read `mfl-api.md`". An agent handed 35k tokens of dated
journal skims it, truncates it, or spends its whole budget on it — so the
knowledge is captured, indexed, pointed at, and silently not applied.

The failure is invisible from either side alone. Grep for pointers and the tree
looks well-wired. Check recency and the corpus looks alive. Only holding the
file SIZE against the INSTRUCTION shows it: "read this before each task" is an
honest instruction at 24 KB and a fiction at 141 KB.

**Evidence:** `docs/claude/insights/domains/` — 476 KB across five files, of
which three were >129 KB; `features/` another 568 KB across 41 files that
nothing routes to beyond "if one exists for this feature."

**Recommendation:** For any doc a workflow tells an agent to read, periodically
price the instruction: bytes ÷ 4 ≈ tokens, against what the agent has to spend
before it starts the actual task. Past roughly 60 KB, "read this file" needs to
become "read this file's head, grep the rest" — the shape now enforced by
`tests/insights-curated-head.test.ts`. And when auditing any knowledge store,
measure the read path and the write path separately; a corpus with a healthy
write loop and a broken read loop looks identical to a working one from the
outside, and is strictly worse than a small one, because the effort is being
spent.

## 2026-08-21 - A shallow clone makes every history-based measurement lie

**Context:** While measuring whether the insights corpus was still growing, I ran
`git show "HEAD@{90 days ago}:<file>" | wc -c` against the current size for the
three big domain files, and `git log --since="90 days ago"`.

**Insight:** Claude Code Remote sessions clone shallow. This one had **57 commits
total and a reflog one day deep**, so `HEAD@{90 days ago}` silently resolved to
current HEAD. Two of the three files reported byte-identical "before" and
"after", which reads as a confident "these have not changed in 90 days" — the
exact opposite of the truth, since both had entries from two days prior. The
`--since` count was equally hollow: "3 commits in 90 days" was really 3 of the
only 57 commits that exist locally.

Nothing errors. `git show` on an unresolvable reflog entry falls back rather than
failing, so the number arrives looking like data.

**Evidence:** `git rev-parse --is-shallow-repository` → `true`;
`git reflog | wc -l` → 10, oldest entry the same day;
`git rev-list --count HEAD` → 57 against a repo with years of history.

**Recommendation:** In any CCR session, run
`git rev-parse --is-shallow-repository` before trusting **any** comparison
against a past revision — `HEAD@{...}`, `git log --since`, `git blame` ages,
"has this file changed recently". If it returns true, either
`git fetch --unshallow` first or find a signal inside the working tree instead.
Here the reliable signal was already in the files: the dated `## YYYY-MM-DD`
headings each entry carries. Prefer in-content evidence over git history in a
shallow clone.

## 2026-08-21 - A distilled rule inherits the archive's date but is presented as current

**Context:** Review of the curated-head PR caught a rule I had written into
`frontend.md`'s head: *"AFL login takes `?next=`, TheLeague `?redirect=`."* It
was faithfully distilled from a 2026-07-07 archive entry that said exactly that.
It is also wrong today — both login pages now accept both params and differ only
in precedence, and each one's source comment says it was made symmetric
deliberately ("`?redirect=` for symmetry with TheLeague's login").

**Insight:** Summarizing a dated journal changes the claim's tense. In the
archive the entry is stamped 2026-07-07 and reads as *what was true then*; a
reader who finds it knows to check. Lifted into a head with the date stripped, the
same sentence reads as *what is true now* — and it has been promoted to the one
place agents are told to read **instead of** the archive. So the distillation
step converts a correctly-dated historical record into a confidently-wrong
current rule, and it does it silently, because the source text was accurate when
written and copying it faithfully feels like the careful thing to do.

This is strictly worse than leaving the file at 141 KB. An oversized archive
fails by being skipped; a wrong head fails by being *believed*.

**Evidence:** `src/pages/theleague/login.astro:20` and
`src/pages/afl-fantasy/login.astro:31` — both read
`searchParams.get('next') || searchParams.get('redirect')` (order swapped per
league), each validated with `startsWith` against its own path prefix. The
archive entry that produced the head line is still below it, correctly dated,
and is now explicitly marked stale by the head.

**Recommendation:** When distilling any dated entry into a head, **re-verify the
rule against current code before promoting it** — grep the symbol, open the file,
check the behavior still matches. Budget for this: it is a different and slower
activity than summarizing, and it is the only step that distinguishes a head from
a wiki page nobody trusts. Two habits that make it cheap:

- Prefer rules that name a helper or a guard test (`use getActiveTeams()`,
  `tests/team-accent-css.test.ts` enforces 3:1`) over rules that describe a
  behavior in prose. A named symbol either exists or it doesn't, so the check is
  a grep and the rule rots loudly rather than quietly.
- When a head contradicts an entry below it, say so in the head. The archive is
  immutable history and must not be rewritten, so the head is the only place the
  correction can live — leaving both versions standing with no pointer is how the
  next reader picks the wrong one.
