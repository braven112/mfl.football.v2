# Transactions Page — plan

**Status:** planning (nothing built yet)
**Routes:** `/theleague/transactions`, `/afl-fantasy/transactions`
**Branch:** `claude/transactions-page-planning-p2olrs`

MFL has a transactions page; it is unreadable and league-scoped to MFL's own
chrome. This is our version: a dense, filterable ledger of **signings** —
who picked up whom, what it cost, and who got dropped to make room. Primarily
an in-season tool (the AFL ran 215 free-agent moves in 2026 alone), but built
against the full committed archive so it works year-round.

## Decisions taken (Sept 2026)

| Question | Answer |
|---|---|
| Leagues | **Both**, one shared component + a thin route per league |
| History | **Current season by default**, year picker for past seasons |
| Default rows | **Signings**: free agents, waivers (both flavours), auction wins |
| Excluded outright | **IR and practice-squad (TAXI) moves** — not signings, high volume, low interest |
| Behind a filter | **Trades** (off by default) |
| Filters | Team, player search, week / date range, "just my team" |
| Row detail | Headshot + franchise logo, position + NFL team, salary / bid amount |
| Layout | Dense table, grouped by day |

Deliberately NOT included: a link from each row to the Schefter post covering
it. Matching a feed post back to its source transaction is real work and the
Schefter feed is one click away in nav; revisit if owners ask.

## The data, and why it needs a normalizer

`data/<league>/mfl-feeds/<year>/transactions.json` is committed for every
season — TheLeague back to 2007, the AFL back to 2003 — and `roster-sync.yml`
refreshes the current year **every 5 minutes**. No new fetch, no new cron.

What's in there is not uniform. 2026 volumes:

| MFL type | TheLeague | AFL | Payload shape |
|---|---|---|---|
| `AUCTION_BID` | 555 | – | `"playerId\|amount\|"` |
| `AUCTION_INIT` | 107 | – | `"playerId\|amount\|"` (a nomination) |
| `AUCTION_WON` | 106 | – | `"playerId\|amount\|"` |
| `TAXI` | 36 | – | `activated` / `deactivated` fields |
| `FREE_AGENT` | 32 | 215 | `"added,\|dropped,"` — **comma-terminated, either side may be empty** |
| `IR` | 9 | 11 | `activated` / `deactivated` fields |
| `BBID_WAIVER` | 4 | – | `"added,\|bid\|dropped,"` |
| `WAIVER` | – | 8 | separate `added` / `dropped` **fields**, not a string |
| `TRADE` | 1 | 0 | `franchise1_gave_up` / `franchise2_gave_up`, includes picks |
| system | `LOCK_ALL_PLAYERS`, `AUTO_PROCESS_WAIVERS`, `BBID_AUTO_PROCESS_WAIVERS`, `LOAD_ROSTERS` | | `franchise` is `""` |

Five traps worth writing down before anyone starts:

1. **The two leagues encode the same concept differently.** TheLeague's blind
   bids are `BBID_WAIVER` with a pipe-delimited string; the AFL's rolling-
   priority claims are `WAIVER` with discrete `added`/`dropped` fields. Any
   code that reads one and assumes the other renders a blank row for half the
   site. This is the single strongest argument for a normalizer module rather
   than parsing inline in the component.

2. **A row is not a player.** One `FREE_AGENT` row can drop seven players:
   `"|16342,14823,13299,13595,7836,10413,16757,"` (a cutdown-day batch). The
   table must render one row per *transaction* with a list of player chips, not
   assume `added`/`dropped` are scalars.

3. **The comma is not consistent across types.** `FREE_AGENT` and the waiver
   types terminate every id with a comma (`"17048,|"`); the auction types do
   not (`"12140|425000|"`). Split, then filter empties — never index by
   position.

4. **System rows carry an empty `franchise`.** They must be dropped before the
   ledger is grouped by team, or the UI grows a nameless franchise. The
   exclusion list already exists as prose in `src/utils/mfl-activity.ts`
   (`OWNER_ACTION_TX_TYPES`) — reuse that set's reasoning, don't re-derive it.

5. **`by_commish: "1"` means the commissioner acted for the owner.** Rare (1
   row in 2026, but 2025 has more) and worth a small badge rather than being
   silently attributed to the owner.

Parsing logic for trades and draft picks already exists — `parseTradeAssets`,
`parseDraftPick`, `parseAuctionTransaction` in `scripts/schefter-scan.mjs` —
but it is **script-local**. Extract it to a shared module rather than copying
it; the page and the Schefter scanner should not drift on what
`FP_0005_2026_3` means.

