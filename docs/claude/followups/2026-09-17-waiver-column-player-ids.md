---
slug: waiver-column-player-ids
status: open
severity: P2
opened: 2026-09-17
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1156
hotfix_sha: 4bf64f3
followup_issue:
followup_pr:
followup_session:
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

- [ ] **F1 — The published Week 1 article is still wrong**
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

- [ ] **F2 — Two independent MFL transaction parsers disagree on the comma-less shape**
  - Source: cross-cutting lens, step 5 (found while verifying the review's finding 1)
  - Where: `scripts/lib/roster-move-parse.mjs:50` and
    `src/utils/contract-eligibility.ts:86` / `:107`
  - Why deferred: an audit, not a fix; widening a fast-path PR into the
    contract-declaration path is the wrong trade.
  - The question: `contract-eligibility.ts` reads a comma-less `N|N|N` as an
    **AUCTION** shape ("no comma after the id, which is what separates it from
    the BBID shape above"), while the feeds carry 738 rows typed
    `BBID_WAIVER` in exactly that shape (2007–2016). This PR made the comma
    optional in `parseRosterMove`'s BBID branch, which is right for those rows
    and also improves genuine auction strings there (`parseRosterMove` has no
    auction branch at all — it previously read an auction bid as a dropped
    player). But the two parsers now classify the same string differently, and
    `tests/contract-eligibility.test.ts:730` passes either way, so the parity
    test is not actually pinning this. Decide which reading is correct per
    `type`, and make the parity test able to fail.

- [ ] **F3 — A BBID row with no readable add id is skipped with no warning**
  - Source: cross-cutting lens, step 5
  - Where: `scripts/article-types/waiver-pickups.mjs:77`
  - Why deferred: not wrong (nothing gets published either way), but
    inconsistent with the bid check three lines below, which does warn.
  - Detail: the `addedIds.length === 0` drop-skip runs before the
    `BBID_WAIVER && !Number.isFinite(bbidAmount)` check, so a nonsense BBID
    string is silently treated as a drop. A test documents the ordering.

- [ ] **F4 — Fact sheet says "1 claims"**
  - Source: deferred at implementation
  - Where: `scripts/article-types/waiver-pickups.mjs:118`
  - Why deferred: cosmetic, and model-facing rather than reader-facing.

- [ ] **F5 — Re-read the PR for post-merge reviewer findings**
  - Source: `/hotfix` step 5 — CodeQL (`Analyze`) was not waited on
  - Where: https://github.com/braven112/mfl.football.v2/pull/1156
  - Why deferred: the diff touches no auth, no server route and no
    user-supplied URL, so CodeQL was not in the blocking bucket. Gemini and
    Copilot were not waited on either.

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
