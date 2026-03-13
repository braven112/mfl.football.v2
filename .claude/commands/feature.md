Run the full feature development pipeline. You are the Scrum Master orchestrating the agent team. The user is the Product Owner who approves at each gate.

If the user provided a feature description with this command, use it. If not, ask: "What feature do you want to build?" and wait for their response before proceeding.

## Step 1: Pre-flight — Write the Story

Do these three things immediately:

1. **Read the story template** at `docs/claude/story-template.md` — this is your format.

2. **Read relevant insight files** to understand existing patterns:
   - `docs/claude/insights/domains/frontend.md` (always)
   - `docs/claude/insights/domains/design-system.md` (if UI work)
   - `docs/claude/insights/domains/mfl-api.md` (if API work)
   - `docs/claude/insights/domains/accessibility.md` (if new interactive UI)
   - `docs/claude/insights/features/{feature}.md` (if one exists for this feature)

3. **Write a structured story** filling in the template with:
   - User story, acceptance criteria, technical context, design requirements
   - Specific file paths for agents to read (not "explore the codebase")
   - Which agents run in which phases

4. **Present the story to the user** and ask: "Does this story look right? Any requirements missing?"

**GATE:** User approves the story before you proceed to Step 2.

---

## Step 2: Design

1. **Launch the `frontend-ux-architect` agent** with the story context. Include in the prompt:
   - The user story and acceptance criteria
   - Specific file paths from "Existing Patterns to Reuse"
   - The relevant editorial design standard section from CLAUDE.md
   - Any existing similar page/component to reference

   Ask the agent to produce:
   - Component/page structure (what components, how they compose)
   - Design token usage plan (which tokens for colors, spacing, typography)
   - Accessibility requirements (WCAG AA: keyboard nav, ARIA, contrast)
   - Responsive strategy (mobile-first, breakpoints, layout shifts)
   - Data flow (what data is needed, where it comes from, what goes to the client)

2. **If the feature involves a new page or major component restructuring**, also include in the frontend-ux-architect prompt a request for rendering strategy advice:
   - Should the page use `prerender = true` (static) or SSR?
   - Which components need React hydration and which directive?
   - What data should be processed in frontmatter vs shipped to the client?

3. **Present the design spec to the PO.** Summarize the key decisions and ask for approval. If the PO requests changes, re-run the agent with feedback.

**GATE:** PO says "approved", "looks good", "go ahead", or similar.

---

## Step 3: Implement

Build the feature based on the approved design spec. Follow these mandatory patterns:

- **Team names:** Use `chooseTeamName()` with the appropriate context (`default`, `short`, `abbrev`)
- **Player display:** Use `PlayerCell.astro` (server) or `buildPlayerCellHTML()` (client)
- **Editorial standard:** Section titles (uppercase + left-border), typography scale, `tabular-nums` for numbers
- **CSS tokens:** Use design tokens with fallbacks: `var(--color-gray-700, #374151)`
- **Year utilities:** `getCurrentLeagueYear()` for roster/contract features, `getCurrentSeasonYear()` for standings/results
- **Defensive coding:** Handle empty states, loading states, error states

After implementation, verify compilation:
```bash
pnpm build
```

**GATE:** Build succeeds without errors.

---

## Step 4: QA

1. **Launch `qa-investigator` and `qa-api-debugger` IN PARALLEL** (single message, two Agent tool calls):

   **qa-investigator prompt:** Include the story's code path trace — the specific files and execution chain to verify (UI trigger → handler → API → response → UI update). Give it specific file paths, not "explore the codebase."

   **qa-api-debugger prompt:** Include the specific API endpoints to test (internal Astro routes and/or external MFL API calls). Give it the expected request/response format. **Skip this agent if the feature has no API calls.**

2. **Review their findings:**
   - If both report all paths WORKING → proceed to Phase 4
   - If issues found → Launch `qa-principal-engineer` with both investigation reports. The principal engineer architects and implements fixes.
   - After fixes, re-run `qa-investigator` to verify (max 2 fix-verify cycles)

**GATE:** QA agents report all code paths working. No MISSING or BROKEN statuses remain.

---

## Step 5: Review

Launch **all three reviewers IN PARALLEL** (single message, three Agent tool calls). Each focuses on non-overlapping concerns to avoid duplicate work:

1. **`code-reviewer`** (haiku — fast, pattern-matching):
   - Design token compliance (no hardcoded colors/spacing)
   - DRY principles (no duplicated logic)
   - CLAUDE.md guideline adherence (team names, player display, year utilities)
   - TypeScript type safety

