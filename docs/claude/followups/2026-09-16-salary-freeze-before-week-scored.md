---
slug: salary-freeze-before-week-scored
status: open
severity: P3
opened: 2026-09-16
found_by: the salary-points doubling repair (scripts/repair-salary-points-doubling.mjs)
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: salary data freezes when week 14 STARTS, not when it is scored

## What was found

`update-salary-averages.mjs` freezes a season's player salary snapshot at
`MFL_FREEZE_WEEK` (default 14):

```js
// scripts/update-salary-averages.mjs, ~line 934
let effectiveWeek = lockedWeek ?? (freezeWeek && detectedWeek >= freezeWeek ? freezeWeek : detectedWeek);
if (!lockedWeek && freezeWeek && detectedWeek >= freezeWeek) { lockedWeek = freezeWeek; … }
```

`detectedWeek` is MFL's current week, which becomes 14 when week 14 BEGINS.
So the first cron run of week 14 freezes the snapshot before most of week 14
has been played. Everything written after that is preserved as frozen.

The doubling repair proved it on real data: two of the three committed 2025
copies (`src/data/` and `data/theleague/`) say `frozenWeek: 14` but hold weeks
1-13 exactly — the original summation reproduces them at cutoff 13, not 14.
They were written at `2025-12-06T01:25Z`, i.e. Friday Dec 5 Pacific, before
week 14 was scored. The third copy (`src/data/theleague/`) was regenerated in
February and does hold weeks 1-14, so the three copies disagree about 2025.

2007-2024 are unaffected: they reproduce at 14 because they were built after
those seasons ended.

## Why it was not fixed with the doubling

The doubling repair was deliberately limited to the double count, and proved
per file that it changed nothing else. Adding week 14 to the two short 2025
copies would move their totals for a different reason, and belongs in its own
diff.

## The fix

Freeze on a COMPLETED week rather than a started one: freeze when
`detectedWeek > freezeWeek` (week 15 has begun, so 14 is final), or gate on
the week's end via `nflWeekEndIsoDate` in `src/utils/nfl-week-starts.mjs`.
Check what "frozen at 14" is supposed to mean first — if the intent is "the
season as of the trade/contract deadline", the right boundary may be a
calendar event, not a week count.

Then bring the two 2025 copies up to a full week 14 so all three agree. Note
Dead Money and MVP read `src/data/`, which is one of the short copies.

## Verification

After the change, the three `mfl-player-salaries-2025.json` copies should
reproduce at the same cutoff, and a freeze during a live season should record
the freeze week's final scores.
