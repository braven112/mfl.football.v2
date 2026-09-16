---
slug: clientrouter-stale-define-vars-window
status: open
severity: low
opened: 2026-09-15
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1111
hotfix_sha:
followup_issue:
followup_pr:
followup_session:
---

# Follow-up: a `define:vars` phase flag goes stale across a ClientRouter swap

Raised by the Codex reviewer on PR #1111 and **deliberately not fixed there**.
It is pre-existing, it is not what that PR was about, and the honest fix is
structural. Recorded so the deferral has an audit trail.

## The hazard

`src/pages/theleague/players.astro` ships a classic
`<script define:vars={{ …, isAuctionSeason, auctionEndMs, mflActionYear, … }}>`.
Those become `const`s **captured once, at the moment that HTML was rendered**.
The same script also does:

```js
document.addEventListener('astro:page-load', init);
```

`document` is one of the two nodes ClientRouter does not replace, so that
listener outlives the page it was registered on. If a session crosses the
auction window's edge — the third Sunday of August at 8:45 PM PT — and then
navigates within the site, a closure that captured `isAuctionSeason === true`
can run `init()` against markup the server rendered with `isAuctionSeason ===
false`. `startAuctionPolling()` restarts, `activeView === 'auction'` is allowed
again, and the row-render path is willing to emit live `O=43` Place Bid links
into a page whose server render deliberately omitted the Auction tab.

PR #1111 made the *server* the authority on the window. This is the one path
where the client can still disagree with it.

## Why it was not fixed in #1111

- **Pre-existing, and worse before.** The same stale closure already governed
  the Bid-vs-Add choice on the acquisition column, so #1111 did not introduce
  the class; it only added flags that ride it.
- **Genuinely narrow.** It needs a page session that straddles 8:45 PM PT on
  one specific Sunday a year, plus an in-site navigation after it. `?testDate`
  reproduces it on demand, which is how the reviewer found it; nothing a real
  owner does reproduces it on any other day.
- **The fix is not a one-liner.** Doing it properly means the phase flag stops
  being a captured constant and becomes something re-read per `astro:page-load`
  from a node the swap REPLACED — the same shape CLAUDE.md already prescribes
  for the cross-league init gate (`data-league` on the gated element). Applying
  that to one of the eight `isAuctionSeason` reads and not the rest would be
  exactly the half-applied gate that #1111's own review caught elsewhere.

## The shape of the fix

`#players-table` already carries `data-league={theLeagueDef.slug}` and is inside
the swapped region. Add `data-auction-open={String(isAuctionSeason)}` beside it,
read it once at the top of `init()` into a `let` that every consumer uses, and
drop `isAuctionSeason` from `define:vars` so nothing can read the stale copy by
habit. `auctionEndMs` needs the same treatment (`data-auction-end`).

Then extend `tests/auction-bid-link-gating.test.ts`: assert `define:vars` no
longer carries `isAuctionSeason`, and that every gate reads the re-read
variable instead. The suite already owns this rule's other halves.

## Worth doing at all?

Probably, but as its own small PR, and the natural time is next March when the
window reopens and the auction surface is being touched anyway. The cost of
leaving it is one evening a year, in a window the league is not bidding in.
