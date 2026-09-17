---
slug: player-modal-full-pool-weekly-stats
status: open
severity: P2
opened: 2026-09-17
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1150
hotfix_sha: da30b4d
followup_issue: 1152
followup_pr:
followup_session: session_01RPZtRevPBtkwT3BcpoFV4K
---

# Follow-up: player modal showed no weekly stats for free agents, practice squad or IR

## Triage note — this was not a real hotfix

Recorded here because it matters for the fast-lane audit
(`docs/claude/followups/README.md`): **this shipped on the fast path by the
user's explicit call, against the triage gate's verdict.** It was P2, not P0 —
nothing was erroring, nothing was a regression, and the diff was 17 files. If
the audit ever asks "how many hotfixes actually needed to be one", this is a no.

The `/hotfix` shortcuts were therefore only partly taken: because there was no
outage, the cost-of-delay license had nothing on its side of the scale, so the
five `/code-review` findings were **fixed in the PR rather than deferred**, at
the `/live` bar. What is left below is genuinely follow-up work, not review debt
that got waved through.

## What broke

The player card's **Season Results** table was missing entirely — section
hidden, not zeroed — for any player not in a franchise's starting lineup. It was
built only from `weekly-results-raw.json`, MFL's `weeklyResults` export, which
lists a franchise's ACTIVE LINEUP. Against TheLeague's committed 2026 feeds that
was 44 of 45 `TAXI_SQUAD`, 11 of 15 `INJURED_RESERVE`, and all 163 scored free
agents. On the AFL the table never existed for anyone: no page there emitted the
payload island.

Present since the feature shipped, so there was no commit to revert.

## What the hotfix did

Added `TYPE=playerScores&W=<n>` as a full-pool per-week fallback, committed as
`data/<league>/mfl-feeds/<year>/playerScores-by-week.json` and merged rather than
replaced. New files: `src/utils/player-week-scores.mjs` (parser),
`src/utils/weekly-player-results-feed.ts` (cached per-league-season loader),
`tests/weekly-player-results-full-pool.test.ts` (31 assertions). Changed:
`src/utils/weekly-player-results.ts` (union of both id sources, owners as a
LIST), `src/components/theleague/PlayerDetailsModal.astro` (multi-owner badges,
brand-map crest, no `window` cache), both AFL pages (payload island), three
TheLeague pages (pass the fallback), `scripts/fetch-mfl-feeds.mjs` (the feed),
`scripts/fetch-fantasy-points-allowed.mjs` + `.github/workflows/weekly-stats-sync.yml`
(per-league `--league=<slug>`).

Second commit fixed all five review findings, including a HIGH cross-league data
bleed this PR itself introduced (the payload was cached on `window`, which the
ClientRouter never replaces — once the AFL also emitted the island, the first
page loaded won for the session, and both leagues have a franchise 0001).

## Deferred items

- [ ] **F1 — `mergeWeek` accepts a truncated response for a finished week**
  - Source: Claude review, `/code-review` (LOW)
  - Where: `scripts/fetch-mfl-feeds.mjs:1124`, the `count === 0` guard at `:1127`
  - Why deferred: needs a policy decision, not a one-liner — what counts as
    "suspiciously fewer rows than the committed week" without rejecting the
    legitimate shrink when MFL drops inactive players from a late week.
  - Detail: the guard only refuses an EMPTY week, but its own comment promises
    that a transient bad response leaves a good week alone. A partial reply for
    an already-finished week destructively replaces it, and a finished week's
    scores are immutable — so a week that has ever been fuller should probably
    never shrink. Compare the "never downgrade" rule the current-week
    `weeklyResults` merge already implements 80 lines above (`wouldDowngrade`).

- [ ] **F2 — Verify the AFL's `fantasyPointsAllowed.json` actually lands**
  - Source: Claude review, `/code-review` (MEDIUM — the fix shipped, the path is
    unverified)
  - Where: `.github/workflows/weekly-stats-sync.yml`, `scripts/fetch-fantasy-points-allowed.mjs`
  - Why deferred: the cron is Tuesdays 13:00 UTC and MFL egress is blocked from
    the session that wrote this, so it could not be exercised. The `--league`
    resolution WAS verified live (`MFL_LEAGUE_ID=13522 … --league=afl` →
    `afl-fantasy (19621)`); the MFL `pointsAllowed` fetch for league 19621 was not.
  - Done when: `data/afl-fantasy/mfl-feeds/2026/fantasyPointsAllowed.json` exists
    with 30+ teams, and the modal's Opp Avg / Opp Rank columns appear on an AFL
    player card (they are hidden by `.wr-no-opp-stats` until then — that part is
    correct behaviour, not a bug).
  - Watch for: the script aborts on `teamCount < 30`. If the AFL's scoring rules
    produce a short table, that threshold is the thing to look at, not the fetch.

