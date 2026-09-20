---
slug: stale-scores-fallback
status: open
severity: P0
opened: 2026-09-20
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1178
hotfix_sha:
followup_issue: 1179
followup_pr:
followup_session:
---

# Follow-up: live scoring blanked to an error card over real scores

## What broke

`/live` and the league live-scoring boards showed "Couldn't read this league —
we reached for the scores and didn't get them" in place of live scores, during
games, repeatedly. Owner report with a screenshot from **2026-09-20 10:33 PT**
(Week 2, Sunday early window) showing BOTH leagues on the error card while the
freshness pill beside them read "● Live · updated just now".

The two were reporting different things. Production logs for that minute show
every `/api/live-board` answering **200** — the board poll succeeded. The
PANELS inside it came back `unavailable`, and a panel replaced its predecessor
wholesale, so real scores were wiped while the transport reported itself
healthy. `LiveBoard`'s existing "a failed poll keeps the last good board"
guard (`data.ok !== false`) never fires for this, because the poll is not what
failed.

**Root cause was confirmed, not inferred.** `get_runtime_errors` showed MFL
returning HTTP 429 to production in the same window:
`[trades/pending] MFL error: MFL HTTP 429` (17:10 UTC) and
`[live-standings] live fetch failed for afl-fantasy 2026; serving committed
feed: MFL leagueStandings responded 429` (17:58 UTC). We were being throttled.

## What the hotfix did

Forward fix, no revert — the behaviour was never introduced by a single commit.

- `src/utils/live/stale.ts` (new) — `resolvePanelViews` holds the last
  CONFIRMED panel for `STALE_HOLD_MS` (5 min) when a panel arrives
  `unavailable`. Only `unavailable` is held; `not-played` / `no-matchup` are
  answers from a feed we READ. Memory keyed `(week, league)`.
- `src/components/shared/live/LvStaleNotice.tsx` (new) — the amber strip with
  a ticking relative age, on the cards and on the drill-in.
- `src/components/shared/live/LiveBoard.tsx` — wires both; a held panel
  overrides the freshness pill so it cannot claim "Live".
- `src/utils/live-scoring-source.ts` — gated the `playoffBrackets` fetch to
  the playoff window (it ran EVERY week, doubling MFL requests for nothing in
  the regular season), added a 20s in-process cache of SUCCESSFUL reads only,
  capped at 64 entries, and named every failure reason in a `console.warn`.
- `src/utils/broadcast-live-source.ts` — the same failure naming for outside
  leagues.

## Deferred items

- [ ] **F1 — A cold page load still shows the error card**
  - Source: deferred at implementation (scope choice, confirmed with the user)
  - Where: `src/components/shared/live/LiveBoard.tsx:~300` (`panelMemory` ref),
    `src/utils/live/stale.ts:1` (header documents the limitation)
  - Why deferred: the hold is per-mount session memory, so a fresh load whose
    SSR assembly fails has nothing to hold. The user explicitly chose "client
    session only" over `sessionStorage` or a server cache when asked.
  - Note: `sessionStorage` keyed by week is the cheap half; a per-user Redis
    mirror of the last good panel is the complete one and was judged too big
    for a display bug.

- [ ] **F2 — The read cache only dedupes within one lambda instance**
  - Source: deferred at implementation
  - Where: `src/utils/live-scoring-source.ts:139` (`payloadCache`)
  - Why deferred: a process-level Map was the change that could ship during
    games. Vercel spins many instances, so concurrent viewers on different
    ones still each hit MFL — a real reduction, not a fix.
  - Note: a short-TTL Redis read cache keyed `host|league|year|week` would
    make the dedup global. Weigh Upstash command cost against MFL 429s;
    `docs/claude/rules/live-scoring.md` has the request-budget context.

