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

## Franchise pages — the league's whole MFL history

The **Franchise pages** box (`franchisePages`) gives a package league the
shared franchise index and detail pages (`components/shared/franchises/`, the
AFL's pages made shared; TheLeague's stay its own), built from every season
MFL holds for the league.

- **Backfill first.** `node scripts/backfill-historical-feeds.mjs --league=<slug>`
  fetches every past season listed in the league's synced `league.json`
  (or the "Backfill historical MFL feeds" workflow — add the slug to its
  choice list). It reads each season's last week from MFL, capped at 18:
  MFL reports `endWeek` 22 for a season that runs to the end of the NFL
  calendar.
- **The chain picks the league up on its own** once the box is ticked
  (league-jobs `franchise-history`; prebuild runs one history step per league).
  A package league gets the default target in
  `compute-franchise-history.mjs`: no salary awards, badges or milestone posts
  (the first run would backdate a post per past award); points summed from
  weekly scores where the standings export has no `pf` column; and no playoff
  appearance a season's MFL bracket does not declare.
- **Champions a league plays outside MFL** go in
  `data/<slug>/championship-history.json` by hand; they show as Titles.
- **No division-strength report** for a league without that page
  (league-jobs `division-strength`): it replays schedules against the ledger,
  and Archie's 2021 schedule runs past its standings.
- **No owner section yet.** Owner names come only with commissioner access;
  where the site has none, owners stay anonymous and the section is hidden.
- **Check whether MFL renumbers the league's franchises.** History is credited
  by franchise id, which is only an identity if ids are stable. Archie's
  reshuffled 33 of 99 teams between 2021 and 2026 (the SeaBirds were 0100,
  then 0048 — while 0048 had been the Mavericks), so every 0048 season went to
  the SeaBirds and their own two vanished. Survey the feeds' names per id
  before trusting a new league's history. If ids move: set the registry's
  `renumbersFranchises: true` (departed teams group by NAME in owner-tenures),
  and give every current team an `ownerHistory` with
  `node scripts/derive-owner-history.mjs --league=<slug> [--by=team-name] --write`,
  then rerun the chain. `--by=owner` (the default, or the "Fetch Owner Names"
  workflow with task=owner-history) is exact but needs commissioner access to
  EVERY league-year — Archie's 2026 co-commissioner login named 2026 only, and
  the script refuses to write a partial answer. `--by=team-name` is the
  conservative fallback: a renamed team's earlier seasons stay unattributed
  (Archie's: 138 of 467), never credited to whoever held the id.
- **Several games a week on one score** (Archie's plays two): the page shows
  points per week, not per game.

## Review every launch and features PR with `/launch-check`

`node scripts/launch-check.mjs <slug>` loads each of the league's pages in
light and dark against a running server and reports non-2xx pages, script
errors, leftover placeholders, dead body links and another league's name or
links, with a screenshot of each (`.claude/skills/launch-check/SKILL.md`).
A finding that also shows on an established league is a shared-component bug:
fix it at the source.

## Not covered yet

TheLeague and the AFL have hand-built pages; their features cannot be changed
this way until those pages are unforked into shared components (roadmap step 6
— rosters, players, playoffs and franchise pages are shared now).
A removed page can still be linked from shared components that do not ask
`packageLeagueHasPath` (Schefter article links already do) — check the PR's
preview for dead links after unticking a box.
