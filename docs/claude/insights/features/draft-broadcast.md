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

### Rehearsal's two timing numbers are COUPLED — the board gets STEP minus HOLD

A rehearsal drives itself: `REHEARSE_STEP_MS` steps a pick, and the reveal that
lands owns the screen for the hold. So the idle board is not given a duration
anywhere — it gets **whatever is left over**, and the two numbers cannot be
tuned independently even though they read as unrelated constants.

That bit twice. Rehearsal originally reused draft night's 18s hold against a 20s
step, which left the board on screen for ~2s per cycle: the half of the
broadcast you most need to watch while rehearsing was the half you never saw.
Live does not have this problem because real picks arrive on the room's clock,
not on a step — **the live pair and the rehearsal pair are genuinely different
problems, and sharing constants between them is the bug, not the DRY fix.**

Rehearsal is now 8s of reveal and 8s of board, with the step DERIVED
(`REHEARSE_STEP_MS = REHEARSE_REVEAL_MS * 2`) rather than written as a second
number that can drift from the first. If you want an even split, derive it; if
you want an uneven one, say so in the comment, because the next reader will
otherwise "fix" one number in isolation.

### Assert on `getAnimations()`, not on the stylesheet, when motion changes

Every animation question on this page — is the crest still flying? does anything
move inside the card? did the entrance survive the morph cancelling it? — is
answered in one Playwright evaluate:

```js
el.getAnimations().map((a) => a.animationName || '(waapi)')
// plus getComputedStyle(el).transform / .opacity, sampled across the entrance
```

That distinguishes the three states a static read of the CSS cannot: a keyframe
that is declared and running, one that is declared and **cancelled at runtime**
(what the morph did to `dbc-reveal-in` on most reveals), and one that is gone.
Grepping the stylesheet would have called the middle case a live animation for
months. Sampling the computed transform at a few points across the entrance also
gives the direction and distance in real pixels (`translateX(-112px)` from the
left, `+236px` from the right), which is the only way to check a `vw`/`%` value
means what you meant on the viewport it will actually run on.

Drive it with `?rehearse=N` and wait on `.dbc__screen--reveal` losing
`is-hidden` — that also times the cadence for free (six consecutive transitions
at 8.0s each is how the split above was confirmed).

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
(`--dbc-fade`, 930ms — one token, and every entrance on the screen is scaled off
it so the handoff stays one movement).

Two things that are load-bearing about how that is wired:

- **The outgoing reveal is held through a REF read during render**, not parked in
  state by a timer. A state update lands after the commit that dropped
  `current`, so the card would unmount and remount for a frame — restarting
  `dbc-reveal-in` at the exact moment it is supposed to be leaving.
  `if (current) lastRevealRef.current = current` before the render reads
  it costs nothing and never drops a frame.
- **The hidden layer ends its fade at `visibility: hidden`, not opacity 0.** The
  idle board carries the conference switcher and the rehearsal button; an
  opacity-0 layer leaves both focusable under a reveal, and `aria-hidden` over
  focusable children is the worse fix. The flip is a `0s` transition delayed by
  the fade duration, so the layer is still painted the whole way out. Both states
  must be listed in the `prefers-reduced-motion` override — killing the
  transition on `.dbc__screen` alone leaves the delayed flip in place, and the
  outgoing layer stays clickable for half a second after it vanishes.

### The shared-element morph was BUILT, then CUT — the dissolve is the answer

**Current state: there is no morph.** `src/utils/broadcast-morph.ts` and
`tests/broadcast-morph.test.ts` are deleted. The two screens are a pair of
slides that dissolve into each other, and `dbc-reveal-in` (opacity + a 1.04 → 1
settle on the whole card) is the only animation in the handoff. Nothing moves
inside either screen.

It got there in three cuts over one session (Brandon, Aug 28 2026), and the
ORDER is the lesson — each step was his call, and each one removed motion:

1. The crest FLIPped between its two boxes while the layers cross-faded under
   it ("the logo shifts to the background centred and the text slides left").
2. The copy stopped travelling: the idle lockup's text faded in place instead,
   and the reveal's copy and cutout slid in from the left and right edges to
   close on the crest as it landed.
3. Then the flight went too — "simplify the animation and reveal the whole card
   instead of animating the logo" — and the slides went with it, because they
   only existed to partner the flight and read as fidgeting without it.

