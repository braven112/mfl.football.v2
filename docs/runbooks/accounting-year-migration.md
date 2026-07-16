# Runbook: League Accounting year migration + Venmo/PayPal reconciliation

Runs in **Cowork** (Claude desktop) using its browser with your already-logged-in
MFL, Venmo, PayPal, and Gmail sessions. This is a Cowork job — not a repo
script — because MFL has **no write API for League Accounting**: the ledger is
readable via `export?TYPE=accounting` (member auth required), but entries can
only be added through the commissioner UI (League Setup → League Accounting).

**When to run:** each new league year, after the new MFL league exists
(TheLeague rolls Feb 14; AFL rolls June 1 — see `src/config/leagues-data.mjs`).

**League facts** (from the registry; shown here for TheLeague 2025 → 2026):

| Fact | Value |
|------|-------|
| League ID | 13522 |
| MFL host | www49.myfantasyleague.com |
| Old-year ledger (read) | `https://www49.myfantasyleague.com/2025/export?TYPE=accounting&L=13522&JSON=1` |
| New-year ledger (read) | `https://www49.myfantasyleague.com/2026/export?TYPE=accounting&L=13522&JSON=1` |
| Franchise names/owners | `https://www49.myfantasyleague.com/2026/export?TYPE=league&L=13522&JSON=1` |

Known MFL gotcha (same as tradeBait — see `docs/claude/insights/domains/mfl-api.md`):
an auth-gated export fetched without a valid session returns **HTTP 200 with an
empty body**, not an error. If the export looks empty but the League Accounting
page shows entries, the browser session isn't logged in — log in and retry.

---

## Paste-ready Cowork prompt

```text
Migrate my MFL League Accounting balances from the 2025 league year to 2026,
reconciling against my Venmo/PayPal payments first. League ID 13522, host
www49.myfantasyleague.com. I am the commissioner and already logged in.

PHASE 1 — Read the old ledger
1. Open https://www49.myfantasyleague.com/2025/export?TYPE=accounting&L=13522&JSON=1
   If it comes back empty, I'm not logged in on this browser — tell me instead
   of concluding the ledger is empty. Cross-check by opening the 2025 League
   Accounting page in the MFL UI.
2. Open https://www49.myfantasyleague.com/2025/export?TYPE=league&L=13522&JSON=1
   to map franchise IDs to team/owner names.
3. Compute each franchise's net balance from the ledger entries. Before
   trusting the sign convention, verify 2-3 franchises against what the 2025
   League Accounting page displays. Show me a table: franchise, owner,
   number of entries, net balance.

PHASE 2 — Reconcile Venmo/PayPal before carrying anything over
4. Pull my incoming payments for the 2025 league year:
   - Venmo: statement/transaction history (CSV download if available,
     otherwise read the feed).
   - PayPal: Activity page for the same date range.
   - If either is awkward in the browser, search my Gmail for Venmo
     "paid you" and PayPal "You've got money" receipts in that range.
5. Match each payment to a franchise owner by name and payment note. Show me
   the matches and ASK about any ambiguous ones — do not guess.
6. List payments that are NOT reflected in the 2025 ledger, and ask me
   whether to add them as 2025 entries before computing final balances.

PHASE 3 — Write carryover entries into 2026
7. Open https://www49.myfantasyleague.com/2026/export?TYPE=accounting&L=13522&JSON=1
   and skip any franchise that already has a "Carryover balance from 2025"
   entry (so this whole run is safe to repeat).
8. Show me the final plan — franchise, owner, carryover amount — and WAIT
   for my explicit OK. Skip franchises with a $0 balance.
9. In the 2026 league, go to the commissioner League Setup → League
   Accounting page. Add ONE entry per franchise: the net balance as the
   amount, description "Carryover balance from 2025". Submit the FIRST entry
   alone, confirm it displays with the correct sign and franchise, then do
   the rest. If the entry form has fields you're unsure about (entry type,
   category, date), stop and ask me.

PHASE 4 — Verify
10. Re-open the 2026 accounting export. Confirm exactly one carryover entry
    per planned franchise with matching amounts. Show me a final table and
    call out any discrepancy.

Guardrails: never submit a form without showing me the plan first; one entry
per franchise; nothing for $0 balances; keep a running log of every entry you
submitted so we can back them out by hand if needed.
```

---

## Ongoing dues reconciliation (during the season)

Repeatable Cowork prompt once the carryover is done:

```text
Check my Venmo, PayPal, and Gmail receipts for league-dues payments received
since <last check date>. Match each to a TheLeague franchise owner (ask about
ambiguous names). For confirmed payments not yet in the ledger, show me the
list, then add a payment entry for each to the 2026 League Accounting page
(league 13522 on www49.myfantasyleague.com). Verify afterwards via
https://www49.myfantasyleague.com/2026/export?TYPE=accounting&L=13522&JSON=1
```

Matching is much more reliable with a standing owner ↔ payment-handle map.
Fill this in once and Cowork can reuse it every time:

| Franchise | Owner | Venmo handle | PayPal email |
|-----------|-------|--------------|--------------|
| 0001 | _fill in_ | _fill in_ | _fill in_ |
| …    |          |              |              |

## Why the payment side is browser-only

- **Venmo** has no public API for personal transaction history — browser
  feed, monthly statement CSVs, or email receipts are the only options.
- **PayPal**'s Transaction Search API requires a business account and app
  approval; for a personal account it's the Activity page/CSV or receipts.
- **Gmail receipts** are the lowest-friction source (both services email
  every payment) and work in Cowork via the Gmail connector.

## If this ever moves onto the site

A read-only "dues status" page is feasible today: fetch
`export?TYPE=accounting` server-side with the viewer's MFL cookie (same
pattern as `src/utils/mfl-trade-bait-cache.ts` — never cache an
unauthenticated empty response). Writes would still be manual/Cowork unless
we reverse-engineer the commissioner accounting form POST.
