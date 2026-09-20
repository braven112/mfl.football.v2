# Per-club NFL mark assignments

**Status:** planned, not started. Decisions made 2026-09-20 against the live
artwork; nothing in `src/` has changed yet.

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

ESPN publishes no SVG at any path (verified: every variant 404s), so `nflcom` is
the only vector option beyond the committed primary. That is why two clubs chose
it for dark.

## Phase 1 — club defaults

Entirely a dark-pipeline change. Three files plus data.

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

## Phase 2 — per-surface, NYJ only

Only three surfaces, and two of them need no CSS at all.

**Always-dark surfaces** (broadcast card, club-colour band) already ship the dark
cut as `src` directly rather than relying on the theme swap — the rules doc calls
this out for the draft broadcast and Sunday Ticket multi-view. So the override is
just: ask a resolver for the src instead of hardcoding one.

```ts
teamMarkSrc(code, { surface: 'broadcast', ground: 'dark' })
```

**The nav override is the only CSS case.** The nav renders a light src that the
global swap would replace with the club default in dark mode. Two options:

1. The nav component asks `teamMarkSrc` for its own src and opts out of the
   global rule. Preferred — no specificity fight, and it matches how the
   always-dark surfaces already work.
2. A scoped rule (`html.dark .nav-club img[src="X"] { content: url(Z) }`). It
   wins on specificity over the unscoped swap, but it adds a rule per surface
   per club and fights the deliberately-zero-specificity `:where()` design the
   ring rules use.

Take option 1 unless a surface cannot choose its own src.

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
   keyline — arguably the correct asset for any club-colour band. Not assigned to
   anyone yet; worth a pass over the 32 bands once phase 1 lands.
