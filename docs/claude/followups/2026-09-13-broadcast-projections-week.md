---
slug: broadcast-projections-week
status: open
severity: P0
opened: 2026-09-13
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1074
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: broadcast projections read the same as the live score

## What broke
On the Live Broadcast board (`/broadcast`), every matchup's **projected** score
was identical to the live score and every win-probability bar sat at 100/0.
Reported during games on Sunday 2026-09-13, NFL week 1.

The cause is a WEEK MISMATCH, not a missing feed. `scripts/fetch-mfl-feeds.mjs`
syncs `projectedScores` with **`W` omitted**, and MFL answers that with the week
IT considers current — which rolls to the NEXT week once the current week's
games are under way. Verified live that afternoon against TheLeague:

    W omitted  -> {"week":"2", 533 rows}
    W=1        -> {"week":"1", 509 rows}

The committed `data/theleague/mfl-feeds/2026/projectedScores.json` therefore
carried `week: "2"` while the board was showing week 1. `projectionsForWeek`
refuses a week mismatch (correctly), the map comes back empty, every starter's
remaining expectation is 0, and `projectedFinal` collapses onto `live`.

## What the hotfix did
Forward fix, not a revert. `loadLeagueProjections`
(`src/utils/broadcast-live-source.ts`) now falls back to a live
`projectedScores` read that names the week BY NUMBER when the committed feed is
for a different week (or missing), cached 10 minutes per `(league, year, week)`
and never caching an empty answer. The committed feed still wins when its week
matches, so the mid-week path is unchanged. The assembler's season year is
threaded through so `?testDate=` renders agree with the snapshot.

Files: `src/utils/broadcast-live-source.ts`, `src/utils/broadcast-board.ts`,
`tests/broadcast-projections-week.test.ts`, `.claude/hooks/path-guard.json`.

## Deferred items

- [ ] **F1 — Sunday Ticket has the identical bug and was not fixed**
  - Source: found while diagnosing, deferred at implementation
  - Where: `src/utils/sunday-ticket-sources.ts:175` (`loadRegisteredContribution`)
    and `src/utils/sunday-ticket-sources.ts:318` (league-wide projections) —
    both call `projectionsForWeek(readLeagueFeed(..., 'projectedScores.json'), week)`
    with no fallback, so every `ContributionPlayer.proj` is 0 on gameday and the
    league-wide path returns `null` outright on `projections.size === 0`
  - Why deferred: `loadRegisteredContribution` is deliberately SYNC (disk only);
    adding the live fallback makes it async and ripples through its callers.
    That is a real refactor, not a one-line fix, and the reported symptom was
    the broadcast board.
  - Note: this is the highest-value item. Verify it is actually broken first —
    read the page on a Sunday, or call it with a committed feed whose week does
    not match.

- [ ] **F2 — The sync should write a week-scoped projections feed**
  - Source: root-cause analysis, deferred at implementation
  - Where: `scripts/fetch-mfl-feeds.mjs:582` (`projectedScores` endpoint, uses
    `withWeek` which is a no-op when the `week` CLI arg is absent)
  - Why deferred: the committed feed has OTHER consumers that legitimately want
    the UPCOMING week (`scripts/article-types/weekend-preview.mjs`,
    `matchup-preview.mjs`, `team-grades.mjs`, `scripts/generate-high-total-matchups.mjs`).
    Forcing `W=<current week>` would silently retarget all of them mid-outage.
    The right shape is probably a per-week file
    (`projectedScores-w<N>.json`) or writing both weeks, and picking between
    them is a design call the clock did not allow.
  - If F2 lands, the fallback added by the hotfix becomes a rarely-taken safety
    net rather than the gameday norm — do NOT delete it, MFL's default week is
    still not ours.

- [ ] **F3 — The projection cache is per-lambda and unbounded in key count**
  - Source: self-review, `/hotfix` step 5
  - Where: `src/utils/broadcast-live-source.ts` (`projectionCache`,
    `PROJECTION_TTL_MS`, `PROJECTION_EMPTY_TTL_MS`)
  - Why deferred: harmless at this scale (≤3 leagues × ≤25 weeks of tiny maps,
    per ephemeral instance) and Redis-backing it is the kind of infrastructure
    decision that does not belong in a P0 diff. Worth revisiting if the board
    ever polls more leagues, or if the same numbers are wanted by Sunday Ticket
    (F1) — a shared cache would serve both.
  - NOT deferred, fixed in the hotfix: the uncapped `mflFetch` (now
    `timeoutMs: 6000`, because `mflFetch` re-sends per redirect hop and this
    runs inside the page render against a 30s `maxDuration`) and the
    never-cached empty answer (now a 60s negative TTL). Both were `/code-review`
    findings and both were adjudicated BLOCKING — a hung or hammered MFL read on
    the SSR path is a new break, not a polish item.

- [ ] **F4 — Post-merge reviewer findings**
  - Source: Copilot / CodeQL / Gemini, not waited on at step 5
  - Where: PR #1074 comments
  - Why deferred: the advisory reviewers lag minutes and the board was wrong
    during live games. Re-read the PR comments before starting.

## Context to start cold

**What was ruled out, so you don't re-walk it:**

- *Not* a Vercel file-tracing problem. `data/<league>/mfl-feeds/<year>/` IS
  shipped into the function — `archivedFeedFiles()` (`scripts/lib/archived-feed-files.mjs`)
  only excludes seasons older than the newest 3, and the tracer's
  unresolvable-path fallback copies the rest. The feed was readable; it was the
  wrong week.
- *Not* `projectionsForWeek` being wrong. Its week-mismatch refusal is correct
  and deliberate (`tests/sunday-ticket-sources.test.ts:37`) — ranking this
  Sunday by another week's numbers would be worse than going flat.
- *Not* the player-id join, the starters/bench split, or `computeTeamTotals`.
  `computeTeamTotals` behaves correctly on both an empty and a populated map;
  the new test pins both directions.
- *Not* the `playerMeta.projected: 0` in `broadcast-board.ts:376`. That is
  deliberate (a projection belongs to a player IN A LEAGUE) and the per-league
  map overrides it — see `docs/claude/insights/features/live-broadcast.md`.

**The one fact that explains everything:** MFL's `projectedScores` export
answers a request with `W` omitted using ITS OWN notion of the current week,
which is the UPCOMING week during a slate. Anything in this repo that reads that
feed and then filters by our week number will go silently empty on gameday. That
is the class of bug, and F1/F2 are the rest of it.

Reproduce any of it with:

    curl -s "https://www49.myfantasyleague.com/2026/export?TYPE=projectedScores&L=13522&JSON=1" | head -c 200
    curl -s "https://www49.myfantasyleague.com/2026/export?TYPE=projectedScores&L=13522&W=1&JSON=1" | head -c 200
