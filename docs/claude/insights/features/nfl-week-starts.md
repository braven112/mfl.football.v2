# NFL week starts — anchoring league dates to the published schedule

> The RULE lives in `docs/claude/rules/schedule-optimization.md` § "The NFL
> kickoff is not a derivation" and § "The bracket is derived from the NFL's
> season length". This file is the discovery record: the things that cost time
> and are not visible from reading the finished code.

## 2026-09-10 — Roger announced the season a day late

Roger posted "TODAY: NFL Season Starts" to GroupMe on the morning of Thursday
2026-09-10. The 2026 season had opened the night before — the NFL moved the
opener to **Wednesday Sep 9**.

Nothing was hardcoded wrong. The repo had exactly one source for every
season-relative date — "kickoff is the Thursday after Labor Day, week N is
kickoff + (N-1)\*7" — inlined in eight places and hardcoded as a Week 1 map in
six more. It is an estimate, and 2026 breaks it three times (week 1 Wednesday,
week 12 Thanksgiving Wednesday, week 18 all-Sunday). 2024 and 2025 broke it too
(a Christmas Day week 17, week 18 shifted both years); nobody noticed because
nothing was comparing the derivation to reality.

### What the investigation actually turned on

**The derivation being wrong was the easy half.** The expensive half was that
every date expressed as *days counted from kickoff* silently inherited the
error, including dates whose real anchor was something else entirely:

- The rumor mill's awake window opened at `kickoff - 11` and MEANT "the AFL's
  NL draft Sunday, Labor Day - 8". Those coincide only while kickoff is
  Labor Day + 3. Fixing kickoff slid the loud 3-posts-a-day cadence onto AL
  draft Saturday — caught by an existing test, not by review.
- The fantasy bracket's 15/16/17 were literals in four files. They are really
  `NFL final regular-season week - 1, -2, -3`, which is why they all had to be
  hand-corrected when the NFL went from 17 to 18 weeks in 2021.

**The lesson that generalizes:** when a derived constant turns out to be wrong,
the bug is rarely just the constant. Grep for everything expressed as an offset
FROM it and ask, for each one, what its real anchor is. Several will not be the
thing you just fixed.

## MFL `nflSchedule` — export quirks

`api.myfantasyleague.com/<year>/export?TYPE=nflSchedule&W=ALL&JSON=1` is one
request for a whole season. Three things to know:

1. **The shape is `fullNflSchedule.nflSchedule[]`**, one entry per week — NOT
   `nflSchedule` at the top level, which is what a single-week (`W=<n>`) call
   returns. Both exist; they are different payloads from the same TYPE.
2. **It returns 22 weeks, not 18.** Weeks 19-22 are the NFL playoffs and carry
   `matchup: []` until January. So "this week has no kickoffs" is NORMAL for a
   playoff week and a BROKEN payload for a regular-season one — the fetcher
   must treat the two differently or it will reject every good response.
3. **A season the NFL has not published 404s with an HTML body**, so
   `res.json()` throws rather than returning MFL's usual error object. Checked
   2026-09-10: 2027 was Not Found. Read the body as text and try to parse, or
   the "not published yet" path looks like a crash.

Point 3 is why the Labor Day derivation had to survive as a fallback rather
than being deleted: February through May, the next season genuinely has no
official answer and something still has to name a date.

## Regenerating `resolved-events.json` — set TZ or the diff lies

`scripts/compute-league-events.mjs` builds dates with `new Date(year, month,
day)`, i.e. **server-local midnight**, and writes them as UTC instants. The
cron that owns the file runs with `TZ: America/Los_Angeles` (see
`schefter-scan.yml`), so every committed `startDate` ends in `T07:00:00.000Z`.

Regenerating in a UTC container writes `T00:00:00.000Z` instead — the same
calendar date, a different instant, and a whole-file diff that hides the one
line you actually changed. Worse, committing it would shift `calendarDaysUntil`
for anything reading the file in PT.

Always: `TZ=America/Los_Angeles node scripts/compute-league-events.mjs`. The
same applies to running the unit suite when a test asserts on these dates.

## Rebasing this file

`resolved-events.json` (both leagues) conflicts on essentially every rebase —
the cron rewrites it continuously. It is not in `resolve-rebase-conflicts.mjs`'s
auto-generated list, so it lands as a manual conflict. Take main's copy
(`--ours` under rebase) through every conflicted step, then regenerate once at
the end with the TZ set and commit that. Merging it row-by-row is wasted work:
the file is fully derived from the event definitions plus the clock.
