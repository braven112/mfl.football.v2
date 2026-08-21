# Best-ball leagues (draft-only)

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Best-ball leagues (draft-only) — opt-in nav, official draft, export-when-done

`best-ball-1` (MFL 37610) is the template for a family of draft-only best-ball
leagues. Rules that keep them cheap to add and impossible to break:

- **Registry flag:** `bestBall: true` marks a league as draft-only. Any UI
  offering lineups/add-drops/trades must be skipped for these leagues.
- **Nav is OPT-IN:** for best-ball navSlugs, only links tagged
  `leagueOnly: <navSlug>` render (`linkMatchesLeague` in nav-utils) — the
  untagged default link set is management UI they don't have. Adding a page
  to a best-ball league = page file + tagged nav link.
- **Official draft = promoted mock engine.** One deterministic PartyKit
  session per league-year (`mock-{navSlug}-official-{year}`), created
  commissioner-only via `/api/best-ball-draft/create` with `official: true`,
  full veteran player pool, 25 rounds, human pick clocks. Zero party-server
  changes — don't fork `party/draft-room.ts` for it.
- **Redraft ADP, not dynasty.** Best-ball leagues re-form every season, so
  every ADP surface (player-pool sort/badges via `adpSource: 'redraft'`,
  auto-pick lists via the `mfl-redraft` ranking source) uses
  `adp-redraft.json`. Dynasty ADP is only a fallback source — it overrates
  youth for a one-season roster.
- **No live MFL syncing by design.** The draft runs entirely on-site; after
  completion `pnpm export:bb-draft --commit` snapshots the results to
  `data/best-ball-1/draft/` and imports them to MFL through the
  `mfl-api.mjs` commissioner-write plumbing. The export refuses sessions
  without the `official` flag.
- **MFL host:** best-ball-1 lives on `www45.myfantasyleague.com`. If a
  future best-ball league's host isn't known yet, `api.myfantasyleague.com`
  works as a reads-only placeholder — commissioner writes fail on the
  gateway (the export script errors loudly and honors `MFL_WRITE_HOST`).
- Sister leagues (#2, …) = new registry entry + copies of the five thin
  pages in `src/pages/best-ball-1/` + a `tokens.css` accent block + tagged
  nav links + guard-test literals.

