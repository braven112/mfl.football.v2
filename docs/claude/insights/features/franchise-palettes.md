# Franchise palettes — going four colours deep

> Sep 2026. Every franchise in TheLeague (16) and the AFL (24) carried only
> `colorPrimary` / `colorSecondary`, with `colorTertiary` / `colorQuaternary`
> populated on a handful and holding `#000000` placeholders on three. This
> records what filling all four slots for 40 clubs taught, because the next
> palette pass — best ball, a new league, a rebrand — will hit the same walls.

## Sampling a crest: the body colour is not the biggest *cluster*

The first sampler applied a brightness floor (`(r+g+b)/3 > 95`) to skip dark
background pixels. It silently picked **highlights instead of body colours**:
The Show's rose came back `#e3b3c4` (hue 339°, value 0.89), which is the *shine
on* their pink, not the pink. Re-sampled with no floor, the crest's four pink
clusters were `#b98c8f` 2.85%, `#cc9ca6` 2.75%, `#997474` 2.38% and
`#dfb2c2` 2.07% — the pick had come from the smallest and lightest of them.

Rules that fell out:

- **Never put a brightness or lightness floor on a palette sampler.** Filter on
  alpha and on *saturation* if you must, never on how light a pixel is. A dark
  crest and a light highlight are both real colours.
- **Sample the CREST, and specifically the 400×400 `groupMe` cut.** An earlier
  version of this file said the opposite — "sample the banner, not the icon" —
  and it was wrong, in a way that took Brandon spotting two bad colours on the
  page to find. **The banner is not a higher-resolution crest; it is different
  artwork.** The Micks banner has no gold ring at all, so sampling it sent the
  pick to the leprechaun's hat buckle, a 0.5% detail; the crest's gold ring is
  `#fdb73c` at **7.08%**, the third-largest colour in the mark. Resolution was
  never the real problem, composition was.

  The 100×100 `icon` does blend small marks, so prefer `groupMe` where it
  exists — but note that the icon and the crest AGREE where the banner does
  not. Chatmaster's aim red is `#ee3d24` from the icon and `#ee3c23` from the
  400px crest, a ΔE of under 1; the `#fe3500` this file used to recommend came
  from the banner and is ΔE 15 from either. The old rule cited that as its
  evidence and had it exactly backwards.
- **Pixel counts from two differently-scaled images are not comparable.** A
  check that compared "nearest cluster" from a full-res icon against "body
  cluster" from a resized banner reported bodies *smaller* than the picks.
  Normalise to percentages, or sample one source.
- **A ΔE that flags 20 of 28 picks is measuring the wrong thing.** A first pass
  at "is this pick a highlight?" fired on nearly everything because derived
  shade-of-primary colours are lighter than their body *by construction*, and
  because hue is numerically unstable for near-blacks (`#021423` computes a
  saturation of 0.94). Scope such a check to picks that actually claim to come
  from the art, and require both colours to be saturated before comparing hue.

## Check a pick against the art's CENSUS — twice now, the colour was never there

The brightness floor above was one failure mode. A second, found only when
Brandon looked at two clubs and said the colour was wrong ("minty wasn't using
the correct yellow", "micks wasn't using the gold stroke, instead it was a
muddy yellow"), is worse: the shipped value appeared **nowhere in the artwork
at all**.

Measured against every cluster ≥0.3% of the source, with the repo's
`colorDistance`:

| Club | Shipped | Nearest real cluster | ΔE |
|---|---|---|---|
| Team Minty Fresh, tertiary | `#c1a427` | `#f7c20b` — the star | **23.4** |
| Muck Juggling Micks, secondary | `#cc7e30` | `#fdb73c` — the crest's gold ring | **21.0** |

Both are desaturated cousins of a real colour, sitting between two regions of
the art rather than on either — Micks' in particular lands between the hat
strap's brown `#a67c52` and the beard orange, which is exactly what a blend
looks like. The correct values are vivid: Minty's star is `#f7c20b` (chroma
236) against the shipped chroma 125, and the Micks buckle's gold is `#fdbb3a`
(chroma 195). Both new values are ΔE **0.0** from a real cluster, because they
ARE one.

