---
slug: league-planner-two-destinations
status: open
severity: P3
opened: 2026-09-16
found_in_pr: https://github.com/braven112/mfl.football.v2/pull/1127
found_session: session_012N2ocehj5VUdEL55tkYmPG
---

# Follow-up: "League Planner" names two different pages

## What is inconsistent

PR #1127 repointed the nav's **League Planner** entry from
`/rosters?view=planner` to `/front-office`, in both leagues. Two other chrome
surfaces still name the old destination, because both resolve the
**page-directory id** `league-planner`, whose `path` is unchanged:

| Surface | Source | Destination |
|---|---|---|
| Left nav (Offseason War Room) | `src/config/nav-config.json` | `/front-office` |
| Footer, "My Team" column | `src/config/footer-config.ts:138` (directory id) | `/rosters?view=planner` |
| Site search | `src/data/page-directory.json` (`id: league-planner`) | `/rosters?view=planner` |

So a TheLeague owner who clicks "League Planner" in the drawer and "League
Planner" in the footer lands on two different pages, both of which really do
render a planner.

**Neither destination is broken.** `?view=planner` aliases to `rosters.astro`'s
`nextyear` view (`src/pages/theleague/rosters.astro` ~10381–10386), whose tab
`aria-label` is itself "League Planner". `/front-office` renders the deliberate
narrowed re-derivation of that same slice — see
`src/utils/front-office-planner-data.ts`'s header. This is a naming collision,
not a dead link.

## Why it was not fixed in #1127

Repointing the directory id moves three things at once — site search results,
the footer column, and the `site-analytics` rollup that canonicalizes
`/rosters?view=planner` onto the `/rosters` key
(`tests/site-analytics.test.ts` pins both behaviors). That is a decision about
which planner is *the* planner, not a mechanical rename, so it belongs to
Brandon rather than to a nav-ordering PR.

## The options

1. **Point the directory id at `/front-office`.** One name, one destination
   everywhere. Costs the rosters `nextyear` tab its own search entry — add a
   separate entry for it if it should stay findable.
2. **Rename one of them.** e.g. the rosters tab becomes "Next Year" (its
   internal view name already is), leaving "League Planner" to mean
   `/front-office` alone.
3. **Leave it.** Both work; the duplication is only confusing if an owner
   notices the two links differ.

## Guard gap

`tests/front-office-section.test.ts`'s duplicate-label guard is **nav-only** —
it iterates `nav-config.json` sections and cannot see the footer or the
directory. A guard that catches this class would have to resolve all three
surfaces for one league and assert that a label maps to one path. Worth writing
alongside whichever option is chosen, not before.
