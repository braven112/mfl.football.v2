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
READ   export?TYPE=accounting&L=<id>&JSON=1   no cookie needed in practice
WRITE  import?TYPE=accounting&L=<id>          the COMMISSIONER's cookie
```

### The response shape — verified, not guessed

MFL returns a **flat `entry` list, every field a string**:

```json
{"version":"1.0","accounting":{"entry":[
  {"id":"59799186","franchise_id":"0015","amount":"825",
   "description":"AFL Champion, NL Champion, ...","timestamp":"1767219728"}]}}
```

This is worth stating loudly because the normalizer was originally written
against three shapes *guessed from MFL's prose docs* — `franchise` with nested
`transaction`, a flat `transaction` list, a summary-only form. **MFL returns
none of them.** All three parsed the real payload to an empty ledger: a league
with 26 transactions reporting zero, no error anywhere, every owner shown
square. `tests/mfl-accounting.test.ts` pins the real payload — don't delete
that test, and don't add a shape you haven't seen a response for.

Four traps, each already handled and each easy to undo:

1. **Commissioner imports are rejected on `api.myfantasyleague.com`.** They
   must go to the league's own web host — `www49` for TheLeague, `www44` for
   the AFL, both from the registry. Reads may use the api gateway.
2. **The read is NOT owner-gated, whatever the docs say.** Verified Aug 2026
   against 19621 and 13522: an unauthenticated request returns the full
   ledger. The api host answers with a **302** to the league host, so a client
   that doesn't follow redirects sees an empty body and looks exactly like a
   permission failure — which is what made it look gated. `mflFetch` follows
   the redirect and carries the Cookie across it.
3. **An empty body is a FAILED READ, not an empty ledger.** Not an auth
   failure (see above) — a throttle, a maintenance page, a redirect that went
   nowhere. Reporting it as "no records" renders a page saying every owner is
   square, which is the one wrong answer that looks completely normal.
4. **`response.ok` is not "the write landed".** MFL reports a rejected import
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
always: `StandingsTable.astro` hardcoded `TIER_PRIZES` until Aug 2026, so the
badge an owner read and the dollars the commissioner wrote were two
independent constants free to disagree. That component now derives from the
registry. **Do not reintroduce a prize amount anywhere else** — put it in the
registry and read it.

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

### Carry-over is the LAST step of the yearly league upgrade

MFL's yearly league upgrade creates next year's league with rosters, keepers
and picks carried — and **empty books**. So the order is fixed, and the
carry-over goes last:

1. MFL creates the new league year (Feb 14 TheLeague, June 1 AFL).
2. Last season's prizes are paid **into the season's own ledger**, before it is
   closed out. `Season payouts` does this.
3. Any remaining settlement in the old year — winnings sent, fees, corrections.
4. **Carry-over.** `Year rollover` moves every closing balance into the new
   league year.

Last because it carries a *closing* balance: anything written to the old year
after the carry has to be carried again by hand, and a second run will not do
it (the description already matches, so the line comes back `already-migrated`
at the old amount and the difference is simply lost). Settle the old year, then
carry it.

From step 4 on, **the newest league year is the only ledger anyone should
touch.** The accounting page enforces that by always defaulting to the current
league year — `leagueYearFor(league)`, which honours each league's own rollover
date rather than a shared Feb 14.

The **Yearly upgrade** tab renders these four steps as a checklist, and step 4
— the carry — is the plan on that same tab.

### Three of the four steps have a signal. One does not.

| Step | How it is known |
|---|---|
| New league year exists | Its ledger reads. |
| Prizes paid into the old year | `planPayouts(season N-1)` against the **N-1** ledger has nothing payable. |
| Old year settled | **No signal exists.** |
| Balances carried | The migration plan has nothing carryable. |

Step 2 is checked against the OLD year's own ledger, not the current one:
that is where a season's prizes belong, and paying them after the carry
strands them in a year nobody looks at.

Step 3 has no MFL flag for "I have finished sending everyone their winnings",
and **inventing one would be worse than admitting it.** So the checklist shows
the same quiescence proxy the unattended job uses, labelled as a proxy, and
**never renders that step as done**. A checklist that ticks a box it cannot
verify is how a commissioner ends up trusting it past the point it earns.

### Automation: `accounting-carry-over.yml`

The carry also runs unattended, weekly. It is real money written with nobody
watching and MFL's import has no delete, so `assessCarryReadiness` (in the pure
planner, tested in isolation) treats *don't know* as *don't write* and refuses
the **whole league** rather than carrying the part it is sure about — a partial
carry that silently drops one franchise is worse than one that never ran. It
refuses when the source has no records, any line conflicts, a balance has no
franchise to land on, the two nets disagree, or the old year is not yet quiet.

**A human driving the page is deliberately NOT held to those gates** — they can
see the warnings and decide. The API returns `readiness` for display only; it
never blocks a commissioner's carry.

`SETTLED_AFTER_DAYS` (14) lives in `scripts/accounting-carry-over.ts` and is
mirrored as `SETTLE_WINDOW_DAYS` in the migrate route, which does not share the
script's module. **The two must agree** — change one, change the other.

### The gap between the upgrade and the carry-over announces itself

Between steps 1 and 4 the league's real balances live in a year nobody is
looking at any more, and **nothing about the new year's ledger looks wrong** —
it looks like a league that owes nothing. That is the failure this feature has
to survive, because it is invisible by construction.

So the console checks on load whether the previous year still has balances to
carry, and if it does, says so in a banner above the tabs — visible from every
tab, not just the one that fixes it. It reuses the `migrate` planner rather
than re-deriving, so the banner and the rollover tab can never disagree.

The check is a **nudge, not a gate**: it fails silent. A league year with no
prior books answers 409, which is a legitimate "nothing to carry" and not an
error worth putting in front of a commissioner.

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

**Reads are verifiable from anywhere** — no cookie required (see above), so
the real export can be fetched and diffed against the normalizer at any time.
That is how the `entry`-shape bug was caught, and it is the first thing to do
when the ledger looks wrong:

```bash
curl -sL "https://api.myfantasyleague.com/2025/export?TYPE=accounting&L=19621&JSON=1"
```

`-L` is not optional — without it the api host's 302 leaves you with an empty
body and a wrong conclusion.

**Writes are not.** Every write needs a real commissioner cookie
(`MFL_USER_ID` + `MFL_IS_COMMISH`), which only exists in a signed-in
commissioner's session. They cannot be exercised from a container with no
`.env.local`, so they are covered by mocked response shapes and must be
verified from the app by a signed-in commissioner. Start with one small
transaction: MFL's import has no delete, so a bad record is corrected with an
offsetting one by hand.
