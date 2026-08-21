Review what was built or changed in this branch and record any learnings worth keeping for future sessions.

## Step 1: Understand what changed

Run:
```bash
git diff main...HEAD --name-only
git log main...HEAD --oneline
```

If there are no commits ahead of main, say "Nothing to record." and stop.

## Step 2: Identify relevant domains

Based on the changed files, determine which insight domains are in play:

| Changed files | Domain file |
|---------------|-------------|
| `src/components/`, `src/pages/`, `src/styles/` | `docs/claude/insights/domains/frontend.md` |
| Design tokens, CSS variables, editorial patterns | `docs/claude/insights/domains/design-system.md` |
| MFL API calls, `src/pages/api/`, auth flows | `docs/claude/insights/domains/mfl-api.md` |
| ARIA, keyboard nav, focus management | `docs/claude/insights/domains/accessibility.md` |

Also check if a feature-specific file exists: `docs/claude/insights/features/{feature-name}.md`

## Step 3: Read the relevant insight files

Read only the domain files that apply — and for `frontend.md`, `design-system.md`
and `mfl-api.md`, read only the **curated head** (above `<!-- /CURATED-HEAD -->`).
`grep -n` the archive below it for your specific topic; never read it whole.
You're looking for gaps, not re-reading everything.

**If your learning changes a rule in the head, update the head too** — a new
dated entry that contradicts the head silently leaves the wrong rule in the
place everyone actually reads. Keep each head under 8 KB
(`tests/insights-curated-head.test.ts` enforces this): the head holds the rule,
the archive holds the evidence.

## Step 4: Evaluate what's worth recording

Ask yourself: *Would a future Claude session, starting cold on this codebase, benefit from knowing this?*

Record insights for:
- Patterns that weren't obvious from the code (e.g., "MFL returns a single object instead of array when there's only one result — always normalize")
- Gotchas discovered during this work (e.g., "the `strict` field in branch protection requires the full PUT, not a PATCH")
- Reusable patterns worth calling out (e.g., "use `initPlayerModalTrigger()` once on the container, not per-row")
- Performance or architecture decisions with non-obvious reasoning

Do NOT record:
- Things already in the insight files
- Things derivable from reading the code
- Temporary state or in-progress work
- Anything already in CLAUDE.md or `docs/claude/rules/*.md`

## Step 5: Write the insights

Use the format from `docs/claude/insights/README.md`.

For **domain insights** — append to the relevant section in the domain file.

For **feature-specific insights** — create `docs/claude/insights/features/{feature-name}.md` if it doesn't exist, or append to it.

If nothing new is worth recording, say "No new insights — patterns already documented." and stop.

## Step 6: Confirm

Tell the user:
- Which insight file(s) were updated
- A one-line summary of each insight added
- If nothing was added and why
