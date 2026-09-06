# The Board (Suggestion Box) — rules

Covers `/suggestions` in every league, the `/api/suggestions/*` routes,
`src/utils/suggestions-storage.ts`, `src/utils/suggestions-scope.ts`, and the
GitHub handoff (`src/utils/github-issues.ts`, `src/utils/suggestion-issue.ts`).

The Board is where an owner's idea enters the system and, if the commissioner
files it, leaves as a tracked work item. Both ends of that pipe have a trap.

---

## 1. The scope is derived from the SESSION, never from the request

`src/utils/suggestions-scope.ts` is the only place that decides which board a
call reads or writes, and `boardScope(user)` is the only sanctioned way to get
one. The `user` comes from `getAuthUser(request)` — the signed session JWT.

Never take the board from a query param, a body field, a header, or the page
the request came from. All of those are client-controlled, so any of them would
let a session signed into one league post onto another league's board by
editing one character. This is the same boundary the rankings store enforces by
*rejecting* a mismatched `?league=` (CLAUDE.md, "Rankings are per-league"); the
Board doesn't accept the param at all, which is strictly simpler.

`tests/suggestions-scope.test.ts` scans every route under
`src/pages/api/suggestions/` and fails on a literal scope argument or a
`searchParams.get('league')`.

## 2. Both leagues have a franchise 0001 — bare keys are ambiguous, not just messy

The Board shipped TheLeague-only, so its Redis keys were bare (`sb:ideas`,
`sb:last-seen`, `sb:rate:0001`). Two of those key on `franchiseId` **alone**:

- `sb:last-seen` — AFL 0001 opening the board would have marked TheLeague
  0001's unread badge as read.
- `sb:rate:{franchiseId}` — one owner's posting rate limit would have been
  consumed by a different person in the other league.

And `sb:ideas` unscoped would publish one league's rule-change debates on the
other league's page.

`scopedBoardKey` infixes the scope after the `sb:` namespace
(`sb:afl:last-seen`) for every league except TheLeague, whose keys stay
**byte-identical** so nothing posted before the AFL got a board is orphaned. If
you add a key, add it to `BASE_KEYS` in `suggestions-storage.ts` and to the
guard test's list — a key that skips `scopedBoardKey` is a silent cross-league
merge, not a visible error.

`scopedBoardKey` throws on a key that doesn't start with `sb:`, because such a
key would land in the keyspace root rather than the board's namespace.

## 3. Team names come from the scope's config, not TheLeague's

`resolveTeamName` used to `import('../data/theleague.config.json')`
unconditionally. On the AFL's board that resolves franchise 0001 to a real —
and wrong — team name rather than failing visibly. It now goes through
`getLeagueTeamBrands(leagueSlugForSuggestionsScope(scope))`.

Any new field the Board reads out of a league config has the same requirement.

## 4. Admin buttons need the league check, not just the role check

`isCommissionerOrAdmin(user)` answers "is this person an admin **of their own
league**". It is not "is this person an admin *here*". A TheLeague commissioner
browsing the AFL's board would pass it, so the route wrapper pairs it with a
league test (`authUser.leagueId === LEAGUES[...].id`) before passing `isAdmin`
into the page. Same footgun CLAUDE.md flags for admin links into league-scoped
pages.

## 5. Filing a GitHub issue is idempotent, and a partial success is not a failure

`POST /api/suggestions/ideas/{id}/github-issue`:

- An idea that already carries `githubIssue` is returned **as-is with 200**.
  Several people admin the board and a double-click must not open a duplicate.
  The UI reinforces this by turning the button into a link once filed.
- If GitHub creates the issue but the Redis write then fails, the route returns
  **207 with the issue URL and a warning** — not a 500. The issue exists; a 500
  would read as "nothing happened" and invite a second filing that *would*
  duplicate.
- Every GitHub failure comes back as a message the commissioner can act on (a
  missing token, a 403), because the caller is a button and "nothing happened"
  is the worst outcome there. `createGitHubIssue` never throws.

## 6. The issue body must carry every structured field

The composer collects page/feature, problem, and desired behavior precisely so
the issue doesn't need a round-trip back to the owner — and by the time you'd
ask, the owner has moved on. That round-trip is the failure mode the whole
feature exists to remove, so a field added to `WebsiteFields` must also be added
to `buildIssueBody`. `tests/suggestion-issue.test.ts` pins the current set.

The backlink is built with `leagueUrl()`, never string concatenation
(`docs/claude/rules/league-urls.md`), and an unknown league degrades to naming
the idea id rather than throwing inside a click handler.

## 7. One page, two routes

`/suggestions` exists in both leagues as a thin wrapper over
`src/components/shared/suggestions/SuggestionBoxPage.astro`. Don't copy the
component into a league directory — `tests/page-fork-ratchet.test.ts` fails a
new forked sibling, and the two boards differ only in which config supplies the
crests and which league the sidebar links point at. Both are props.
