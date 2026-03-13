# Story Template

Use this template during the `/feature` Pre-flight phase to write a structured story that agents can execute autonomously. The template pre-computes context so agents receive specific file paths and instructions instead of spending tokens searching.

---

## Template

Copy and fill in the sections below:

```markdown
# Story: [Feature Title]

## User Story
As a [league member / commissioner / guest], I want [capability] so that [benefit].

## Acceptance Criteria
- [ ] [Testable, specific criterion — what the user can do or see]
- [ ] [Another criterion]
- [ ] [Edge case handling]
- [ ] pnpm test passes
- [ ] pnpm build succeeds

## Technical Context

### Files to Create
- `src/pages/theleague/[page].astro` — [purpose]
- `src/components/theleague/[Component].astro` — [purpose]

### Files to Modify
- `src/pages/theleague/[existing].astro` — [what changes, approximate line range]
- `src/data/nav-config.json` — [add nav entry if new page]

### Data Sources
- [MFL API endpoint, JSON file path, or computed data]
- [Year utility: getCurrentLeagueYear() | getCurrentSeasonYear()]

### Existing Patterns to Reuse
- `src/components/theleague/PlayerCell.astro` — Player display lockup
- `src/utils/team-names.ts` → `chooseTeamName()` — Team name overflow prevention
- `src/utils/salary-calculations.ts` — Cap math (if salary-related)
- [Other specific utilities or components with file paths]

## Design Requirements

### Layout
- **Desktop:** [description of desktop layout]
- **Mobile:** [description of mobile adaptation, breakpoint: 640px]

### Editorial Patterns
[Check which apply:]
- [ ] Section titles (uppercase + left-border accent)
- [ ] Section titles with subtitles (.section-header)
- [ ] Detail rows (flex rows with fixed-width labels)
- [ ] Key metrics strip (3-column grid, gray-50 bg cards)
- [ ] Data table (sticky headers, hover rows, tabular-nums)
- [ ] Player lockup (PlayerCell.astro)
- [ ] Team name display (chooseTeamName)

### Rendering Strategy
- [ ] `prerender = true` (static content, no auth needed)
- [ ] SSR (needs auth, user-specific data, or real-time data)
- [ ] Mixed (page SSR, some components prerendered)

## Agent Sequence

### Phase 1: Design
- **frontend-ux-architect** — Design component structure, token usage, a11y, responsive

### Phase 2: Implement
- **main session** — Build from approved design spec

### Phase 3: QA
- **qa-investigator** — Trace code path end-to-end [+ specific paths to verify]
- **qa-api-debugger** — Test API endpoints [if applicable, list endpoints]

### Phase 4: Review
- **code-reviewer** — Tokens, DRY, CLAUDE.md compliance
- **astro-performance-expert** — Hydration, bundle, rendering, data loading
- **frontend-ux-architect** — Final a11y + UX review

## Prompt Context Per Agent

### frontend-ux-architect (Phase 1)
- Read: [specific CLAUDE.md section relevant to this feature]
- Reference: [existing similar page/component for patterns]
- Focus: [specific design challenges for this feature]

### qa-investigator (Phase 3)
- Trace: [UI trigger] → [handler] → [API route] → [MFL API] → [response] → [UI update]
- Key files: [list the files in the feature's code path]

### astro-performance-expert (Phase 4)
- Check: [rendering strategy decision, hydration directives used]
- Verify: [data loading approach, bundle impact]

## Done Definition
- [ ] All acceptance criteria met
- [ ] pnpm test passes
- [ ] pnpm build succeeds
- [ ] No Critical review findings remain
- [ ] Insights documented in `docs/claude/insights/`
- [ ] What's New entry added (if new page / feature / enhancement)
- [ ] Weekly changelog entry added (if bug fix / style tweak)
```

---

## Guidelines

### Writing Good Acceptance Criteria
- **Testable:** Can be verified by looking at the page or running a test
- **Specific:** "User sees salary in $X.XXM format" not "salary displays correctly"
- **User-focused:** Describe what the user experiences, not implementation details
- **Edge cases:** Include empty states, error states, mobile behavior

### Pre-Computing Context
The "Prompt Context Per Agent" section is critical for token efficiency. Instead of telling agents to "explore the codebase," give them:
- Specific file paths to read
- The exact CLAUDE.md section relevant to the feature
- An existing similar feature to reference for patterns
- Clear scope of what to evaluate (not "review everything")

### When to Skip Agents
Not every feature needs every agent:
- **Skip qa-api-debugger** if the feature has no API calls
- **Skip astro-performance-expert in Phase 1** if it's a small enhancement (run in Phase 4 only)
- **Skip qa-principal-engineer** if Phase 3 QA finds no issues