**So the check is mechanical, and cheap: after picking, measure the pick
against the cluster census it supposedly came from.** A pick more than ~10 ΔE
from every real cluster was not sampled — it was interpolated, and it will read
as muddy because a blend of two saturated colours is always less saturated than
either. Do not eyeball this; `#c1a427` and `#f7c20b` both read as "a yellow" in
a swatch list, and the difference is only obvious beside the crest.

Two corollaries the pass had already half-learned:

- **Sample the region, not the image** — but check you are in the right image
  first. Micks' gold reads as 6.5% of a 44×22 crop around the banner's hat
  buckle and under 0.5% of the whole banner. On the CREST it needs no crop at
  all: the gold ring is 7.08% of the mark. A pick that requires you to hunt for
  a crop is usually a pick from the wrong source.

- **The sweep is mechanical, and it over-fires three times before it is
  useful.** Comparing every configured colour to its crest's cluster census at
  ΔE > 10 flags 23 of 40 franchises, because official palettes (the US flag,
  UCLA, the Raiders) and the deliberate shade-of-primary fourth colours are
  SUPPOSED to be absent from the art. The signal that actually matches what a
  human calls "muddy" is narrower: **same hue (within ~12°), crest cluster ≥2%,
  and the crest colour carrying ≥40 more chroma.** That returns a list you can
  act on. Corroborating evidence that it is the right filter: it independently
  flags Gridiron Geeks' `colorSecondary`, and `BAND_ART_DIRECTION` already
  carries a hand-written override for that exact franchise reading "swaps the
  muted `colorSecondary` orange for the vivid one, so the accent is visible at
  all" — someone had already worked around the bug rather than fixing it.
- **Look at the art.** Both of these were found by a human opening the page,
  not by any check in this repo. Reading the crop at 4× made the answer obvious
  in seconds — the buckle is plainly gold on a plainly brown strap.

## The census sweep over-fires on GRADIENTS — look before you apply

Running the muddy-colour filter (same hue, crest cluster ≥2%, ≥40 more chroma)
across all forty flagged nine clubs. **Three were wrong**, and the reason is
worth knowing because the filter cannot see it:

- **Vitside Mafia** and **Jewpacabra** are painted as GRADIENTS. Vitside's
  dragon ramps maroon → bright red, so the crest has no single "the red" — it
  has `#74211e`, `#7c221f`, `#8c2520`, `#932620`, `#ab2a21` and `#da3121`, each
  3-4%. The config's `#aa322b` sits mid-ramp, which is the correct
  representative value; the filter saw only the brightest end and called the
  middle muddy. Jewpacabra's glowing green is the same shape.
- **Maverick**'s flagged tertiary `#ebd0a1` is the **single largest cluster in
  its own crest at 31.8%**. The filter fired because a more saturated tan
  exists at 3.1%. Saturation is not correctness.

So the filter finds CANDIDATES, never verdicts. Before changing a value, open
the crest. A ramp of same-hue clusters each a few percent means a gradient, and
a mid-ramp value is right. A flagged colour that is itself a top-three cluster
is right. What is actually wrong looks like the Micks case: the shipped value
matches NO cluster, and the real one is a discrete, flat region of the art.

The six that were real: Chatmaster's primary (`#cfad30` chroma 159 against a
`#ffce31` that is 15.6% of the mark), Fullybaked's secondary (`#a20002`, 20.2%)
and tertiary, Swiftie's tertiary (`#f19c90`, 13.6%), Drunk Indians' tertiary,
No Soup's secondary (the neckerchief `#c93803`), and Gridiron Geeks' secondary.

**A workaround in code is evidence of bad data.** The Geeks case had already
been hit once: `BAND_ART_DIRECTION` carried a hand-written
`secondary: '#d45500'` with a comment saying it "swaps the muted
`colorSecondary` orange for the vivid one, so the accent is visible at all".
Nobody asked why the config's orange was muted. With `#f68428` in the config
the override no longer needs a secondary at all, and dropping it means the
club's band and its palette cannot disagree about which orange it wears. When a
hand-authored override exists to compensate for a colour, suspect the colour.

## The CHART hue is where a franchise's wrong colour hides longest

