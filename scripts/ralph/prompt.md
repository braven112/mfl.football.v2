# Ralph Agent Instructions

You are an autonomous coding agent working on the MFL Football v2 project.

## Your Task

1. Read the PRD at `scripts/ralph/prd.json`
2. Read the progress log at `scripts/ralph/progress.txt` (check Codebase Patterns section first)
3. Check you're on the correct branch from PRD `branchName`. If not, check it out or create from main.
4. Pick the **highest priority** user story where `passes: false`
5. Implement that single user story
6. Run quality checks (e.g., `pnpm run test:unit`, `pnpm run build` check)
7. Update AGENTS.md files if you discover reusable patterns (see below)
8. If checks pass, commit ALL changes with message: `feat: [Story ID] - [Story Title]`
9. Update the PRD (`scripts/ralph/prd.json`) to set `passes: true` for the completed story
10. Append your progress to `scripts/ralph/progress.txt`

## Progress Report Format

APPEND to `scripts/ralph/progress.txt` (never replace, always append):
```
## [Date/Time] - [Story ID]
Thread: [Link to thread if available]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered (e.g., "this codebase uses X for Y")
  - Gotchas encountered (e.g., "don't forget to update Z when changing W")
  - Useful context (e.g., "the evaluation panel is in component X")
---
```

## Consolidate Patterns

If you discover a **reusable pattern** that future iterations should know, add it to the `## Codebase Patterns` section at the TOP of `scripts/ralph/progress.txt` (create it if it doesn't exist). This section should consolidate the most important learnings.

## Update AGENTS.md Files

Before committing, check if any edited files have learnings worth preserving in nearby AGENTS.md files. If you discover reusable knowledge (API patterns, gotchas, testing approaches), add them to the relevant `AGENTS.md`.

## Quality Requirements

- ALL commits must pass project quality checks
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow existing code patterns (Astro, React, TypeScript)

## Stop Condition

After completing a user story, check if ALL stories have `passes: true`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with `passes: false`, end your response normally (another iteration will pick up the next story).

## Important

- Work on ONE story per iteration
- Commit frequently
- Keep CI green
- Read the Codebase Patterns section in progress.txt before starting
