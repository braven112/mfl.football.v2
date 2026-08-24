# League accounting

Commissioner-facing money: MFL's league ledger, CSV import/export, and the
season payout run.

**Read this before touching anything under `src/pages/api/accounting/`,
`src/utils/mfl-accounting.ts`, `src/utils/accounting-*`, or a league's
`payouts` table.** Every rule here is a way to move real money incorrectly.

| | |
|---|---|
| Admin pages | `/theleague/admin/accounting`, `/afl-fantasy/admin/accounting` |
| API | `src/pages/api/accounting/{records,import,payouts,migrate}.ts` |
| MFL client | `src/utils/mfl-accounting.ts` |
| CSV | `src/utils/accounting-csv.ts` |
| Planner (pure) | `src/utils/accounting-payouts.mjs` |
| Rollover planner (pure) | `src/utils/accounting-migration.mjs` |
| Season data | `src/utils/accounting-season-data.ts` |
| Gate | `src/utils/accounting-request.ts` |
| Prize tables | `payouts` in `src/config/leagues-data.mjs` |
| Tests | `tests/mfl-accounting.test.ts`, `tests/accounting-csv.test.ts`, `tests/accounting-payouts.test.ts`, `tests/accounting-migration.test.ts`, `tests/accounting-access.test.ts` |

## The sign convention: positive CREDITS the franchise

MFL's export and import docs agree, and the direction is the opposite of
"amount owed" intuition:

- **Positive** — credits the franchise. A prize, a payout, money they paid in.
- **Negative** — charges the franchise. Dues, fees, a fine.

**A prize is a POSITIVE amount.** Writing a payout negative doubles the
owner's bill instead of paying them, and MFL returns nothing that
distinguishes the two — no error, no warning, just a wrong ledger.

Go through `creditAmount()` / `chargeAmount()` rather than writing the sign by
hand. Never infer the sign from the description ("dues" → negative): that kind
of helpfulness eventually pays a prize backwards.

## MFL's two endpoints do not have the same access model

```
READ   export?TYPE=accounting&L=<id>&JSON=1   any league OWNER's cookie
WRITE  import?TYPE=accounting&L=<id>          the COMMISSIONER's cookie
```

Three traps, each already handled and each easy to undo:

1. **Commissioner imports are rejected on `api.myfantasyleague.com`.** They
   must go to the league's own web host — `www49` for TheLeague, `www44` for
   the AFL, both from the registry. Reads may use the api gateway.
2. **An empty 200 body is an AUTH FAILURE, not an empty ledger.** MFL answers
   an unauthorized accounting request with HTTP 200 and nothing in the body
   (verified against league 13522). Reporting that as "no records" renders a
   page saying every owner is square.
3. **`response.ok` is not "the write landed".** MFL reports a rejected import
   at HTTP 200 with an `<error>` element. The body decides.

**The import takes ONE record per call.** There is no batch form. Everything
bulk is a loop, a loop can fail halfway, and a partial batch is a normal
outcome — not an error state. Bulk callers must report PER-ROW results so a
re-run can carry only the failures. Never collapse a batch to one ok/failed.

**There is no delete and no upsert.** A wrong record is corrected with an
offsetting record, by hand, in MFL. That asymmetry is why every guard below
exists.

## A re-run must never pay the season twice

Each planned payout carries a deterministic description — `2025 League
Champion` — and that string is the idempotency handle. The planner checks it
against the LIVE ledger first:

- **already-paid** — franchise + description + amount all match. Not rewritten.
- **conflict** — description matches but the amount does not. Never payable;
  the whole run stops. That is a hand-edited ledger or a changed prize table,
  and both need a human.
- **payable** — not in the ledger.

The idempotency key is **(franchiseId, description)**, not description alone.
Two conferences each have a seed 3, so two franchises legitimately share the
description `2025 Wild Card (seed 3)` and both must be paid. Keying on
description alone silently skips the second one — pinned by
`tests/accounting-payouts.test.ts`.

**The ledger read is not optional.** A plan built against an unreadable ledger
cannot tell already-paid from payable, and its failure mode is "pay
everything". A ledger error fails the whole request rather than degrading to
an unchecked plan.

**The apply path recomputes the plan; it never accepts one from the client.**
A client-supplied plan is an arbitrary "pay this franchise this much" endpoint
wearing a payout costume.

## Winners are derived, never typed in

Nothing in a payout run is hand-entered. The planner reads what each league
already publishes:

