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

# Follow-up: four private copies of the same HTML escaper in `src/utils/`

## What was found

The Set Lineup bench fix (#1120) needed to escape values for an
`innerHTML` string, and the quality pass found it was about to add the **fifth**
byte-identical private `esc()` in `src/utils/`. None of the existing four was
exported, which is exactly why there were four:

| File | Escapes |
|---|---|
| `src/utils/player-cell-html.ts` | `& < > "` |
| `src/utils/loading-html.ts` | `& < > " '` |
| `src/utils/afl-waiver-order.ts` | `& < > "` |
| `src/utils/waiver-priority-render.ts` | `& < > "` |

They are not quite interchangeable: `loading-html.ts` also escapes the
apostrophe. That difference is invisible today because every call site in all
four modules interpolates into **double**-quoted attributes or text — but it
means a naive "replace all four with one import" is a behaviour change for
whichever body is not chosen, and it is why this was not folded into #1120.

## What #1120 did

Exported `player-cell-html.ts`'s copy as `escapeHtml` and imported it in the new
`src/utils/lineup-bench.ts`, so the fifth copy never landed. The other four are
untouched.

## What the follow-up should do

1. Pick the **superset** body (`& < > " '`) — escaping the apostrophe is never
   wrong for a double-quoted attribute and is required for a single-quoted one,
   so the superset is safe for all current call sites.
2. Give it a real home rather than leaving it exported from a player-cell
   module — `src/utils/html-escape.ts`, or an existing string-utils module if
   one fits.
3. Re-point all five importers, and delete the private copies.
4. Consider a scan guard (`/guard-test`): a private `function esc` whose body
   is the `&amp;/&lt;/&gt;` chain in `src/utils/` should fail, naming the
   shared util. That is what stops the sixth copy — the rule is mechanical and
   nobody will remember it otherwise.

## Why it was deferred

Behaviour-preserving only if step 1's reasoning holds for every call site
across four modules, each of which would need its own read. #1120 is a bug fix
shipping in the week owners are setting lineups; widening it into a four-file
sweep of every HTML-emitting util is the wrong trade against that clock.
