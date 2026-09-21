# Per-club NFL mark assignments

**Status:** **phases 1, 2, 3 and the Brand Book shipped** 2026-09-20.
Decisions made against the live artwork.

Today every NFL club has exactly one light mark (`/assets/nfl-logos/{CODE}.svg`)
and one dark mark (ESPN's mirrored `500-dark` PNG, swapped in by CSS). This plan
makes that choice **per club**, and — for one club — **per surface**.

## The finding this rests on

There are **three grounds, not two**. A surface renders a club mark on white, on
a dark card, or on the club's own colour, and the third is not a variant of the
first two:

- A mark built for white (a solid dark-inked logo) dissolves on a dark card.
- A mark built for dark (white body, thin keyline) reads as a hollow outline on
  white, and at the 12–18px of a player cell it disappears entirely.
- A club-colour band is a dark ground for almost every club, so it wants the
  dark mark — even though the page around it may be in light theme.

The third case is already settled precedent elsewhere in this repo:
`src/utils/franchise-band-brand.ts` picks **the dark artwork when the franchise
has any** for the fantasy-team band, for exactly this reason. Club marks should
follow the same rule rather than invent a second one.

**The club-colour ground is derived, never stored.** A band resolves to the
club's `dark` assignment when the club colour is dark and `light` when it is
light (relative luminance of `colors[0]` from `nfl-brand-kit.json`, the same
threshold `readable()` uses). That is one rule for 32 clubs instead of 32
hand-set values, and it is overridable per surface if a club breaks it.

## Why this is not "pick a logo set"

`docs/claude/rules/theming-and-assets.md` records that NFL.com publishes exactly
ONE cut per club, and that for CHI, NYG and NYJ that cut is the dark-background
mark. That was first read as a defect to work around (`KEEP_COMMITTED`). It is
better read as a **fact about grounds**: for those three clubs, upstream gives us
a good dark mark and no light one. The assignments below take the dark mark for
dark grounds and keep the held light art for light grounds — which is what the
upstream was telling us to do all along.

## The assignments

Chosen against rendered comparisons on both grounds at real sizes, 2026-09-20.
Marks are named by the ids in `MARK_SOURCES` below.

| Club | light | dark | club-colour band | per-surface |
|---|---|---|---|---|
| CHI | `primary` (the orange C) | `nflcom` (bear head, **vector**) | → dark | — |
| NYG | `primary` (blue `ny`) | `nflcom` (white `ny`, **vector**) | → dark | — |
| NYJ | `primary` (green oval) | `altDark` | → dark | 3 surfaces, below |

Every other club keeps today's behaviour and needs no entry.

Two things fall out of the table that shape the work:

1. **The light side does not change for any club.** All three sit on `primary`,
   which is what the light pipeline already produces. `scripts/download-nfl-logos.mjs`
   and `KEEP_COMMITTED` need no edit at all in phase 1.
2. **Every change is on the dark side**, and two of the three want a **vector**
   dark cut — which the dark pipeline cannot currently carry.

### NYJ per-surface overrides

The NFL.com Jets cut is a white-filled oval with a green keyline. On a dark or
club-colour ground it is a solid white mark and the strongest of the three
available. On white it is an outline, and at 12–18px it is a hairline. So it is
assigned by ground rather than by size:

| Surface | ground | mark |
|---|---|---|
| Nav club switcher (40px) | light | `nflcom` |
| Broadcast card | always dark | `nflcom` |
| Club-colour band | club colour | `nflcom` |

The nav entry is the only per-surface override on a **light** ground anywhere in
this plan, and the only one that needs the CSS path in phase 2.

## Mark sources

An assignment names a mark id; the id resolves to a URL through the catalog
already committed at `src/data/nfl-brand-kit.json`.

| id | source | format |
|---|---|---|
| `primary` | the committed `/assets/nfl-logos/{CODE}.svg` | SVG |
| `nflcom` | `teams.<CODE>.primarySvg` (NFL.com club endpoint) | **SVG** |
| `espn` | `teams.<CODE>.espn.default` | PNG |
| `espnDark` | `teams.<CODE>.espn.dark` — today's dark default | PNG |
| `altLight` | `teams.<CODE>.espn.secondaryOnWhite` | PNG |
| `altDark` | `teams.<CODE>.espn.secondaryOnBlack` | PNG |
| `whiteKnockout` | `teams.<CODE>.espn.primaryWhite` | PNG |
| `wordmark` | `teams.<CODE>.wordmark` (nflverse) | PNG |
| `reversed` | **derived** — recolour of the committed SVG, per-club map | SVG |

ESPN publishes no SVG at any path (verified: every variant 404s), so `nflcom` is
the only vector option beyond the committed primary. That is why two clubs chose
it for dark.

## Derived marks — the reversed cut

Broadcast graphics use a **reversed** mark on dark grounds: the body knocked out
to white with the club colour carrying the keyline. Fox's score bug does this for
every club (observed 2026-09-20 on a SEA @ ARI broadcast).

**No source we can reach publishes it.** Checked and ruled out: ESPN's full
17-treatment brand kit, NFL.com's club endpoint, Fox Sports' own web CDN
(including every `vresize` version index, which returns byte-identical files, and
five guessed `-dark`/`-alt`/`-reverse` filenames, all 404), nflverse, Sleeper and
mflscripts. Every one serves the standard mark. The reversed cut lives in the
networks' own graphics packages, which are not distributed.

Note in passing that Fox's WEB set is not its BROADCAST set — its site serves the
standard Cardinals bird, the bear head for Chicago, a flat blue `ny` with no red
keyline for the Giants, and a Jets wordmark with no oval.

### It can be derived instead

Our committed SVGs carry flat, discrete fills, so a reversal is a colour swap on
artwork we already ship — still vector, still ~8 KB, nothing to license. For
Arizona:

| role | from | to |
|---|---|---|
| body | `#97233f` | `#ffffff` |
| keyline | `#000000` | `#97233f` (club primary; tunable redder) |
| beak | `#ffb612` | `#e2571b` |

This is a **third source class** alongside "fetched from upstream" and
"committed": generated at build time from our own SVG plus a per-club map. It
fills exactly the gap that made CHI/NYG/NYJ awkward — a for-dark mark where
upstream publishes none.

It is a derivation, not the club's official reversed artwork, and will differ in
small details from what a network airs. Fine for our surfaces; never describe it
as the official mark.

### It does NOT generalise — measured, then reviewed

A naive "largest painted area becomes white, darkest other tone becomes the
keyline" was run against all 32 committed SVGs and rendered on a dark card
(2026-09-20). Two numbers that disagree, which is the point:

- **31 of 32 pass the structural test** (no gradients, no embedded raster, two or
  more meaningful tones). CHI is the sole structural failure: one fill, 69% of
  the mark — a true silhouette with nothing to swap against.
- **Only about a third render acceptably.** Seven come back visually unchanged
  (SEA, SF, NO, NE, JAX, NYG, NYJ), and GB and TEN are destroyed outright,
  reduced to a blank white oval and a blank circle because the swap ate the only
  tone carrying the mark.

The structural test narrows candidates; a rendered before/after decides. Same
discipline as `KEEP_COMMITTED` and the drift gate in `download-nfl-logos.mjs`.

### The reversals we are keeping

Reviewed on a dark render and on club colour, 2026-09-20. **Three**, not the ten
the mechanical pass nominated:

| Club | from | to | note |
|---|---|---|---|
| ARI | body `#97233f`, keyline `#000000`, beak `#ffb612` | `#ffffff`, `#97233f`, `#e2571b` | matches the broadcast cut |
| DET | body `#0076b6`, keyline `#b0b7bc` | `#ffffff`, `#0076b6` | a clean white lion |
| WSH | body `#5a1414`, keyline `#ffb612` | `#ffb612`, `#5a1414` | **gold, not white** |

ATL, BUF, CLE, HOU, LV and TB rendered acceptably and were **declined on
review** — recorded here so nobody re-derives them and assumes the omission was
an oversight.

Arizona's keyline is the club primary `#97233f`, not a brighter red. Sampling the
outline in the broadcast photograph returned `#882830` as its cleanest red, which
sits in the club-primary family rather than near a true red like `#c8102e` — and
a photograph of a television carries enough colour cast that it is corroboration,
not a match. A brighter red was rendered alongside and looked good; club red
was chosen on review (2026-09-20), and it is one value in the map.

**The reversal target is not always white.** Washington's W goes to *gold* with a
burgundy keyline — a straight swap of the club's two colours. Treating "reversed"
as a synonym for "knocked out to white" would have produced a white W nobody
asked for. The rule is: the body takes the club's other colour, whichever reads
on a dark ground.

### Where a reversed mark is NOT the answer

A single-colour silhouette cannot be reversed — it can only be knocked out
whole, and ESPN already publishes that as `primaryWhite` (the `whiteKnockout`
id). Use that for silhouettes; use `reversed` for two-tone marks. Chicago is the
worked example: it cannot be reversed, and it does not need to be, because
NFL.com already gives it a real for-dark mark (the bear head).

## Phase 1 — club defaults — SHIPPED

Entirely a dark-pipeline change, as predicted: no committed light SVG moved and
`download-nfl-logos.mjs` was not touched. What landed:

- `src/data/nfl-mark-assignments.json` — the three deviations, defaults
  unchanged.
- `scripts/lib/nfl-mark-sources.mjs` — `MARK_SOURCES`, `assignedMark`,
  `resolveMark`. Throws on an unknown id rather than falling back.
- `scripts/lib/dark-logo-mirror.mjs` — `isValidSvg`/`isValidAsset`, a per-item
  `format`, and an optional `transform`. `formats` is written to the manifest
  ONLY for non-PNG cuts, so the college mirror's manifest is byte-identical
  (pinned by test).
- `scripts/fetch-nfl-dark-logos.mjs` — resolves each club's assigned dark mark,
  and runs SVG cuts through `optimizeAndTrimSvg` so a theme swap does not change
  the mark's rendered size.
- `src/utils/nfl-logo-dark-css.ts` — extension from the manifest, never assumed.
- `tests/nfl-mark-assignments.test.ts`, plus the files added to the `nfl-logos`
  path-guard domain.

Verified: all 32 mirror cleanly, CHI and NYG land as trimmed SVG, and the built
stylesheet emits `url(".../CHI.svg")` alongside `url(".../ARI.png")`.

The original plan for this phase follows, for the record.

### 1. `src/data/nfl-mark-assignments.json` (new, committed)

Deviations only; a club with no entry keeps today's behaviour.

```json
{
  "defaults": { "light": "primary", "dark": "espnDark" },
  "clubs": {
    "CHI": { "dark": "nflcom" },
    "NYG": { "dark": "nflcom" },
    "NYJ": { "dark": "altDark" }
  }
}
```

No `generatedAt` or any run-clock field: every commit to `main` is a production
build (CLAUDE.md § cron cadence), so a timestamp would make each regeneration a
deploy. Keys sorted, so an unchanged file re-serializes byte-identically.

### 2. `scripts/lib/nfl-mark-sources.mjs` (new)

One place that answers "what URL and what format is mark `X` for club `Y`",
reading `nfl-brand-kit.json`. Shared by the mirror and by any tooling, so the
mark table has one copy — the same reason `KEEP_COMMITTED` already moved into
`scripts/lib/nfl-logo-sources.mjs`.

### 3. `scripts/fetch-nfl-dark-logos.mjs` + `scripts/lib/dark-logo-mirror.mjs`

The mirror is PNG-only in two places, and both must become format-aware:

- `isValidPng()` checks PNG magic bytes and a 1 KiB floor. An SVG has neither.
  It becomes a per-format validator — SVG validated as "parses as an `<svg>`
  root and is over ~200 bytes", so a CDN error page saved as `.svg` still fails.
- The output filename is hardcoded `${key}.png`.

The manifest must then carry the **format**, not just the code, because
`resolveNflDarkLogoUrl()` builds `${darkBasePath}/${canonicalCode}.png` from the
code alone. Extend it without breaking the existing contract:

```json
{ "codes": ["ARI", "..."], "formats": { "CHI": "svg", "NYG": "svg" } }
```

`codes` keeps its present meaning (what the build actually has on disk, the
safety contract that lets the CSS emit a local path). `formats` is additive and
defaults to `png` when a code is absent, so the committed `{"codes": []}` default
and every existing reader keep working.

### 4. `src/utils/nfl-logo-dark-css.ts`

`resolveNflDarkLogoUrl()` takes the extension from the manifest instead of
assuming `.png`. Nothing else changes: `buildNflLogoDarkCss()` still emits one
`html.dark img[src="<light>"] { content: url("<dark>"); }` per canonical code and
per legacy alias, and `content: url()` renders an SVG exactly as it renders a
PNG.

Two existing behaviours to preserve deliberately:

- **The CDN fallback.** A code missing from the manifest falls back to ESPN's
  `500-dark` URL. For a club assigned `nflcom`, that fallback is the *wrong
  artwork*, not merely a remote one. Prefer falling back to the club's assigned
  ESPN treatment where one exists, and accept ESPN `500-dark` only as the last
  resort — a correct-ish mark beats a broken image, which is the rule the
  fallback exists for.
- **`NFL_DARK_STROKE_CODES`.** Only `CAR` is ringed, and none of the three clubs
  here are. But the ring is keyed on the *light* srcs and composes with the
  swap, so changing a club's dark mark can change whether it needs a ring.
  Re-render the three dark cuts on `#1e1e1e` at 16px before shipping; do not
  assume.

## Phase 2 — SHIPPED, but not as planned

**The premise was wrong.** This phase was specified as three per-surface
overrides for the Jets, and two of the three surfaces do not exist:

- **Nav club switcher** renders `team.iconUrl` — the FRANCHISE crest, not an NFL
  club mark. `--nav-team-logo-size` named a fantasy-team logo all along.
- **Club-colour band** has no implementation. No app surface paints club colour
  behind an NFL mark; that band existed only in the mockup used to choose the
  assignments.
- **Broadcast card** exists, but renders the LIGHT src and leans on the global
  swap, so there was no per-surface src to override.

Per-surface overrides therefore had nowhere to attach. Investigating why
surfaced a real defect instead, and that is what shipped.

### The defect: an always-dark surface cannot use a themed swap

The dark swap is emitted as `html.dark img[src="…"] { content: url(…) }`. That is
right for a surface following the viewer's theme, and wrong for one that is dark
in BOTH themes. Two are:

- the live broadcast board — `live-broadcast.css`: *"This surface is dark in
  BOTH themes … no `html.dark` override exists or is wanted."*
- the Sunday Ticket multiview — `sunday-ticket.css`: *"near-black in both
  themes."*

For a **light-theme** viewer neither fires the swap, so both rendered the LIGHT
mark on a near-black ground — the dissolving case the whole dark pipeline exists
to prevent, and a bug for all 32 clubs rather than the one the phase was scoped
to.

Three surfaces were already correct: `BroadcastFace.tsx`, `MomentTakeover.tsx`
and `draft-broadcast.ts` call `resolveNflDarkLogoUrl()` and ship the result as
`src`. Phase 1 reached those for free — they picked up the per-club assignment
with no change.

### What shipped

`nflLogoUrl(team, ground)` in `src/utils/live/nfl-logo-url.ts` — already "the one
answer" for the live kit — now takes a ground. `'dark'` resolves the cut
directly, theme independently, and inherits the per-club assignment because
`resolveNflDarkLogoUrl` is where that already resolves.

It falls back to the LIGHT local path, never the ESPN CDN, when a build has no
mirror (dev, test, Storybook's empty manifest). Shipping a CDN URL as a `src` is
the cross-origin fetch that module exists to avoid — it is what made ESPN weather
rather than a code change fail a Chromatic build — and the light mark on a dark
ground is only today's behaviour, so the fallback is never a regression.

Applied to `BroadcastPlayerStrip.tsx` (which also loses its private copy of the
helper), `SundayTicketBox.astro` and `SundayTicketBoard.astro`.

Also fixed a latent bug of the class phase 1 removed: the white-ring rule built
its dark keys as `${base}/${code}.png`, hardcoded. A stroked club whose dark cut
became SVG would have keyed the ring on a file that is never rendered, and the
ring would have silently stopped reaching exactly the surfaces it was written
for. `CAR` is PNG today, so it was latent — which is when it is cheap.

Verified against a real mirrored build: CHI and NYG resolve to
`/assets/nfl-logos/dark/*.svg`, NYJ and ARI to `*.png`, and the light ground is
unchanged. Guard: `tests/nfl-mark-assignments.test.ts` names the always-dark
surfaces, so a new one is a deliberate addition rather than a silently
theme-dependent one.

### Still open

Per-surface overrides remain unimplemented **because nothing needs them**. The
Jets' three overrides in the editor point at two surfaces that do not exist and
one that the ground rule now handles. If a real surface ever wants a mark
different from its club's ground assignment, the mechanism to build is the one
sketched below.

## The Brand Book — SHIPPED

### It answers at the root too, for the shared host

`mfl.football` is deliberately not a second front door for a league with its own
apex — `resolveSharedHostHiddenLeague` 404s `/theleague/*` and `/afl-fantasy/*`
there, because a league reachable at two addresses is two sets of links and two
places to stay signed in. So the shared host cannot link into a league's brand
page; it gets its own route at `/brand`, which is the honest path anyway since
NFL club marks belong to no league.

`leagueSlug` is therefore OPTIONAL on both components. Without it they render in
`MflAppLayout` (TheLeagueLayout wears one league's crest, nav and manifest) and
drop the roster panel — the only league-specific thing on the page, which is
what makes a neutral copy possible instead of a fork. On a league apex the
middleware rewrites `/brand` → `/<slug>/brand` before it reaches the root route,
so `theleague.us/brand` still serves the league copy with its rosters.


`/<league>/brand` (index) and `/<league>/brand/<code>` (32 clubs), public, both
leagues, one shared component per route shape. It is the page this plan kept
being explained on a whiteboard: every cut on file for a club, which one each
GROUND draws, the real app surfaces that draw it, and who in the league rosters
that club's players.

### Why it reads the same files the build reads

`src/utils/nfl-marks.ts` resolves a ground through `nfl-mark-assignments.json`
and `nfl-brand-kit.json` — the same two files `scripts/lib/nfl-mark-sources.mjs`
reads — rather than restating the assignments. A reference page that could
disagree with the build is worse than no reference page.
`tests/nfl-marks-page-data.test.ts` pins the two mark-id tables equal and the
per-club, per-ground resolution identical, because two tables in two languages
is exactly the shape that drifts in silence.

### Two things it must do that no other page does

**1. A ground previews the MIRRORED file, not the catalog URL.** The catalog
says where a cut came FROM (ESPN's CDN, NFL.com, nflverse); a ground says what
this site SERVES. `shippedUrl()` returns the same answer
`resolveNflDarkLogoUrl` gives the swap CSS, extension and all, so with a
populated mirror the previews are same-origin and with the committed empty
manifest they degrade to the catalog URL rather than to a local path that 404s.

**2. Both pages opt OUT of the global dark swap.** `buildNflLogoDarkCss` emits
`html.dark img[src="<light src>"] { content: url(<dark cut>) }` for every light
src the site can render. Everywhere else that is the point. Here it is fatal:
this page's whole job is showing cuts SIDE BY SIDE, each pane painting its own
ground rather than the viewer's theme — so for a dark-mode reader the light
pane, the "Light surfaces" ground card, and the Primary and ESPN-light entries
in the filmstrip would every one render the DARK cut, and the comparison would
show one mark twice. The opt-out is `content: normal !important`; the
`!important` is load-bearing, because the swap rule's specificity matches the
opt-out's and load order between the layout head and a scoped component style
is not something to rely on.

### The band is still derived

`bandSlot(code)` reads the club colour's luminance (> 0.42 → the light slot).
The hero, the index tile and the band preview all go through it, so the "three
grounds, not two" rule is demonstrated 32 times rather than asserted once — and
a threshold nudge moves every one of them together instead of leaving a stored
table half-updated.

### The hero is the real hero shell

`CompositeHero` — the live shell every composite on both homepages renders
through — takes this club's mark as its CREST WATERMARK and the club's own
colours as the card. It is the surface that answers where a mark ends up
BIGGEST: a hero paints it at ~300px behind the copy, which is where a cut that
survives 16px can still fall apart.

Two props, and the difference matters. `accent` paints a PHASE gradient and
`glowColor` is only a faint radial over it, so a gold club came out blue with a
gold crest on it. The club belongs in `franchise`, via
`resolveHeroFranchiseBackdrop` — the prop's own docblock says it is for "a hero
that is about a TEAM rather than about the league" — which also floors the pair
for white text and clears the accent, pill and CTA inks against the gradient
that is actually rendered, per band. A hand-built gradient skips all of that.

The crest takes the BAND ground's cut: a hero's gradient is dark in both
themes, the same reason `hero-franchise-backdrop.ts` resolves a franchise crest
server-side rather than leaving it to the `html.dark` swap.

`ShowcasePage.astro` had already established that a fixture can drive the live
shell, and records what happened the three times a gallery reproduced the
treatment inline instead — the crest watermark never appeared at all.

### League context

`src/utils/nfl-club-rosters.ts` answers "who rosters Bears". Franchise names
come from the MFL `league.json` feed, never `theleague.config.json` — a page
that exists in both leagues cannot read one league's config file. Ownership is
a LIST (`getOwnersByPlayer`, `activeOnly: false`): an AFL player is routinely
rostered in both conferences, and the question here is ownership rather than
startability, so a taxi-squad Bear counts. A feed it cannot read is an empty
panel, never a broken page.

## Phase 3 — the reversed cut — SHIPPED

`src/data/nfl-mark-reversals.json` (the curated map above),
`scripts/lib/nfl-mark-reversal.mjs` (the swap) and
`scripts/derive-nfl-reversed-marks.mjs` (`--check` for the guard) write
`public/assets/nfl-logos/reversed/{ARI,DET,WSH}.svg`. `reversed` is a mark id
on both sides now, and the Brand Book badges it **made here** — it is the one
cut in this repo we draw rather than fetch.

**Committed, not mirrored.** The dark cuts are fetched from a CDN, gitignored
and tracked by a manifest; these are derived from committed art, so they belong
in the diff where a human can look at them — the same reason the light SVGs are
committed rather than built. That is also why the script is run by hand
alongside `download-nfl-logos.mjs` rather than added to prebuild.

Three things the implementation had to get right:

- **An absent source colour throws.** A logo refresh that moves one fill would
  otherwise make the swap a no-op, shipping the light mark under a "reversed"
  label with nothing to notice it by. `tests/nfl-mark-reversals.test.ts` pins
  the throw, and pins every `from` colour still present in the committed art.
- **The swap is simultaneous.** Washington's map EXCHANGES its two colours;
  applied in sequence the first pass paints every burgundy gold and the second
  paints all of it — original and just-made alike — burgundy, leaving a
  single-colour blob.
- **Detroit needs its detail layer in the map.** The mane, face and leg lines
  are a separate white layer OVER the blue body, so reversing the body alone
  merged them into it and flattened the lion to a blank silhouette. The detail
  takes Honolulu blue, exactly inverting the light mark. This was caught on the
  render, not in review of the map — which is the argument for rendering every
  one of these before calling it done.

Shorthand hex is normalized both ways (`#000` ↔ `#000000`); ARI's keyline is
exactly that case and a raw string compare misses it.

**Not assigned to any ground.** The three cuts exist and are visible; which
club draws one on which ground is still an edit to `nfl-mark-assignments.json`,
and `darkItems()` will refuse a `reversed` assignment until the mirror learns to
COPY a committed file rather than fetch a URL. Deliberate: making the art and
changing what ships are two decisions.

### Phase 3 — the original plan

Only once phases 1 and 2 have settled, and only for clubs whose reversal was
eyeballed on a dark render:

1. `src/data/nfl-mark-reversals.json` — the curated per-club colour map above.
2. A derivation step (prebuild or the same manual script that commits the light
   art) writing `/assets/nfl-logos/reversed/{CODE}.svg`, and adding the code to
   the dark manifest so `resolveNflDarkLogoUrl` can point at it. Phase 1's
   format-aware manifest is a prerequisite: these are SVG.
3. A guard that every club in the reversal map still has the `from` colours
   present in its committed SVG. A logo refresh that changes a fill silently
   turns the reversal into a no-op or a mess, and that must fail the build.

**Do not build phase 2 until phase 1 has shipped and settled.** It serves one
club and three surfaces; if the Jets' default proves fine in practice, it may
never be needed.

## Guards

- Extend `tests/nfl-brand-kit-data.test.ts`, or add
  `tests/nfl-mark-assignments.test.ts`: every club key is a canonical code from
  `getAllNFLTeamCodes()`, every mark id exists in `MARK_SOURCES`, and every id a
  club names actually resolves to a URL in `nfl-brand-kit.json`. A typo'd mark id
  must fail the build, not fall back silently.
- Pin the **club-colour ground rule** with a test over all 32 clubs: the derived
  slot matches the luminance of `colors[0]`. It is a rule, and a rule with no
  test is prose.
- The manifest's new `formats` field: assert a code listed there is also in
  `codes`, and that a missing entry reads as `png`.
- `tests/nfl-logo-assets.test.ts` is unchanged and must stay green — phase 1
  touches no committed light SVG.
- Add the new files to the `nfl-logos` path-guard domain in
  `.claude/hooks/path-guard.json`.

## Deliberately not doing

- **Switching any club's light mark.** All three chose `primary`. Nothing forces
  a raster file into the SVG-only light pipeline, which keeps
  `tests/nfl-logo-assets.test.ts` and every hardcoded `.svg` call site untouched.
- **A whole-set source switch** (all-ESPN / all-NFL.com). ESPN is PNG-only and
  6× the weight of the SVG set; that comparison is recorded separately and is
  not what this plan implements.
- **Per-club light overrides on small surfaces.** No club asked for one, and the
  legibility work showed the light default is the safe ground.
- **AFL scoping.** These are NFL club marks, shared by both leagues; the
  assignments are league-neutral and need no registry entry. Confirm before
  shipping if any AFL surface renders marks differently.

## Open questions

1. **Vector dark for the other 29 clubs.** Once the mirror can carry SVG,
   NFL.com's cut is vector for every club. Whether to prefer it over the ESPN
   PNG generally is a separate decision — it is the *right* artwork for only some
   clubs, and this plan does not settle it.
2. **The white knockout.** `espn.primaryWhite` is a clean white mark with no
   keyline — the right asset for a single-colour silhouette on a dark or
   club-colour ground, where `reversed` cannot help. Not assigned to anyone yet;
   worth a pass over the 32 bands once phase 1 lands.
3. **Whether three is the final list.** ARI, DET and WSH are decided. Six more
   rendered acceptably and were declined; if a surface later wants one, the map
   is the only edit.
