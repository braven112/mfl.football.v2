---
slug: waiver-column-player-ids
status: shipped
severity: P2
opened: 2026-09-17
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1156
hotfix_sha: 96d2b71
followup_issue: 1158
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1159
followup_worked: 2026-09-17
followup_merged: 2026-09-17
followup_sha: 27b91c3
followup_session: session_013bTc8oqnPeFXqWfMo39cFf
---

# Follow-up: the waiver column named players by MFL id

## What broke

The Week 1 waiver report ("Dark Magicians Drop $775K Bomb", `sf_2026_waiver_pickups_w01`,
published 2026-09-17) named every player by id — *"dropping three-quarters of a
million on Player 16171"* for what was Kendre Miller. Same article credited
Bring the Pain with *"snagging Player 15749 at no cost"* in a week they had
**dropped** Isiah Pacheco, and shipped with no composite hero.

Severity was P2, not a true hotfix: nothing was erroring, the next cron was 6.8
days out, and merging the code fix does not rewrite the published article. Ran
on the fast path at the user's explicit direction after that was said.

## What the hotfix did

Forward fix, no revert. `scripts/article-types/waiver-pickups.mjs` hand-parsed
MFL's roster-move string with `.split('|').filter(Boolean)`. The add side
carries a trailing comma, so `parts[0]` was `"16171,"` — a key no player map
holds — and every claim fell through to the `Player \${playerId}` placeholder;
`.filter(Boolean)` also erased the empty add segment that marks a pure drop.
Now routes through the shared `parseRosterMove`.

The review round also fixed `scripts/lib/roster-move-parse.mjs`: its BBID
pattern required a comma after the add id, a whole-number bid and a single
drop, so 738 of 1307 recorded BBID rows fell through to the FREE_AGENT branch
where the **bid was read as a dropped player id** and the claim priced at $0.

Guard shipped with the fix: `tests/article-transaction-parse-guard.test.ts`
(verified to fail 8 ways against the pre-fix code), wired into the
`schefter-columns` path-guard domain. **There is no F1 here** — the guard test
was not deferred.

## Deferred items

Re-validated 2026-09-17 against what actually shipped in `96d2b71`, before any
code was written. Three worked, one dropped, one still blocked.

- [ ] **F1 — The published Week 1 article is still wrong** — STILL TRUE, STILL BLOCKED
  - Re-checked: `sf_2026_waiver_pickups_w01` on `main` still carries **eight**
    `Player <digits>` placeholders (16171, 17668, 15749, 14983, 16342, 13418,
    12610) and no `heroPlayerId`. Nothing since the hotfix has touched it, and
    nothing will — the fix is to the generator.
  - Still not doable from a Claude session, for the same two reasons plus one
    more that is worth recording: there is no `ANTHROPIC_API_KEY` and no
    `.env.local` in the container, and dispatching `schefter-articles.yml` is
    refused here as a **production deploy** (that workflow commits to `main`
    and republishes the live feed) independently of whether the token would
    have carried `actions: write`.
  - **This one needs a human.** The two routes below are unchanged and still
    correct; (a) is the cheaper one.
  - Source: deferred at implementation — cannot be done from a Claude session
  - Where: `sf_2026_waiver_pickups_w01` in `src/data/theleague/schefter-feed.json`
  - Why deferred: the fix is to the GENERATOR, so it governs the next run and
    does not rewrite a published post. Regenerating needs a `waiver-pickups`
    re-run, and this session could not trigger one: no `ANTHROPIC_API_KEY` in
    the container, and `workflow_dispatch` returns **403 Resource not
    accessible by integration** (the GitHub App has `actions: read`, not
    `actions: write`).
  - How to do it: the generator dedups on the article id, so the stale post has
    to leave the feed first. `scripts/commit-feed-and-push.mjs` unions the feeds
    by post id with **ours winning on a duplicate**, so a re-run REPLACES the
    post on main in one commit with no window where it 404s — verified locally
    (1 copy after merge, no post-count drift). Either:
    (a) run `node scripts/schefter-weekly-articles.mjs --type waiver-pickups
        --week 1` locally with a real `.env.local`, or
    (b) branch off main with just that post deleted from the feed and dispatch
        `schefter-articles.yml` against that ref (`type=waiver-pickups`,
        `week=1`); the workflow commits to main regardless of the ref it ran on.
  - Note: this article type has no `buildGroupMePromo`, so a re-run does NOT
    re-ping the chat. Rebuilt fact sheet was verified correct against the live
    feeds: real names, no phantom, `heroPlayerId: "16171"`, $3.325M unchanged.