| Source kind | Reads |
|---|---|
| `placement` | Placement brackets. Each final decides TWO places — winner takes the bracket's place, loser the one below. |
| `award` | The league's resolved award record (`data/afl-fantasy/awards-history.json`). |
| `playoff-seed` | `seed` on the FIRST round of each conference bracket. |
| `tier-rank` | The all-play tier table, rebuilt with the same helpers the standings page uses. |
| `weekly-high` | Weekly results, through the week the playoffs start. |

Four things that are load-bearing:

- **Seeds are only readable on the opening round.** Later rounds carry
  `winner_of_game` refs instead.
- **The Toilet Bowl and the NIT are title brackets by `isTitleBracket()`** —
  neither name contains "Nth place". Left unfiltered they claim 1st place
  overall. `CONSOLATION_NAME` in the planner is what stops that.
- **A 0-0 final is unplayed, not a tie.** Both are "no winner", but only one
  of them stays that way.
- **Weekly-high ties SPLIT.** Both constitutions say so. A winner-takes-all
  tiebreak quietly underpays an owner every time two teams tie.

**A prize that cannot be derived is reported, never skipped.** A run that
silently omits the NIT looks exactly like one where nobody won it.

**The planner is pure** — no fetch, no fs, no clock, no registry lookups.
That is what lets the route, a test and a future CLI produce the same plan,
and why "why did it pay that" is answerable by replaying inputs.

## Prize tables live in the registry, once

`payouts` in `src/config/leagues-data.mjs` is the only prize table. It was not
always — there were THREE copies, and finding the first one did not find the
others:

| Copy | Held | Removed |
|---|---|---|
| `TIER_PRIZES` in `StandingsTable.astro` | AFL tier ranks | Aug 2026 |
| `placementPayouts` + `WEEKLY_HIGH_PAYOUT` in `theleague/playoffs.astro` | TheLeague's whole table | Aug 2026 |
| `aflPayouts` in `afl-fantasy/playoffs.astro` | all 11 AFL amounts | Aug 2026 |

Each one fed a live prize display, so the dollars an owner read and the
dollars the commissioner wrote were independent constants free to disagree.
**Do not reintroduce a prize amount anywhere else** — put it in the registry
and read it.

Display surfaces go through `src/utils/prize-display.ts`, which returns the
registry ROW (label included) rather than a bare number, so a caller cannot
re-type a label either. `tests/prize-display.test.ts` scans every prize
surface for a `$<amount>` literal matching any registry amount and fails on a
new copy — that scan is what would have caught the two playoff tables.

### A display surface must resolve a winner the same way the planner does

Reading the registry is necessary but not sufficient: the AFL playoffs page
derived its division titles by iterating `divisionWinners`, which pays one per
division. That is right for today's four-division layout and WRONG for the
2003-2012 six-division seasons, where it paid six titles ($900) against the
four the planner pays ($600). Display now keys off `conferenceSeed` through
`getSeedPrize()`, the same seeds-1-2 / seeds-3-4 rule `resolvePlayoffSeeds`
applies. If a page and the planner can disagree about WHO won, sharing the
amount was never the whole fix.

`prizePool` is the constitution's stated total. It is **display-and-reconcile
only**: the planner never scales or caps a prize to fit it, and the page shows
the drift so a human decides. Silently correcting a total is how a real prize
disappears.

### The AFL pays FOUR division titles, not six

The AFL has six divisions but each conference sends only four playoff teams —
its two best division winners (seeds 1-2) plus two wild cards (seeds 3-4). A
third division winner who misses the playoffs is **not paid**.

That is why both prizes key off playoff seed rather than a division-title
award slug. Paying all six division slugs totals $2,525 against a stated
$2,220 pool; paying the four seeds totals $2,225, which is the pool within the
same rounding TheLeague's "approximately $712" carries. Confirmed with the
commissioner, Aug 2026 — **do not "fix" this back to six division awards.**

TheLeague's table reconciles exactly: the derived 2025 plan totals $712.

## Year rollover: MFL's new league starts with EMPTY books

MFL creates a brand-new league every year — Feb 14 for TheLeague, June 1 for
the AFL — and **the new league's accounting ledger starts completely empty.**
Nothing carries over on MFL's side. Without a deliberate migration, the
league's books reset to zero every February and every outstanding debt and
credit silently disappears.

`/api/accounting/migrate` plans and applies the carry-forward; the console's
**Year rollover** tab drives it.

