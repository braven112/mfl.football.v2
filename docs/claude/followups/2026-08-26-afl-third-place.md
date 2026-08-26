---
slug: afl-third-place
status: shipped
severity: n/a
opened: 2026-08-26
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/624
hotfix_sha: 2c8a41a
followup_issue:
followup_pr: https://github.com/braven112/mfl.football.v2/pull/625
followup_session: session_01JMwqhbD4W2ERCTjoVgmVaU
---

# Follow-up: third place is never recorded for the AFL

**This brief was written retroactively, by `/followup`.** PR #624 shipped
through `/live`, not `/hotfix`, so no brief existed — the item below was
deferred in the merge report rather than in a file, which is exactly the
"silently vanished item" the README warns about. Recreated here so the
deferral has an audit trail like any other.

Note the severity field is `n/a` for the same reason: nothing was outranked by
a clock. The item was deferred because it is a DIFFERENT bug of the same class,
found while reviewing the fix for the first one, and folding it in would have
widened a PR that was already regenerating derived data across two leagues.

## What broke

`getChampionshipResult` in `scripts/compute-franchise-history.mjs` hardcoded
`bracketsList['2']` as the third-place bracket. For the AFL from 2018 bracket 2
is `AL Championship` — a conference semifinal bracket, not a placement game —
so the value it produced was always the eventual champion or runner-up, and the
`else if` chain at `:977` claimed that franchise first. Third place was
therefore **never recorded for the AFL: 0 of 23 seasons.**

This is the same hardcoded-bracket-id bug PR #624 fixed one function above it,
in `getPlayoffParticipants`. Both were flagged by the same rule in
`docs/claude/rules/standings-brackets-draft-order.md`, which PR #624 extended.

## What the hotfix did

PR #624 fixed the participant reader (playoff berths) and, on the UI side,
stopped `finalsSubtitle` claiming "no other podium finishes" — which had turned
this missing data into a positive claim of absence. It did **not** recover the
missing third places. The gap was reported in the merge summary.

## Deferred items

- [x] **F1 — Resolve the third-place bracket by name, not by id**
  - Source: Copilot review of PR #624, relayed and confirmed in
    https://github.com/braven112/mfl.football.v2/pull/624#discussion_r3859408543
  - Where: `scripts/compute-franchise-history.mjs:336` (`// 3rd place = bracket "2"`)
  - Why deferred: a different bug from the one the PR was fixing, and the fix
    regenerates championship-derived data across both leagues — a second
    regeneration inside a PR already carrying one

- [x] **F2 — Recover third place for the seasons whose export has no ids**
  - Source: same finding; the recovery path is the one PR #624 established
  - Where: `scripts/compute-franchise-history.mjs:791`, reading
    `data/afl-fantasy/derived/reconstructed-playoff-brackets.json`
  - Why deferred: with F1
  - Note: MFL's AFL export carries franchise ids only from 2024, and
    `championship-history.json` has no `thirdPlace` key at all, so F1 alone
    recovers only 2024-2025

- [x] **F3 — Guard test: a resolved third place is never the champion or runner-up**
  - Source: this session — the invariant whose violation IS the bug
  - Where: `tests/playoff-field-size.test.ts` or a sibling
  - Why deferred: n/a, new here. Per `/followup` step 4 the guard test is not
    optional

## Context to start cold

Verified before building, on the committed data:

- **Every AFL season 2004-2025 can resolve a third place** — 22 seasons. Each
  candidate is already a playoff participant and none collides with that
  season's champion or runner-up, which is a strong independent check that the
  era rule below is right.
- **The era rule.** 2004-2017: bracket 2, the 6-team `AFL Losers Bracket` /
  `AFL Consolation Bracket`, whose FINAL winner is third (the rules doc already
  states this: "they won the AFL Losers Bracket; 2nd is the title-game loser").
  2018-2025: bracket 4, `AFL 3rd Place Game`, a direct 2-team game. 2003 has no
  game log at all and is permanently unrecoverable.
- **2006 has two candidate brackets** — `2 AFL Losers Bracket` (w15) and
  `3 AFL Losers Bracket Placing Games` (w16). The earlier one is the decider.
- **TheLeague needs no fix and must not get the AFL's rule.** Its bracket 2 has
  always been the third-place bracket (renamed `3rd Place Bracket` in 2025) and
  is correct today. It resolves in only 3 of 19 seasons (2020, 2023, 2025)
  because bracket 2 is ABSENT from the committed feed for 2007-2018, 2021 and
  2022, and present-but-idless for 2019 and 2024 — a data ceiling, not a bug,
  and there is no reconstruction for TheLeague to recover it from. A
  week-based rule of the kind the AFL uses would actively break TheLeague: its
  `The Loser's Bracket` (w14) starts EARLIER than `The Consolation Bracket`
  (w16) and is the 5th-place bracket (renamed `5th Place Bracket` in 2025).
- Third place is already inside the entry-bracket field, so recovering it must
  NOT change any berth count. AFL berths must stay at exactly 8 per season.

## Worked

All three items shipped in #625 on 2026-08-26. 22 AFL seasons recovered, one
per season 2004-2025; berths unchanged at 8 per season; TheLeague's ledger
byte-identical.

Two findings from the review of #625, both on the new tests, both fixed in the
same PR:

- The recovery assertion compared a feed synced every few minutes against a
  ledger rebuilt nightly, so the hours between week 17's third-place game
  scoring and that night's rebuild would have been a red `main`. Now scoped to
  seasons the derived data already calls finished, and it skips a winner the
  collision guard legitimately discarded rather than reporting the guard
  working as a failure.
- `expect(third[0].playoffResult).not.toBe('missed')` was tautological — the
  array was filtered on that value. Replaced with a real coherence check: a
  season recording a third place must also record a champion and a runner-up.

## Still open

- [ ] **F4 — `parseNITResults` hardcodes NIT bracket ids 6/7/8/9**
  - Source: review of #625, out of that PR's diff
  - Where: `src/utils/afl-draft-utils.ts:719-743`
  - Status: **not a live bug.** Verified: those ids are correct for 2018+
    (`6 NIT Championship`, `7/8/9` the 3rd/4th/5th place games) and
    `draft-predictor.astro:96` reads only the CURRENT season's bracket file, so
    every id it touches is right. It is wrong for any earlier era — the NIT is
    bracket 3 in 2005 and 5 in 2010-2017 — and becomes a real bug the moment
    that code is pointed at a historical season.
  - Why deferred: a different feature with its own verification surface, on a
    follow-up that already regenerates derived data across both leagues. The
    third instance of this family, and the first one that is currently
    harmless; recorded rather than fixed so it is not discovered a third time
    by accident.
  - Fix when taken: `bracketKindFromName` already classifies NIT brackets by
    name, and `placementFromName` already reads "3rd Place" — the same two
    helpers this PR used.