## Architecture

Follow `src/pages/theleague/division-strength.astro` exactly — it is the
canonical thin wrapper and the shape `tests/page-fork-ratchet.test.ts`
measures.

```
src/utils/mfl-transactions.ts          normalizer: raw feed rows -> TransactionRow[]
src/utils/mfl-transaction-assets.ts    shared trade-asset + draft-pick parsing
                                       (extracted from schefter-scan.mjs;
                                        schefter-scan.mjs imports it too)
src/utils/transactions-feeds.ts        lazy-glob season loader + year list
src/utils/transactions-view.ts         filter/sort/group -> what the page renders
src/components/shared/transactions/TransactionsPage.astro
src/components/shared/transactions/TransactionRow.astro
src/pages/theleague/transactions.astro       thin wrapper: glob + league config
src/pages/afl-fantasy/transactions.astro     thin wrapper: glob + league config
```

**The year picker is a lazy `import.meta.glob`.** A static import specifier
can't be a runtime variable, so the route globs its own league's feeds and the
shared loader picks the season. `src/utils/draft-results-feeds.ts` already does
exactly this and documents why lazy matters: the glob's *keys* answer "which
seasons exist" for free at build time, while only the viewed season is read.
TheLeague's 20 seasons of transactions are ~2.6 MB — eager-globbing puts all of
it in the serverless chunk to render one week.

**SSR (`prerender = false`), reading the committed JSON.** The 5-minute sync
plus the deploy it triggers makes committed data fresh enough, and it costs
zero MFL calls per pageview. A live fetch path exists (`live-auctions.ts` hits
`TYPE=transactions` at request time) if in-season staleness ever bites, but
don't start there.

**No auth gate on the route.** Standings and players are ungated and this is
the same class of page. `getAuthUser(Astro.request)` is still read, but only to
resolve the "just my team" filter and to default it off for logged-out
visitors.

## The normalized row

```ts
interface TransactionRow {
  id: string;              // stable: `${type}-${timestamp}-${franchise}`
  at: number;              // epoch ms (MFL gives epoch SECONDS in a string)
  week: number | null;     // getCurrentNFLWeek(new Date(at), year) — takes an
                           // arbitrary date, which is exactly what we need
  kind: 'free-agent' | 'waiver' | 'blind-bid' | 'auction' | 'trade';
  franchiseId: string;
  franchiseId2?: string;   // trades only
  added: PlayerRef[];      // may be empty (a pure drop)
  dropped: PlayerRef[];    // may be several
  picks?: PickRef[];       // trades only
  amount: number | null;   // bid / winning bid, raw dollars
  byCommish: boolean;
}
```

`PlayerRef` is resolved through `getPlayerMap(year, leagueSlug)`
(`src/utils/player-map.ts`) which already returns name, position, NFL team and
headshot from the committed `players.json`. Render with the existing
`PlayerCell` / `buildPlayerCellHTML` so the headshot fallback chain, the NFL
logo and the dark-mode avatar rings come for free rather than being
re-implemented. Franchise crest and accent come from
`src/utils/league-team-brands.ts` (`TeamBrand`), which already covers both
leagues.

### Salary / bid column — be honest about what we know

| Move | Cost source | Confidence |
|---|---|---|
| `BBID_WAIVER` | bid is in the transaction string | exact |
| `AUCTION_WON` | winning bid in the string; cross-checkable against `auctionResults.json` | exact |
| `FREE_AGENT` (FCFS) | **not in the feed** — fall back to the player's current roster salary, and only when they're still rostered by that franchise | partial |
| AFL, any type | no salary cap in the league | column hidden |

The column renders only for leagues with the `salaryCap` feature
(`leagueHasFeature(slug, 'salaryCap')`), and an unknown FCFS cost shows as `—`,
never as `$0`. Do not invent a number here.

## Filters

All four are URL params so a filtered view is linkable, and all are applied
server-side in `transactions-view.ts` so the first paint is already correct.

- **`?team=0007`** — one franchise. In the AFL this doubles as the conference
  filter, since franchise ids map to AL/NL.
- **`?q=`** — player name search over the season's rows. **AFL caveat:** the
  same NFL player is routinely rostered in both conferences, so a name search
  legitimately returns two franchises' moves. That's correct, not a bug — don't
  dedupe it away.
- **`?week=`** / **`?from=`&`?to=`** — `getCurrentNFLWeek(date, year)` in
  `src/utils/current-week.ts` already buckets an arbitrary date into an NFL
  week, so no new date math.
