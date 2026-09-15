---
slug: afl-conference-playoff-badges
status: open
severity: P1
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1087
hotfix_sha: b652cc5
followup_issue: 1089
followup_pr:
followup_session:
---

# Follow-up: the AL's division standings badged one wild card instead of two

## What broke

`/afl-fantasy/standings` (division view) drew its DIV / WC pills on the
**league-wide** seed — 4 division winners, then wild cards 5-7 — which is
TheLeague's playoff shape. The AFL seeds a bracket **per conference**: division
winners first, then wild cards out to 4, on each side. Two conferences sharing
one 1..7 scale means whichever side's wild cards sort lower falls off the end.

In 2026 that was the AL: it read `DIV #2`, `DIV #3`, `WC #6`, and Midwestside
Connection — its actual 4th seed — carried no badge at all. Longstanding, not a
regression; reported 2026-09-15 during week 3.

## What the hotfix did

Forward fix, no revert.

- `getDivisionStandings` (`src/utils/standings.ts:238`) now attaches
  `conferenceSeed` alongside the league seed for any league with conferences,
  and `conferenceSeed` is declared on `TeamStanding` (it was always written and
  read, never on the interface — clearing 3 pre-existing ts(2339)s, hence the
  baseline retighten to 1716).
- `StandingsTable.astro` takes a `badgeSeeding` prop naming which ladder the
  badge column reads, deliberately separate from `tiering` (which also selects
  the table's visual variant and row banding — a division card must not take
  those on). Defaults to `TIERING.leagueSeed`, so TheLeague is a verified no-op.
- `src/pages/afl-fantasy/standings.astro` passes
  `TIERING.conferenceSeed(divisionWinners.length)` per division card, resolving
  the conference off the same `conference.divisions` list
  `getConferenceStandings` filtered on, and falling back to `TIERING.none`
  (no badge) rather than to the league ladder.
- Guard: `tests/playoff-badge-seeding.test.ts`, wired into the
  `standings-brackets-draft-order` path-guard domain, whose `paths` now also
  cover the standings component directory and `src/pages/*/standings.astro`.

## Deferred items

- [ ] **F1 — `getConferenceStandings` hardcodes a 2-wild-card conference field**
  - Source: Claude review, `/code-review` (medium)
  - Where: `src/utils/standings.ts:619` — `sortedWildCards.slice(0, 2)`
  - What: the slice assumes two division winners per conference. For the AFL's
    2003-2012 **three-division** era that yields a 5-team conference field, i.e.
    a 10-team league bracket. MFL's own 2008 bracket metadata says
    `teamsInvolved: 8`, and this PR's own 2008 badge test asserts 4 — so the
    badges and this helper now disagree for those seasons. The fix is
    `slice(0, Math.max(0, 4 - sortedDivWinners.length))`, with the 4 sourced
    from the registry rather than inlined again.
  - Why deferred: pre-existing and historical-seasons-only (the live page is
    unaffected), but `wildCards` feeds `/afl-fantasy/playoffs`'s
    `championshipField` **and** its per-wild-card payout math
    (`src/pages/afl-fantasy/playoffs.astro:179`, `:687`, `:827`). Changing it
    moves prize numbers on archived seasons, which needs its own verification
    pass against `championship-history.json` — not something to widen a hotfix
    with.
  - Note: `tests/playoff-field-size.test.ts` is the conservation law that should
    catch the field-size half; check whether it currently passes *because* those
    seasons resolve their field from the bracket feed rather than from here.

- [ ] **F2 — Post-merge advisory reviewer findings**
  - Source: CodeQL / Gemini / Copilot, not waited on at merge
  - Where: PR #1087 comments
  - Why deferred: `/hotfix` merges on Claude's review plus green CI; the
    advisory reviewers land minutes later. Re-read the PR comments and fold
    anything real in here.

## Context to start cold

- **The rule this sits under** is `docs/claude/rules/standings-brackets-draft-order.md`
  §1 and §4: MFL's feed order is authoritative for division winners, but
  *standings order is not seed order*. Everything here stays on the feed-order
  path (`preserveFeedOrder: true`) — the fix changes only which LADDER the badge
  is cut on, never the ordering.
- **Why `badgeSeeding` is not just `tiering`**: `tiering` also drives
  `variant` (`std` / `league` / `conf` / `tier`) in `StandingsTable.astro:56`,
  which swaps the whole card's CSS namespace, plus `tier-boundary` row rules.
  Passing a conference tiering to a division card to get the badges right would
  have restyled every division card and drawn a cut line inside it. That is the
  trap if anyone later tries to "simplify" the two props into one.
- **The two leagues are deliberately different here** and must stay so:
  TheLeague has no conferences and its league-wide 4 + 3 ladder *is* its
  bracket. `scripts/sibling-drift.mjs` flags `theleague/standings.astro` as the
  unchanged twin every time this area is touched; that is correct, and the
  TheLeague case in the guard test is what pins it.
- **Don't pin the guard to the live feed.** The first version of
  `tests/playoff-badge-seeding.test.ts` asserted 2026 franchise names against
  exact seeds. The 2026 feed is cron-synced mid-season, so a results sync would
  have failed the suite with the fix intact — and because the suite is in the
  path-guard map, that would have blocked *every* edit in the standings domain.
  Exact-value pins moved to 2025 (complete, immutable); 2026 is asserted
  structurally only.
- **The regression is a counting fact, not a fact about the AL.** The league
  ladder badges 4 + 3 = 7 and the AFL seeds 8, so one conference is always
  short. It was the AL in 2026 and the NL in 2025 — which is why the test
  asserts the total, not the conference.
