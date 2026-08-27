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
crest must never sit behind the COPY, or every stat line lands on a detailed
shield.

(Aug 2026: the layout mirrored to copy-left / crest / player-right, and the
crest moved with the player rather than staying centred — dead centre put its
left edge under the player's name, which is the same failure the banner was cut
for. It now sits low and right, at 58%/64%.)

The reveal also has to restate `color` on its headings: it renders inside
`TheLeagueLayout`, whose global `h1`/`h2` rules beat plain inheritance, so the
player's name came out near-black on the franchise gradient.


### Franchise brand colours are not safe to paint text on

Nine of the AFL's 24 franchises have a gradient stop white text cannot be read
against — **six of them use the same near-white `#e9e9e9`**, and Midwestside's
`#ffcd00` is worse. On a laptop that is a squint. On the TV it is an unreadable
card in front of the whole league, which is what it took to notice.

`toBroadcastPair` (`src/utils/draft-broadcast.ts`) saturates, then floors the
contrast at 4.5. Three things about it are load-bearing:

- **Saturate BEFORE darkening.** Darkening costs saturation, so boosting after
  is partly undone. A TV across a lit room eats subtlety — a merely-accurate
  colour reads washed out.
- **Resolve the pair together, not stop by stop.** A greyscale stop has no hue
  to preserve, so alone it can only ever darken to grey: Suh Girls' warm brown
  faded into a dead slate halfway across the card. Borrowing the hue of
  whichever stop HAS one keeps the gradient in the franchise's colour. A
  franchise greyscale on both stops (Titsburgh) correctly stays grey.
- **Discard the grey's own lightness when tinting it.** Rebuilt in hue at
  `#e9e9e9`'s native 0.91 lightness the channels land within a few points of
  each other, and the contrast floor then scales that straight back to the grey
  you were escaping. A mid lightness is what reads as the colour.

Applied in the broadcast card, NOT inside the shared `resolveSplashColors` —
TheLeague's draft room uses that same helper for a 3.6s overlay on a laptop.

### `icon` is 100x100; the TV needs the 400x400 group-me art

Every AFL franchise's `icon` is 100x100, but the broadcast crest renders at
~52-68vh — **roughly 560-730px on a 1080p TV** — so it was upscaled 5x+ and
visibly pixelated. All 24 already had 400x400 art sitting in
`public/assets/afl/group-me/`; only one was wired into the config. Resolution
order is `groupMeDark -> groupMe -> icon`.

Two traps here. First, checking the config FIELDS is not checking the
FILESYSTEM: the art existed on disk for 26 franchises while the config knew
about one, and reporting "we only have one" from the field scan was wrong.
Second, a missing crest degrades to NO crest rather than to the small one, so
`tests/draft-broadcast.test.ts` pins that every declared path resolves.

### Two CSS traps this layout walked into

Both cost a cycle and neither is visible in a diff:

- **`translateX` on a flex child is a percentage of ITS OWN width**, not the
  container's. The figure is half the card, so `translateX(10%)` moves the
  player 5% of the screen — the first attempt landed at half the intended
  distance.
- **A `both`-fill animation's final keyframe transform beats a static
  `transform` on the same element.** `.dbc-reveal__model` owns `dbc-model-in`,
  which ends on `translateY(0) scale(1)`, so a translate set there is silently
  swallowed. Shift the parent figure instead.

And one that is only a trap because the breakpoints disagree: in the portrait
single-column layout `order` decides the STACK, not left-vs-right, so a base
`order` swap inverts the phone (copy above player) unless it is re-pinned.
