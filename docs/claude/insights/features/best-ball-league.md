# Best Ball League #1 (third league) — launch insights

Context: adding `best-ball-1` (MFL 37610), the site's first draft-only
best-ball league and the template for sister leagues. The registry/nav/ADP
rules live in CLAUDE.md ("Best-ball leagues" section) — this file records
the learnings that AREN'T obvious from the code or CLAUDE.md.

## Adding league N: grep for `isAFL ?` — the registry is not the whole story

The league registry handles routing/hosts/features automatically, but a
handful of shared components still enumerate leagues with binary ternaries
that silently dump a new league into TheLeague's branch (wrong branding,
wrong links — the bug is invisible until you LOOK at a rendered page):

- `src/components/theleague/Header.astro` — logo, wordmark, and desktop nav
  icons all branch per league.
- `src/components/theleague/Footer.astro` — champion banner + four link
  columns; bb1 pages shipped TheLeague's footer until a What's New
  screenshot exposed it. **Screenshot-review every new league's page chrome;
  route smoke tests (200s) don't catch wrong-league branding.**
- `src/components/theleague/RosterLoader.astro`, `src/pages/api/auth/login.ts`
  (preference-cookie arm), `src/utils/team-preferences.ts`,
  `src/utils/league-context.ts` (cross-league switcher pairs).

The layout's slug→navSlug mapping is now registry-driven
(`getLeagueBySlug(slug)?.navSlug`) — don't reintroduce ternaries there.

## PartyKit mock engine is a zero-change multi-tenant draft engine

Official best-ball drafts and bb1 mocks required NO party-server changes:
the whole contract is (a) room id prefixed `mock-`, (b) a session object
POSTed at creation, (c) ranked lists keyed by `MockRankingSource`. Sessions
register in `{leagueId}-registry`, so league scoping falls out for free —
the lobby just filters `-official-` ids out of the practice list. New
ranking sources are additive: the server reads whatever keys the create
route stored (its only hardcoded fallback is `'mfl-rookie'` when no default
was sent).

## Rankings-import localStorage is deliberately league-agnostic

`rankings.*` keys (and the composite config) are NOT league-scoped, while
draft queues ARE (`leagueId+year`). Consequence: one imported board feeds
every league's queue/My-Rank source — which is why
`ImportRankingsPage.astro` could be extracted to `components/shared/` with
zero per-league logic. Don't "fix" the storage keying without realizing
cross-league sharing is a feature.

## The literal guard reads error messages too

`tests/league-literal-guard.test.ts` flagged `www45.myfantasyleague` inside
a *human-readable error string* in the export script (an example host in
help text). That's by design — write examples as `wwwXX.myfantasyleague.com`
so they never match a protected literal.