- **`?mine=1`** — the signed-in owner's franchise, via
  `franchiseIdForLeague(authUser, slug)`. Hidden when logged out.
- **`?types=`** — the type toggles. Default is the signings set
  (`free-agent,waiver,blind-bid,auction`); trades are opt-in. IR and TAXI are
  filtered out in the normalizer and are not toggleable at all.

Client-side interactivity must init on `astro:page-load`, not
`DOMContentLoaded` — `tests/clientrouter-init-ratchet.test.ts` enforces it, and
the day-grouped table with live filters is exactly the shape that goes inert
after a ClientRouter navigation.

## Layout

Day headers (`Sunday, September 7`) with compact rows beneath:

```
 9:41 AM   [crest] Rebels        + Jalen McMillan  WR TB      $425,000   BLIND BID
                                 − Tyler Boyd      WR NYJ
```

- Time in the viewer's chosen clock with the league's PT appended — read via
  `readViewerClock` (side-effect free, safe in a component). **Do not call
  `Astro.cookies.set()` from the shared component** — resolving a preference
  writes a cookie and throws `ResponseSentError` after headers commit. If the
  page needs to persist a choice, the route does it.
- Wide table scrolls inside its own `overflow-x: auto`; the page body must not
  scroll horizontally on mobile.
- A stacked card layout under ~640px rather than a squeezed table.

## Build phases

1. **Normalizer + tests.** `mfl-transactions.ts` against recorded fixtures from
   both leagues and at least two seasons. No UI. Use the `mfl-fixture-recorder`
   agent so the fixtures are sorted and provenance-stamped — MFL returns arrays
   in nondeterministic order and a hand-pasted fixture bakes that in.
2. **Extract the shared asset parser** from `scripts/schefter-scan.mjs` and
   point the scanner at it. Verify the Schefter feed output is byte-identical
   before and after.
3. **Feed loader + view model.** `transactions-feeds.ts`, `transactions-view.ts`,
   filters, year list. Still no UI.
4. **Shared component + both thin routes.** Table, day grouping, player cells,
   crests, salary column gated on the league feature.
5. **Filter UI**, `astro:page-load` wiring, mobile layout.
6. **Registration** (below) and a What's New entry.

## Registration checklist — none of this is optional

- [ ] `src/data/page-directory.json` — one entry per league (`id`,
      `title`, `description`, `path`, `icon`, `category: 'reports'`,
      `visibility: 'all'`, `popularity`, **10+ tags**). Nothing tells you to add
      this; without it the page is invisible to site search.
      `tests/page-directory-data.test.ts` enforces the tag minimum only once the
      entry exists.
- [ ] `src/config/footer-config.ts` — both leagues.
- [ ] `src/data/whats-new.json` — a `new-page` entry at the top, in the
      league's editorial voice, with a webp screenshot in
      `public/assets/whats-new/`. **Inline links in the prose written
      league-neutral** (`/transactions`, never `/theleague/transactions`) —
      `rewriteDescriptionLinks` prefixes per reader and a pre-prefixed href
      sends half the audience to the other league's site.
- [ ] **Ask Brandon whether it's hero-worthy** before setting
      `excludeFromHero`. Don't decide silently.
- [ ] `.claude/hooks/path-guard.json` — route the new files to a guard suite.

## Tests

- `tests/mfl-transactions-parse.test.ts` — the five traps above, one case each:
  AFL `WAIVER` fields vs TheLeague `BBID_WAIVER` string; a multi-drop
  `FREE_AGENT`; the auction types' missing trailing comma; system rows with an
  empty franchise excluded; `by_commish` surfaced.
- `tests/transactions-view.test.ts` — filters compose, `?mine=1` is inert when
  logged out, unknown year falls back rather than 500s.
- `tests/transactions-clientrouter.test.ts` — init on `astro:page-load`.
- Salary column absent for the AFL, present for TheLeague.
- Run the `sibling-drift-checker` agent before the PR: two routes land at once,
  and they must stay thin.

## Open questions

- **Auction bids.** `AUCTION_WON` is in the ledger; the 555 `AUCTION_BID` rows
  and 107 `AUCTION_INIT` nominations are not. If the bidding history is wanted,
  it belongs as an expandable detail on the winning row, not as ledger rows.
- **Mass drops.** A seven-player cutdown row is technically one transaction but
  reads as an event. Possibly collapse to "dropped 7 players" with a expander.
- **Dead money.** A drop in TheLeague generates a `salaryAdjustments` entry.
  Showing the cap hit next to the drop would make the page genuinely useful for
  cap planning, but it's a second join and a second source of wrongness.
  Deferred.