2. **`astro-performance-expert`** (sonnet — checklist-based):
   - Hydration directive correctness (`client:load` vs `client:visible` vs `client:idle`)
   - Rendering strategy (prerender where possible)
   - Bundle impact (inline scripts, data serialization)
   - Data loading efficiency (frontmatter filtering, client payload size)

3. **`frontend-ux-architect`** (opus — deep reasoning):
   - Accessibility audit (keyboard nav, ARIA, contrast, screen reader)
   - UX quality (responsive behavior, loading/empty/error states)
   - Component reusability (could this be abstracted for other pages?)
   - Design consistency (editorial standard compliance)

**For each agent prompt:** Include only the specific files that were created or modified, not the entire codebase. Reference the story's "Prompt Context Per Agent" section.

**After reviews:**
- If no Critical findings → proceed to Phase 5
- If Critical findings → fix them, then re-run ONLY the specific reviewer that flagged the issue (not all three)
- Important findings → fix if quick, otherwise document for follow-up

**GATE:** No Critical issues remain across all three reviews.

---

## Step 6: Ship

1. **Run the test suite:**
   ```bash
   pnpm test
   ```
   If tests fail, fix and re-run.

2. **Run the production build:**
   ```bash
   pnpm build
   ```
   If build fails, fix and re-run.

3. **Update What's New** (check which applies):
   - **New page / new feature / enhancement** → Add entry to `src/data/whats-new.json` with editorial voice, screenshot, and all required fields (see CLAUDE.md "What's New Changelog" section)
   - **Bug fix / style tweak** → Add entry to `src/data/weekly-changelog-staging.json`
   - **Internal / refactor / data sync** → No entry needed

4. **Present the Ship Summary:**
   ```
   ## Feature Complete: [Title]

   **Files created:** [list]
   **Files modified:** [list]
   **Key decisions:** [1-2 sentences on major design/architecture choices]
   **Review status:** All reviews passed (code-reviewer ✅, astro-perf ✅, frontend-ux ✅)
   **What's New:** [Updated / Not applicable]

   Ready for `/test` (Vercel preview) or merge to main.
   ```

**GATE:** Tests and build both pass.

---

## Step 7: Retrospective

This phase runs automatically after Phase 5 — no gate needed.

1. **Review all agent outputs** from this feature (design spec, QA reports, review findings)

2. **Extract 1-3 key insights** — things learned that will help future features:
   - Patterns that worked well
   - Gotchas discovered
   - Performance decisions and their rationale
   - Accessibility approaches worth reusing

3. **Write insights** to the appropriate files using the format in `docs/claude/insights/README.md`:
   - Cross-cutting learnings → `docs/claude/insights/domains/{domain}.md`
   - Feature-specific learnings → `docs/claude/insights/features/{feature}.md` (create if new)

4. **Update MEMORY.md** if the feature revealed significant architectural patterns or project conventions worth preserving across sessions.

---

## Token Efficiency Rules

Follow these rules to minimize token waste across all agent launches:

1. **Don't paste full CLAUDE.md** into agent prompts. Embed only the section relevant to the feature (e.g., "Player Display" for player-facing work, "Editorial Design Standard" for UI work).

2. **Give agents specific file paths** to read. Instead of "explore the rosters page," say "read `src/pages/theleague/rosters.astro` lines 1-100 for the data loading pattern."

3. **Pre-load insight context** from the story template. The story's "Prompt Context Per Agent" section lists exactly what each agent needs.

4. **Scope agent output format.** Tell each agent what deliverable you expect:
   - frontend-ux-architect → "produce a design spec"
   - qa-investigator → "produce an investigation report"
   - code-reviewer → "produce a review with Critical/Important/Suggestion findings"
   - astro-performance-expert → "produce a performance report using your standard format"

5. **Don't duplicate concerns across agents.** Each Phase 4 reviewer has a defined lane — don't ask the code-reviewer to also check accessibility (that's the frontend-ux-architect's job).

---

## Quick Reference: Agent Roster

| Agent | Model | Phase | Focus |
|-------|-------|-------|-------|
| frontend-ux-architect | opus | 1, 4 | Design, a11y, UX, responsive |
| code-reviewer | haiku | 4 | Tokens, DRY, guidelines |
| astro-performance-expert | sonnet | 4 | Hydration, bundle, rendering |
| qa-investigator | sonnet | 3 | Code path tracing |
| qa-api-debugger | sonnet | 3 | Live API testing |
| qa-principal-engineer | opus | 3 (if issues) | Implements fixes |
