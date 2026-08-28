# Draft Broadcast — the TV big board

## Context

`/afl-fantasy/draft-broadcast` (Aug 2026), then `/theleague/draft-broadcast`
(Aug 2026). A laptop plugged into a TV on draft night: owners keep picking in
MFL's own live draft room, and this page follows along and throws each
selection on screen. Zero interaction, read from ten feet.

Deliberately NOT a variant of `/theleague/draft-room`. That page is an
interactive tool (queue, chat, filters, submit); this is a display. They share
the DATA layer — `buildDraftPlayers`, `pick-reveal.ts`, `/api/draft/status` —
and nothing else.

**Two leagues, ONE island.** The AFL drafts by CONFERENCE (two independent
108-pick boards, hence `?conference=`); TheLeague drafts as a single `LEAGUE`
unit. Everything built around switching boards is gated on
`conferences.length > 1`, so the single-unit league gets no dead switcher —
`tests/draft-broadcast.test.ts` pins that gate. Each league keeps its OWN thin
page (feeds, franchise brands and the keeper/off-board rule differ); only the
island and the two utils are shared.

## Key files

| File | Role |
|------|------|
| `src/pages/afl-fantasy/draft-broadcast.astro` | SSR (AFL): per-conference board, brands, pool |
| `src/pages/theleague/draft-broadcast.astro` | SSR (TheLeague): single-unit rookie board |
| `src/components/shared/draft-broadcast/DraftBroadcast.tsx` | Poll → diff → queue → reveal |
| `src/components/shared/draft-broadcast/BroadcastRevealCard.tsx` | The reveal, TV scale |
| `src/utils/draft-broadcast.ts` | Pure: best-available, on-the-clock, rehearsal |
| `src/utils/draft-broadcast-server.ts` | Keepers, board ranks, feed joins |

## Insights

### Board rank must be scoped to the pool the room is actually drafting from

The AFL learned this as a keeper problem (below). TheLeague's rookie draft is
the same lesson wearing different clothes: it is **rookies only** — all 51 of
the 2026 board's picks were `status: 'R'` — so ranking a rookie against every
unrostered dynasty asset put the 1.01 somewhere in the 300s and made the entire
class read as a reach. TheLeague's page adds every NON-ROOKIE to the off-board
set alongside the rostered players, which is what makes `#1` mean "first name
off the rookie board".

The rookie set comes from `buildDraftPlayers({ rookieOnly: true, enrich: false })`
rather than a re-derived "what counts as a rookie" check — one definition, and
`enrich: false` keeps the second pass cheap. Note the page still SHIPS the full
trimmed pool (not just rookies): a pick of someone outside the shipped pool
reveals as a blank card on a 65" screen, and "rookies only by rule" is not a
guarantee worth that.

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
for. It sat low and right, at 58%/64%.)

(Aug 28 2026, Brandon: **back to dead centre, at 0.42** — landscape only;
portrait still anchors it off the right edge, because there the copy is stacked
UNDER the player and a centred crest lands on the name. Tucked behind the player
the crest spent most of its area under the cutout and the rest against the card
edge, so at 0.26 it read as texture, not as a franchise mark. What makes centring
survivable this time is that `.dbc-reveal__text` now carries its own
`text-shadow`: the banner failed because it was competing TYPE, and a shield
under shadowed type is a different problem from a wordmark under it. If the crest
ever needs to go brighter still, deepen that shadow — do not move it back off
centre.)

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

### The idle board and the reveal are LAYERS, not alternatives

`DraftBroadcast` rendered `current ? <BroadcastRevealCard/> : <OnTheClock/>`, so
the handoff replaced the entire screen in one frame — on a TV that reads as
somebody changing the channel rather than as the board reacting to a pick. Both
now mount at all times inside `.dbc__screen` layers and cross-fade on opacity
(`--dbc-fade`, 620ms — read at runtime by the morph, never re-typed).

Two things that are load-bearing about how that is wired:

- **The outgoing reveal is held through a REF read during render**, not parked in
  state by a timer. A state update lands after the commit that dropped
  `current`, so the card would unmount and remount for a frame — restarting
  `dbc-reveal-in` and `dbc-model-in` at the exact moment it is supposed to be
  leaving. `if (current) lastRevealRef.current = current` before the render reads
  it costs nothing and never drops a frame.
