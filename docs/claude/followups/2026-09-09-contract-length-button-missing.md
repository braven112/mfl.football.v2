---
slug: contract-length-button-missing
status: open
severity: P1
opened: 2026-09-09
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1034
hotfix_sha: c3f5cc5
followup_issue: 1035
followup_pr:
followup_session: session_01P8mtV8jzABSsCD9uzoSAek
---

# Follow-up: newly acquired players had no contract-length control

## What broke

Two owners reported a newly acquired player landing on their roster with no way
to declare contract years — no chip on the Yrs column, no **Declare Contract**
in the player's action sheet, and nothing failing anywhere. Ryan Flournoy
(`16778`, claimed by Bring the Pain 2026-09-09 02:00 UTC) and Dontayvion Wicks
(`16195`, signed by Dark Magicians 02:59 UTC). In-season declaration windows are
24 hours, so both would have expired unclaimed.

Two independent causes, and the two players separate them cleanly:

| Player | Parse | Freshness |
|---|---|---|
| Flournoy — BBID claim, nothing cut | broken | stale |
| Wicks — plain free agent | fine | stale |

## What the hotfix did

Forward fix, no revert.

- `src/utils/contract-eligibility.ts` — the BBID branch matched add-only claims
  against `/^(\d+),\|(\d+)\|,$/`, requiring a trailing comma MFL has never
  emitted (it writes `"16778,|500000|"`). Now reads segments via `idsIn` instead
  of enumerating shapes, so no-drop and multi-drop claims both parse; the
  auction branch takes a trailing cut too; the drop-only branch no longer strips
  just the first comma.
- `src/utils/mfl-transactions-cache.ts` (new) — layers the last 3 days of
  transactions over the build-time feed (Redis, 2-min TTL, MFL's `DAYS` filter,
  merged newest-first). Throws on MFL's HTTP-200 error bodies so a good cached
  list is never evicted by one.
- `src/pages/theleague/rosters.astro`, `src/pages/theleague/index.astro` — read
  through that cache.
- `tests/fixtures/mfl-transaction-strings.json` (new) — one entry per distinct
  (type, shape) in the real 2026 export.
- `.claude/hooks/path-guard.json` — new `contracts-eligibility` domain; the file
  that shipped this was routed to none.

## Deferred items

- [ ] **F1 — A THIRD copy of the transaction parser, still on the strict regexes**
  - Source: Claude review, `/code-review --comment` on PR #1034
  - Where: `src/utils/august-cut-selection-core.mjs:360` (`parseAcquisitionAdds`);
    its false parity claim is at `src/utils/august-cut-selection-core.mjs:383`;
    the test that claims to pin parity is `tests/august-cutdown-date.test.ts`
  - Why deferred: real, but it is the once-a-year August cut path and the 2026
    cutdown has already passed, so nothing is at risk this cycle. Fixing it
    properly means a THREE-way parity test rather than a fourth divergence,
    which is more than a hotfix should carry.
  - Detail: `parseAcquisitionAdds` has the original
    `/^(\d+),\|(\d+)\|(\d+),$/ || /^(\d+),\|(\d+)\|,$/` pair, so
    `'8851,|425000|'` → `[]` — 6 of the 8 BBID rows in the recorded corpus. No
    acquisition event means `selectAutoCuts` treats that player as the oldest
    held and `scripts/apply-august-cuts.mjs` cuts a genuinely long-held player
    instead. Its generic branch also has the single-comma bug this hotfix fixed
    (`'16195,16196,|'` → `[]`). `tests/august-cutdown-date.test.ts` asserts the
    fabricated `'14837,|1|,'`, so it passes straight over the divergence.
  - Shape of the fix: one parser, three call sites — or, if the `.mjs`/`.ts`
    split makes that impractical, a parity test that runs ALL THREE
    implementations over `tests/fixtures/mfl-transaction-strings.json`.

- [ ] **F2 — `scripts/lib/roster-move-parse.mjs` has the multi-drop gap too**
  - Source: found while fixing F-equivalent shapes in this PR
  - Where: `scripts/lib/roster-move-parse.mjs:41`
  - Why deferred: its BBID regex is `/^(\d+),\|(\d+)\|(\d*),?$/`, which handles
    the no-drop case correctly but not a claim with two cuts — that falls to the
    positional split, where segment 1 is the BID, so it would report a phantom
    DROP of player "425000". Schefter would post a made-up roster move. No such
    string exists in the recorded corpus, so it has never fired.
  - Note: the parity test added in this PR is scoped to recorded shapes, so it
    will not catch this. Fold into F1's three-way parity work.

