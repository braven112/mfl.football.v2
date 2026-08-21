# Domain rules

Prescriptive, load-bearing rules for one area of the repo each. Extracted from
`CLAUDE.md` in Aug 2026, when that file had grown to 84 KB — ~21k tokens loaded
into every session on every turn, most of it irrelevant to the task at hand.

**How this differs from the neighbors:**

| Tree | Shape | Read it when |
|---|---|---|
| `CLAUDE.md` | Router + cross-cutting rules | Always (auto-loaded) |
| `docs/claude/rules/` | Prescriptive: "do this, never that" | Before editing in that domain |
| `docs/claude/insights/` | Dated journal: "here's what we learned on X" | Digging into history or prior art |
| `docs/claude/*.md` | Reference: auth, testing, build, league rules | Looking up how something works |

**Adding a rule:** put it in the domain file here. Add a line to `CLAUDE.md`
*only* if it applies to work anywhere in the repo — otherwise the router
regrows into the encyclopedia this split undid. If the rule can be enforced by
a guard test in `tests/`, write the test too: a test is checked, prose is
skimmed.

**Adding a domain:** new file here + a row in the `CLAUDE.md` "Read before you
touch" table. The row's third column is the trap in one line — that sentence is
what stops a mistake before the file is ever opened, so make it concrete.