The thing to take from that: **a logo travelling the width of a 65" TV is a lot
of movement to spend on the one frame where the room is trying to read a name.**
The argument in the other direction is real and is written up below — a dissolve
alone does throw away the continuity of "the same mark is being rearranged" —
but it lost to legibility on an actual TV. Do not rebuild this because the
argument sounds good in a diff; it sounded good here too.

If a shared element IS ever wanted back, this is what it cost to get right the
first time, and none of it is obvious:

- **Never `fill: 'forwards'`.** The obvious way to write the LEAVING half is to
  pin it where it flew to — its layer is about to be hidden anyway. That
  transform **survives `cancel()`** in Chrome: the finished animation stops
  being listed by `getAnimations()` while still applying, so the next morph
  measured the idle crest sitting on the reveal's box, computed a zero delta,
  and the board silently stopped animating back. The leaving element ended up
  with no fill at all, snapping home the instant it landed — invisible, because
  the morph and the layer's opacity transition were the same duration and
  started together. The guard test that pinned this ban is deleted along with
  the module, so this paragraph is now the only record of it.
- **Cancel, then measure, then read the base transform.** All three, in that
  order. The reveal crest is centred with `translate(-50%, -50%)`, and a WAAPI
  keyframe REPLACES the transform property rather than adding to it — animating
  a bare `translate()` drops the centring and throws the crest half its own
  width off in both directions. The base is read as the computed matrix so a CSS
  change can't desync from the module, which is exactly why it must be read off
  a settled element.
- **`dbc-reveal-in` has to be cancelled on the way in.** It scales the whole
  card 1.04 → 1, and a crest measured inside a parent still growing under it
  sets off from the wrong box and drifts the whole flight. The card got a
  straight opacity fade instead; the motion was the crest's job. Note this is
  why the card's own entrance was invisible for most of the morph's life —
  restoring it was most of what "reveal the whole card" meant.
- **Artwork scales, type does not.** The copy block goes from a 2.5vh team name
  to a 9vh player name; scaling between them reads as a zoom effect rather than
  as the same words moving. It translates and cross-fades its contents.
- **The two elements in a pair are usually different franchises.** The board
  behind a reveal has already advanced to whoever is on the clock next, so the
  mark that flies to centre is not the one that lands there. Dissolving them
  along one path is what makes that read as "the mark becomes the drafting
  team's" instead of as a mistake.

### The two broadcast screens are a PAIR, and they compose colour differently

The board has two full-screen surfaces that alternate all night (18s per reveal
live, an even 8s/8s in rehearsal):
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

### The origin line's mark: ship the dark cut, and ship only the half you can't derive

The reveal card's meta line names where a player came from — his college if he
is a rookie, his NFL team otherwise — and carries that origin's logo to its
left. Two decisions behind it that are not obvious from the code:

**The card opts OUT of the site-wide dark-logo swap.** Every other surface ships
the light mark and lets a `html.dark` rule replace it; this card cannot, because
its franchise gradient is dark in BOTH themes, so for a light-theme viewer the
swap never fires and the marks with dark outlines vanish. `resolveOrigin`
resolves the dark cut server-side and ships it as the `src`. The full reasoning,
and why `display: none` on error is safe here when it is wrong everywhere else,
is in `dark-mode-team-icons.md` (2026-08-28) — that is the file to read before
adding another logo to this page.

**Only the college half rides on the player.** Resolving a school needs the
80 KB `college-logos.json`, so it happens in `enrichBroadcastPlayers`; the NFL
half is derived on the client from `nflTeam`, which every player already
carries. Sending a resolved URL for both would have spent ~45 bytes × the whole
draftable pool to ship a string the island can build — the same trade
`buildDefenseFacesByTeam` already made, and the payload is the recurring cost on
this page. The college lookup is gated on `usesCollegeOrigin`, the exported
predicate the card itself uses to pick the label, so the server cannot resolve a
school mark for a player the card will label with his pro team.

