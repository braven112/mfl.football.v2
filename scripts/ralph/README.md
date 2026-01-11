# Ralph - Autonomous AI Coding Agent

Ralph is an autonomous coding agent that works through a Product Requirements Document (PRD) by implementing user stories one at a time.

## Setup

Ralph supports **three AI providers**: Gemini, Claude, and Codex.

### Prerequisites

- **For Gemini:** Install the `gemini` CLI
- **For Claude:** Install the `claude` CLI
- **For Codex:** Install the `codex` CLI

## Usage

### Basic Usage

```bash
# Run with Gemini (default)
./ralph.sh 10

# Run with Claude
./ralph.sh 10 claude

# Run with Codex
./ralph.sh 10 codex

# Using environment variable
AI_PROVIDER=claude ./ralph.sh 10
AI_PROVIDER=codex ./ralph.sh 10
```

### Parameters

- `[max_iterations]` - Maximum number of iterations before stopping (default: 10)
- `[ai_provider]` - AI provider to use: `gemini`, `claude`, or `codex` (default: `gemini`)
- `CODEX_FLAGS` (optional) - Extra flags passed to the `codex` CLI (e.g., auto-approval)

### How It Works

1. Reads the PRD from `prd.json`
2. Reads the progress log from `progress.txt` (check "Codebase Patterns" first)
3. Picks the highest priority story with `passes: false`
4. Implements that story
5. Runs quality checks (build, tests)
6. Commits changes with format: `feat: [Story ID] - [Story Title]`
7. Updates `prd.json` to mark story as complete
8. Appends progress to `progress.txt`
9. Repeats until all stories pass or max iterations reached

### Auto-Approval Flags

Ralph uses autonomous execution flags to run without manual intervention:

- **Gemini:** `--yolo` (auto-accept tool calls)
- **Claude:** `--dangerously-skip-tool-approval` (auto-accept tool calls)

### Archiving

When you switch branches (change `branchName` in `prd.json`), Ralph automatically:
- Archives the previous run to `archive/YYYY-MM-DD-branch-name/`
- Resets `progress.txt` for the new run
- Tracks the last branch in `.last-branch`

## Files

- **`ralph.sh`** - Main autonomous loop script
- **`prompt.md`** - Agent instructions
- **`prd.json`** - Product Requirements Document with user stories
- **`progress.txt`** - Running log of completed work and learnings
- **`.last-branch`** - Tracks current branch for archiving
- **`archive/`** - Archived runs from previous branches

## Guardrails (safety)

- Refuses to run on `main`/`master`; switches or creates the branch from `prd.json`.
- Uses iteration timeout (default 15m) when `timeout`/`gtimeout` is available.
- Fails the iteration if the AI command exits non-zero; stops after 3 identical failures.
- Asserts that the targeted story (highest priority `passes: false`) is marked `passes: true` after each iteration; otherwise stops.
- Honors `<promise>COMPLETE</promise>` output and exits.

## Stop Condition

Ralph will automatically stop and exit when:
1. All user stories have `passes: true`
2. It detects `<promise>COMPLETE</promise>` in output

Otherwise, it continues until reaching `max_iterations`.

## Example Workflow

```bash
# Start a new feature branch
git checkout -b ralph/new-feature

# Create PRD
cat > scripts/ralph/prd.json <<EOF
{
  "project": "MFL Football v2",
  "branchName": "ralph/new-feature",
  "description": "Add new feature",
  "userStories": [
    {
      "id": "US-001",
      "title": "Implement Feature",
      "priority": 1,
      "passes": false
    }
  ]
}
EOF

# Run Ralph with Claude
./ralph.sh 20 claude

# Or with Gemini
./ralph.sh 20 gemini
```

## Quality Requirements

- All commits must pass project quality checks
- Never commit broken code
- Keep changes focused and minimal
- Follow existing code patterns

## Tips

1. **Start with fewer iterations** (5-10) for new features to catch issues early
2. **Check progress.txt** regularly to see what Ralph has learned
3. **Read "Codebase Patterns"** section in progress.txt before starting
4. **Update AGENTS.md** files when discovering reusable patterns
5. **Switch providers** if one gets stuck (Claude vs Gemini have different strengths)
