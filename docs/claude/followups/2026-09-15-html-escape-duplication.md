---
slug: html-escape-duplication
status: open
severity: P3
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1120
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: eleven private copies of the same HTML escaper

## What was found

The Set Lineup bench fix (#1120) needed to escape values for an `innerHTML`
string, and the quality pass found it was about to add the **twelfth**
hand-typed `&amp;/&lt;/&gt;/&quot;` chain in `src/`. Nothing exported one,
which is precisely why there were eleven:

```bash
grep -rln "replace(/&/g, '&amp;')" src/    # 11 files
```

| File | Also escapes `'` |
|---|---|
| `src/utils/player-cell-html.ts` | no |
| `src/utils/loading-html.ts` | **yes** |
| `src/utils/afl-waiver-order.ts` | no |
| `src/utils/waiver-priority-render.ts` | no |
| `src/components/shared/WaiverClaimsPanel.astro` | no |
| `src/scripts/transaction-hub.ts` | no |
| `src/pages/theleague/rosters.astro` | no |
| `src/pages/theleague/players.astro` | no |
| `src/pages/theleague/projected-free-agents.astro` | no |
| `src/pages/afl-fantasy/players.astro` | no |
| `src/pages/afl-fantasy/trade-builder.astro` | no |

They are **not** interchangeable: `loading-html.ts` also escapes the
apostrophe. That difference is invisible today only because every call site
interpolates into double-quoted attributes or text — so a naive "replace all
eleven with one import" silently changes behaviour for whichever body is not
chosen. That is why this was not folded into #1120. (The apostrophe column was
derived by grepping each file for `&#39;`; verify per file before relying on
it.)

Note the last five are page/component-local copies, which the two-league
sibling pairs duplicate again — `players.astro` carries one on each side.

## What #1120 did

Exported `player-cell-html.ts`'s copy as `escapeHtml` and imported it from the
new `src/utils/lineup-bench.ts`, so the twelfth never landed. The other eleven
are untouched.

## What the follow-up should do

1. Adopt the **superset** body (`& < > " '`). Escaping the apostrophe is never
   wrong for a double-quoted attribute and is required for a single-quoted one,
   so the superset is safe for every current call site — but confirm that claim
   against the ~5 call sites that build single-quoted inline handlers
   (`buildHeadshotOnerror` in `src/constants/roster-constants.ts` emits
   `this.src='…'`, which is exactly the shape where this matters).
2. Give it a real home rather than leaving it exported from a player-cell
   module: `src/utils/html-escape.ts`.
3. Re-point all twelve importers and delete the private copies. The page-local
   ones must land on BOTH sides of each sibling pair — `players.astro` is one
   of the pairs `docs/claude/rules/` warns about.
4. Add a scan guard (`/guard-test`): a private escaper body in `src/` should
   fail the build naming the shared util. That is what stops the thirteenth —
   the rule is mechanical and nobody will remember it.

## Why it was deferred

Behaviour-preserving only if step 1 holds across eleven files, five of which
are inside pages whose client scripts run in the browser. #1120 is a bug fix
shipping in the week owners are setting lineups; widening it into an
eleven-file sweep of every HTML-emitting surface is the wrong trade against
that clock.
