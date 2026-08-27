# AFL Draft Broadcast — the TV big board

## Context

`/afl-fantasy/draft-broadcast` (Aug 2026). A laptop plugged into a TV on draft
night: owners keep picking in MFL's own live draft room, and this page follows
along and throws each selection on screen. Zero interaction, read from ten feet.

Deliberately NOT a variant of `/theleague/draft-room`. That page is an
interactive tool (queue, chat, filters, submit); this is a display. They share
the DATA layer — `buildDraftPlayers`, `pick-reveal.ts`, `/api/draft/status` —
and nothing else.

## Key files

| File | Role |
|------|------|
| `src/pages/afl-fantasy/draft-broadcast.astro` | SSR: board skeleton, brands, player pool |
| `src/components/afl/draft-broadcast/DraftBroadcast.tsx` | Poll → diff → queue → reveal |
| `src/components/afl/draft-broadcast/BroadcastRevealCard.tsx` | The reveal, TV scale |
| `src/utils/draft-broadcast.ts` | Pure: best-available, on-the-clock, rehearsal |
| `src/utils/draft-broadcast-server.ts` | Keepers, board ranks, feed joins |

## Insights

### The AFL is a keeper league, and ADP does not survive that

**Every AL franchise keeps 7, so 84 players are gone before 1.01 is called.**
The AFL's 1.01 is the **85th pick** of a from-scratch board — round 8, pick 1.
The first version of this page compared the raw pick number against MFL redraft
ADP and called **90 of 108** picks on the 2025 board a REACH.

Correcting the scale (rank within the *available* pool) fixes round one exactly
— picks 1 and 2 land on 0, round-1 median delta −3. **It does not fix rounds
2+**, and that is the real finding: measured as "Nth best available", the AFL's
median pick is the **~84th-best available by redraft ADP**, and the literal
best available went just 4 times in 108. Past round one this league does not
draft to redraft ADP at all — owners already hold seven studs and draft for
depth, need and upside.

So **no rescaling makes a STEAL/REACH verdict honest here.** It is a data-fit
problem, not an arithmetic one. The board states a fact instead — "2nd best
available", his position among what was actually still on the board — which
needs no threshold and cannot be wrong. Taking the top man left still earns the
green; taking the 90th-best available is visibly a reach without the screen
saying so.

Sanity check that the pool is right: the 2026 AL board tops out at **Joe
Burrow, ADP 26.16**. Every player with a better ADP is kept. If the top of your
board is an ADP-3 player, keepers aren't being excluded.

### Keepers are per CONFERENCE, and are rostered-minus-drafted

- `duplicatePlayers: true` means the National League can keep a man the American
  League can still draft. Pooling both conferences' keepers deletes up to 84
  legitimately draftable players from a board they belong on.
- Derive the kept set as **rostered minus already-drafted**, never as a plain
  roster read. MFL adds each pick to the drafting franchise's roster as it
  lands, so mid-draft a plain read counts fresh picks as keepers and shrinks the
  pool under the board. The subtraction makes it correct however late the page
  is opened.

### ESPN headshots are LANDSCAPE — size composites on width

A real cutout is about **600×436**, head and shoulders. Capping it on height
(`max-height: 94%`) never binds, `max-width` clamps it to the column, and the
player ends up a postage stamp marooned in the corner of his own column with
two-thirds of it empty. Size on **width**, let the figure clip the bottom bleed.

Verify composites with a REAL cutout, not a square stand-in — the aspect ratio
is the whole bug. In a sandbox that can't reach `a.espncdn.com` from the
browser, `curl` usually still can: download one and serve it through Playwright
request interception.

### Phone breakpoints: orientation, not width

`max-width: 900px` catches a phone in LANDSCAPE and hands it the portrait
layout — stacking a player above a text block inside ~400px of height, starving
both. Split them: `(max-width: 900px) and (orientation: portrait)` stacks;
`(orientation: landscape) and (max-height: 560px)` goes side-by-side. A
width-only rule also misses 932×430 entirely, which then falls through to the
desktop grid.

Related, from the same pass: **never fix a collision by hiding the subject.**
An early mobile rule set `display: none` on the player cutout to stop it
colliding with the name. That "fixed" the collision by deleting the reason the
page exists.

### `collectFreshPicks` drops bursts — right for a laptop, wrong for a TV

The default `maxBurst = 3` discards larger bursts as rejoin noise. On a TV a
fast round that lands 4 picks inside one poll would then reveal **nothing**, and
a room notices a missing pick far more than a late one. Broadcast passes
`maxBurst = Infinity` and queues instead, shortening each reveal when the queue
backs up. The first-observation and slot-sync guards still apply, so opening the
page mid-draft is still history rather than a 60-reveal storm.

### Measuring a rehearsal is not measuring the feature

`?rehearse=` replays a COMPLETED season, so its payload carries that season's
data quirks. Twice during this build a 2025-rehearsal measurement was reported
as a property of the live board — "these three players have no ESPN id" — when
the 2026 feed has all three. **Before stating a data gap as a finding, check it
against the year the feature will actually run on.**

### Artwork behind artwork; type on clean gradient

Franchise banners were tried as the reveal backdrop and cut: a banner is mostly
its own wordmark, so behind a player's name it reads as two competing pieces of
type at the moment the room is trying to read one. Blurring it back far enough
to stop competing left it contributing nothing. Colors + crest only — and the
crest sits behind the PLAYER, not behind the copy, or every stat line lands on
a detailed shield.

The reveal also has to restate `color` on its headings: it renders inside
`TheLeagueLayout`, whose global `h1`/`h2` rules beat plain inheritance, so the
player's name came out near-black on the franchise gradient.
