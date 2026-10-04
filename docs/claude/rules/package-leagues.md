# Package leagues — pages follow features

A **package league** (registry `pageKit: 'package'`: Archie's and every league
the League Launcher builds) gets its pages from one kit, entitled by its ticked
features. Three things move together and must never be edited apart:

| What | Source | Applied by |
|---|---|---|
| Route files `src/pages/<slug>/…` | `templates/package-league/<route>.tmpl` | `scripts/sync-league-routes.mjs` |
| Site-search entries | `templates/package-league/page-directory.json` | same |
| Nav links | `templates/package-league/nav-section.json` | same, and filtered live by `nav-utils.ts` |

Which routes a league gets: `src/config/package-league-routes.mjs` — `null` is
every package league, a feature key is "only while that box is ticked".

## Rules

- **Edit the template, never the route file.** A package league's route file
  is output. Change `templates/package-league/x.astro.tmpl`, then
  `node scripts/sync-league-routes.mjs --all` — the fix reaches every league
  at once. `tests/package-league-routes.test.ts` fails on a route that drifted
  from its template, which is how an edit made only to Archie's copy is caught.
- **The template names no league.** `__LEAGUE_SLUG__`, `__LEAGUE_NAME__`,
  `__LEAGUE_SHORT__` only. Archie's used to BE the template, which meant
  unticking one of Archie's boxes would have deleted the pages every later
  launch copies.
- **A league's own pages stay outside the manifest.** Archie's Gauntlet and
  its theme previews are not kit routes, so no sync writes or deletes them,
  and their nav links are left alone.
- **Change a league's features through the update path**, not by hand:
  `node scripts/update-league-features.mjs '{"slug":…,"features":{…}}'` (or the
  Launcher's "Change a league's features", which opens a PR). It sets the
  registry values in place — comments kept — and syncs pages, search and nav;
  the scheduled jobs follow on their own (`scripts/lib/league-jobs.mjs`).
- **The nav never links a page the features do not entitle**, even before a
  sync has run: `linkMatchesLeague` asks `packageLeagueHasPath`.

## Review every launch and features PR with `/launch-check`

`node scripts/launch-check.mjs <slug>` loads each of the league's pages in
light and dark against a running server and reports non-2xx pages, script
errors, leftover placeholders, dead body links and another league's name or
links, with a screenshot of each (`.claude/skills/launch-check/SKILL.md`).
A finding that also shows on an established league is a shared-component bug:
fix it at the source.

## Not covered yet

TheLeague and the AFL have hand-built pages; their features cannot be changed
this way until those pages are unforked into shared components (roadmap step 6).
A removed page can still be linked from shared components that do not ask
`packageLeagueHasPath` (Schefter article links already do) — check the PR's
preview for dead links after unticking a box.
