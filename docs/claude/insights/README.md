# AI Insights System

This folder contains institutional knowledge captured by AI agents during development. Insights improve work quality by preserving learnings across sessions.

## Structure

```
insights/
├── README.md                    # This file
├── domains/                     # Cross-cutting knowledge by domain
│   ├── frontend.md              # UI/UX patterns, component architecture
│   ├── design-system.md         # Design tokens, CSS variables, theming
│   ├── mfl-api.md               # MFL API quirks, authentication, data formats
│   └── accessibility.md         # A11y patterns, ARIA usage
└── features/                    # Feature-specific learnings
    ├── nav-redesign.md          # Navigation drawer insights
    ├── auction-predictor.md     # Auction predictor insights
    └── {feature-name}.md        # New features get their own file
```

## Workflow

### Before Starting a Task

1. **Identify relevant insight files** based on:
   - Feature being worked on → check `features/{feature}.md`
   - Domains involved → check `domains/{domain}.md`

2. **Read the relevant files** to understand:
   - Past decisions and why they were made
   - Gotchas and pitfalls to avoid
   - Patterns that worked well
   - Open questions still unresolved

### After Completing a Task

1. **Record learnings** in the appropriate file(s):
   - What worked well
   - What didn't work and why
   - Gotchas discovered
   - Patterns worth reusing
   - Decisions made and rationale

2. **Use the standard format** (see below)

## Insight Entry Format

```markdown
## [Date] - [Brief Title]

**Context:** What were you trying to do?

**Insight:** What did you learn?

**Evidence:** Code location, error message, or example

**Recommendation:** How should future work handle this?
```

### Example Entry

```markdown
## 2026-01-18 - MFL API Does Not Pass Franchise ID in Redirects

**Context:** Implementing team verification flow for nav redesign

**Insight:** MFL's login redirect (`/login?L={id}&URL={return}`) does NOT include
the user's franchise_id in the return URL. The redirect only takes users back -
no identity is passed.

**Evidence:** Researched via mfl-api-expert agent. Confirmed by existing code in
`src/utils/mfl-login.ts` which uses `myleagues` API to get franchise_id after
credential validation.

**Recommendation:** For team verification, either:
1. Use the existing login form + myleagues API pattern
2. Use a custom MFL page with a script that adds `?myteam={id}` to return links
```

## Guidelines

- **Be specific** - Vague insights aren't useful
- **Include evidence** - File paths, error messages, API responses
- **Explain the "why"** - Future readers need context
- **Keep entries focused** - One insight per entry
- **Cross-reference** - Link to related insights or docs when relevant
- **Update, don't duplicate** - If an insight evolves, update the existing entry