`color` is the legacy per-franchise graph colour, chosen so sixteen lines stay
apart on one chart, and `design-system.md` says in as many words never to
repurpose it as brand identity. Vitside Mafia's was `#f06abc`, a hot pink on a
black-and-red franchise. The band had already been fixed to stop reading it —
`franchise-band-brand.ts` still carries the comment "the pink it was using is a
chart hue only" — but the hue itself stayed, and it is what the owner-activity
chart drew for years.

Replacing one is genuinely constrained, which is why the pink was there. The
club's own red `#aa322b` is **ΔE 15.1** from the Pigskins' `#cc2936`, well
inside the repo's "≥25 clearly distinct" line, so the two lines would have been
unreadable together. The crest's maroon `#7c221f` clears it at **30.8** while
still being a colour the club actually wears. Measure a replacement against
every OTHER franchise's `color`, not just against the brand — that is the
constraint the field exists to satisfy.

Related: a guard that pins the wrong value by literal stops testing anything
the day it changes. `tests/franchise-band-brand.test.ts` asserted the band was
`not.toBe('#f06abc')`; it now reads `color` from the config, so it keeps
meaning "never the chart hue" whatever that hue becomes.

## Hue does not decide whether a colour is "pink" — lightness does

A sweep for pink on `#960129` (a deep crimson, 39% of the Gamecocks crest)
flagged it, because its hue computes to **344°** — the same magenta-ish band as
the actual pink `#f06abc`. They are nothing alike: `#f06abc` sits at lightness
0.68 and `#960129` at 0.30. Deep crimsons and true pinks share a hue and differ
in lightness, so a hue-band test alone cannot tell them apart — the same shape
as every other over-firing check in this file.

## Era colours are sampled too, and were sampled just as badly

Three of Vitside's four historical eras carried desaturated mauves that appear
nowhere in their own art — including two eras that SHARE an icon file and yet
stored different colours, which is only possible if both were bad samples of
the same image:

| Era | Was | Its icon's real colour |
|---|---|---|
| 2003 "The original" | `#874d46` | `#960129` (39%) |
| 2004 "The red oval" | `#aa7671` | `#fc3333` (12.1%) |
| 2009 "The rooster" | `#a65468` | `#960129` — same icon as 2003 |

Two eras on one icon must resolve to one colour. Worth checking whenever era
art is shared, which it often is.

One relief: era `colorPrimary` is NOT copied into any derived file, so editing
one needs no recompute. `franchise-history.json` copies era `icon`/`banner` —
that is the ripple `throwback-week.md` warns about, and it is a different
field.

## Use the repo's `colorDistance`, never an ad-hoc RGB metric

`src/utils/team-color-contrast.ts#colorDistance` is CIE76 ΔE in Lab space and
is documented as "≥25 clearly distinct". A hand-rolled weighted-RGB distance
written mid-session reported `#181818` vs `#000000` as **25.8** — i.e. distinct
— where the real figure is **8.2**, i.e. near-identical. Two blacks in one
four-colour palette is a wasted slot, and the wrong metric argued for keeping
both. There is one distance function; use it.

## An official palette does not automatically beat the approximate one

Tempting rule: "where the club's name points at a real team, take the official
hexes." It is right more often than not — Iowa's solid black and the Raiders'
`#000000` both replaced a `#181818` stand-in that the clubs' own crests showed
was wrong (~50% pure black in each icon).

But it fails when the official value lands on top of something the club already
has. Raiders Silver `#A5ACAF` is **ΔE 10.8** from Titsburgh's existing
`#8b8f93` primary — taking it for the freed fourth slot would have recreated
exactly the near-duplicate the pass was removing. Official black: yes. Official
silver: no. **Check each value against the palette it is joining, not against
the club's name.**

## Promoting the crest's dominant colour to primary keeps paying off

Four clubs had a primary that was not the biggest thing in their own art:
Harambe (white), Balls Deep (`#ddc08c` tan, 30.6% of the icon), The Show
(black), the Magicians (a navy that read as black). In **every** case, fixing
the primary also improved the derived stripe — the count of clubs needing a
different trim colour per theme dropped from 12 to 10 in the AFL and 5 to 4 in
TheLeague. A club whose primary is wrong tends to have downstream colour
problems that look unrelated.