### The sign is preserved, never flipped

A franchise at **-100** at the close of 2025 (they owe $100) opens 2026 at
**-100**. A franchise at **+300** opens at **+300**. The carried amount IS the
closing balance, unchanged.

This is the most destructive thing to get wrong in the whole feature. Flipping
it converts every debt in the league into a credit and every credit into a
debt, in one pass, with no error from MFL — and the resulting ledger looks
entirely plausible. Pinned by `tests/accounting-migration.test.ts`.

The plan reports **source net vs carried net**. Those two agreeing is the
check that nothing was invented, lost, or flipped; the UI calls out a
mismatch rather than leaving it to be spotted in the numbers.

### An empty source ledger is an ERROR, not an empty result

The quiet failure: a degraded read of last year's ledger yields no balances,
the plan has nothing to carry, and the page says "nothing to migrate" — which
is exactly what a genuinely settled league looks like. The commissioner ticks
it off and the books are lost.

So a source ledger with **no records at all** refuses to plan and returns 409.
A year that really did end empty has nothing to carry anyway, so refusing
costs nothing and catches the case that destroys the books.

The TARGET ledger read is equally non-optional: without it, already-carried
cannot be told from carryable, and the failure mode of guessing is carrying
everything twice.

### Balances follow the franchise, not the owner

Both constitutions say a replacement owner takes the team over as-is,
financial obligations included. So a straight franchise-id carry is the rule,
not an approximation — if 0009 changed hands over the winter, 0009's debt is
still 0009's debt. **No owner-history lookup belongs in the migration.**

A balance whose franchise no longer exists in the target year cannot be
carried and is reported as a warning, never dropped. That is real money
someone has to reassign by hand.

### Other guards

- **Idempotency** is keyed on (franchiseId, description), with the description
  year-stamped: `Balance carried forward from 2025`. Every franchise's carry
  record shares that description by design, so keying on description alone
  would carry exactly one franchise and skip the rest.
- **A conflict stops the whole run** — a carry record already present at a
  different amount means the source moved after a partial run, or someone
  edited by hand. The correct balance is then ambiguous.
- **Same-year and backwards migrations are refused.** Carrying a year into
  itself doubles the whole league in place; backwards is a typo or an attempt
  to rewrite closed books.
- **Zero balances are skipped**, and reported as skipped — a franchise missing
  from the plan entirely reads as an oversight.
- **A partial carry is safe to re-run**: rows that landed come back
  already-migrated on the next plan.

## Two clocks, and they are not interchangeable

This feature straddles both of the repo's year clocks (see CLAUDE.md):

- **`year`** — the MFL LEAGUE year, i.e. which ledger is being written.
  Roster-management-shaped: `getCurrentLeagueYear()`, or the league's own
  rollover date.
- **`season`** — the season being paid, whose results decide winners.
  Results-shaped: `getCurrentSeasonYear()`.

They differ for most of the calendar. Settling the 2025 season in March 2026
writes SEASON 2025's payouts into the 2026 LEAGUE's ledger. Collapsing them
into one parameter pays the wrong season's winners out of the wrong year's
books.

## The gate

Every route goes through `resolveAccountingContext()`:

- Authenticated, and **commissioner/admin only** — these routes expose and
  edit the whole league's books, so owner-level access is never enough.
- The `?league=` slug is a **check against the session, never an input**. A
  commissioner of one league must not reach another's money. Same rule as the
  rankings scope.
- The league must have `features.accounting`. best-ball-1 does not: it is
  draft-only with no MFL syncing, and enabling it would be that league's first
  MFL write.
- MFL cookies come from the session cookies our own login set — never from
  anything the client supplies.

The pages repeat the gate in their own frontmatter. A page gate protects the
page, not the endpoints behind it, and **`Astro.redirect()` returned from a
COMPONENT does not redirect** — it stops that component rendering and serves a
blank 200. That is why the gate lives in each thin route wrapper and not in
`AccountingConsole.astro`.

## Testing without MFL credentials

The authenticated read and every write need a real commissioner cookie, so
they cannot be exercised from a container with no `.env.local`. The suites
cover the parts that don't need one — sign convention, MFL's response shapes
(including the empty-200 and `<error>`-at-200 cases, mocked), CSV round trips,
payout derivation against committed 2025 feeds, and the gate. The live MFL
round trip is verified on a preview deploy by a signed-in commissioner.
