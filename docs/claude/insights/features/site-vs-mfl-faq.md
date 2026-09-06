# Site-vs-MFL FAQ, The Board in two leagues, and the GitHub handoff

Built 2026-09-06. One thread: tell owners what the two sites are for, then
make the "post an idea" half of that story actually true by opening The Board
to the AFL and giving the commissioner a one-click path from an idea to a
tracked work item.

Files, by layer:

| Layer | Files |
|---|---|
| FAQ | `src/components/shared/faq/FaqPage.astro`, thin routes `src/pages/{theleague,afl-fantasy}/faq.astro` |
| Board scope | `src/utils/suggestions-scope.ts` (the boundary), `src/utils/suggestions-storage.ts` (every fn takes it) |
| Board page | `src/components/shared/suggestions/SuggestionBoxPage.astro`, thin routes in both leagues |
| GitHub handoff | `src/utils/github-issues.ts` (network), `src/utils/suggestion-issue.ts` (pure body/title/labels), `src/pages/api/suggestions/ideas/[id]/github-issue.ts` |
| UI | `AdminToolbar.tsx` (button → link once filed), `IdeaDetail.tsx`, `SuggestionBox.tsx` |
| Guards | `tests/suggestions-scope.test.ts`, `tests/suggestion-issue.test.ts`, `docs/claude/rules/suggestion-box.md` |

---

## 2026-09-06 — The dangerous keys were the ones nobody would have looked at

The obvious risk in giving the AFL a board was `sb:ideas` — one hash, two
leagues, everybody's ideas mixed together. That one is loud: you'd see it on
first load and fix it in a minute.

The two that would actually have shipped are `sb:last-seen` and
`sb:rate:{franchiseId}`, because **they key on franchiseId alone**. Both
leagues have a franchise 0001. An AFL owner opening the board would have
cleared a TheLeague owner's unread badge, and one owner's posting rate limit
would have been consumed by a different person entirely. Neither produces an
error, a wrong name on screen, or anything a reviewer would notice — the
badge is just gone, once, for somebody else.

The lesson generalizes past this feature: when a single-league store goes
multi-league, **the risky keys are the ones whose only variable is the
franchise id**, not the ones holding the obvious shared content. Those are
invisible when they break.

`resolveTeamName` had the same shape and was nearly missed for the same
reason: it hardcoded an import of TheLeague's config, so on the AFL's board
franchise 0001 would have resolved to a real, wrong team name rather than
failing. A lookup that always finds *something* never announces that it is
looking in the wrong place.

## 2026-09-06 — Scoping is safest as a required parameter, not a default

`suggestions-storage.ts` could have defaulted the scope to TheLeague and
saved fourteen call-site edits. Every function requires it instead, with no
default, so the compiler enumerated the call sites rather than leaving the
ones nobody remembered quietly writing the legacy bucket.

That is what caught the two `findCommentAcrossIdeas` helpers, which sit
*above* the handlers where `user` is not in scope — an easy miss in a
mechanical pass, and one that would have compiled fine under a default.

The scope itself comes from `getAuthUser(request).leagueId` and nowhere
else. Not a query param, not a body field, not the referring page. The
rankings store solves the same problem by *rejecting* a mismatched
`?league=`; not accepting the param at all is strictly simpler, and the guard
test scans every route to keep it that way.

## 2026-09-06 — TheLeague's keys stay byte-identical, so there is no migration

`scopedBoardKey(base, 'theleague')` returns `base` unchanged. Every idea,
comment, reaction and last-seen marker written before this change still
loads, and no migration script exists to go wrong at 2am. Same idiom as
`rankings-scope.ts` and `schefter-keys.mjs`, and it should be the default
move whenever a single-league store grows a second league: the new league
gets an infix, the incumbent gets nothing.

## 2026-09-06 — A partial success is not a failure, and saying so prevents the duplicate

`POST .../github-issue` has a state that most write routes don't: GitHub
created the issue, then the Redis write failed. Returning 500 there would be
accurate about the request and wrong about the world — the issue exists, and
a commissioner reading "500" clicks again and opens a second one. It returns
**207 with the issue URL and a warning** instead.

The same reasoning drives the two other choices:

- An idea that already carries `githubIssue` returns **200 with the existing
  link**, not a fresh filing. Several people admin the board.
- The UI turns the button into a link once filed, so the duplicate is never
  offered in the first place. The route refusing it is the backstop, not the
  mechanism.
- `createGitHubIssue` never throws and surfaces GitHub's own message. The
  caller is a button, and "nothing happened" is the worst possible outcome
  there — a missing token and a 403 need different actions from the person
  clicking.

## 2026-09-06 — Splitting the issue body from the network call is what keeps the ticket useful

`suggestion-issue.ts` is pure; `github-issues.ts` does the fetch. The split
exists because the body is the half that rots: a field added to the composer
and not to the body means the ticket silently loses the thing the owner
typed, and nobody notices until an agent picks up "the standings page is
confusing" with no page, no problem, and no expected behavior.

That round-trip back to the owner is the exact failure the whole feature was
built to remove — by the time you ask, the owner has moved on. So the body is
asserted in a test that needs no token.

## 2026-09-06 — The guards found two things the author didn't

Worth recording because it argues for running them early rather than at the
end:

- `tests/whats-new-data.test.ts` rejected an AFL-only entry whose summary said
  "The League" — the cross-league hero bug, caught in copy rather than code.
  It also enforced the `-dark` screenshot twin and the 40-entry retention cap
  (fixed mechanically: `node scripts/weekly-changelog-rollup.mjs --cap-only`).
- `tests/article-links.test.ts` failed because Schefter's destination registry
  still believed `/suggestions` was TheLeague-only. Giving a league a page is
  not finished when the route renders — the registries that describe what
  exists where have to learn it too.

And the type ratchet reported a **drop** (1764 → 1763): threading the scope
through exposed that `seed.ts` had been calling `saveComment(idea.id,
comment)` against a one-argument signature since the route was written. A
mechanical refactor is a decent way to surface arity bugs that were never
load-bearing enough to fail visibly.
