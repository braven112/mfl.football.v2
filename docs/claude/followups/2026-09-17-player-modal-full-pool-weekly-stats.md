---
slug: player-modal-full-pool-weekly-stats
status: open
severity: P2
opened: 2026-09-17
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1150
hotfix_sha: da30b4d0640ebe8ba5a930a21407bf0853e7e56e
followup_issue: https://github.com/braven112/mfl.football.v2/issues/1152
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1154
followup_session: https://claude.ai/code/session_01RPZtRevPBtkwT3BcpoFV4K
followup_worked: 2026-09-17
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

## Rejected findings (shipped unaddressed, on judgement)

- **Copilot: "TypeScript annotations in a client `<script>` will throw a syntax
  error in the browser"** (`PlayerDetailsModal.astro`, two comments). Wrong.
  Astro compiles a `.astro` `<script>` through esbuild and strips TS with no
  `lang="ts"` needed. Verified against the SHIPPED artifact, not reasoned about:
  the production bundle for the `da30b4d` deploy carries both callbacks with the
  types gone (`je.map(function(e){…})`, `q.some(function(e){…})`). The same block
  also already shipped `as HTMLElement | null` and `as HTMLImageElement | null`
  before this PR, and the modal was driven in a real Chromium on this branch.

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

Re-validated 2026-09-17 against `main` at `da30b4d`, and F3 again on
2026-09-18. **Three worked (F1, F3, F5), three still open (F2, F4, F6)** — see
the verdicts below. The issue stays open; do not close it.