Corollary: **a colour's *hue* being right does not make it visible.** The
Magicians' first midnight value `#0d0e17` is hue 234° — technically a
blue-purple — but its chroma (max channel minus min) is **10**, so it renders
as black. Chroma, not hue, decides whether a dark colour reads as coloured at
all. `#1a1440` at chroma 44 is where it starts looking like indigo.

## A white primary collapses `toBroadcastPair`

`docs/claude/insights/features/live-broadcast.md` already records that
`toBroadcastPair` only ever DARKENS. The corollary this pass found: with a
**white** primary it has nowhere to go, and both stops land on the secondary —
Harambe derived `#247cb9 → #287cb7`, two blues a hair apart and no gradient.

The fix is the escape hatch that already exists: add the franchise to
`HAND_AUTHORED` in `tests/broadcast-gradient-config.test.ts` and write the
gradient by hand, pinning why. Do not leave the collapsed derivation in place.

**And read `draft-broadcast.md` § "broadcastGradient" before touching any
franchise's `colorPrimary`/`colorSecondary`.** Those strings are *derived* and
the guard re-derives all of them on every run; this pass assumed they were
free-standing literals that merely referenced colours the club still owned, and
shipped seven stale gradients into the working tree before the guard caught it.
The doc says so plainly. It was not read first.

## Changing a colour changes THREE other things, not one

`broadcastGradient` (above) was the one this pass got caught by. The review of
the same PR turned up two more, and they share a shape: a value somewhere else
that was derived from the colour you just replaced, and that nothing
recomputes.

- **`colorPrimaryDark` / `colorSecondaryDark`** (TheLeague only) are the
  hand-picked dark-theme substitutes `darkClaim` swaps in on every live-scoring
  surface (`src/utils/live/model.ts`). Change `colorSecondary` without them and
  the club wears two different identities by theme: Running down the Dream went
  cloud grey `#9bacb3` in light and stayed the OLD tan `#d89a5f` in dark — ΔE
  50 apart, a different colour entirely. Check whether the new value still
  needs a dark variant at all before writing one: `#9bacb3` clears 6.88:1 on
  the live card unaided, so the right edit was to DELETE the field and let
  `darkClaim` fall through, not to pick a new tan.
- **Which colour leads the hero card.** `resolveAccent` takes the first
  candidate that clears its floors in the order **secondary → tertiary →
  quaternary → primary**, so filling a previously-empty tertiary or quaternary
  slot can silently demote the primary. Filling all forty palettes moved the
  hero accent on **fourteen** franchises. Thirteen of those moved within the
  club's own family and were improvements; the fourteenth is the one to watch
  for, because `accent` (3:1, large type) and `accentPanel` (4.5:1, small type)
  resolve independently and can land on **different colours**. Midwestside
  Connection is the case: the new `#00a9e0` wins the headline, fails the
  distinctness bound once lifted to 4.5, and lets the gold win the panel — one
  card, blue headline, gold data panel.

The cheap way to see all three at once is to resolve every franchise through
the real utils before and after, from the two config blobs, rather than
reasoning about any single club. That sweep is what found the fourteen; reading
the diff found none of them.

Midwestside is also the club that settled it: Brandon's call was "drop the blue
from midwest", and the fourth slot is **white** instead — which he had already
asked for as their dark-mode trim, and which being hueless leaves the ladder
nothing to prefer over the gold. Their accent is `#ffcd00` again in both
leagues, agreeing with `BAND_ART_DIRECTION`'s "black, with the gold as trim and
glow". After that, **no franchise of the forty** takes its headline accent and
its panel accent from different slots.

Attributing an accent back to its slot has its own trap, and the first two
attempts at it both over-fired. A raw ΔE between `accent` and `accentPanel`
flags eight clubs, because the panel is the same colour LIFTED and ΔE reads
lightness. Nearest-candidate-by-distance flags ten, because a lifted colour
drifts toward white and so lands nearest a white slot it never came from —
Midwestside's own gold `#ffcd00` → `#ffeea6` attributes to its white
quaternary under that metric. The only correct check is EXACT: push each
candidate through the same `ensureContrastOn` the resolver uses and compare for
equality. That reports zero, and it is pinned in
`tests/hero-franchise-backdrop.test.ts`.

