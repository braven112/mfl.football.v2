---
slug: normalize-name-copies
status: open
severity: P3
opened: 2026-09-16
origin: live-quality-pass
found_in_pr: https://github.com/braven112/mfl.football.v2/pull/1123
---

> **Not hotfix debt.** This brief came from `/live`'s code-quality pass (step
> 5c), not from a `/hotfix` deferral, so it has `found_in_pr` rather than
> `hotfix_pr` and no `hotfix-followup` issue behind it. The README's
> `grep '^status: open'` audit is about whether the fast lane gets repaid —
> read this one as a refactor note, not as an unpaid hotfix.

# Follow-up: five `normalizeName` copies, and they do not agree

## What this is

Surfaced by the `/live` quality pass on PR #1123 (snap counts). That PR moved
one of these copies from `scripts/fetch-snap-counts.mjs` into
`scripts/lib/snap-counts.mjs`; it did not add a new one, and deliberately did
not unify them. This is the note so the next person does not re-derive the
survey.

```
src/utils/rankings-parser.ts:30      export function normalizeName  (TS, exported)
scripts/lib/snap-counts.mjs:70       export function normalizeName  (moved by #1123)
scripts/fetch-espn-college-ids.mjs:50  function normalizeName
scripts/schefter-trade-speculation.mjs:289  function normalizeName
scripts/fetch-def-spotlight-players.mjs:124 function normalizeName
```

## Why it is not a one-line fix

**They are not the same function.** The two most-used copies differ in ways
that change which players match:

| | `rankings-parser.ts` | `snap-counts.mjs` |
|---|---|---|
| punctuation | `[^a-z\s]` — also strips DIGITS | strips `.` and `'`, then `[^\w\s]` — KEEPS digits |
| suffixes | one pass, `\s(ii\|iii\|iv\|jr\|sr)$` | seven passes, and it handles a bare ` V` |

So a straight swap silently re-matches (or un-matches) players in whichever
pipeline adopts the other's rules — in snap counts that means a player's usage
row attaching to the wrong MFL id, which is precisely the failure #1123 exists
to stop. Any unification needs a fixture diff of the matched set before and
after, per league, not a refactor on faith.

**And there is a real boundary in the way.** `rankings-parser.ts` is TypeScript
and the other four are node scripts, which cannot import it. Unifying means
either a `.mjs` home that the TS side re-exports (the shape
`src/utils/pecking-order-season-window.mjs` and `snap-count-season.mjs` already
use, so there is precedent) or accepting the copies.

## Suggested shape

1. Put the canonical normalizer in `scripts/lib/` or `src/utils/*.mjs` and have
   `rankings-parser.ts` re-export it.
2. Before switching any caller, diff its matched set against the current one —
   `scripts/fetch-snap-counts.mjs` prints `matched`/`unmatched` counts already,
   and a 20-player swing is invisible in that number alone, so compare ids.
3. Guard it with a test that pins the suffix and punctuation cases the two
   copies disagreed on.

Do not do this while the season is live unless the matched sets come out
identical: these pipelines feed pages owners are reading weekly.
