# Release review — 2026-09-29

**Verdict: GO**

**Range:** `origin/main...origin/staging` at staging `316eca175c`. About 30
feature PRs since the last promotion, 650 files, +103,137/−20,257 (most of the
line count is committed data and the demo's generated fixtures).
**Blackout:** `release-blackout.mjs` reports Tuesday 2026-09-29 clear to promote.
**CI on the tip:** `Tests` and `Type baseline` both green (run 36671616868).

## Merge-down (resolved before this review)

`staging-merge-down.yml` failed on every main push from 2026-09-28 on, because
hotfixes landed on main while overlapping work landed on staging. It was fixed
in `db76ec07a3` + `316eca175c`:

- Live standings (#1252/#1257 on main, #1254 on staging): kept staging's
  version, which is the superset.
- Throwback Week hotfixes #1273 and #1275 re-applied inside the shared
  AFL-family components that #1227 introduced (`StandingsPage`, `LineupPage`).
  Git could not carry them over, because the AFL route files became thin wrappers.
- Auth: kept both #1216 (registry-only sessions) and #1241 (MFL Live pilot
  sign-in for league 10105), by Brandon's call. The pilot leagues get a session
  through the `mfl-live` scope only, `getAuthUser` keeps it, and
  `isCommissionerOrAdmin` refuses it. Pinned in `tests/auth-league-scope.test.ts`.
- `demo-generator`'s live-week test depended on the cron-synced 2026 feed still
  holding a half-played week. It now builds that week itself.

## Landed after the review

- #1266: the AFL's What's Next and calendar now use the AFL's own league year
  (it rolls June 1), not TheLeague's Feb 14 date. The change is utility code
  only, pinned by `tests/afl-event-league-year.test.ts`, and CI was green on the
  promoted tip.

## Promotion

`main` fast-forwarded `314e6c4e0b → d01861d556` on 2026-09-29, 22:3x PT, after
Chromatic build 544 (95 visual changes) was accepted.

## Blocks promotion

None.

## Stored-shape compatibility

Every write in range goes to a NEW key namespace that nothing on main reads:
`insights:*` (#1253 site analytics), `demo:tokens:*`, `demo-leads:*`, and
`mfl-standin-state*` (#1227, demo deployment only). The existing owner-activity
writes in `track-visit.ts` keep their signatures and value shapes
(`recordVisit`, `recordAnonymousVisit`). Current production can read everything
staging writes.

## Build rehearsal

`PREBUILD_FULL=1 pnpm prebuild`: exit 0, 31s, every step green. The range changed
`prebuild.mjs`, `compute-afl-free-agents.mjs` (a new `--league` flag) and
`build-styles.mjs`. `free-agents.json` differed only by its stamp, so production's
reader is unaffected. The 2027 ADP/playerRanks 404 warnings come from existing
fetches this range did not touch, and they degrade as designed.

## Fix before promotion

None beyond the merge-down itself.

## Follow-up filed

`docs/claude/followups/2026-09-29-release-review-followups.md`:

- **Live boards poll in background tabs.** `LiveStandingsBoard.tsx:82-112`
  (new) copies `LiveBoard.tsx:235-271` (already in production): a `setTimeout`
  chain with no `visibilityState` gate. Each poll fans out to 2N MFL reads for
  an owner in N leagues. Fix both boards together.
- **Two Redis EVALs per page view.** `track-visit.ts` now runs owner-activity
  and site-insights as separate scripts. They could merge into one.
- **Three bye-week lookups.** `nfl-bye-lookup.ts` (new, normalizes both dialects
  of team code), `nfl-bye-weeks.ts#byeWeeksForSeason`, and
  `draft-broadcast-server.ts#loadByeWeeks`. The new one exists because the
  others miss eight teams under ESPN codes, so fold the older two into it.
- **TheLeague's trade builder is still a 503-line page** while the AFL's is now
  a wrapper over `afl-family/TradeBuilderPage`. This is a unification
  candidate, not drift: TheLeague's copy carries contract logic the component
  does not.

## Ratchets

| Baseline | Before | After | Why |
|---|---|---|---|
| page-fork | — | −1 (`theleague/players.astro` pair) | #1227 unified the players pages |
| typecheck | unchanged | unchanged | CI Type baseline green |
| design-literal | (new) | 2099 font-size / 213 transition / 251 shadow | #1265 introduced the ratchet. The merge-down's ported lines use tokens |

## Visual diffs (Chromatic)

#1265 (design polish: motion and type tokens, dark elevation, shared states)
touches the story import closure, so expect a large batch that is mostly
#1265's. The rosters phone-layout PRs (#1218/#1219/#1233/#1235) and the
Throwback standings line account for the rest.

## Checked, nothing found

Sibling drift (all other unchanged twins are not applicable: custom-site titles
and league-specific rules pages). Hydration: one new `client:load`
(`LiveStandingsBoard`, the page's main content). The `src/data` bundle is 15.1 MB of 50 MB.
The Gemini duplication sweep did not run: its CLI is not installed in this
session, so the duplicate check was done by hand, for bye-week lookups, device
classification and empty states.