- [x] **F2 — Two independent MFL transaction parsers disagree** — WORKED, and the
      premise was partly wrong
  - Source: cross-cutting lens, step 5 (found while verifying the review's finding 1)
  - Where: `scripts/lib/roster-move-parse.mjs` and `src/utils/contract-eligibility.ts`
  - **The comma-less `N|N|N` shape does NOT actually diverge.** Ran both parsers
    over all 5,908 distinct roster-move strings in both leagues' 20 seasons
    (36,471 rows): the "auction" branch and the BBID branch are different
    *labels* for the same grammar — segment 2 is a price, segment 3 is the cut
    list — so they return identical output. The label was wrong; the reading
    was not.
  - **The real divergence was one shape: the DECIMAL bid** (`N|D|N`,
    `"7598|1525000.00|0000"`, 17 rows, 2007–2011). It matched neither
    integer-only pattern in `contract-eligibility.ts`, fell through to the
    two-segment branch, split into three, and returned **zero adds** — which
    `parseTransactions()` discards whole, so the declaration window never
    opens. That is the exact end state of the drop-free-claim bug that file was
    already fixed for once.
  - **Answering "which reading is correct per `type`":** at three segments the
    string is unambiguous and the type is not needed. At **two** segments it is
    the only thing that can decide — `"8925|625000"` is an auction price (1410
    rows) where `"11957,|9122,"` is a cut list, both bare digits. Without it,
    the auction's price is returned as a dropped player id. `parseTransactionString`
    now takes an optional `type` and `parseTransactions` passes it.
  - **Found while censusing:** `0000` in a pre-2017 drop segment is MFL's
    NOTHING-CUT sentinel, not a player. 276 rows carry it; no season of either
    league has a player with that id; it never appears in a FREE_AGENT row or
    any post-2016 shape. **Both** parsers were returning it as a dropped id, and
    in the scanner it reaches `describePlayer` → the published prose
    `Player 0000` — the same latent placeholder failure as #1156, waiting on a
    backfill that replays an old season. Filtered in both.
  - **"Make the parity test able to fail" — done, and proved.** The test never
    changed; its *corpus* did. `tests/fixtures/mfl-transaction-strings.json`
    held 10 shapes recorded from TheLeague's 2026 export alone; MFL has sent
    **60**. All three real disagreements live in shapes it did not contain, so
    it could not have failed on any of them. Re-recorded from the committed
    feeds — every league, every season — with the new
    `scripts/record-transaction-shapes.mjs` (offline, deterministic, no API
    key). Verified by running the **pre-fix** parser against the widened corpus:
    3 mismatches surface, **0** of which the old corpus could see.
  - Also added: a ratchet asserting the fixture still covers every shape the
    feeds hold (so a new MFL shape fails loudly instead of being parsed on
    faith), and a guard on the corpus's own breadth so it cannot be trimmed
    back to green.
  - **Gap closed on the way past:** `scripts/lib/roster-move-parse.mjs` — the
    file at the centre of this whole incident — belonged to **no** path-guard
    domain, so editing it ran no guard at all. It and the new recorder are in
    `contracts-eligibility` now, which also runs `tests/roster-move-parse.test.ts`.

- [x] **F6 — A THIRD parser of the same field, and the worst of them** — FOUND AND
      FIXED during this follow-up's own review round
  - Where: `src/utils/august-cut-selection-core.mjs#parseAcquisitionAdds`
  - The brief said "two independent parsers". There were three. This one was
    never in the corpus, never in the parity test, and never in a path-guard
    domain — and it was the **strictest** of the three, which made it the
    wrongest: it enumerated shapes, and every shape it had not enumerated
    returned no adds rather than failing. It missed `"0502,|425000|"` — a
    winning claim with nothing cut, in the **current** format, **281 rows** —
    plus all 738 pre-2017 rows and the 17 decimal-bid ones.
  - Its docstring advertised `"addId,|bbid|,"` as a supported shape: the
    hand-written string MFL has never emitted, and the exact fabrication that
    hid this same bug in `contract-eligibility.ts` a week earlier.
  - Impact: an acquisition that parses to no adds does not error, it silently
    never happened. A rookie won on a claim with nothing cut produced no
    acquisition event, so `selectAutoCuts` ordered the August cuts off an
    incomplete history — and that reaches `scripts/apply-august-cuts.mjs`,
    which cuts real players, plus `rosters.astro` and the admin cutdown report.
  - Rewritten onto the one positional grammar and added to the corpus parity
    test, which was verified to fail against the old version on the 281-row
    shape. Also fixed on the way: the two-segment branch stripped **all**
    commas from the add side, so a multi-add `"0519,15434,|"` spliced two
    player ids into one number that passed a digit test.

- [x] **F3 — A BBID row with no readable add id is skipped with no warning** — WORKED
  - Source: cross-cutting lens, step 5
  - Where: `scripts/article-types/waiver-pickups.mjs`
  - Confirmed still true. An unreadable row is *unparsed* — neither a drop nor a
    free pickup — and which of those two silent readings it got depended only on
    which check ran first. Both halves warn now; an ordinary drop still does not,
    because a warning that fires on normal rows is one the operator learns to skip.
  - Side effect worth noting: the unreadable row no longer creates an empty
    `claimsByTeam` entry, so it can no longer surface as a `(0 claims, $0 spent)`
    team or win the `Most claims` reduce.

- [x] **F4 — Fact sheet says "1 claims"** — WORKED
  - Where: `scripts/article-types/waiver-pickups.mjs`
  - The fact sheet is the model's only source of truth and is read as prose, so
    a broken plural is a sentence the column can echo verbatim. Local `countOf`
    helper; one call site.

- [x] **F5 — Re-read the PR for post-merge reviewer findings** — DROPPED, nothing found
  - Source: `/hotfix` step 5 — CodeQL (`Analyze`) was not waited on
  - Where: https://github.com/braven112/mfl.football.v2/pull/1156
  - All five checks on the head commit (`1a4ceb3`) are green, including the two
    that landed **after** the 18:24:10 merge: `CodeQL` at 18:24:45 and `Analyze`
    at 18:24:50. Copilot reviewed at 18:06 — "Approval recommended", 0 comments.
    Gemini never ran (the external reviewer is opt-in since Aug 2026 and was not
    requested). No comment of any kind was posted after the merge except the
    hand-off note. Nothing to adjudicate.

## Context to start cold

- **Why nothing threw.** `players.get("16171,")` returning `undefined` hits the
  `?? `Player \${playerId}`` fallback, which is *published prose*. All ten ids
  resolve fine in the players feed — the comma was the only cause. The lesson
  recorded in `docs/claude/rules/schefter.md` is that a placeholder is not a
  safe degradation in a generator whose output ships unread.
- **Shape census, both leagues, all 20 seasons** (the thing worth not
  re-deriving): BBID is `N,|N|N,` / `N,|N|` from 2017 on, and `N|N|N` plus
  decimal-bid `N|N.N|N` / `N|N.|N` in 2007–2016. FREE_AGENT is `|N,` (drop),
  `N,|` (add), `N,|N,` (swap), and multi-drop `|N,N,...` up to 14 ids. The AFL
  has **zero** BBID_WAIVER rows in any season — which is why the blank
  `Highest single bid: $0 for  by ` line the review found would have been
  every AFL week, and why the changelog line is tagged `theleague`, not
  `both` (the workflow's fallback branch runs this type with no `--league`).
- **Ruled out:** not an MFL data problem, not a feed-freshness problem, and not
  present in any other article type or in either league's archive — a scan of
  both feeds (786 posts) plus the archive shards found exactly one post
  carrying a `Player <digits>` placeholder.

## Census, corrected and widened (2026-09-17 follow-up)

The brief's summary above was right but partial. The full census — both
leagues, every season on disk, 36,471 rows — is now a committed artifact rather
than a paragraph: `tests/fixtures/mfl-transaction-strings.json`, regenerated by
`node scripts/record-transaction-shapes.mjs`. **60** distinct (type, shape)
pairs, against the 10 the fixture used to hold.

`BBID_WAIVER`, all of it TheLeague (the AFL has never had one row):

| shape | rows | seasons |
|---|---|---|
| `N,\|N\|N,` | 288 | 2017–2026 |
| `N,\|N\|` | 281 | 2017–2026 |
| `N\|N\|N` | 452 | 2007–2016 |
| `N\|N\|Z` | 269 | 2007–2016 |
| `N\|D\|N` | 10 | 2007–2011 |
| `N\|D\|Z` | 7 | 2007–2010 |

`D` is a decimal bid; `Z` is the `0000` nothing-cut sentinel, which gets its own
token in the shape mask precisely so the corpus can carry it as its own case —
folded in with `N` it shares a group with a real drop id and disappears.
569 modern + 738 legacy = 1307, matching the hotfix's adjudication exactly.

`FREE_AGENT` runs to 14 comma-delimited drops (`|N,N,…`), and the AFL has the
only `N,\|N,N,` row in either league (2024). Two shapes outside the roster-move
family are worth knowing about because `ACQUISITION_TYPES` includes
`AUCTION_WON`: `"8925|625000"` (1410 rows) and MFL's scientific notation
`"6616|1.525e+06"` (334 rows), both two-segment and both needing the `type`.

## Shipping

PR: https://github.com/braven112/mfl.football.v2/pull/1159 — **merged as `27b91c3`**.
Targets `main`, not
`staging`. This is a bug fix, which `docs/plans/staging-release-process.md`
(line 117) puts straight to prod, and `staging` has not taken #1156 yet: a PR
against it would drag the whole hotfix plus ~100 cron commits along.

Worked on branch `followup/waiver-column-player-ids`, off `origin/main`.
`pnpm test:unit` green at 505 files / 12,221 tests. The two new behavioral
guards were verified to fail against the pre-fix code (F3: `warn` not called;
F4: `(1 claim,` absent), and the widened corpus was verified to surface 3
parity mismatches the old one could not see.

The review round found four more things, all confirmed and fixed in the PR —
the significant one being **F6** above, a third parser. It also found that six
places read this one MFL field, not two; the three still unpinned are filed as
`docs/claude/followups/2026-09-17-transaction-parser-proliferation.md`, one of
them (`offseason-hero-data.ts:999`) a live inversion that reports the players a
team CUT as its recent pickups.

Reviewers: Claude correctness / cross-cutting / quality all ran. Copilot ran and
independently raised F6. CodeQL and Analyze green. **Codex did not run** (CLI
absent in the cloud sandbox) and **Gemini did not run** (`workflow_dispatch`
403s for this token — `actions: read`, not `actions: write`, the same gap F1
records). Neither is a clean pass.

`/update-whats-new`: **skip**. Nothing here is reader-facing — the parser
divergence only ever affected pre-2017 rows, and the fact-sheet wording is
model-facing. F1 is the only user-visible half of this incident and it remains
open.
