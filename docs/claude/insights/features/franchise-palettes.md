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
- **Sample the BANNER, not the icon, for small marks.** Icons here are 100×100
  and blend anything small into its surroundings. Chatmaster's aim red is
  `#ee3d24` at icon resolution and `#fe3500` from the 950×158 banner — the
  banner value is the real one. The icon is still right for *dominant* colours
  (Balls Deep's tan is 30.6% of it, ΔE 1 from the banner's).
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
