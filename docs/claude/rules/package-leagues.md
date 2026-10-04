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

## Rules and Ask Roger

The **Ask Roger** box (`rulesQa`) gives a package league a Rules page and the
Roger chatbot. Both read two sources: the commissioner's written rulebook,
dropped in as `data/<slug>/constitution.md` (optional), and the league's MFL
settings digest, regenerated on every sync. A league with no written rulebook
still gets a working Rules page and Roger, answering from its MFL settings.
To add a commissioner's rulebook later, commit `constitution.md` — no code
change. Roger's rules: `docs/claude/rules/roger.md` § "Ask Roger for package
leagues".

## Playoffs — a box AND the data

The **Playoffs** box (`playoffs`) gives a package league the shared Playoffs
page (`src/components/shared/playoffs/PlayoffsPage.astro`, the AFL's page made
shared; TheLeague's stays its own). Its route is generated whenever the box is
ticked, but the page and every link to it stay hidden until MFL has the
league's REAL brackets — the owner's call, so a commissioner who has not set
brackets up never sees an empty page.

- **The index is the gate.** `data/playoff-bracket-leagues.json` lists the
  leagues with real brackets; the feed sync adds a league the first run they
  arrive and never removes one (`src/utils/playoff-bracket-index.mjs`).
  `tests/playoff-bracket-index.test.ts` fails if it disagrees with the feeds.
- **Every listing surface asks `packageLinkVisible`** (package-league-routes.mjs):
  the nav, the header's icon row and the homepage's quick links. The header
  and quick links used to list a league's kit links unfiltered, which was
  harmless only while every kit page existed the moment its box was ticked. A
  new surface that lists a package league's pages must ask it too.
- **Seeding is MFL's.** A package league shows MFL's resolved franchises as
  they are (`franchiseResolver`); a slot MFL has not filled stays "Seed N".
  Standings order is not seed order (standings-brackets-draft-order.md, rule 4).
- **Predicted brackets are TheLeague's alone.** The sync's standings-based
  prediction is TheLeague's format; it was written for Archie's too, and
  Archie's calendar announced TheLeague's playoff weeks as its own.

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
