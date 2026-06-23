Evaluate whether the current changes require a What's New or changelog entry, then write it.

## Step 1: Understand what changed

Run:
```bash
git diff main...HEAD --name-only
git log main...HEAD --oneline
```

If there are no commits ahead of main, say "Nothing to document." and stop.

## Step 2: Classify the change

Read the commit messages and changed file list to determine which category applies:

| Category | What it looks like |
|----------|-------------------|
| `new-page` | New file under `src/pages/` |
| `new-feature` | New interactive element, tool, or mode on an existing page |
| `enhancement` | Meaningful change to how an existing feature works |
| `bug-fix` | Fix to broken behavior |
| `style-tweak` | Visual-only polish, no behavior change |
| `skip` | Refactor, data sync, internal tooling, test-only, docs-only |

## Step 3: Route to the right file

**If `new-page`, `new-feature`, or `enhancement`:**

Read `src/data/whats-new.json` (first 30 lines is enough to see the schema).

Check if an entry already exists for this change (matching `link` path or `id`). If it does, confirm it's current and stop.

If no entry exists, write a new one at the TOP of the array following the mandatory editorial voice from CLAUDE.md:
- 2-3 paragraph `description` with opening hook, feature details, and callback close
- Witty, self-aware, columnist voice — never dry release notes
- Include a `summary` with personality too
- `image` and `imageAlt` are required — take a Playwright screenshot if a dev server is running, otherwise note that a screenshot is still needed and set a placeholder filename

**If `bug-fix` or `style-tweak`:**

Read `src/data/weekly-changelog-staging.json`.

Append an entry to the `changes` array:
```json
{
  "date": "<today YYYY-MM-DD>",
  "type": "bug-fix | style-tweak",
  "summary": "<user-facing description of what changed and why it matters>",
  "impact": "user | admin",
  "area": "<closest match: free-agents | rosters | navigation | design-system | homepage | rankings | trade-builder | salary | league-summary | calendar | standings | playoffs | mvp | import-rankings | whats-new | other>"
}
```

Write `summary` as a user-facing improvement, not a code description.

**If `skip`:**

Say "No What's New entry needed — change is internal." and stop.

## Step 4: Confirm

Tell the user:
- Which file was updated (`whats-new.json` or `weekly-changelog-staging.json`)
- The entry title/summary that was written
- If a screenshot is still needed, say so explicitly
