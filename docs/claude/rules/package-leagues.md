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

## League History — a box, and a History-only league

The **League History** box (`leagueHistory`, needs Franchise pages) gives a
package league the same shared History pages TheLeague and the AFL render:
`/history` (the Rafters), the Record Book, the History franchises tab, Ask the
History, `/rivalries` and `/owners`. Its `franchises/[id]` then renders the
History franchise page rather than the older shared one. Every route reads
its dataset through the league-data loader and 404s until the first sync has
built it.

A league is one of THREE products (Brandon, 2026-11-15), the registry's
`tier`: `'history'` (its past seasons only), `'ai'` (we write its articles, the
AI Beat Reporter plan, with History as the add-on) or `'full'` (a full site; an
entry with no `tier` is full). Best ball stays its own draft-only type
(`bestBall`), outside the tiers. Read it through `leagueTier()`, and ask
`isFullManagementLeague()` before offering or sending a league anything
season-time (MFL Live Pro and sign-in, lineup checks, trade pushes, the weekly
What's New): it is false for best ball AND for the History and AI tiers. A
bare `!bestBall` is how the first History league ended up in all of those
(`tests/full-management-league.test.ts`).

The **History-only** archetype (`history-only`) launches a league with the
History box and Franchise pages ticked and writes `tier: 'history'` into its
registry entry. `packageRoutesFor(features, league)` then drops every "every
league" route except `index`, `login` and `forbidden`, and the homepage
REDIRECTS to `/<slug>/history`, the address the tier is sold at (Brandon,
2026-11-14). Upgrading to a full site is changing the tier: the homepage takes
the bare `/<slug>` back and History stays where links already point. Pass the
league to `packageRoutesFor` (`kitPlan`, `syncNav`, `syncDirectory`,
`launch-check` all do): a call with features alone cannot see the tier and
plans the full site. `league-jobs.mjs` keeps a History or AI tier league on the
MFL sync and the history chain only (`fullSite`). The AI tier has no archetype
or pages of its own yet; its product is the Beat Reporter plan.

Launching one, end to end (Gridiron Gumbas, MFL 35892, Nov 2026):

1. `node scripts/new-league.mjs --spec <spec>` with `archetype: "history-only"`.
2. `node scripts/backfill-historical-feeds.mjs --league=<slug>`: every season
   MFL serves, each with its own year's league id and host, AND each season's
   playoff bracket GAMES (the `playoffBrackets` export is metadata only; a
   season without `brackets` has no champion).
3. `node scripts/recompute-derived-chain.mjs`, then
   `compute-league-history-players.mjs` / `-moves.mjs --league=<slug>` (Ask
   the History needs all three files).

**Private seasons.** MFL serves an archived season of a private league only to
its owners: without the commissioner's `MFL_APIKEY` those seasons come back
"API requires logged in user", and the history starts at the first public
season. Gumbas lost 2014-2019 that way. A season MFL lists but no game was
played in (Gumbas 2013, all-zero standings) is dropped from the dataset
(`buildHistoryDataset`); delete its feed directory too, or owner tenures still
date the owners from it.

## Owner Activity — every league, private by default

Every league gets `/activity` (no feature box: `PACKAGE_ROUTES['activity.astro']`
is `null`), and it is PRIVATE: the site's platform admins always see it, a
league's commissioner only after an admin ticks "Let the commissioner see this
report" on the page (a per-league Redis flag, off by default, read fail-closed),
owners never. The gate is `resolveOwnerActivityAccess`
(`src/utils/owner-activity-access.ts`) in each route; the page is
`components/shared/OwnerActivityPage.astro`. Because owners cannot open it, it
is not a Schefter article destination and its search entries are `admin`.
`tests/owner-activity-access.test.ts` fails on a league without the route or a
route that renders the report without the gate.

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