- [ ] **F3 — No retry on a failed league read**
  - Source: deferred at implementation (the user chose "log + cache + skip
    brackets" over the variant that included a retry)
  - Where: `src/utils/live-scoring-source.ts:~190` (`fetchMfl`)
  - Why deferred: retrying a 429 makes throttling worse, and the 429s are now
    confirmed rather than hypothetical. A retry is only safe if it is
    timeout/network-only and explicitly NOT applied to a throttle response.
  - Note: revisit once the new failure logs show the timeout/429 split. That
    split is the whole point of the logging that shipped here.

- [ ] **F4 — The freshness pill's AGE ignores the held panel**
  - Source: Claude review, `/code-review` on PR #1178
  - Where: `src/components/shared/live/LiveBoard.tsx:371` (`boardFeed`),
    `src/utils/live-scoring-view.ts:374` (`describeFeedFreshness`)
  - Why deferred: `describeFeedFreshness` takes `Math.max(fetchedAt)` across
    all feeds, and the ESPN scoreboard keeps polling successfully, so the
    `fetchedAt: heldSince` we pass is inert — the pill can read "Reconnecting ·
    updated 20s ago" beside a strip saying "from 3m ago". The TONE does flip
    off "Live", which was the screenshotted contradiction, so the user-facing
    lie is fixed; only the age disagrees. Fixing it means changing shared
    freshness logic that other surfaces read, which is not a during-games edit.

- [ ] **F5 — `weekly-changelog-staging.json` was re-serialized whole**
  - Source: Claude review, `/code-review` on PR #1178 (review body, not a
    finding)
  - Where: `src/data/weekly-changelog-staging.json`
  - Why deferred: cosmetic. A one-entry append rewrote ~130 lines because
    `JSON.stringify` emitted literal `—` where the file had `—`.
    Functionally identical, but it widens the rebase surface on a file both
    lanes append to. Append textually next time rather than round-tripping.

- [x] **F6 — DONE: stale AFL top-players artifact (fixed in this hotfix)**
  - Source: observed while running the suite
  - Where: `data/afl-fantasy/derived/top-players.json`,
    `tests/top-players-data.test.ts:169`
  - Not this hotfix's bug, but it blocked the gate, so it was fixed here:
    the derived payload still listed Rashid Shaheed as owned by Fullybaked
    (`0010`) after that franchise dropped him, so the AFL top-players surface
    named a team that no longer rostered him. `pnpm run compute:top-players:afl`
    removed the stale owner (a 5-line deletion) and the suite goes green.

- [ ] **F7 — `mfl-live-board.test.ts` makes REAL ESPN calls and can time out**
  - Source: observed in CI on PR #1178
  - Where: `tests/mfl-live-board.test.ts:91` ("ok — a played week with a
    pairing"), `src/utils/mfl-live-board.ts` (`fetchNflScoreboard`,
    `loadNflGameDetail`)
  - Why deferred: environmental, not this diff's — the suite mocks
    `cross-league-live` but NOT the two ESPN reads, so the first test in the
    file pays a real round trip against vitest's 5s default while the other 19
    ride the warm module cache. It failed on the day production logs show ESPN
    summary requests timing out, and passes locally 3/3 in ~1s.
  - Note: mock the ESPN reads in this suite rather than raising the timeout —
    a unit test reaching the public internet is the actual defect, and it will
    keep flaking on every slow ESPN day.

## Context to start cold

**The thing that makes this bug class invisible:** a healthy transport over a
failed read. `/api/live-board` returns 200 with `ok: true` while carrying
panels that could not be read, because one dead league is deliberately not an
outage. Every instinct says "check whether the endpoint is up" and the endpoint
is always up. Read the PANEL statuses, not the HTTP status.

**What was ruled out.** MFL itself was healthy when probed directly from this
container (both hosts, three times, 200 + valid JSON, 300–600ms) — so the
failures are intermittent and source-dependent, not an MFL outage. That is
consistent with per-IP throttling of Vercel's egress rather than anything wrong
with the league feeds. Do not re-probe from a dev box and conclude it is fine;
that test cannot see the thing that is failing.

**Why the failures had no logs.** `readCrossLeagueLive` catches every failure
into `ok: false` and returned it silently. Timeout, refused connection, HTTP
error, HTML-under-a-200 and an MFL `error` key were all the same value with
nothing written down — the same "no failing entry next to the page render"
signature as the 2026-09-09 outage. The logging added here is what makes the
next occurrence diagnosable, so **check the new `[live-scoring]` warns first**;
they now distinguish those five cases, and F3 depends on what that split shows.

**A trap that bit during this work.** `resolvePanelViews` runs inside the
island's RENDER body, and the island re-renders for reasons unrelated to a
board poll (the NFL scoreboard store pushing, the hold timer ticking, a matchup
being opened, and — worst — a FAILED poll calling `setFeed` while `board` still
holds the last good payload with its panels still `ok`). The first cut stamped
`at: now` on every render, which would have made the strip say "from just now"
about four-minute-old scores and restarted the five-minute hold from the last
render. Fixed in `0e9b395` by treating the panel OBJECT identity as the arrival
signal. Anything else added to this render path needs the same care.

**Three test suites now depend on cache isolation.**
`live-scoring-bench`, `live-scoring-host-resolution` and
`live-scoring-read-load` each call `clearLiveScoringPayloadCache()` in
`beforeEach`. They assert on which URL was fetched, so without it they answer
from each other's reads and test their own ordering. Any new suite that mocks
`fetch` around `loadLiveScoringPayload` needs the same line.
