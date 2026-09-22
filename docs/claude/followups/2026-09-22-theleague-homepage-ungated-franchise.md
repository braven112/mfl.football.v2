---
slug: theleague-homepage-ungated-franchise
status: open
severity: P2
opened: 2026-09-22
found_during: https://github.com/braven112/mfl.football.v2/pull/1186
found_session: session_01VT95wpLFH8jTdRSfZhT4Ry
---

# Follow-up: TheLeague's homepage reads the session franchise ungated

## What's wrong

`src/pages/theleague/index.astro:85`:

```js
const userFranchiseId = authUser?.franchiseId;
```

No league check. Both leagues have a franchise 0001 — and a 0007, and a 0013 —
so an **AFL owner browsing TheLeague's homepage is matched to TheLeague's
franchise of the same number**. Two places consume it:

- **:326** — `allTeams.find(t => t.franchiseId === userFranchiseId)` sets
  `userTeamName` / `userTeamIcon` from `theleague.config.json`. An AFL owner is
  shown a TheLeague club's name and crest as *their* team.
- **:412** — `liveTransactions` fires `getCachedRecentTransactions(...)` for a
  viewer who owns nothing in this league: a blocking MFL fetch in front of TTFB
  for a card that is about somebody else's roster.

## Why it is clearly a defect and not a decision

The same file already knows the rule. Fourteen lines below, `:99` derives a
second, *correctly gated* id for the install banner:

```js
const theLeagueFranchiseId =
  authUser?.leagueId === THELEAGUE.id ? (authUser.franchiseId ?? null) : null;
```

— with a comment that reasons it out ("It takes a TheLeague SESSION, not merely
a signed-in one — same reasoning as the AFL homepage"). So the page carries two
verdicts on the same question and they disagree, which is the exact failure
`franchiseIdForLeague`'s docstring warns about: *"Derive every signed-in flag
from this rather than re-comparing `leagueId` inline, so the page cannot carry
two verdicts that disagree."*

The AFL's twin, `src/pages/afl-fantasy/index.astro`, was moved onto
`franchiseIdForLeague` in PR #1186. TheLeague's was not, because it does not
call the preferred-team resolver at all — which is why the diff could not show
this and `scripts/sibling-drift.mjs` is what surfaced it.

## The fix

Replace `:85` with `franchiseIdForLeague(authUser, THELEAGUE.id)` and collapse
`theLeagueFranchiseId` into it, so the page has one verdict. Import is already
available from `src/utils/auth.ts`.

**Check each consumer before collapsing.** `userFranchiseId` is read in ~8
places in a 500-line frontmatter; some already re-gate inline (`:343`,
`:266`), and those inline checks should come out with it rather than be left
double-guarding. Confirm no consumer wants "signed in at all" rather than
"an owner here" — `isAuthenticated` is the flag for that case and already
exists.

## Why it was not fixed in #1186

Pre-existing, on a page that PR does not otherwise touch, and the change is
behavioural across several homepage branches. Widening a resolver fix into the
homepage's auth model is how a reviewable diff stops being one.

## Guard

`docs/claude/rules/preferred-team.md` § "Derive the session id with
`franchiseIdForLeague`" holds the rule;
`tests/preferred-team-resolution-guard.test.ts` enforces it at the fourteen
resolver call sites only. This page is not one of them, so closing this
follow-up should widen that guard's scan to any `src/pages/**` frontmatter that
reads `authUser?.franchiseId` without a league gate — that is the shape, and it
would have caught this without a drift run.