- [ ] **F3 — Confirm the by-week feed filled weeks 1–18, and drop the hand seed**
  - Source: deferred at implementation
  - Where: `data/theleague/mfl-feeds/2026/playerScores-by-week.json`,
    `data/afl-fantasy/mfl-feeds/2026/playerScores-by-week.json`
  - Why deferred: MFL egress was blocked, so the committed files were seeded with
    **week 1 only**, re-keyed from the already-committed `playerScores.json` via
    `reduceWeekScores`. Real data, but a partial the pipeline did not write.
  - Done when: the roster-sync daily loop has run and both files carry every
    played week. If they do not, check that the daily branch is being reached at
    all — `--refresh-live` + `isFreshToday()` means the 18-week loop only runs on
    the first run of each day, and hotfix #1146 changed that job's trigger to a
    Vercel cron ping.

- [ ] **F4 — Decide whether the payload belongs in the page at all**
  - Source: deferred at implementation (design decision, deliberately not made
    under a hotfix)
  - Where: the `#weekly-player-results` island in five pages —
    `src/pages/theleague/{players,rosters}.astro`,
    `src/pages/theleague/front-office/projected-free-agents.astro`,
    `src/pages/afl-fantasy/{players,rosters}.astro`
  - Why deferred: it is an architecture change, not a fix. Shipping it inside a
    hotfix would have put a new API route and a modal-open fetch on the fast lane.
  - Detail: the island is now ~780 KB of raw JSON per page (was ~460 KB on
    TheLeague; the AFL had none). Over the wire that is only **10.0 KB brotli**
    (from 8.1), which is why it was judged acceptable — but it is still 780 KB of
    HTML text the browser holds, and it is the WHOLE LEAGUE embedded to render ONE
    player. Serving it from an endpoint on modal open (the modal already fetches
    news that way, `/api/player-news.ts`) would make every one of those five pages
    *smaller than before this PR* and would make the data live rather than baked —
    `rosters.astro`'s copy is currently frozen at build time. Weigh against the
    added round-trip on open.

- [ ] **F5 — Fold in the external reviewers**
  - Source: Gemini / Copilot / CodeQL, which `/hotfix` step 5 does not wait for
  - Why deferred: by design — their findings land on the PR after the merge.
  - Done when: PR #1150's comments have been re-read after merge and anything
    real is either fixed or explicitly rejected with a reason here.

## Context to start cold

- **Read first:** `src/utils/player-week-scores.mjs`'s header. It states the
  whole rationale — which populations `weeklyResults` cannot see and why, what
  the full-pool feed can and cannot tell you (points only: no franchise, no
  starter status, no games-played), and the keep-every-finite-score rule it
  shares with `parseYtdPlayerScores`.
- **The prior art is `src/utils/stats-season.mjs`.** It solved the identical
  blind spot for the Free Agents points column in Aug 2026 using `W=YTD`. This
  work is its per-week sibling; keep the two consistent rather than letting them
  drift.
- **Two rules in this code are load-bearing and easy to "simplify" wrongly:**
  1. A week's roster is a **list**. The AFL rosters the same NFL player in both
     conferences (326 such weeks in its 2026 feeds) and plays doubleheaders where
     a franchise appears in two matchups. `WeekEntry.o` is omitted when there is
     only one owner purely to keep TheLeague's payload byte-identical — it is not
     an optional-because-unimportant field.
  2. `WeekEntry.st === ''` means **"no lineup carried him, so we have no answer"**
     — NOT "did not play". Points are usually non-null on such a week. Rendering
     an empty status as a zero or a dash would re-introduce the bug in a new form.
- **The payload must never be cached across a navigation.** See the second commit
  and `tests/weekly-player-results-full-pool.test.ts`'s "never caches the payload
  on `window`". Same class as `rankings-scope.ts`'s re-read-per-call rule.
- **Before touching `rosters.astro`:** run `scripts/roster-parity-check.mjs`
  before AND after (needs a dev server on :4399). It passed 12 renders on this PR.
- **Verification recipe used here**, worth reusing: drive
  `window.openPlayerDetailsModal({ id, name, position, nflTeam })` in Playwright
  (`executablePath: '/opt/pw-browsers/chromium'`) and read `#weekly-player-results`
  out of the DOM. Taxi-squad `17482` and free agent `12610` (Wentz, 25.22) are the
  TheLeague cases; `9431` is the dual-rostered AFL case.