The ladder is now **stated on the Brand Book** (`/<league>/brand/<slug>`, in
`FranchiseBrandPage.astro`) rather than living only in `resolveAccent`'s
comment, because that page draws a real `CompositeHero` from the real resolver
— so a reader can see Midwestside's hero come out blue with nothing on the page
explaining which slot did it. `tests/hero-franchise-backdrop.test.ts` §"the
accent ladder" pins the order behaviourally AND scans the page for the same
string, so the prose and the resolver cannot drift apart. Mutation-checked:
moving `colorPrimary` to the front of the candidate list fails four of them.

Note when writing such a test that the accent is the winning slot **lifted** to
clear the backdrop, never the raw hex — `#2e7d32` comes back `#58975b`. Assert
which candidate it is NEAREST to, not equality.

## Screenshot the Brand Book — it prints every colour a club owns, side by side

Two stale values survived every check in this pass and were caught by opening
`/<league>/brand/<slug>` on the preview and looking: Chatmaster's
`colorQuaternary` was a 0.70 scale of the muddy gold that had just been
replaced, and Gridiron Geeks' `colorSecondaryDark` was a lift of the muted
orange that had just been replaced. Both are the derived-follower class this
file already documents — and knowing about the class did not stop me walking
past two instances of it.

The page is unusually good at this because it renders the whole palette as
adjacent swatches plus what the site DERIVES from them. A colour that no longer
belongs is obvious there and invisible in a diff, where it is just a hex that
did not change.

The preview is public for these routes, so it screenshots without auth:

```js
// Chromium is pre-installed; the agent proxy's CA is not in Playwright's NSS
// store, so pin the proxy CA's SPKI rather than disabling verification.
chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [`--ignore-certificate-errors-spki-list=${spki}`],
});
// spki: openssl x509 -in /root/.ccr/agent-proxy-ca.crt -pubkey -noout \
//         | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary \
//         | openssl enc -base64
```

## A dark-theme variant is NOT "the same colour, lighter"

Worth knowing before writing a guard for one. `darkClaim` swaps
`colorPrimaryDark` / `colorSecondaryDark` in wholesale on live-scoring
surfaces, and several clubs deliberately **lead with a different one of their
own four colours** there — Dead Cap Walking navy → green, Cowboy Up navy ↔ red,
the Ninjas' green secondary becoming their red quaternary.

Two guards were attempted and both over-fired, for the same reason every other
over-firing check in this file did: **ΔE reads lightness, and a dark variant is
supposed to differ in lightness.** Same-family (ΔE base vs dark > 50) flagged 8
clubs, nearly all deliberate swaps. Membership (ΔE dark vs nearest own slot >
30) flagged 5, with Fire Ready Aim scoring 34 purely for being a lift. Neither
shipped. A workable version compares hue and chroma while ignoring lightness,
and skips near-black bases. Five values that a human should look at are
recorded in `docs/claude/followups/2026-09-22-dark-variant-audit.md`.

## Guards that move with the data

Filling every slot invalidated four test fixtures that were asserting the *old*
shape, and each wanted a different answer:

- `team-colors` / `franchise-brand` pinned "returns undefined when not defined"
  using clubs that now define all four. **bb1 is the last league still on two
  colours** and is the fixture that keeps that path exercised; the unknown-
  franchise fallback covers the rest.
- `hero-franchise-backdrop` pins the all-neutral clubs to one constructed grey.
  Giving the Wabbits a carrot dropped that group from four to three — a real
  behavioural change to their homepage hero, not a test to silence.
- `franchise-band-brand` tracks band-hue collisions as `KNOWN_DATA_GAPS` and the
  list may only SHRINK. The Show's black primary resolved one of the AFL's
  three. Retighten it, same idiom as `typecheck-baseline.json`.

## One value in 40 clubs has no source

The Wascawy Wabbits' carrot `#ed7117` and grey `#9b9b9b` were **chosen, not
sourced**. Their crest contains no chromatic pixel at all and there is no
public Looney Tunes palette to cite. It is flagged in the config commit, in the
hero-backdrop test comment, and here — because the next person to audit these
values deserves to know which one will not trace back to anything.
