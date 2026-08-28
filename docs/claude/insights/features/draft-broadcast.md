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

Nine of the AFL's 24 franchises have a gradient stop that fails even the 3.0
WCAG bar for large text — **six of them the same near-white `#e9e9e9`**, and
Midwestside's `#ffcd00` is worse. Against the 4.5 the board enforces, 21 of the
24 need adjusting. (Quote the bar with the count: "nine of 24" alone is the
3.0 figure and reads as a much smaller problem than it is.) On a laptop that is a squint. On the TV it is an unreadable
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
- **Only rescue a grey that actually FAILS.** Near-black is greyscale too, and
  ten franchises pair a colour with `#181818`. A saturation-only grey test
  repainted that black in the partner's hue — Vitside Mafia's black half came
  out red — and flattened every one of those cards to colour-on-colour.
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

### The inline preview is NOT the geometry this page ships in

Every size on this board is a `vh` of the VIEWPORT, but `.dbc` is only
`calc(100vh - 12rem)` tall until someone hits Full screen, where it becomes
`100vh`. So an element that is 34vh of the viewport occupies ~41% of the inline
board and exactly 34% of the fullscreen one. Judging a size from an inline
screenshot overstates it by about a fifth, which is the difference between "that
crest is crowding the rails" and "that crest is fine".

Screenshot it in the shape it ships in. No fullscreen API needed — inject

```css
.dbc { height: 100vh !important; position: fixed !important; inset: 0 !important;
       z-index: 99999 !important; border-radius: 0 !important; }
html, body { overflow: hidden !important; }
```

after load and the geometry matches the TV. Do NOT `display: none` the site
chrome to get there: hiding `main` collapses `.dbc` and every measurement comes
back as a zero-size rect, which reads as a broken selector rather than a broken
harness.

Measure, don't eyeball: `getBoundingClientRect()` on the crest, the stage and
the rails catches an overflow that `overflow: hidden` has already cropped out of
the screenshot. At 1920×1080 the stage is 600px; on a 390×844 phone it is 231px,
which is why a size that is comfortable on the TV clips the pick line off a
phone. Any change to the stage stack needs a measurement at BOTH.

### Stacked, the crest is capped by the copy; side by side it is not

The on-the-clock crest sat at 17vh for one reason: stacked above the name, the
two shared the stage's vertical budget and anything larger pushed the copy into
the rails. Moving the copy to the crest's right made them split WIDTH — which a
1920px board has spare — and the same crest went to 34vh with room left over.
When a vertical constraint is what is capping an element, changing the axis is
cheaper than negotiating for pixels.

### `display: none` is invisible to `+`, `:has()` and every other selector

`hideOnError` hides a 404'd crest with an inline `display: none`, which leaves
the `<img>` in the DOM. So a rule that adapts the copy to "is there a crest"
cannot be written as `.dbc-idle__crest + .dbc-idle__clock-copy` alone — that
matches a hidden crest exactly as it matches a visible one, and `:has()` has the
same blind spot. There are two distinct no-crest cases and they need different
mechanisms: a franchise with no icon never renders the element (the sibling
combinator covers it), and a 404 needs the handler to flag an ancestor
(`closest('.dbc-idle__clock')?.classList.add('is-crestless')`).

That flag then inherits the bug the `<img>` key was already added to prevent:
state written onto a REUSED node outlives the team it was written for. Keying
only the image left the row's flag stuck for every franchise after the first
404. Key whatever element the state lands on, not just the one that failed.
### Moving a computed value into config: generate the defaults, then guard the derivation

`broadcastGradient` (Aug 2026) moved the reveal card's background out of code
and into per-franchise league config. The migration technique is the reusable
part, and it applies to anything here that is currently *computed* and wants to
become *authored*:

1. **Generate every default by running the function you are replacing.** All 36
   non-hand-authored entries were written by calling
   `toBroadcastPair(colorPrimary, colorSecondary)` and formatting its output —
   not by eyeballing hexes. That makes the migration a provable visual no-op,
   which is the only way to change 40 franchises at once and still sleep.
2. **Guard the derivation, not the literal.**
   `tests/broadcast-gradient-config.test.ts` re-derives all 36 and fails on
   drift, with a `HAND_AUTHORED` exempt set for the ones deliberately designed.
   Pinning literal strings instead would have made every future brand-colour
   tweak a two-file edit with no signal about which one was wrong.
3. **The fallback lives in ONE place.** The card sets `--dbc-gradient` only when
   config supplies a valid value; the stylesheet's own `var()` fallback still
   paints the derived pair. Computing a fallback string in the component too
   would have given two subtly divergent implementations of "the old look".

The cost of choosing a raw CSS string over structured stops is that **nothing
else in the build can catch a typo, and the failure is invisible**: a stray `;`
does not error, it ends the inline declaration and the card renders with no
background at all — on a TV, mid-draft. `isSafeCssGradient` exists for that, and
a failing value is ignored rather than painted.

### The two broadcast screens are a PAIR, and they compose colour differently

The board has two full-screen surfaces that alternate every ~20 seconds:
`.dbc-reveal` (the pick) and `.dbc-idle` (on the clock). `#638` made the idle
screen run the same `resolveSplashColors` → `toBroadcastPair` treatment as the
reveal card precisely because the two were contradicting each other.

They still **compose** that pair differently, and one string cannot serve both:

| | angle | stop order | note |
|---|---|---|---|
| `.dbc-reveal` | 115deg (or 315deg, hand-authored) | primary → secondary | 315deg puts 0% in the bottom-right, under the cutout |
| `.dbc-idle` | 150deg | secondary → primary | second stop at **130%**, so it never fully lands on screen |

So changing one surface's colour source without the other reintroduces exactly
the contradiction `#638` fixed. That is live right now: Midwestside's idle
screen is gold-dominant while its reveal card is near-black (accepted
deliberately, Aug 2026 — see `docs/claude/rules/theming-and-assets.md`).

### `.dbc-reveal__wash` caps what a bottom-right accent can ever be

The wash sits above the background and lays 45% black over the right edge (58%
over the left, where the copy is). A corner accent therefore tops out at ~55% of
its authored luminance no matter what: Midwestside's `#ffd400` lands ~`#8c7100`
on screen. Author around it — a corner hue has to start genuinely bright — or
change the wash, which affects all 24 cards.

### `afl.config.json` does not survive a JSON round-trip

`JSON.parse` → `JSON.stringify` on the league configs is **lossy**, so never
rewrite them that way:

- `afl.config.json` declares `groupMe` **twice** on franchise `0007` (lines ~370
  and ~429, same value). Parsers keep the last; a round-trip silently deletes
  one. Harmless today only because the two values are identical.
- `theleague.config.json` hand-formats some arrays inline (`loaderQuips`), which
  a re-stringify explodes into one-element-per-line — turning a 40-line diff
  into a several-hundred-line one.

Edit these files as TEXT (anchored line insertion) and validate with
`JSON.parse` afterward. Verify the round-trip before trusting it:
`node -e "s=fs.readFileSync(p,'utf8'); JSON.stringify(JSON.parse(s),null,2)===s"`.