That predicate lives in `pick-reveal.ts`, not here, because the draft room's own
splash asks the same question about the same pick — it had carried an identical
inline copy, agreeing right up until one of them changed. Three call sites now
share it (both reveal surfaces and the broadcast's server), and
`tests/draft-broadcast.test.ts` fails if any of them re-derives
`isRookie && college` inline again.

**No mark beats a wrong mark.** A free agent and a retiree both normalize to the
NFL shield, which says nothing beside a name; an unrecognised team code and a
school absent from the table would 404. All four return `logo: null` and the
label stands on its own.

### Verifying this page in the sandbox: `page.route` did not intercept its images

Chromium's context routes (`ctx.route('https://a.espncdn.com/**', …)`) never
fired for the reveal card's logo and headshot requests in the remote sandbox —
the handler's own `console.log` never printed, so the requests were not reaching
it. Blocking the service worker (`serviceWorkers: 'block'`) did not change it,
and the cause was not chased further. Recorded as observed behaviour, not as an
explanation: **do not assume the `verify` skill's "fulfill them with a
placeholder image" advice works on this page.**

What did work, and is enough to judge layout: wait for `.dbc-reveal__meta`, then
rewrite the src in the page.

```js
await page.$$eval('.dbc-reveal__origin-logo', (imgs) => {
  for (const img of imgs) { img.style.display = ''; img.src = '/assets/nfl-logos/KC.svg'; }
});
```

Read the element's `outerHTML` BEFORE that swap — the un-swapped src is the only
evidence the resolution logic emitted the right URL, and the swap destroys it.
Note also that a reveal is not on screen at load: the rehearsal replays picks on
a poll interval, so a fixed `waitForTimeout` mostly screenshots the idle board.
Wait on the selector (`?rehearse=3` reaches a reveal in well under a minute).

### Both rails lead with their image, and the chip came from player-cell

"Up next" leads each row with the franchise crest and "Just off the board"
leads with the player's headshot, both in a fixed-width second column sized off
one `--dbc-rail-figure` on `.dbc-idle__rails`. Two things that are load-bearing
rather than styling:

- **The crest wrapper renders whether or not there is a crest.** A franchise
  with no icon, or one whose crest 404s into `hideOnError`'s inline
  `display: none`, would otherwise collapse its own grid column and pull that
  row's name left out of line with the rows above it — the same
  `display: none`-is-invisible-to-selectors trap the on-the-clock lockup hit
  further up this file, in its cheaper form.
- **The headshot chip is the shared `.player-cell__avatar`, not a copy**, which
  means this board inherits two `html.dark`-keyed treatments it cannot rely on.
  See "The avatar chip on an ALWAYS-DARK surface" in
  `docs/claude/insights/features/player-composites.md` — the board is dark for
  a light-theme viewer too, so both ring properties take the dark-mode ring and
  a DEF chip resolves its own dark logo URL.

### `hideOnError` on this board never fired for a crest that failed early

The rails and the on-the-clock lockup are in the SERVER-rendered HTML, so a
crest can finish 404ing before the island hydrates — and React does not replay
an error event it was not mounted for. Stubbing `/assets/afl/group-me/**` to
404 left all six crests visible as broken-image glyphs with `onError` never
fired, and the on-the-clock copy left-aligned against a crest that was not
there: precisely the failure the `is-crestless` flag was added to prevent. Each
crest `<img>` now also carries a `ref` that re-checks
`complete && naturalWidth === 0` at mount. Same fix, same reason, as
`nflLogoRefCallback` in `roster-constants.ts`. Anything added to this board with
an `onError` fallback needs the ref too — the reveal card is the exception,
since it only ever mounts after a pick lands client-side.

### Portrait: both rows flexible, and the clamp is what makes it safe

Portrait leads with the copy and closes with the player (Brandon, 2026-08-28),
which is what the BASE layer's `order` already does — so the breakpoint stopped
re-pinning `order` entirely rather than inverting it a second time. The row
sizing that goes with it is the part worth remembering, because the obvious
version of it is wrong in a way you will not see on a phone:

```css
grid-template-rows: minmax(min-content, 1fr) minmax(0, 1fr);  /* copy, figure */
.dbc-reveal__text   { align-self: end; }
.dbc-reveal__figure { min-height: 0; }
```

- **The figure's row must stay FLEXIBLE.** `.dbc-reveal__model` is capped by
  `max-height: 100%`, and a percentage max-height only binds against a definite
  track — that clamp is the only thing stopping a tall cutout from shoving the
  copy off the top of the card. `grid-template-rows: auto auto` plus
  `align-content: end` was tried first because it closes the copy-to-player gap
  on a tall phone and looks better there. It also overlapped the copy and the
  player by **141px at 600x660** and 75px at 540x720 (Surface Duo), because
  nothing was clamping anything. Measured, not reasoned: 375x667 and 360x640
  both LOOK fine, so a phone-only check passes a broken layout.
- **`align-self: end` on the copy is what banks the slack above it.** With the
  copy's row content-sized instead, every leftover pixel pools in the figure row
  and a 390x844 phone gets ~170px of bare gradient between the last stat and the
  player's head. Both rows flexible + copy bottom-aligned puts the slack over
  the copy as headroom, which is where the old player-on-top layout had it too.
- **`min-content` is the copy row's floor, not `0`.** The copy is the one thing
  on the card that must never be cropped, so on a short viewport it takes what
  it needs (255px at 600x660) and the figure row gives way.
- **An EMPTY figure gives its row back**, via
  `.dbc-reveal__body:not(:has(.dbc-reveal__model))` collapsing to one row.
  Without it the crest-only reveal and a 404'd cutout leave half a card of bare
  gradient under the copy. `:has()` is sound here only because
  `handleCutoutError` nulls the state and REMOVES the `<img>` — a
  `display: none` fallback would be invisible to it.
- **`min-height: 0` on the figure must stay a zero.** A revision reserved
  `64vw` there so the absolutely-positioned defence pair (`--def`, `bottom: 0`)
  would have a box in a content-sized row — and that floor then applied to the
  two states with nothing to show, the crest-only reveal for an unmapped defense
  and a cutout that 404'd, both of which render an EMPTY figure. It read as
  250px of bare gradient under the copy. A flexible row gives the pair its box
  for free.

Growing the cutout to fill the leftover space is NOT the fix, and was tried
first: `object-fit: contain` can never exceed the box's WIDTH, so on a
width-bound cutout `height: 100%` changes nothing at all. The only ways to fill
vertically are `cover` (crops him) or letting him run past the column — the
120% the TV uses, explicitly declined for portrait further up this file.

The crest re-anchors to the BOTTOM-right here (`top: auto; bottom: -6vh;
transform: none`). Its old `top: 42%` centring was written for the previous
stack, where the copy sat under the player; with the copy leading it crossed
the name. Note all three of `left`, `top` and `transform` have to be unwound —
the base layer centres with `left: 50%/top: 50%` + `translate(-50%, -50%)`, and
leaving any one in re-centres the crest on an axis.

**Sweep these eight viewports for any portrait change here**, all of them
`orientation: portrait` and under the 900px breakpoint: 390x844, 375x667,
360x640, 320x480, 430x500, 540x720, 600x660, 768x1024. The card's height is
`max(30rem, 100vh - 12rem)`, so everything at or under ~672px tall sits on the
480px floor and is where the budget actually gets tight — and the WIDE short
ones (540x720, 600x660) are the failures, not the narrow tall ones everybody
tests. Assert `text.bottom === figure.top` and that the kicker's top is never
above the card's.

## 2026-08-28 — Pre-flight: why the images arrive late, and how to rehearse the network

Two draft-night problems that both live upstream of anything on screen.

### ESPN's headshots expire in under four minutes

`a.espncdn.com/i/headshots/nfl/players/full/<espnId>.png` is ~237 KB and comes
back with `cache-control: max-age=233`. The value COUNTS DOWN across requests,
so it is an edge TTL, not a hint about the client — and either way the browser
throws the entry away in under four minutes.

That is the whole explanation for "sometimes the images don't load". Nothing is
racing and nothing is broken: every reveal starts a cold ~240 KB request for a
picture the same laptop downloaded ten minutes ago, and on room wifi it lands
some seconds into an eighteen-second card. The same applies to the reveal's
origin mark, which `resolveOrigin` resolves to
`a.espncdn.com/i/teamlogos/nfl/500-dark/<code>.png` — also remote, also short.

Two pieces answer it, and NEITHER works without the other:

- **`public/sw.js` now keeps `a.espncdn.com` images in their own cache**
  (`IMAGE_CACHE_NAME`), cache-first for a week, on our clock rather than the
  origin's. It is a separate cache name and is exempt from the activate sweep
  (`KEEP_CACHES`) — bumping `CACHE_NAME` to evict a poisoned HTML entry must
  not also throw away a board somebody warmed an hour before their draft.
  The worker RE-ISSUES each request as CORS: an `<img>` request is `no-cors`,
  and its opaque response is unreadable, unstampable, and charged to the origin
  quota at a padded size. ESPN sends `access-control-allow-origin: *`, so this
  costs nothing.
- **`BroadcastWarmup` pulls the whole plan before the first pick**, in board
  order (`planBroadcastImages`). It WAITS for the worker to control the page
  first — warming into the plain HTTP cache buys four minutes, which is close
  to nothing — and reports `data-durable="false"` on screen when there isn't
  one. **The service worker is registered in PROD ONLY** (see
  `TheLeagueLayout.astro`), so a warm-up on the dev server is always the weak
  kind. That is not a bug to chase.

Three things about the plan that are decisions, not details:

- **Board order, not pool order.** The AFL ships 1,180 players to serve a
  108-pick board. Warming in pool order spends the room's first minutes of wifi
  on players nobody takes. `?warm=` sets the depth; the default (400) covers
  the realistic board several times over at ~145 MB, `all` is ~4x that, and
  `off` is the escape hatch for a connection where the warm-up would compete
  with the poll it exists to protect.
- **It gates on `isSplashCutoutEligible`, the card's own predicate.** A planner
  with its own copy of that rule would drift into warming images the card never
  requests (a DEF crest, an MFL JPG) and missing ones it does.
- **Every defender in a defense pool, not the two on screen.** The reveal card
  draws two at random from each five-man pool per pick, so a slice would leave
  three of five cold on every team-defense selection.

### `?rehearse=` cannot catch a network problem — `?mflLeague=` can

Rehearsal replays a finished season through the real ingest path, which is why
it is worth having. But it never calls `/api/draft/status`, so it proves
nothing about the league id, the draft unit, the host, or whether a franchise id
resolves to a crest — the four things that would actually ruin a night.

`?mflLeague=<id>` (`draft-broadcast-source.ts`) points the board's POLL at
another MFL league while everything else stays this league's: copy the league in
MFL, turn the draft on in the copy, and the board follows it live. Verified
end-to-end on 2026-08-28 against a real MFL league: SSR skeleton, poll, flag.

- **The skeleton comes from the overridden league too.** Draft order and who is
  on the clock come off the board, so reading the local feed there would show
  the room the real league's order over the copy's picks.
  `fetchRemoteDraftResults` returns null on any failure and the local skeleton
  is the fallback — an unreachable test feed degrades to a board following
  nothing, never a blank TV.
- **The unit defaults to `null`, meaning "whichever unit this board has."** A
  "draft only" copy can carry one unnamed unit where the AFL drafts by
  conference, and `/api/draft/status` answers a NAMED unit that isn't there with
  a 404 rather than a board. `?conference=` (explicit) or `?unit=` names one.
- **The host is allowlisted to `*.myfantasyleague.com`, in the API as well as
  the page.** `/api/draft/status` fetches whatever host it is handed and is
  public, so a free-text host parameter is server-side request forgery with a
  URL bar for an interface. It was already accepting one; `resolveMflHost` /
  `resolveMflLeagueId` now gate both parameters there.
- **An override is always flagged on screen**, above both layers — a test feed
  that vanished for the eighteen seconds a reveal owns the TV is a test feed
  nobody sees.
- **A copy league's draft units exist before its BOARD does.** The 2026
  rehearsal copy (MFL 65915) answered `draftResults` with `CONFERENCE00` and
  `CONFERENCE01` both named and zero `draftPick` slots between them, because
  nobody had set the draft up yet. That is a valid response, so the fetch has
  nothing to report and the override would have rendered a board with no draft
  order and no first pick. `hasDraftSlots` is the check; the local skeleton is
  the fallback for the empty case as well as the unreachable one. It has to be
  caught at SSR because the poll cannot fix it — `ingest` ignores an empty
  board, so the pre-draft screen would simply stay blank.

A copy made through MFL's own league-copy keeps the franchise IDS, which is what
makes the whole override work: 65915 carries 0001–0024 with the same
conference split, so every pick resolves to an AFL name, colour and crest out of
`afl.config.json`. The copy's own franchise names never reach the screen. If a
future copy ever renumbers its franchises, the board will show "the next team up"
with no crest — check `franchiseId` alignment first when that happens.

Both pre-flight overlays share one top-centre stack (`.dbc__preflight`). Every
other edge of this board is spoken for: the idle header owns the top corners,
the fullscreen button is pinned top-right, the reveal's ghost pick number owns
the bottom-left, and `.dbc__status` owns the bottom-right.


### MFL's draft export FLAPS — the board must keep the union, not the latest poll

Measured live during the 2026 AFL rehearsal (2026-08-28), polling
`TYPE=draftResults` for one league and one unit every two seconds:

```
03:07:13  api=1 pick   www44=0
03:07:15  api=0        www44=0
03:07:18  api=0        www44=1 pick
03:07:21  api=1 pick   www44=0
03:07:24  api=0        www44=0     <- four consecutive stale reads on api
```

Both hosts, alternating, with runs of four. MFL serves exports from backends
whose caches disagree, so **one poll is a sample of whichever backend answered,
not a monotonic view of the draft.** Switching hosts does not help — the
league's own `www44` flaps too, so there is no "authoritative" host to prefer.

Rendered straight, the room saw 1.01 land, the board flip back to
"on the clock", and forward again, every few seconds (owner report, mid-draft).
And silently in both directions: `collectFreshPicks` already held the pick in
its seen-set, so it never re-revealed on the way back.

`DraftBroadcast` now keeps `filledRef` — every filled slot it has ever seen, by
overall pick number — and merges each poll against it. Three properties, and
the first two are why it is a MERGE rather than a "drop the stale response":

- **A filled slot in the response always wins**, so a commissioner's re-pick
  still reaches the board. Only an EMPTY slot defers to what we hold.
- **A response that is stale for one slot and fresh for another contributes its
  fresh half.** Disagreeing backends make that combination possible, and
  dropping the response whole would discard a real pick.
- **The filled count can never shrink**, which is the property the room
  actually watches.

The cost is that a genuine UNDO is not reflected until someone re-picks that
slot. That is the right trade for a TV board: an undo is rare and self-corrects
on the next selection, while the flap was happening every few seconds in front
of the league. Do not "fix" this by trusting the newest response.

Pinned in `tests/draft-broadcast-preflight.test.ts` ("a flapping MFL board"),
including the four-in-a-row run — a one-poll tolerance would not have covered
what was measured.


### The poll loop had no client-side timeout — one hung request ended the night

Reported mid-draft: "it stopped updating after pick 7", then "I refreshed and
it was a few rounds ahead". MFL was at 25.

The board's poll is a self-chaining `setTimeout`: the next tick is scheduled
only once the current `await fetch(...)` settles. The **server** side of
`/api/draft/status` has always carried `AbortSignal.timeout(10_000)`. The
**browser** side carried nothing. So a request that never settles — a wifi
drop, a laptop suspending mid-flight, a proxy holding the socket — does not
delay the loop, it BREAKS it. The board freezes on its last value and only a
reload recovers, which is exactly the reported shape.

Three changes, in order of how much they cover:

- **`AbortSignal.timeout(POLL_TIMEOUT_MS)` on the fetch.** A timeout now lands
  in the same `catch` as any other failure: counted, backed off, and — the
  point — rescheduled. This is the line that keeps a three-hour draft polling.
- **A watchdog** (`POLL_WATCHDOG_MS`) comparing now against a timestamp each
  tick stamps in its `finally`. It covers what an abort cannot: a timer the
  browser throttled while the tab was backgrounded, or one the machine slept
  through. It only ever re-arms; `inFlight` stops it polling in parallel.
- **Re-arm on `visibilitychange` and `online`.** Returning from sleep or a
  dropped network is when the board is most stale, so ask immediately instead
  of waiting out the interval.

Any future rewrite of this loop must keep all three. A chained timeout with no
abort is not a slow poller, it is a poller with a single point of failure, and
the failure is silent.

### A jump of eighteen picks is a catch-up, not a fast round

Consequence of the same MFL flapping. When a current snapshot finally answers
after a run of stale ones, the union gains every pick at once — measured going
from 3 to 25 in one poll. `maxBurst = Infinity` (correct for a genuinely fast
round, where dropping a pick is the worse failure) then queued 22 reveals at
`REVEAL_RUSH_MS` each: nearly two and a half minutes narrating a round the room
finished, during which the idle board — who is ACTUALLY on the clock — never
gets the screen.

Past `CATCHUP_BURST` fresh picks, only the NEWEST is revealed and the rest are
taken as read. Note this is deliberately not the old `maxBurst` behaviour of
dropping the burst entirely: on a TV, a pick the room watched happen must still
appear. Show the one that just happened, skip the history.


### A union of picks is the WRONG model — take the newest snapshot whole

The union (previous section) survived the plain flap and then failed the moment
the draft was reverted to restart it. Two live reports, an hour apart:

> "I reverted the draft to restart and now it switches between old picks and
> then to the correct pick."
> "it was working on the first pick and then jumped to the old 1.12 even though
> we are on 1.02."

The union can only grow, so it can never shed an abandoned draft. Worse, the
first attempt at a fix — release a slot after it has been reported empty
continuously for 45s — could not fire at all here, because the stale backends
kept serving the OLD board and every one of those reports reset the slot's
clock. 1.12 was immortal.

**The thing the union was built to fix does not need a union.** Every snapshot
MFL served was INTERNALLY COHERENT — a clean prefix of the draft, never a board
with holes (verified across seven distinct snapshots). The responses are not
corrupt, they are of different AGES. So:

- **Take the newest snapshot and use it whole**; ignore any older than what is
  on screen. `boardAge` is `(newest pick timestamp, filled count)`, compared in
  that order.
- **The timestamp is the half that survives a revert.** A re-picked 1.01 is
  stamped LATER than every pick of the abandoned draft, so a two-pick restarted
  board beats a stale twelve-pick one on its first appearance, with no window to
  wait out. That is the whole reason age is not just a pick count.
- **The count only breaks ties inside one second**, which is where MFL's own
  stamp resolution runs out.

`REVERT_CONFIRM_MS` survives, much reduced in scope: it now covers the single
case recency cannot settle — a revert with NO re-pick yet, where the true board
is both emptier and stamped earlier than what is on screen. A plain flap can
never accumulate toward it, because a current snapshot lands every few polls and
clears the clock outright.

The general lesson, which cost two rounds: **when a source flaps, ask whether
its individual responses are coherent before merging them.** Merging coherent
snapshots invents states that never existed and, worse, makes the merged state
impossible to walk back.

### (superseded) The first revert fix, and why it failed

Kept because the reasoning is a trap worth recognising, not because the code
survives. The rule was: hold a slot filled until it has been reported empty
CONTINUOUSLY for 45s, since "a flap alternates, a revert does not". The
asymmetry is real. What it missed is that after a revert the flap is not
between current-and-empty but between **current-small and stale-LARGE** — so
the stale reports kept refreshing the old slots' clocks and the window never
expired. A rule keyed on "how long since anyone said filled" is only safe when
the stale reads are the emptier ones.


## 2026-08-29 — Draft night, live: what MFL's draft feed actually does

Six hours of testing against a live copy league (MFL 21227). Every entry below
is a measurement, not a theory, and the last one supersedes a lot of work.

### THE HEADLINE: read `static_url`, not the JSON export

`TYPE=draftResults` is served from backends whose caches disagree, and the
spread is not "occasionally stale" — it is unusable. Measured with the draft
PAUSED, so the truth was frozen at 24 picks, 77 requests returned:

| response  | share |
|-----------|-------|
| 17 picks  | 70%   |
| 18 picks  | 18%   |
| 19 picks  | 3%    |
| 24 (true) | 8%    |

**Seven picks behind is the single most likely answer MFL will give you.**
Cache-busting query params and `Cache-Control: no-cache` change nothing — this
is many backends, not one edge cache. Neither does host choice: `api.` 302s to
`www##`, and both flap.

MFL also publishes a STATIC file — the one its own draft room reads — and names
it in `static_url` on every draft unit:

```
https://www44.myfantasyleague.com/fflnetdynamic2026/<league>_<unit>_draft_results.xml
```

Ten consecutive fetches during a live draft returned byte-identical, CURRENT
results (31 picks, matching the room's 3.08 exactly) while the JSON export was
serving 26. Its root element even carries `round="03" pick="08"` — the
on-the-clock position outright. Present for every shape checked: both AFL
conferences, a copy league, and TheLeague's single `LEAGUE` unit.

`/api/draft/status` prefers it whenever it is at least as fresh. Three things
about how:

- **The URL is never constructed by hand.** It comes from MFL's own response,
  including the `www##` host that actually serves it — the `api.` host only
  redirects and will not serve the file.
- **The JSON export stays as the fallback**, because it is the documented API
  and this file is an implementation detail of MFL's UI. If it moves, the board
  degrades to the old sampled behaviour rather than to nothing.
- **Sampling drops to one request once the static URL is known.** Ten redundant
  calls per poll per viewer is a lot to spend on a source about to be ignored.

If a future session sees the board lagging again, check the static file FIRST.

### Everything else that broke, in the order it was found

1. **A hung `fetch` ends a self-chaining poll loop.** The client had no timeout
   where the server had one; one request that never settled froze the board
   until reload. `AbortSignal.timeout` + a watchdog + re-arm on
   `visibilitychange`/`online`. A chained timeout with no abort is a single
   point of failure, and it fails silently.
2. **A union of picks cannot represent a revert.** See the superseded section
   above. Recency (newest pick stamp, then filled count) handles the flap and
   the revert with one rule.
3. **Automatic rollback is unsafe when the freshest snapshot is rare.** With the
   truth arriving ~10% of the time the board legitimately rejects most polls, so
   a "nothing but older responses for 45s" trigger fires constantly during a
   NORMAL draft and reversed a live board. THE BOARD NEVER MOVES BACKWARDS ON
   ITS OWN; the threshold only raises a visible "reload to resync".
4. **A reveal must be news.** MFL fires queued autopicks in bursts — four picks
   stamped in the SAME SECOND — and each took its own 6s reveal, so the screen
   alternated old pick / live board / old pick and read as "bouncing".
   `REVEAL_MAX_AGE_MS` absorbs anything older than 90s onto the board silently.
5. **One SSR fetch is a coin toss.** With 30% of responses empty, one load in
   three seeded the board from an empty snapshot. The page render samples too.

### The habit that actually found these

Every one of the above was diagnosed by MEASURING the feed — polling MFL in a
loop and printing the distribution — not by reading code. Two of them looked
exactly like our bug and were MFL's; two looked like MFL's and were ours. When
this board misbehaves, sample the source first and get the distribution; the
answer is usually in it.

## 2026-08-29 — The rehearsal and the live clock

### A wall-clock gate silently kills the rehearsal, and the rehearsal still LOOKS fine

`REVEAL_MAX_AGE_MS` (item 4 above) shipped the same morning this broke. It
judges a pick by the clock: older than 90 seconds and it lands on the board
without taking the screen. Correct for the autopick burst it was written for —
and fatal to `?rehearse=`, which replays a season that has already FINISHED.
Every pick on that board is stamped months ago, so every pick failed the gate
and the dry run revealed nothing at all.

**What made it cost real time is that nothing looked broken.** The board
advanced pick by pick, on-the-clock updated, the rails filled, the cadence was
right. Only the card that is the entire point of the night never appeared, and
"the reveal doesn't show" reads as a bug in the reveal — the last place it was.

Two things follow, and the second is the general one:

- **A pick the replay rolls forward IS happening now, so stamp it now.**
  `applyRehearsal(picks, upTo, replayedFrom, nowMs)` restamps only what the
  replay itself makes. Picks at or below the operator's starting `?rehearse=N`
  keep their original stamps — they are history the operator asked to start
  from, exactly like the SSR board on draft night, and restamping them would
  make a reload of `?rehearse=40` storm forty reveals.
- **Fix it by making the rehearsal PASS the gate, never by exempting it.**
  A `if (rehearsing) skipTheCheck` would have fixed the symptom and quietly
  retired the rehearsal's whole value: the replay feeds `ingest` — the live
  path — precisely so a dry run exercises what draft night exercises. A dry run
  that routes around the live logic proves nothing about the live logic. This
  is the same point as "Measuring a rehearsal is not measuring the feature"
  above, arriving from the opposite direction.

The gate moved to `src/utils/draft-broadcast.ts` and is exported, so the
contract between it and `applyRehearsal` is pinned by test rather than living
half inside a React component where nothing could reach it. The guard walks a
full replay step by step and asserts the newest pick clears the gate at each
one — a per-step check, because the board advancing was never the broken half.

**The rule to carry forward: any check on this board that reads `Date.now()`
must be asked what it does to a replayed board before it merges.** The class is
wider than the rehearsal, too — the gate is measured against the CLIENT clock,
so a TV laptop running more than 90 seconds FAST would suppress every reveal on
live draft night with the identical, silent symptom. Skew the other way is
harmless. If that ever needs closing, the fix is to measure a pick's age
against the board's own newest timestamp rather than the wall clock.