- **The hidden layer ends its fade at `visibility: hidden`, not opacity 0.** The
  idle board carries the conference switcher and the rehearsal button; an
  opacity-0 layer leaves both focusable under a reveal, and `aria-hidden` over
  focusable children is the worse fix. The flip is a `0s` transition delayed by
  the fade duration, so the layer is still painted the whole way out. Both states
  must be listed in the `prefers-reduced-motion` override — killing the
  transition on `.dbc__screen` alone leaves the delayed flip in place, and the
  outgoing layer stays clickable for half a second after it vanishes.

### The crest and the copy MOVE between the screens; a dissolve alone throws that away

Both screens show the same two things — the franchise crest and a block of copy
beside it — in different places: the idle board holds them as a side-by-side
lockup mid-stage, the reveal puts the crest dead centre behind everything and
the copy over on the left. Cross-fading alone made the room watch a logo vanish
and another appear, when what is actually happening is that the same two
elements are being rearranged. `src/utils/broadcast-morph.ts` FLIPs each pair
across the fade (Brandon, Aug 28 2026: "the logo shifts to the background
centred and the text slides left and updates to the reveal text").

Measured on a 1920x1080 board: the crest travels (767, 426) at 367px wide →
(960, 613) at 734px; the copy slides from cx 1169 to cx 690. Both directions
run, so the board shrinks the crest back into the lockup when the reveal ends.

What it cost to get right:

- **Never `fill: 'forwards'`.** The obvious way to write the LEAVING half is to
  pin it where it flew to — its layer is about to be hidden anyway. That
  transform **survives `cancel()`** in Chrome: the finished animation stops
  being listed by `getAnimations()` while still applying, so the next morph
  measured the idle crest sitting on the reveal's box, computed a zero delta,
  and the board silently stopped animating back. The leaving element now has no
  fill at all and snaps home the instant it lands — invisible, because the
  morph and the layer's opacity transition are the same duration and start
  together. `tests/broadcast-morph.test.ts` pins the ban.
- **Cancel, then measure, then read the base transform.** All three, in that
  order. The reveal crest is centred with `translate(-50%, -50%)`, and a WAAPI
  keyframe REPLACES the transform property rather than adding to it — animating
  a bare `translate()` drops the centring and throws the crest half its own
  width off in both directions. The base is read as the computed matrix so a CSS
  change can't desync from the module, which is exactly why it must be read off
  a settled element.
- **`dbc-reveal-in` is cancelled on the way in.** It scales the whole card
  1.04 → 1, and a crest measured inside a parent still growing under it sets off
  from the wrong box and drifts the whole flight. The card gets a straight
  opacity fade instead; the motion is the crest's job.
- **Artwork scales, type does not.** The copy block goes from a 2.5vh team name
  to a 9vh player name; scaling between them reads as a zoom effect rather than
  as the same words moving. It translates and cross-fades its contents.
- **The two elements in a pair are usually different franchises.** The board
  behind a reveal has already advanced to whoever is on the clock next, so the
  mark that flies to centre is not the one that lands there. Dissolving them
  along one path is what makes that read as "the mark becomes the drafting
  team's" instead of as a mistake.

### The two broadcast screens are a PAIR, and they compose colour differently

The board has two full-screen surfaces that alternate every ~20 seconds:
`.dbc-reveal` (the pick) and `.dbc-idle` (on the clock). `#638` made the idle
screen run the same `resolveSplashColors` → `toBroadcastPair` treatment as the
reveal card precisely because the two were contradicting each other.

They also **composed** that pair differently — which is why sharing the
treatment was not enough, and why they now share the STRING itself
(`broadcastGradient`, on `--dbc-gradient`, read by both rules):

| | angle | stop order | note |
|---|---|---|---|
| `.dbc-reveal` | 115deg (or 315deg, hand-authored) | primary → secondary | 315deg puts 0% in the bottom-right, under the cutout |
| `.dbc-idle` | 150deg | secondary → primary | second stop at **130%**, so it never fully lands on screen |

Matching the colours while composing them differently is what let Midwestside
show a gold-dominant idle board and a near-black reveal for the same franchise.
The fix was to share the string, not just the treatment — which repainted the
other 36 idle screens onto their reveal's composition, deliberately. The lesson
generalises: when two surfaces must agree, sharing the INPUTS is not enough if
each still owns the composition. Share the output, or expect them to drift.

### `.dbc-reveal__wash` caps what a bottom-right accent can ever be

The wash sits above the background and lays 45% black over the right edge (58%
over the left, where the copy is). A corner accent therefore tops out at ~55% of
its authored luminance no matter what: Midwestside's `#ffd400` lands ~`#8c7100`
on screen. Author around it — a corner hue has to start genuinely bright — or
change the wash, which affects all 24 cards.

### `afl.config.json` does not survive a JSON round-trip

`JSON.parse` → `JSON.stringify` on the league configs is **lossy**, so never
rewrite them that way:

- `afl.config.json` declared `groupMe` **twice** on franchise `0007` (same
  value; parsers keep the last, so a round-trip would silently delete one).
  Fixed Aug 2026, and `tests/league-config-duplicate-keys.test.ts` now scans all
  three configs so it cannot come back — `JSON.parse` accepts a duplicate
  without a word, so nothing else in the build can see one.
- `theleague.config.json` hand-formats some arrays inline (`loaderQuips`), which
  a re-stringify explodes into one-element-per-line — turning a 40-line diff
  into a several-hundred-line one.

Edit these files as TEXT (anchored line insertion) and validate with
`JSON.parse` afterward. Verify the round-trip before trusting it:
`node -e "s=fs.readFileSync(p,'utf8'); JSON.stringify(JSON.parse(s),null,2)===s"`.
### The exit chip hides on hover-capable devices ONLY

The chip in the top-right corner is the only interactive element on the page,
and once the board is fullscreen on a TV it is the only thing on screen that
isn't the board — so on a laptop it drops to `opacity: 0` while fullscreen and
comes back on hover or `:focus-visible`.

The gate is `@media (hover: hover) and (pointer: fine)`, and it is load-bearing
rather than defensive: **a touchscreen has no hover to bring the chip back and
no Esc key either**, so the same rule applied there leaves the viewer sealed in
fullscreen with only the OS gesture as a way out. Touch keeps the always-dimmed
chip. Note what those two features actually report: the PRIMARY pointing device,
so a touchscreen laptop matches on its trackpad and hides the chip. That is the
right call here (trackpad and Esc are both present), but it is not the same
claim as "no touchscreen ever hides it" — don't write it down as if it were.

`tests/draft-broadcast.test.ts` slices the stylesheet into its `@media` blocks
and fails if any rule hiding `[data-in-fullscreen='true']` sits outside a
hover-capable query — a top-level hide is invisible in review and only breaks on
a device nobody is testing on. Three details in that guard exist because the
first version of it passed a broken stylesheet:

- **`.includes('hover: hover')` classifies the exact inversion as safe.**
  `not all and (hover: hover)` means "hide on touch ONLY" and contains the
  string; so does `any-hover: hover`, which reports on inputs that aren't in
  use. The classifier has its own unit test for that reason.
- **A hide is not only `opacity: 0`.** `visibility: hidden` and `display: none`
  reintroduce the whole trap and are worse, because they also stop the chip
  being hoverable — which is the entire mechanism by which it comes back.
- **Checking the attribute EXISTS is not checking its value.** Inverting the
  ternary hides the "Full screen" button before fullscreen and leaves the exit
  chip on the TV during, and satisfies a presence check.

Two smaller notes:

- **Opacity, not `display`/`visibility`**, so the chip stays hit-testable while
  invisible — that is also why there is no invisible hit target on the chip
  itself: the pointer being on it is what reveals it.
- **The hover reach is a wrapper (`.dbc__fullscreen-zone`), not an `::before`
  apron on the button.** An apron is part of the button's own hit area, which
  makes the whole invisible rectangle an exit-fullscreen button — fine for a
  pointer traveling into it, not fine for a tap or a pointer already parked in
  that corner. The wrapper is a hover target with no handler, so a click in the
  reach does nothing while the movement still reveals the chip.
- **`:hover` and `:focus-visible` are separate rules, never one selector list.**
  One unsupported pseudo-class invalidates the entire list per spec, and here
  that drops the reveal while leaving the hide in force.