- [ ] **F3 — Homepage awaits are sequential, not `Promise.all`**
  - Source: Claude review, `/code-review --comment` on PR #1034
  - Where: `src/pages/theleague/index.astro:321` and `:394`
  - Why deferred: pure perf, and the hotfix already removed the worse half by
    gating the transactions fetch on `userFranchiseId`. Both are Redis-backed
    with a 2-min TTL, so the cost is one extra round trip on a cache miss.

- [ ] **F4 — `MFL_USER_ID` secret is expired; `integration-test` is red on main**
  - Source: CI, observed while merging this PR
  - Where: repository secret, checked by `scripts/check-owner-cookie-replay.mjs`
    via `.github/workflows/mfl-integration-test.yml`
  - Why deferred: not a code change at all — only @braven112 can rotate a
    repository secret. Recorded here so it is not lost.
  - Detail: red on the last 8 runs on `main`, including pure data-sync commits.
    The job's own error says cookie replay for the **August cuts** job would fail
    the same way, which makes this a prerequisite for F1 actually being testable
    end to end.

- [ ] **F5 — Roster Sync cron is throttled to a run every 2–4 hours**
  - Source: found during diagnosis
  - Where: `.github/workflows/roster-sync.yml:5` (`cron: "*/5 * * * *"`)
  - Why deferred: the live-transactions cache routes contract eligibility around
    it, so the reported symptom is fixed — but every OTHER consumer of the
    committed feeds is still hours stale, which is a separate piece of work.
  - Detail: observed actual run starts 00:30, 22:32, 20:00, 17:24, 13:30, 09:02,
    04:33, 00:09 — GitHub silently drops scheduled runs on high-frequency crons.
    All runs SUCCEED; they just don't happen every 5 minutes. Worth deciding
    whether the answer is fewer feeds per run, a different trigger, or accepting
    it and moving more consumers onto live caches.

## Context to start cold

**Why ~10,000 tests passed over this for months.** The add-only BBID case was
asserted at `tests/contract-eligibility.test.ts` against a hand-typed
`'14867,|500000|,'` — a string with a trailing comma MFL does not emit. The test
and the code agreed with each other and both disagreed with reality. That is the
entire reason `tests/fixtures/mfl-transaction-strings.json` now exists: it is
recorded from the live export, one entry per distinct (type, shape), so an
assertion cannot drift from what MFL actually sends. **Do not hand-write MFL
strings into a test.** Re-record instead.

**The failure was silent by construction.** `parseTransactions()` drops any
acquisition whose string yielded no added ids, so a parse miss is
indistinguishable downstream from a player who was never acquired.
`findAcquisitionTransaction` returns null, `getPlayerEligibility` falls through
every branch, and `rosters.astro` renders plain text. There is no error, no log
line, and no failing test — which is why it took an owner noticing.

**Two causes, and the second is easy to miss.** Wicks's string always parsed
correctly. If you only reproduce with Flournoy you will conclude the parse fix
was sufficient and quietly leave the freshness half broken. The
`tests/mfl-transactions-cache.test.ts` composition test exists specifically to
pin that: same signing, not eligible against the static feed, eligible once the
live row merges in.

**Verification that actually proves something here.** Unit tests were not
enough — the live path needs real Redis, which no local clone or cloud session
has (`vercel env pull` was never run here; there is no `.env.local`). The
preview deployment was the first environment where `getCachedRecentTransactions`
ran for real, and it is what confirmed the wiring: franchise 0008 →
`new-acquisition` for Flournoy, 0015 → Wicks, with the branch's static feed
still ending `2026-09-08T04:34Z`. If you touch this path again, verify on a
preview, not locally.

**A negative test can pass for the wrong reason.** The first attempt at proving
the MFL-error-body tests failed against the old code stripped the optional
chaining as well, so the old code threw a `TypeError` instead of returning `[]`
— the tests "failed correctly" for a reason that had nothing to do with the
finding. Reconstruct the *exact* prior body when checking that a guard bites.

**MFL error shapes, verified live 2026-09-09:** a bad league id and a bad
parameter both return **HTTP 200** with `{"error": "An error has occurred - …"}`.
The `{$t: …}` variant also exists. `DAYS=<n>` on `TYPE=transactions` works and
returns ~1.3 KB versus ~84 KB for the full export.