- [x] **F1 — `mergeWeek` accepts a truncated response for a finished week** — WORKED
  - Verdict: **still true.** The code was unchanged and Copilot independently
    found the same thing after the merge (PR #1150, `fetch-mfl-feeds.mjs:1130`).
  - The policy call, made here: **a finished week's pool does not shrink.** MFL
    can void a handful of rows in a genuine stat correction, so the floor is a
    proportion rather than "never fewer", and a response carrying less than 90%
    of the rows already committed for that week is refused with a
    `::warning::`. A legitimate late-season shrink is not a thing this feed
    does — `playerScores&W=<n>` scores the whole pool the league's rules can
    score, not the week's actives — so the "MFL drops inactives from a late
    week" worry the brief raised does not apply; the floor still leaves ~48
    rows of slack on a 484-row week if it ever does.
  - Shape: the decision moved OUT of the fetch script into
    `weekMergeDecision` / `WEEK_SHRINK_FLOOR` (`src/utils/player-week-scores.mjs`),
    because inline it is only reachable behind a live MFL fetch — which neither
    CI nor an agent session can make. Now unit-tested on both sides of the
    floor, plus a scan guard that the script has not re-inlined the policy.
  - Recorded as a rule: `docs/claude/rules/storage-and-build.md` §
    "A merged feed needs a FLOOR, not just an empty check".

- [ ] **F2 — Verify the AFL's `fantasyPointsAllowed.json` actually lands** — STILL OPEN
  - Verdict: **still true and still unexercised.** `data/afl-fantasy/mfl-feeds/2026/fantasyPointsAllowed.json`
    does not exist on `main` as of 2026-09-17. `weekly-stats-sync.yml` last ran
    2026-09-15 (before the hotfix), and its next scheduled run is **Tue
    2026-09-22** — and only nominally at 13:00 UTC: that last run landed at
    17:26, because GitHub drops and delays this repo's scheduled events
    (`docs/claude/rules/storage-and-build.md` § "GitHub's `schedule` is not a
    cadence"). Unlike `roster-sync.yml`, this workflow has no Vercel cron
    backing it, so "Tuesday" is the most that can be promised.
  - Blocked, not deferred again: **MFL egress is blocked from this session too**
    (`www45.myfantasyleague.com:443 — connect_rejected`), so the fetch cannot be
    exercised locally, and the one way to exercise it early — a
    `workflow_dispatch` of `weekly-stats-sync.yml` — needs a human to approve
    it, because that workflow commits to `main` and therefore deploys
    production.
  - Next action: dispatch `weekly-stats-sync.yml` on `main` (it is
    `workflow_dispatch`-enabled and takes no inputs), or wait for Tuesday.
    Then check the file exists with 30+ teams.
  - Re-checked 2026-09-18T01:15Z: still absent, as expected — the workflow has
    not run since 2026-09-15.
- [x] **F3 — Confirm the by-week feed carries EVERY PLAYED WEEK, and drop the hand seed** — DONE 2026-09-18
  - Retitled: it was filed as "filled weeks 1–18", which is not the bar and is
    what sent the first verification pass looking for a partial that was not one.
  - **The item was framed wrong, mine included.** "Weeks 1–18" was never the bar
    on 2026-09-17: the 2026 season had played ONE week. Week 2 kicked off
    `2026-09-17T17:15-07:00` = 2026-09-18T00:15Z (`src/data/nfl/week-starts.mjs`),
    and MFL's W-less `playerScores.json` still names **week 1** — which is MFL
    itself saying so, per the "a W-less request asks MFL to name its own week"
    rule the fetch loop already follows. The bar is EVERY PLAYED WEEK, and a
    file holding week 1 alone was already meeting it.
  - Verified 2026-09-18T01:15Z on `main`: the daily set ran (`fetch.meta.json`
    stamped `00:03:48Z` for TheLeague, `00:06:16Z` for the AFL — so
    `skipDailyFeeds` was false and the 18-week loop DID run), and both files
    carry `weeks: { "1": 487 }`. Weeks 2–18 are unplayed, so MFL answers them
    with its blank placeholder, `reduceWeekScores` reduces that to `{}`, and
    `weekMergeDecision` refuses it as `empty`. Working exactly as designed.
  - **The hand seed is gone** — not deleted, outgrown. It was 484 rows; the
    pipeline's own week 1 is 487, written by the live path at
    2026-09-17T08:16Z (`0f41b30`) and left alone by today's daily pass. Nothing
    committed by hand survives in that file.
  - One thing NOT verified: the run log itself. The Actions log host
    (`results-receiver.actions.githubusercontent.com`) is blocked by this
    session's egress proxy, so "weeks 2–18 came back as placeholders" is
    inferred from the committed result plus the daily set completing, not read
    from the log. If you ever want it confirmed directly, the lines to look for
    are `playerScores week N came back empty`.

- [ ] **F4 — Decide whether the payload belongs in the page at all** — STILL OPEN, needs a human call
  - Verdict: **still true**, and deliberately not decided here. It is the one
    item the brief itself flags as an architecture change rather than a fix,
    and `/followup` routes those to `/feature`, not to a free-hand refactor of
    a 12k-line page's data flow.
  - Recommendation, for whoever makes the call: **move it to an endpoint.** The
    size argument is the weaker half (780 KB of HTML text, but only 10.0 KB
    over the wire); the stronger half is that `rosters.astro`'s copy is frozen
    at build time, so the table it renders is as stale as the last deploy,
    while the modal's own `/api/player-news.ts` fetch next to it is live. One
    endpoint would make all five pages smaller than they were before #1150 and
    make the data current. The cost is one round-trip on modal open, on a
    modal that already makes one.
  - If it goes ahead: `scripts/roster-parity-check.mjs` before AND after
    (dev server on :4399), per `docs/plans/rosters-page-split.md`.

- [x] **F5 — Fold in the external reviewers** — WORKED
  - Gemini did not run on #1150 (`pr-external-review.yml` is opt-in). CodeQL and
    Analyze both passed. Copilot posted four comments after the merge; all four
    are adjudicated:
  - `scripts/fetch-mfl-feeds.mjs:1130` — **confirmed.** Same finding as F1,
    reached independently. Fixed above.
  - `PlayerDetailsModal.astro:1878` and `:1933` — **rejected.** Copilot read the
    TypeScript annotations in the client `<script>` as a runtime syntax error.
    That block is a plain Astro `<script>`, not `is:inline`, and it carries bare
    module specifiers (`import { escapeHtml } from '../../utils/player-cell-html'`)
    — so Vite/esbuild transpiles it at build and the browser never sees an
    annotation. Copilot's own note says it could not run its full agentic suite.
    It is also disproven empirically: the PR's Playwright pass drove
    `openPlayerDetailsModal` against the preview deployment and read 484 players
    back out of `#weekly-player-results`, which that script is what produces.
    Pinned anyway, because adding `is:inline` to that tag WOULD break it:
    "keeps its client script bundled, because it is TypeScript".
  - `weekly-player-results.ts:325` — **rejected.** Copilot asks for `p: null`
    whenever `isBye`, which is the exact inverse of review finding F-c, fixed
    in this PR's second commit and already pinned by "keeps a real score on a
    week it computed as a bye". `isBye` is DERIVED from `info.nflTeam`, the
    player's current team, so for a mid-season trade it is the wrong team's bye
    and the points being discarded are a real week he played. A score MFL gave
    us outranks a bye we computed. The narrow sub-case Copilot is right about —
    a TRUE bye that MFL nonetheless scores would count toward Games / PPG — is
    tracked as **F6** below, which frames it better than this rejection does:
    the defect is the LABEL, not the number.

- [ ] **F6 — A row labelled "Bye" that also shows points** — STILL OPEN, and the sharper framing
  - Source: Copilot review on #1150, `src/utils/weekly-player-results.ts:325`
  - Why deferred: it is a judgement call about a PRE-EXISTING rendering rule, not
    a regression this PR introduced, so it did not belong on a fast path.
  - Copilot's prescription — force `p: null` whenever `isBye` — is the wrong
    direction and was rejected. `isBye` is DERIVED from `info.nflTeam`, which
    `players.json` reports as the player's CURRENT team, so after a mid-season
    trade the computed bye is his NEW team's: a WR who moved from a week-12-bye
    team to a week-5-bye team really played week 5 and MFL really scored him.
    Discarding a score we were given because of a bye we inferred deletes a week
    he played. The roster branch has kept points under `isBye` since the table
    was written.
  - What IS right about it: `Bye` beside `21.4` reads as a contradiction, and the
    row counts toward Games / PPG via `X.p!==null&&(J+=X.p,Y++)` in the modal.
    The defect is the LABEL, not the number — when we hold a score, "bye" is
    probably just wrong, so the honest row drops the bye label and keeps the
    points. Decide that deliberately, for both branches at once.
  - Re-validated 2026-09-17: **still true, and it outranks the way F5 below
    first filed the same Copilot comment.** F5 rejects Copilot's prescription,
    which is right; F6 names what is actually wrong, which the rejection alone
    does not. When we hold a score for a week, the BYE label is the thing that
    is false — whether because the bye was derived from the wrong (current)
    team, or because MFL scored a player his real bye week. Both branches of
    `buildWeeklyPlayerResults` must answer it the same way, and neither should
    be changed without the other.
  - It is a judgement call with a user-visible answer, so it wants the `/live`
    bar and a human, not a follow-up commit. Left open deliberately.
  - **The measurable half cannot be measured before 2026-10-13.** The question
    "does MFL emit a score for a player on his real bye" needs a scored bye
    week, and 2026's FIRST bye is **week 5** (`nflSchedule-full.json`: 30 teams
    in week 5, 32 in weeks 1–4). Week 5 kicks off 2026-10-08, so the earliest
    honest answer is the daily pass after it finishes. Until then only the
    derived-bye half of F6 is decidable, and that half does not need data — a
    traded player's bye label is wrong on the face of it.

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
