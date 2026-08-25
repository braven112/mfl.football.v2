# Design System Insights

<!-- CURATED-HEAD -->
> **Read this head, then stop.** Everything below `/CURATED-HEAD` is a dated
> archive (~130 KB, 50 entries) — do NOT read it start-to-finish. Grep it for
> your topic: `grep -n "focus ring" docs/claude/insights/domains/design-system.md`.
>
> The repo-wide rule ("every `var(--x)` must reference a token that exists") is
> in `docs/claude/rules/theming-and-assets.md`. This head is the part the guard
> tests **cannot** see.

## Four ways a token fails — only the first is caught

| Failure | Symptom | Guard? |
|---|---|---|
| Defined nowhere | Hardcoded fallback renders in BOTH themes | **Yes** |
| Defined light-only | Light value renders in dark mode | No |
| Ink tokenized, surface hardcoded | Inverted ink on a fixed light surface — worst contrast of all | No |
| Defined and valid, value rejected *for that property* | Property resets to its **initial** value | No |

The last one is the nastiest: `background: var(--x)` where `--x` holds a
gradient is all-or-nothing — if it fails to substitute, `background` falls to
`transparent`, not to the previous cascade winner. Split it:
`background-color: <literal mid-stop>` + `background-image: var(--x)`, in every
theme block. `tests/hero-gradient-surface-fallback.test.ts` enforces this.

The "half-tokenized" row has a grep-able tell: `var(--color-` and a raw `#fff`
in the same style block. Light mode looks pixel-perfect, so it ships and stays.

## The gray ramp inverts — both directions

`tokens-dark.css` flips the whole scale. `--color-gray-50..300` are **surfaces**
in dark, not text (`gray-700` is the readable muted gray). And `--color-gray-900`
resolves to near-**white** under `html.dark` — so a "dark broadcast panel"
painted with it turns white at night. **A surface that must stay dark in both
themes takes a literal** (`#111827`), never a gray token.

## Don't fix a token that has other consumers

- **Never remap `--color-primary` per league** to correct heading color — it also
  feeds every primary fill and the nav's active pill. Headings come from the
  `--link-color` family; override that instead.
- `--card-bg` is a **gradient** in dark — never paint form fields with it
  (`--input-bg` is the solid one).
- Trace a bad dark value to *every* consumer before overriding. The fix belongs
  on the token only the broken consumer reads, never on a shared primitive.

## League leakage the guard can't see

`--color-secondary` is TheLeague's brand green and **genuinely resolves on AFL
pages** — a real token with real values in both themes, so "token exists" passes
while the page wears the wrong league's identity. It mostly lives in **shared
chrome**, not the AFL tree, and travels under aliases that don't contain the
word: `--secondary-color`, `--accent-link-hover-text-color`. Chase the alias
chain to a literal, and grep the raw hex too (`#2e8743`) — a hardcoded gradient
has no `var()` to find. In a *shared* stylesheet, scope an
`html[data-league='afl']` override rather than swapping the token; TheLeague's
green is correct on TheLeague. `tests/afl-brand-green-guard.test.ts`.

Treat a token only ONE theme block overrides as half-defined. `--color-surface-3`
is dark-only (no `:root` value) — safe only inside a `:global(html.dark)` block.
**AFL dark collapses the elevation ramp** (`--card-bg`/`--card-surface`/
`--content-bg`/`--color-surface-2` are all `#16283c`), so nested surfaces need
`--color-surface-3`. Test nested surfaces on the AFL palette, not TheLeague's.

## Franchise color has three separate roles

- `color` (config) — the **chart** color, chosen for distinctness on a bar graph.
  Do not repurpose it as brand identity. It is picked to sit apart from fifteen
  other lines, so it can name a hue the franchise does not wear at all: Vitside
  Mafia is black-and-red and its `color` is **pink**. The player modal band
  anchored on this field and shipped that pink; an owner reported it (Aug 2026).
- `colorPrimary`/`Secondary`/… — brand colors, correct for a **fill** with text
  on top.
- `teamAccentVar(fid)` → `--team-accent-<fid>` — the only correct source for a
  **foreground** (text, numerals, borders, chart lines, swatches). It guarantees
  3:1, but **only against `--card-surface`**. Put the mark on a custom chip or a
  tinted well and the floor silently stops applying — that's a bug neither
  `design-token-guard` nor `team-accent-css` can see. When the color isn't yours
  to choose, give the mark a hairline ring in the surface's own ink.

## `--league-accent` is LIGHT in dark mode — white ink on it fails AA

The accent flips brightness with the theme: `#1c497c` / `#c41e3a` in light, but
`#3b82f6` (TheLeague) / `#ef5350` (AFL) / `#34d399` (bb1) in dark. So the
reflex pairing — white text on an accent fill, correct in light at 9.2:1 and
5.8:1 — measures **3.68:1**, **3.49:1** and **1.92:1** in dark, all under the
4.5:1 floor. Nothing catches it: the token exists, resolves, and is defined in
both themes, so `design-token-guard` passes and light mode looks perfect.

Any filled accent chip (an active tab, a current-page pill, a selected state)
needs `:global(html.dark) … { color: #0b1220; }` — dark ink on the same fill
clears 5.09:1 / 5.37:1. And note 14px/700 is NOT large text; that floor is
18.66px bold, so the 3:1 large-text allowance does not apply to a chip label.

Measure the computed values in a real browser rather than reading the token —
the accent is aliased through `--color-primary` on TheLeague and only pinned
directly on AFL, so the source does not tell you the shipped colour.

## Smaller traps, each of which cost a session

- **An inline `style` beats every `html.dark` rule.** JS-built markup carrying
  `style="color:#059669"` cannot be fixed from a stylesheet — move it to a class.
- A bare `html.dark { }` inside a **scoped** Astro `<style>` gets scoped and dies
  (a `:root { }` in the same block does not). Use
  `:global(html.dark) .wrapper { --token: … }`.
- **Elevation belongs to the element that owns the surface.** `box-shadow` only
  on something that also has a background and a `border-radius`; a layout-only
  wrapper draws a sharp rectangle instead. Dark shadows are ~6x heavier than
  light, so a "dark-mode-only" shadow bug is usually just a shadow bug.
- **Focus ≠ selected.** `--box-shadow-focus-ring` is alpha-blended, and alpha is
  not a shade — it composites to gray-blue. Selected states take an opaque
  `--color-primary` border plus a 12% `color-mix` tint.
- **Inverse surfaces** (a dark panel on a light page) need their own scoped
  `:focus-visible` — the global ring is `--color-primary`, which *is* the
  footer's background at 1.00:1. Define their tokens once, with no dark pair.
- `var()` does not resolve in an SVG **presentation attribute** —
  `el.style.stroke = 'var(--x)'` works, `setAttribute('stroke', …)` renders nothing.

## Measuring

Set the browser's color scheme and reload — **do not** toggle `html.dark`; on an
`auto` preference the pane's own scheme wins and you get plausible, wrong
numbers. For SVG ink use an alpha bounding box over rendered pixels: `getBBox()`
excludes stroke, and the halo on every `-dark` badge *is* a stroke.
<!-- /CURATED-HEAD -->

---

## 2026-08-21 - A Surface That Renders Team Accents Must BE the Card Surface

**Context:** An owner reported the Owner Activity chart's hover readout
unreadable in dark mode — white text on a near-white box. Immediate cause was
the ramp-inversion trap already documented below (2026-07-05): the tooltip
asked for `--color-gray-900` + `--color-white`, and `gray-900` resolves to
`#ededed` under `html.dark`. That half is old news. The part worth keeping is
what the *correct* replacement turned out to be, and why "any theme-aware
pair" was not good enough.

**Insight:** `getTeamAccentPair` (`src/utils/team-colors.ts`) forces every
`--team-accent-<fid>` to clear 3:1 against **one specific value per theme** —
`LIGHT_CARD_SURFACE` (`#ffffff`) and `DARK_CARD_SURFACE` (`#262626`
TheLeague / `#16283c` AFL). That guarantee is anchored to `--card-surface` and
travels nowhere else. So any container that renders team-accent marks — legend
swatches, tooltip dots, chart keys, a colored rank numeral — inherits the
guarantee only if its own background IS `--card-surface`. Put those marks on a
custom chip, a tinted well, or a "dark panel" and the contrast floor silently
stops applying, even though nothing about the accent token changed.

The activity tooltip proved both directions of this at once. In dark mode it
was the ink that failed (the ramp flip). In **light** mode it had been failing
the whole time in a way nobody filed: the near-black franchise accents (Bring
The Pain, Cowboy Up) were black dots on a `#111827` chip — invisible, on the
theme everyone looks at. One wrong surface, two themes, two different bugs,
and the light one was the older of the two.

**The other half, learned the hard way in review:** "paint it `--card-surface`"
is *necessary but not sufficient* — the mark's color must also come from
`teamAccentVar`, and on the two activity pages only ONE of them does.
`theleague/activity.astro` passes `teamAccentVar(...)`;
`afl-fantasy/activity.astro` passes a hand-written 24-entry `CHART_PALETTE`
of raw hexes, because AFL franchises carry no config `color` and their derived
accents collapse to **20 distinct values for 24 teams** (three resolve to
`#181818`, three to `#8b8f93`) — unusable as 24 chart lines. So do NOT
"fix" that page by switching it to accent tokens; the palette is deliberate,
and distinctness is the constraint it solves for. Its cost is that 8 of those
24 fall under 3:1 on white and a *different* 8 fall under it on the AFL's navy
card — no flat surface satisfies both halves.

**When the palette can't be fixed, give the mark an edge.** A hairline ring in
the surface's own ink — `box-shadow: 0 0 0 1px color-mix(in srgb,
var(--page-text) 40%, transparent)` — keeps a swatch's SHAPE readable at any
fill contrast, in both themes and both leagues, and costs nothing when the
fill already passes. Right answer whenever the color is not yours to choose.

**Rule:** a floating surface that carries franchise color should be
`background: var(--card-surface)` + `color: var(--page-text)`, elevated with a
`0 0 0 1px var(--card-border)` ring and `var(--shadow-lg)` rather than by being
a different color. You get theme-correctness and the accent contrast floor from
the same decision. Reach for `--nav-tooltip-bg`/`--nav-tooltip-text` (a real,
theme-aware tooltip pair that exists in both token files) only for tooltips
carrying **no** team color — it is an elevated surface, not the card surface,
so the 3:1 floor does not cover it.

**Why the guard tests didn't catch it:** `design-token-guard` only asks whether
a referenced token is *defined* somewhere, and `--color-gray-900` is very much
defined. `team-accent-css` only asks whether each accent clears 3:1 against the
card surface, which it does — the accents were fine, the surface underneath
them was not. Neither test can see a mark and its background land on different
surfaces. That pairing is still eyes-only; screenshot both themes.

---

## 2026-08-18 - A Gradient in a Custom Property Makes `background` All-or-Nothing

**Context:** An owner reported the homepage kickoff hero rendering with no
background on mobile — white headline, white summary, light-blue countdown,
all sitting on the bare gray page, in light mode and then dark. Every other
rule in the same block was clearly applying: the pill, the flex footer, the
white CTA, the 40%-opacity model image. Only the surface was missing.

**Insight:** The composite heroes each declare their background as a custom
property and paint it with one shorthand:

```css
--psh-surface: linear-gradient(115deg, #2563eb, #1c497c 55%, #0f3057);
background: var(--psh-surface);
```

`var()` substitutes at **computed-value time**, and the spec's rule there is
brutal: if the substituted value isn't valid for the property, the declaration
is *invalid at computed-value time* and falls back to the property's **initial
value** — not to the previous cascade winner, and not to a partial application.
For `background` that initial value is `transparent`.

So a token that fails takes the whole surface with it, while its neighbours in
the same rule survive. That's why the failure doesn't degrade into "a plain
hero" — it degrades into white ink on nothing, which is the *unreadable*
outcome. This is a distinct mechanism from the two already documented:

| Failure | Symptom | Caught by the guard? |
|---|---|---|
| Token defined nowhere | Hardcoded fallback renders in BOTH themes | Yes |
| Token defined light-only | Light value renders in dark mode | No |
| Token **defined and valid**, value rejected for the property | Property resets to its INITIAL value | No |

The guard tests can't see the third one: the token exists, the syntax parses,
and nothing is wrong in the source text.

**Evidence:** `src/components/theleague/PreseasonCompositeHero.astro` and seven
sibling heroes; the shipped stylesheet and markup both verified correct in
headless Chromium at the reporter's viewport, which is what ruled the CSS
itself out and pointed at value resolution on the device.

**Recommendation:** Never let a var-carried gradient be the only thing painting
a surface that has ink designed for it. Split the shorthand:

```css
background-color: #1c497c;              /* LITERAL — cannot be dropped */
background-image: var(--psh-surface);   /* the gradient, when it resolves */
```

Pick the literal from the gradient's own mid stop so the fallback reads as the
same panel, and add it to every theme/variant block that redefines the surface
— otherwise one theme silently loses the net.
`tests/hero-gradient-surface-fallback.test.ts` enforces both halves. The same
reasoning applies to any all-or-nothing shorthand fed by a token: `background`,
`border`, `font`, `grid-template`. A token holding a plain color is far less
exposed, because a color that fails usually fails at parse time in the
stylesheet rather than at substitution.

---

## 2026-08-17 - An Elevation Shadow Belongs to the Element That Owns the Surface

**Context:** `/afl-fantasy/playoffs` rendered a hard, square-cornered dark halo
around each bracket block in dark mode — the owner read it as a "double shadow
on the brackets and then the card." `.bracket-card` was
`display: grid` + `box-shadow: var(--box-shadow-lg)`, nested inside
`.brackets-grid`, which is the actual card (background, `border-radius: 1rem`,
padding, its own `--box-shadow-lg`).

**Insight:** A `box-shadow` is painted around the element's *border box*, which
exists whether or not the element has a background or a `border-radius`. So an
elevation shadow on a surfaceless nested element does not read as "slightly
raised" — it draws a **sharp rectangle** on the surface it is already sitting
on, and the parent card's own shadow is right there next to it, which is what
makes it read as doubled rather than merely wrong.

The rule that prevents it: **elevation is a property of a surface.** Only give
`box-shadow: var(--box-shadow-*)` to an element that also has a background and
a `border-radius`. A layout-only wrapper (`display: grid`/`flex`, no paint)
inherits its elevation from the card it lives in and must not restate it.

**Why dark mode surfaces it first (and why light mode is not proof):** the
shadow tokens are not the same in the two themes. `tokens-dark.css` sets
`--shadow-color: 0deg 0% 0%` (pure black) at alphas of 0.2–0.4 on `--shadow-lg`;
light mode uses a tinted `220deg 3% 15%` at 0.03–0.06. That is deliberate — dark
surfaces swallow low-alpha shadows — but it means the same rule renders roughly
**six times** heavier at night. So the identical square halo was present in both
themes all along; light mode just rendered it faintly enough to pass for a
deliberate divider. **A shadow bug reported as "dark mode only" is usually a
shadow bug, not a dark-mode bug** — check the light theme before concluding the
`html.dark` block is at fault.

Note the multiplier if you go looking: the comment above those tokens in
`tokens-dark.css` says "roughly 2.5x the light-mode opacity", and that number is
wrong — the committed values work out to ~6.5x on `--shadow-lg` and ~5.6–7x on
`--shadow-md`. Harmless (nothing computes off the comment), but don't quote it.

**Related trap in the same file, correct as-is:** `:global(html.dark)
.brackets-grid` overrides the shadow to
`0 0 0 1px var(--content-border), var(--box-shadow-lg)` — a border ring stacked
on the elevation, because at night the shadow alone can't separate the card from
the page background. That is a legitimate nested-shadow pair on an element that
*does* own a surface. Don't "deduplicate" it while removing a real double
shadow.

**Cross-league check paid off here:** TheLeague's sibling page
(`src/pages/theleague/playoffs.astro`) has the same `.bracket-card` /
`.brackets-grid` structure and has always been shadow-free on the inner block,
so the AFL page was the drifted copy. On the two-league page pairs, diffing the
sibling's rule is usually faster than reasoning about the CSS from scratch —
and it tells you which side is the bug.

---

## 2026-08-15 - `--box-shadow-focus-ring` Is a FOCUS Affordance; Using It for SELECTED Ships a Duller Blue

**Context:** The roster page's team-crest drawer marked the active team with
`box-shadow: var(--box-shadow-focus-ring)`, while the two other selected-state
controls on the same card — `.view-tab[data-active]` and `.mode-btn.active` —
both drew a solid `--color-primary` ring. The owner reported the crest's blue
"doesn't match the other buttons." All three resolve from the *same* dark-mode
blue (`#3b82f6`), which is exactly why the mismatch was easy to ship and hard
to explain.

**Insight:** the focus-ring token is alpha-blended, and alpha is not a shade —
it is a different color once it composites.

`--box-shadow-focus-ring` is a thin alias — `tokens.css` and `tokens-dark.css`
both define it as `var(--shadow-focus-ring)`, which holds the actual value.
Call sites use the `--box-shadow-` name; the raw value lives on the shorter one.

| Token | Dark value | Composited over the `#21232a` card |
|---|---|---|
| `--color-primary` | `#3b82f6` | `#3b82f6` — full-strength blue |
| `--box-shadow-focus-ring` → `--shadow-focus-ring` | `0 0 0 3px rgba(59,130,246,0.4)` | ~`#2c4a70` — reads gray-blue |

At 40% over a dark surface the ring loses most of its chroma, so it looks like
a shadow rather than a decision. Light mode has the same problem from the other
direction (`rgba(28,73,124,0.25)` over white washes to a pale slate). So "both
elements use the blue token" is not sufficient — check whether one of them is
using it *through* an alpha layer.

**Rule:** the two affordances are not interchangeable.

- **Focus** (transient, keyboard, must not compete with content) → the
  translucent `--box-shadow-focus-ring` glow. Correct as-is; don't "fix" it.
- **Selected** (persistent, semantic, the answer to "where am I") → an opaque
  `--color-primary` border plus the standard 12% tint:

```css
.thing[data-active="true"] {
  background: color-mix(in srgb, var(--color-primary, #1c497c) 12%, var(--content-bg, white));
  border-color: var(--color-primary, #1c497c);
}
```

Give the element a `border: 2px solid transparent` in its base rule so the
selected state only *colors* the border — swapping a `box-shadow` for a real
border otherwise reflows the control by 2px on each side.

**Generalization worth carrying:** when several controls on one card express the
same state, they should reference the same token *at the same opacity*, not
merely the same token. A grep for `--color-primary` finds "matching" rules that
render as two different colors; the honest check is
`getComputedStyle(el).borderColor` on each element side by side in the running
page. That check is what proved the fix here — active crest and active view tab
both reported `rgb(59,130,246)` dark / `rgb(28,73,124)` light, and the same
composited `color-mix` background in both themes.

**Dead-code note:** `src/components/theleague/TeamIconNav.astro` carries a
near-identical `.team-icon-btn[data-active]` block with its own hardcoded
`rgba(28,73,124,0.1)` glow. It styles against `--primary-color`, which does
resolve — both token files define it as a legacy alias of `--color-primary` —
so this is a naming-convention issue, not a broken-token one. Prefer
`--color-primary` in new code. Nothing imports the component; if it's ever
revived, apply the pattern above and drop the hardcoded alpha glow.

---

## 2026-08-10 - A Token Defined in Only ONE Theme Passes the Guard and Still Breaks Dark Mode

**Context:** The What's New surfaces (`WhatsNewRow.astro`, `WhatsNewIndexPage.astro`,
`WhatsNewDetailPage.astro`) each carried their own copy of the same five
`--cat-*` category color tokens. Only the row ever got an `html.dark` override.
The other two shipped the *light* palette in dark mode for months — deep violet
pills where the homepage showed brightened ones — and every test passed the
whole time.

**Insight:** `tests/design-token-guard.test.ts` proves a token is defined
*somewhere*. It does not prove it's defined *per theme*. That's a different
failure mode from the one CLAUDE.md documents:

| Failure | Symptom | Caught by the guard? |
|---|---|---|
| Token defined nowhere | Hardcoded fallback renders in BOTH themes | Yes |
| Token defined light-only | Light value renders in dark mode | **No** |

The light-only case is the sneakier of the two, because light mode looks
perfect and the token name reads like it's theme-aware. It hides especially
well behind a *filled* pill — white-on-deep-violet is legible in dark mode,
just wrong, so nobody files a bug. It only became visible when a *bare-text*
badge using the same token landed at ~2:1 against the dark card.

**Resolution:** the six `--cat-*` tokens now live once in `tokens.css` +
`tokens-dark.css` and all three page-local copies are deleted. That's the
actual fix — three copies of a two-theme pair is three chances to update one
and forget the others, and no test can see the drift.

**Recommendation:**
- Page-local token blocks are a smell (see the `:root`-in-scoped-style gotcha
  further down — tokens belong in `tokens.css` / `tokens-dark.css`). When you
  genuinely must keep one, the light block and the dark block are a **pair**;
  never add one without the other.
- When the same token block is copy-pasted across sibling components, treat
  divergence as the default assumption and diff them. Grep the token name and
  compare the `html.dark` hit count against the `:root` hit count — an
  imbalance is the bug.
- Route every pill's ink through a companion ink token (`--cat-badge-ink`)
  rather than a hardcoded `#fff`. Brightening a fill for dark mode silently
  inverts what a readable ink is, and a literal `#fff` can't follow.
- **Don't borrow a category color for a chip that sits next to the category
  pill.** The freshness chip originally reused `--cat-new-feature`, so on
  `new-feature` entries it rendered as a pixel-identical twin of the badge
  beside it — reintroducing, in color, the duplication the change set out to
  remove. It has its own neutral `--wn-fresh-bg` / `--wn-fresh-ink` pair now.
  A chip that means "when" should never be colored by a token that means
  "what".
- **`--cat-` is a shared prefix covering two unrelated families.** These five
  are What's New categories; `--cat-preseason` / `--cat-draft` /
  `--cat-free-agency` / `--cat-regular-season` are *calendar event* categories
  and are still declared page-locally in `WhatsNextCard.astro` and
  `CalendarEventCard.astro`. Several consumers of that second family
  (`AuctionStrip`, `AflPlayoffsHero`, `hero-resolver.ts`) sit outside those
  components, so they silently render their `var(..., #fallback)` literal —
  the same single-theme trap, still unfixed. Check which family you mean
  before adding a `--cat-*` token.

**Two adjacent gotchas from the same fix:**
- **A bare `html.dark { }` rule inside a *scoped* Astro `<style>` gets scoped
  and dies** (it compiles to `html.dark:where(.astro-hash)`), even though a
  `:root { }` rule in that same block is left alone and reaches
  `documentElement`. Asymmetric and easy to trip over. Working pattern for a
  scoped file: `:global(html.dark) .page-wrapper { --token: ...; }` — custom
  properties inherit, so hanging them off the wrapper covers the subtree.
  Verify with `getComputedStyle`, not by reading the source.
- **A badge that overlays user-supplied imagery needs its own fill.** These
  cards absolutely-position the meta row across the thumbnail/content seam
  (`transform: translateY(-60%)`), so a transparent badge's real backdrop is
  whatever color that entry's screenshot happens to be — not the card. Contrast
  reasoned against `--card-bg` is meaningless there. Filled pill, always.

---

## 2026-07-05 - Dark-Mode Token-Mapping Gotchas (QA/polish pass)

**Context:** A full light/dark × desktop/mobile QA sweep over every public page,
plus authenticated-page spot fixes, surfaced a cluster of token traps that all
share one root cause: a token's *name* implies one role but it feeds another
consumer where the dark value is wrong. None are visible from reading a single
component — you only see them when the token resolves on a dark surface.

- **`--card-bg` is a GRADIENT in dark — never paint form fields with it.**
  Inputs/selects/textarea that used `background: var(--card-bg)` got the radial
  corner-glow smeared across the field (Tip Schefter). Use `--input-bg` (solid;
  white in light). Same rule as color-mix/background-color: `--card-bg` is only
  valid in `background:` shorthand on a *card-sized* element.

- **Never remap `--color-primary` per-league to fix headings — it feeds FILLS.**
  AFL dark headings rendered TheLeague blue; the tempting fix (remap
  `--color-primary` to white in the `html.dark[data-league="afl"]` block) turned
  the nav drawer's active pill (`--nav-switcher-active-bg`) and every primary
  button white-on-white. Headings/plain anchors are colored at the LAYOUT level
  via `:global(h1..h4)`/`:global(a) { color: var(--primary-link-default-text-color) }`
  → `--link-color`. Fix heading color by overriding the **`--link-color` family**
  (`--link-color`, `-hover`, `-focus`, `-accent`), and leave `--color-primary`
  alone so fills stay a readable accent. Blue fills on AFL dark are acceptable
  shared chrome (AFL light's active pill is navy, also a primary fill — never red).

- **Inverted gray ramp: `--color-gray-50..300` are SURFACES in dark, not text.**
  `tokens-dark.css` inverts the gray scale, so `gray-300` is a near-black surface
  value. Using it for muted text (`--tip-rail-cooker__hint`) makes it invisible;
  `gray-700` is the readable muted-text gray. Same trap makes `gray-50/100`
  backgrounds/borders vanish — glass-wash pills instead
  (`rgba(255,255,255,0.06)` bg + `0.12` border).

- **An ALWAYS-dark (theme-independent) surface must use a literal, never
  `var(--color-gray-900)`.** The ramp inverts both ways: `gray-900` is `#111827`
  (dark) in light mode but resolves to a near-WHITE surface (`rgb(237,237,237)`)
  under `html.dark`. The Free Agents hero spotlight panel used
  `var(--color-gray-900)` as its "dark broadcast panel" background and silently
  turned white in dark mode. If a surface is meant to stay dark in both themes
  (broadcast panels, photo backdrops, video letterboxing), hardcode `#111827`
  (or similar) — do NOT reach for a gray token. Confirm with
  `getComputedStyle(el).backgroundColor` under `html.dark`: a light rgb on a
  "should-be-dark" element is this bug. Corollary for theme-SPLIT surfaces: set
  each theme explicitly with literals (`#eef1f6` light / `#111827` dark via an
  `html.dark` override) rather than one gray token that flips — the flip is
  rarely the tone you want.

- **Accent text sinks into dark cards — brighten toward white.**
  Big countdown digits / date lines that used the raw category or league accent
  disappeared on the `#0f1e2e`/`#262626` card (regular-season navy especially).
  Add a `--card-count-ink`-style var: raw accent in light (unchanged),
  `color-mix(in srgb, <accent> 55%, #ffffff)` in dark — keeps enough saturation
  to still read as "its" accent while clearing contrast.

- **Per-conference accent via a fallback-chain var.** AFL standings needed NL
  cards blue and AL red on the *same* `StandingsTable`/`ConferenceLeagueStandingsTable`
  component. Set `--division-accent` inline only for NL (`conferenceId === '01'`
  → `#5b9bd5`), then write every accent consumer as
  `var(--division-accent, var(--league-accent, #ef5350))`. AL and TheLeague (no
  conferenceId, var unset) fall through to `--league-accent` untouched. Drives
  the card gradient, seed-number color, and preferred-team highlight from one hook.

**Meta-lesson:** when a dark value looks wrong, trace the token to *every* consumer
before overriding it — the fix belongs on the token that only the broken consumer
reads (`--link-color`, `--input-bg`, a scoped `--card-*` var), never on a shared
primitive (`--color-primary`, `--color-gray-*`) that also feeds correct consumers.

---

## 2026-07-04 - Theme-Aware Mini-Hero Chrome (Light Default, Navy Dark)

**Context:** The deep-navy hero/event-card chrome (EventHeroShell, WhatsNextCard,
CalendarEventCard) became the dark-mode look, so light mode needed a light
editorial version of the same cards.

**Pattern:** Route every surface-dependent color through component-local custom
properties declared on the root class with LIGHT values, then override the whole
set in one `:global(html.dark) .component { ... }` block with the original navy
literals. One set of rules serves both themes — no duplicated selectors.

- Surface/ink set: `--card-surface`, `--card-ink`, `--card-ink-soft` (~body),
  `--card-ink-faint` (micro labels), plus per-role vars for link chips, muted
  pills, CTA. Light = editorial tokens (`--color-white`, `--color-gray-900/600/500`);
  dark = the original literals (`#0f1e2e`, `rgba(255,255,255,.72)`, …).
- Accent glow washes: derive from the accent instead of hardcoding per-category
  rgba — `--card-glow: color-mix(in srgb, var(--card-accent) var(--card-glow-strength), transparent)`
  with `--card-glow-strength` theme-keyed (≈12% light, ≈52% dark; past events
  8%/18%). Category variants then only set `--card-accent`.
- Photo cut-out fades: never hardcode the fade color — build gradients from the
  surface var: `linear-gradient(90deg, var(--ev-surface) 0%, color-mix(in srgb, var(--ev-surface) 60%, transparent) 26%, …)`
  so the image feathers into whichever surface is active.
- CTA inverts per theme: light = navy button/white text, dark = white button/navy
  text (`--ev-cta-bg`/`--ev-cta-ink`).
- Accent-on-surface text (event date): light needs darkening
  (`color-mix(accent 75%, gray-900)`), dark needs lightening (`color-mix(accent 45%, #fff)`).

**Why:** The navy card IS the dark-mode design; scattering `html.dark` overrides
per-property would have doubled the stylesheet and drifted. The var-set approach
keeps the dark look byte-identical while the light version rides the editorial
tokens.

**Global-CSS variant (React hero stylesheets):** `live-scoring-hero.css`,
`trade-deadline-hero.css`, `playoff-bracket-hero.css` use the same pattern with
plain `html.dark { ... }` blocks (never `:global()` in .css files). Two extras:
- A derived var like `--lsh-glow: color-mix(... var(--lsh-accent) ...)` must be
  declared on the **component root element** (`.lsh`), not `:root` — custom
  properties resolve where declared, so a `:root`-level derivation ignores
  variant accent overrides like `.lsh--playoffs`.
- Amber/sky accents that are *text* on the card need theme-keyed darkening for
  light (`#f0a23a → #d97706`, `#60a5fa → #2563eb`); borders/pills can keep the
  bright brand hue in both themes.
All heroes are covered: EventHeroShell wrappers (Auction/Draft/CutWatch/Tagged/
TagExtension/UDFA/Preseason/DraftCountdown via LeagueEventHero) inherit the
shell's `--ev-*` vars — panel-slot content must reference those vars, never
`rgba(255,255,255,…)` literals. Season heroes + hero-stub.css were already
token-based (light) and invert via tokens-dark.

---

## 2026-03-02 - Editorial Hero Banner Pattern

**Context:** Homepage hero redesign to match the magazine/editorial style from `about.astro`.

**Pattern name:** `HeroBanner` with `variant="editorial"`

**Component:** `src/components/theleague/HeroBanner.astro`

**Design:** Transparent background (blends into page), large bold title (800 weight, `clamp(1.75rem, 2.5vw + 0.75rem, 2.5rem)`), eyebrow badge + date, summary, two-action row (primary CTA button + text link). Image floats right in a tilted browser-frame when available.

**Key props:**
```astro
<HeroBanner
  variant="editorial"
  title="Large headline here"
  summary="Body copy — max 54ch"
  link="/feature-page"
  linkLabel="Read more"
  kicker="New Feature"       <!-- gray pill badge, uppercase -->
  kickerDate="Mar 2, 2026"   <!-- date next to badge -->
  allNewsLink="/theleague/whats-new"
  allNewsLabel="All releases"
  image="feature-screenshot.webp"  <!-- optional, goes RIGHT -->
  imageAlt="Screenshot of feature"
/>
```

**Layout rules:**
- Text on the LEFT, image on the RIGHT (normal flex row — not `row-reverse` like the old card variant)
- No card background, border, or box-shadow — blends into page `var(--page-bg)`
- Mobile (<700px): stacks vertically, image below text
- The section header label ("Featured News" + "View all releases" link) was removed from the parent — the `allNewsLink` prop handles that link inline

**Where used:** Homepage (`src/pages/theleague/index.astro`) — always `variant="editorial"` now.

**Eyebrow data source:** `hero-resolver.ts` → `featureToHero()` sets `kicker` from `WHATS_NEW_CATEGORY_LABELS[entry.category]` and `kickerDate` from `formatKickerDate(entry.date)`.

---

## 2026-01-18 - Existing CSS Variable Naming Convention

**Context:** Planning nav design tokens

**Insight:** The codebase uses CSS custom properties with a specific naming pattern.

**Evidence:** From existing stylesheets:
```css
--primary-color: #1c497c;
--secondary-color: #2e8743;
--primary-content-bg-color: #ffffff;
--primary-content-border-color: #e2e8f0;
--primary-link-hover-text-color: #b22222;
```

**Recommendation:** Follow this pattern for new components:
- Use `--{component}-{property}` for component-scoped tokens
- Reference existing global tokens where applicable
- Example: `--nav-bg` can fallback to `--primary-content-bg-color`

---

## 2026-01-18 - Box Shadow Token Pattern

**Context:** Recent commits show box shadow work

**Insight:** The codebase uses `--shadow-md` and similar tokens for consistent shadows.

**Evidence:** `src/components/theleague/Header.astro:247` uses `box-shadow: var(--shadow-md);`

**Recommendation:** Use shadow tokens rather than hardcoded values:
```css
box-shadow: var(--shadow-sm);  /* subtle */
box-shadow: var(--shadow-md);  /* default */
box-shadow: var(--shadow-lg);  /* prominent */
```

---

## 2026-01-18 - Transition Timing Function

**Context:** Planning nav drawer animations

**Insight:** Use cubic-bezier for smooth, natural-feeling transitions.

**Evidence:** From Header.astro hamburger animation:
```css
transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

**Recommendation:** Standard transition for UI elements:
```css
--nav-transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 2026-01-18 - Nav Token Architecture Complete

**Context:** Created nav design tokens for the unified navigation drawer

**Insight:** The nav tokens file (`src/assets/css/src/_nav-tokens.scss`) establishes a comprehensive design token system with:
- Dimension tokens (widths, heights, spacing scale)
- Transition tokens (timing functions, durations)
- Color tokens for light and dark modes
- Z-index layering system
- Touch target minimums for accessibility (44px)

**Key patterns implemented:**
1. **Fallback references**: Tokens reference existing global variables where possible
   ```css
   --nav-bg: var(--primary-content-bg-color, #ffffff);
   --nav-section-color: var(--primary-link-hover-text-color, #b22222);
   ```

2. **Dark mode dual support**: Both `@media (prefers-color-scheme: dark)` AND `.dark` class for manual toggle

3. **Semantic grouping**: Tokens organized by purpose (dimensions, transitions, colors, etc.)

**Evidence:** `src/assets/css/src/_nav-tokens.scss` - 250+ lines of design tokens

**Recommendation:** When creating new component token files:
- Import early in main SCSS (before component styles)
- Group by category with clear comments
- Provide fallbacks to existing global tokens
- Support both dark mode methods

---

## 2026-01-18 - SCSS Import Order for Tokens

**Context:** Adding nav tokens to main SCSS files

**Insight:** Design token files should be imported after reset/fonts but before component styles.

**Evidence:** Updated both `theleague_main.scss` and `afl_main.scss`:
```scss
@use "./fonts";
@use "./reset";

//// Design Tokens (load before components)
@use "./nav-tokens";

//// Alphabetical (components)
```

**Recommendation:** Follow this order for SCSS imports:
1. Fonts
2. Reset/normalize
3. Design tokens (CSS custom properties)
4. Components (alphabetical)

---

## 2026-01-18 - Nav Tokens Must Be in tokens.css

**Context:** Nav drawer CSS variables weren't working because the demo page didn't load the compiled SCSS

**Insight:** Nav tokens must be defined in `src/styles/tokens.css` (the single source of truth), not just in `_nav-tokens.scss`. This ensures:
1. Nav components work in any page that imports tokens.css
2. No dependency on the full compiled SCSS bundle
3. Consistent values across all contexts (demo pages, layouts, etc.)

**Decision:** All `--nav-*` CSS custom properties are now defined in both:
- `src/styles/tokens.css` - Primary source, always available
- `src/assets/css/src/_nav-tokens.scss` - For pages using the full SCSS bundle

**Evidence:** Nav drawer failed on `/nav-demo` because it only imported tokens.css, not theleague_main.css

**Recommendation:**
- When adding new nav tokens, add them to BOTH files
- Use fallback values in component CSS as defensive coding: `var(--nav-team-logo-size, 40px)`
- The tokens.css file is the canonical source; keep _nav-tokens.scss in sync

---

## 2026-01-18 - Icon Assignment: Next Year Summary = Chalkboard

**Context:** Choosing the right icon for the Next Year Summary nav link

**Decision:** The **chalkboard** icon (`icon-chalkboard`) must always be used for the "Next Year Summary" page/link.

**Rationale:** The chalkboard icon visually represents planning and forecasting, which aligns with the purpose of previewing next year's roster and salary commitments.

**Evidence:** `src/config/nav-config.json` - "next-year" link uses `"icon": "chalkboard"`

**Recommendation:** If creating any new links or references to the Next Year Summary feature, always use the chalkboard icon for consistency.

---

## 2026-03-01 - Editorial Design Standard (Modal-Derived)

**Context:** The PlayerDetailsModal, ContractDeclarationModal, and other modal components established a refined editorial design language that is now the standard for all new pages and components.

**Insight:** The "editorial design" is characterized by specific typography, spacing, color, and layout patterns that create a clean, data-dense, sports-editorial feel. New pages must follow these patterns.

### Typography Hierarchy

| Role | Size | Weight | Color | Extra |
|------|------|--------|-------|-------|
| **Hero/Page Title** | 1.35rem | 700 | gray-900 | line-height: 1.2 |
| **Section Title** | 0.75rem | 700 | gray-900 | UPPERCASE, 0.06em letter-spacing, left border accent |
| **Body/Values** | 0.875rem | 400–500 | gray-700 | `font-variant-numeric: tabular-nums` for numbers |
| **Meta/Secondary** | 0.875rem | 500 | gray-600 | Supporting info below titles |
| **Detail Label** | 0.75rem | 600 | gray-500 | UPPERCASE, 0.04em letter-spacing |
| **Micro Label** | 0.6875rem | 600 | gray-500 | UPPERCASE, 0.05em letter-spacing (metric cards) |
| **Table Header** | 0.625rem | 600 | gray-500 | UPPERCASE |

### Section Title Pattern (Signature Element)

The left-border accent on uppercase section titles is the most recognizable editorial pattern:

> **AFL font-size exception:** AFL uses UFC Sans Condensed, which renders visually smaller than The League's Vend Sans at the same rem value. AFL section-title components use `font-size: 0.9rem` (not 0.75rem) to compensate. When bumping section titles in AFL components, use 0.9rem. When bumping in TheLeague components, use 0.75rem (already standard). Don't accidentally "fix" one by copying from the other.

```css
.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-900, #111827);
  padding-left: 0.625rem;
  border-left: 2px solid var(--color-primary, #1c497c);
}
```

### Section Header with Subtitle Pattern

When a section title needs a descriptive subtitle, wrap both in a `.section-header` container so the left-border accent spans both lines. This keeps the title and subtitle visually unified as a single label block, rather than the subtitle dangling loose below the border.

**HTML:**
```html
<div class="section-header">
  <h3 class="section-header__title">NFL Analysis</h3>
  <p class="section-header__sub">Players on the same NFL team</p>
</div>
```

**CSS:**
```css
.section-header {
  padding-left: 0.625rem;
  border-left: 2px solid var(--color-primary, #1c497c);
  margin-bottom: 0.75rem;
}

.section-header__title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-900, #111827);
  line-height: 1;
}

.section-header__sub {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-gray-400, #9ca3af);
  line-height: 1.3;
}
```

**When to use:**
- Section title + subtitle (e.g., "NFL Analysis" / "Players on the same NFL team")
- Any editorial section heading that needs a clarifying description

**When NOT to use (use standalone section title instead):**
- Section titles without subtitles (e.g., "Cap Analysis") — use the plain `.section-title` pattern above

**Evidence:** First implemented in `src/pages/theleague/rosters.astro` for the NFL Analysis and College Analysis sections in the Analytics view.

### Key Metrics Strip

3-column grid for hero-level stats:
```css
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.625rem;
}
.metric-card {
  background: var(--color-gray-50, #f9fafb);
  border: 1px solid var(--content-border, #e2e8f0);
  border-radius: var(--radius-md, 0.5rem);
  padding: 0.5rem;
  text-align: center;
}
.metric-value {
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.metric-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-gray-500);
}
```

### Detail Row Pattern

Label + value rows separated by subtle borders (NOT a table — flexbox):
```css
.detail-row {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-gray-50, #f9fafb);
}
.detail-label {
  width: 4.5rem;
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-gray-500);
  text-align: right;
}
.detail-value {
  font-size: 0.875rem;
  color: var(--color-gray-700);
}
```

### Pill/Badge Pattern

Compact metadata indicators:
```css
.pill {
  background: var(--color-gray-100, #f3f4f6);
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-full, 9999px);
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}
```
Semantic variants use light background + dark text (e.g., info: `#f0f9ff` bg, `#0369a1` text).

### Table Styling

```css
/* Header */
thead th {
  background: var(--color-gray-50);
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-gray-500);
  position: sticky;
  top: 0;
}

/* Rows */
tbody td {
  padding: 0.3rem 0.5rem;
  font-size: 0.75rem;
  color: var(--color-gray-700);
  border-bottom: 1px solid var(--color-gray-50);
}
tbody tr:hover { background: var(--color-gray-50); }

/* Footer/totals */
tfoot td {
  border-top: 1px solid var(--content-border);
  background: var(--color-gray-50);
  font-weight: 600;
}
```

### Modal Shell (Reference)

**CRITICAL:** When building new modals or overlays, the backdrop MUST use the frosted-glass blur effect. Never use a plain dark overlay without blur — this is a core part of the site's visual identity.
- **Overlay (mandatory):** `rgba(15, 23, 42, 0.45)` + `backdrop-filter: blur(2px)` — the blur is NOT optional
- Modal: `max-width: 580px`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-xl)`
- Body padding: 1.75rem desktop, 1.25rem mobile
- Entry animation: `0.32s ease-out` scale(0.96→1) + translateY(12px→0) — see ContractDemoOverlay `cdemo-card-enter`
- Mobile entry: `0.3s ease-out` translateY(100%→0) (bottom sheet slide-up)
- Close button: 32px circle, gray-100 bg, gray-500 icon, absolute top-right
- Mobile (≤640px): bottom-sheet style (`align-items: flex-end`, top-only radius)

### Selected State Pattern (Cards/Options)

Interactive selection uses a left border accent + subtle gradient:
```css
.option-selected {
  border-left: 2px solid var(--color-primary, #1c497c);
  background: linear-gradient(135deg, #f0f5fa 0%, #e8eff7 100%);
  box-shadow: 0 1px 3px rgba(28, 73, 124, 0.08);
}
```

### Color Usage Rules

| Purpose | Token | Fallback | Contrast on #fff |
|---------|-------|----------|------------------|
| Primary text | `--color-gray-900` | `#111827` | 16.75:1 |
| Secondary text | `--color-gray-700` | `#374151` | 9.33:1 |
| Tertiary text | `--color-gray-600` | `#4b5563` | 6.40:1 |
| **Labels/hints** | **`--color-gray-500`** | **`#6b7280`** | **4.63:1 ✓ AA** |
| Accent/brand | `--color-primary` | `#1c497c` | 7.22:1 |
| Subtle bg | `--color-gray-50` | `#f9fafb` | — |
| Borders | `--content-border` | `#e2e8f0` | — |
| Light borders | `--color-gray-50` | `#f9fafb` | — |

> **A11y correction (2026-03-02):** Labels/hints was previously `--color-gray-400` (#9ca3af, ~2.86:1) which **fails WCAG AA**. Corrected to `--color-gray-500` (#6b7280, ~4.63:1). Reserve gray-400 for non-text elements only (borders, decorative dividers, disabled controls).

### Defensive CSS

Always use token fallbacks: `var(--color-gray-700, #374151)`. This ensures components render correctly even if tokens.css fails to load.

### Responsive Rules

- Mobile breakpoint: `max-width: 640px`
- Reduce padding: 1.75rem → 1.25rem
- Shrink hero elements (avatars, titles) by ~25%
- Hide lower-priority table columns
- Use `:global()` for styles targeting JS-inserted DOM

**Evidence:** PlayerDetailsModal.astro (1072 lines), ContractDeclarationModal.astro, PlayerInjuryModal.astro, PlayerNewsModal.astro

**Recommendation:** Before building any new page or component, reference these patterns. The PlayerDetailsModal is the canonical implementation. When in doubt, match its typography, spacing, and color choices.

---

## 2026-03-01 - Button & CTA System (Official Decision)

**Context:** Formalizing the button/CTA hierarchy based on the demo modal's navigation buttons.

**Decision:** The dark blue button (`var(--color-primary, #1c497c)`) from the `ContractDemoOverlay` demo modal ("Next" / "Start Exploring") is the **official primary CTA** for the site — whether implemented as a `<button>` or an `<a>` anchor tag.

### Element Selection Rule

| Element | When to use |
|---------|-------------|
| `<button>` | In-page actions — submit form, open modal, trigger JS |
| `<a href>` | Navigation — links to pages, external URLs, anchors |

The CSS classes (`.btn--primary`, `.btn--secondary`, `.btn--ghost`) are identical for both. **Never use `<a>` without an `href`, and never use `<button>` for navigation.**

### CTA Hierarchy

| Variant | Token | Color | When to use |
|---------|-------|-------|-------------|
| **Primary** | `--btn-primary-bg` | `#1c497c` (dark blue) | Default CTA — modals, forms, page-level actions, link CTAs |
| **Secondary** | `--btn-secondary-bg` | `#2e8743` (green) | Select spaces only — affirmative/go actions (bid submit, roster confirm) |
| **Ghost / Text** | transparent | `--color-gray-500` | Low-emphasis; paired with a primary CTA (e.g. "Back", "Cancel") |

### Primary CTA Spec (from demo modal)
```css
display: inline-flex;
align-items: center;
justify-content: center;
background: var(--btn-primary-bg, #1c497c);
color: var(--btn-primary-text, #fff);
font-size: 0.8125rem;
font-weight: 600;
border-radius: 8px;
padding: 0.625rem 1.25rem;
border: none;
text-decoration: none; /* required when applied to <a> */
transition: background 0.15s ease;

/* Hover */
background: var(--btn-primary-bg-hover, #164066);
```

### Green CTA (Secondary) Usage Rule

The green CTA (`--btn-secondary-bg`) is **not a general-purpose CTA**. It is reserved for contexts where green communicates "go", "approve", or positive affirmation (e.g. submitting an auction bid, confirming a roster action). Default to primary blue in all other cases.

### Canonical Reference

- Live demos: `src/pages/theleague/design-system.astro` (Buttons & CTAs section)
- Tokens: `src/styles/tokens.css` under `--btn-primary-*` and `--btn-secondary-*`
- Source pattern: `.cdemo-nav__next` / `.cdemo-nav__start` in `src/components/theleague/ContractDemoOverlay.astro`

**Recommendation:** Use `--btn-primary-bg` and `--btn-secondary-bg` tokens. Never hardcode `#1c497c` or `#2e8743` directly in CTA styles — always go through the token layer.

---

## 2026-03-02 - Page Toolbar / Section Header Row Pattern

**Context:** Applied while aligning the Free Agents page (`src/pages/theleague/players.astro`) with the editorial design standard. The toolbar row below a hero or section break needed editorial identity.

**Insight:** Pages with data tables benefit from a "toolbar row" that combines the editorial section title (left-border accent) with a live count display and optional action buttons (view toggles, filters). This is the page-level analog to the modal section title.

### Toolbar Pattern

```html
<div class="players-toolbar">
  <div class="toolbar-left">
    <h2 class="section-title">Available Players</h2>
    <span class="count-display" aria-live="polite">
      <strong id="showing-count">50</strong> of <strong id="total">0</strong>
    </span>
  </div>
  <div class="toolbar-center">
    <!-- optional: view toggle pills -->
  </div>
  <div class="toolbar-right">
    <!-- action button (Filters, Export, etc.) -->
  </div>
</div>
```

```css
.players-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem 0 0.625rem;
  border-bottom: 1px solid var(--color-gray-50, #f9fafb);
  flex-wrap: wrap;
}
.toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}
/* Section title: the standard editorial left-border accent */
.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-900, #111827);
  padding-left: 0.625rem;
  border-left: 2px solid var(--color-primary, #1c497c);
  margin: 0;
  line-height: 1.2;
  white-space: nowrap;
}
/* Count display alongside section title */
.count-display {
  font-size: 0.75rem;
  color: var(--color-gray-400, #9ca3af);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.count-display strong {
  color: var(--color-gray-700, #374151);
  font-weight: 600;
}
```

**Key rules:**
- Section title always uses the left-border accent (`border-left: 2px solid var(--color-primary)`)
- Count uses `baseline` alignment with title so numbers sit on same text baseline
- `aria-live="polite"` on the count container for screen reader updates
- On mobile: `toolbar-left` can `flex-wrap: wrap` and `gap: 0.5rem`

**Source:** `src/pages/theleague/players.astro` (toolbar section)

---

## 2026-03-02 - Filter Panel Section Title Pattern

**Context:** Applied to the collapsible filter panel on the Free Agents page.

**Insight:** Any collapsible panel, drawer, or expandable section that contains grouped controls should open with an editorial section title. This provides visual hierarchy and confirms to the user what context they're in.

### Filter Panel Pattern

```html
<div class="filters-panel__inner">
  <h3 class="section-title">Filters</h3>
  <div class="filters-grid">
    <!-- filter groups -->
  </div>
</div>
```

Filter labels follow the **Detail Label** spec from the editorial standard:
```css
.filter-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-gray-400, #9ca3af);  /* NOT gray-500 */
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

**Common mistake:** Using `gray-500` for filter labels. Editorial standard uses `gray-400` for all uppercase labels.

**Source:** `src/pages/theleague/players.astro` (filters-panel section)

---

## 2026-03-02 - Table Header: Gray-50 Editorial Standard (Production Confirmed)

**Context:** Converting the Free Agents page from the dark gradient table header to the editorial standard.

**Decision:** The `--table-header-gradient` token (dark blue) is **NOT** the editorial standard for tables. It is a legacy pattern. New pages and refactored pages must use the gray-50 editorial header.

### Correct Table Header CSS

```css
.my-table thead {
  background: var(--color-gray-50, #f9fafb);
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--content-border, #e2e8f0);
}
.my-table th {
  padding: 0.5rem 0.375rem;
  font-size: 0.625rem;      /* NOT 0.7rem or 0.75rem */
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-gray-400, #9ca3af);
  white-space: nowrap;
}
/* Hover state (light bg) */
.my-table th.sortable:hover {
  background: var(--color-gray-100, #f3f4f6);
  color: var(--color-gray-600, #4b5563);
}
/* Sorted state */
.my-table th.sorted {
  background: rgba(28, 73, 124, 0.06);
  color: var(--color-primary, #1c497c);
}
```

**Anti-pattern:** Using `rgba(255,255,255,0.1)` for hover/sorted — this only works on dark backgrounds and is invisible on the editorial gray-50 header.

**The `--table-header-gradient` token** is still defined in tokens.css for backwards compatibility but should not be used in new work.

**Source:** `src/pages/theleague/players.astro` (table styles, confirmed 2026-03-02)

---

## 2026-03-01 - Slide Animation System (from ContractDemoOverlay)

**Context:** Documenting the four animation patterns established in the contract demo walkthrough modal.

**Source:** `src/components/theleague/ContractDemoOverlay.astro`

### Animation Catalog

| Name | Keyframes | Duration | Use Case |
|------|-----------|----------|----------|
| **Card Enter** | scale(0.96→1) + translateY(12px→0) + fade | 0.32s ease-out | Desktop modal/card entrance |
| **Slide Up** | translateY(100%→0) | 0.3s ease-out | Mobile bottom-sheet modals |
| **Panel In** | translateX(16px→0) + fade | 0.3s ease-out | Step-to-step transitions within a modal |
| **Trigger Enter** | translateX(100%→0) + fade | 0.5s ease-out, 1.5s delay | Floating edge-anchored CTAs |

### Motion Rules

- **Entrances:** Always `ease-out` (decelerate into place)
- **Duration range:** 0.2s–0.35s for UI elements; 0.5s max for dramatic reveals
- **Fill mode:** `forwards` when starting from `opacity: 0`
- **Stagger delays:** 0.05s increments for list items
- **Mobile override:** Prefer slide-up (bottom sheet) over scale-enter on small screens
- **Interactive transitions:** `0.3s cubic-bezier(0.4, 0, 0.2, 1)` for hover/focus state changes

### Astro `<style>` Gotcha

`@keyframes` work fine inside scoped `<style>` blocks, but `{ }` characters inside `<code>` HTML tags in the template must be escaped using `set:html` (e.g., `<code set:html="'@keyframes foo { ... }'" />`) to avoid Astro treating them as JS expressions.

**Live demos:** `src/pages/theleague/design-system.astro` (Animation & Motion section)

---

## 2026-03-02 - Negative/Warning State Pattern (Subtle Red Accents)

**Context:** Redesigning the Dead Money Awards page to use the editorial design system. The original page used large red background blocks (gradient fills, pink cards) to indicate "bad" items. This was overpowering and inconsistent with the editorial language.

**Decision:** Negative/warning states use **subtle left-border accents** — never large colored backgrounds.

### Pattern: Winner/Worst Card (Left-Border Accent)

For ranking cards where #1 is the "worst" or "winner" of a negative award:
```css
.rank-card-worst {
  border-left: 3px solid var(--color-error, #dc2626);
  box-shadow: var(--shadow-md);
}
```
The elevated shadow + red left-border is sufficient. The badge, red numeric text, and rank number already communicate hierarchy. **Never use** `background: linear-gradient(... error-light ...)` or full red borders on cards.

### Pattern: Negative Data Card (Shame/Zero-Value)

For cards representing negative data (zero-point players, wasted salary):
```css
.negative-card {
  background: var(--color-gray-50, #f9fafb);
  border: 1px solid var(--content-border, #e2e8f0);
  border-left: 2px solid var(--color-error, #dc2626);
  border-radius: var(--radius-md, 0.5rem);
}
```
The neutral gray-50 background keeps cards visually consistent with the rest of the page. The red left-border is the only color signal — paired with red text on key values (e.g., salary amounts).

### Anti-Pattern: Colored Background Blocks

**Never do this:**
```css
/* ❌ Too heavy — overwhelms the editorial layout */
background: var(--color-error-light, #fee2e2);
border: 1px solid #fecaca;

/* ❌ Red gradient fills are not editorial */
background: linear-gradient(135deg, #fff5f5 0%, #ffffff 100%);
border: 2px solid var(--color-error);
```

### Section Title Variant (Red Accent)

For section titles that mark negative/shame sections, override the left-border color:
```css
.section-title--negative {
  border-left-color: var(--color-error-dark, #b91c1c);
}
```
This keeps the editorial section-title pattern intact while signaling the section's tone.

**Evidence:** Dead Money Awards page redesign (`src/pages/theleague/dead-money.astro`) — Hall of Shame cards, Jerry Jones winner cards.

**Recommendation:** When building award/ranking pages with negative connotations, rely on:
1. Left-border color accents (2-3px)
2. Red text on key numeric values
3. Badge components for labels
4. Elevated shadow for #1/winner emphasis
Never flood a card or section with colored backgrounds.

---

## 2026-03-02 - Broadcast Diagonal Cut (Flair Pattern)

**Context:** Redesigning the Free Agents hero section to give the rotating player photos a distinctive sports-media presence. Iterated through several approaches (desaturated watermark, bordered frame, sports card with header/footer strips) before landing on the broadcast diagonal cut inspired by ESPN, FOX Sports, and CBS NFL broadcast graphics packages.

**Decision:** The **broadcast diagonal cut** is an official design element for adding visual flair to sections that benefit from bold, sports-forward energy. It should be used sparingly — for hero sections, feature highlights, or promotional areas — not for everyday data layouts. Think of it as the design system's "broadcast mode."

### When to Use

- **Hero sections** with featured imagery (players, action shots, promo graphics)
- **Feature callouts** or marketing areas that need visual punch
- **Landing page accents** where the editorial standard alone feels too restrained
- Any context where you'd see a similar treatment on ESPN SportsCenter or FOX NFL Sunday

### When NOT to Use

- Data tables, forms, modals, or utility UI
- Anywhere the diagonal geometry would compete with content readability
- Stacked/repeated — one broadcast cut per page maximum

### Core Technique: Parallelogram Clip-Path

The photo container uses `clip-path: polygon()` to create a parallelogram where both diagonal edges slant at the same angle. The key is that both left and right edges have an identical slope (20% horizontal shift over the full height), creating true parallel lines.

```css
/* Container: parallelogram with matching diagonal edges */
.broadcast-photo {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 50%;
  overflow: hidden;
  pointer-events: none;
  /* Left edge: 20%→0%, Right edge: 110%→90% (same 20% slope) */
  /* Right point starts off-screen (>100%) so the diagonal */
  /* enters the visible area partway down, showing only a  */
  /* small corner of background on the bottom-right         */
  clip-path: polygon(20% 0, 110% 0, 90% 100%, 0% 100%);
  background: var(--color-gray-900, #111827);
}
```

### Accent Stripes

Thin primary-blue stripes run along each diagonal edge using pseudo-elements with their own `clip-path` polygons. The stripe width is 2.5% of the container. The gradient direction is reversed between left and right for visual balance.

```css
/* Left accent stripe */
.broadcast-photo::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  background: linear-gradient(
    to bottom,
    var(--color-primary, #1c497c) 0%,
    rgba(28, 73, 124, 0.6) 100%
  );
  clip-path: polygon(20% 0, 22.5% 0, 2.5% 100%, 0% 100%);
  pointer-events: none;
}

/* Right accent stripe (parallel, same slope) */
.broadcast-photo::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  background: linear-gradient(
    to bottom,
    rgba(28, 73, 124, 0.6) 0%,
    var(--color-primary, #1c497c) 100%
  );
  clip-path: polygon(110% 0, 107.5% 0, 87.5% 100%, 90% 100%);
  pointer-events: none;
}
```

### Geometry Rules

The parallelogram math must keep both edges parallel:

| Parameter | Left Edge | Right Edge | Rule |
|-----------|-----------|------------|------|
| Top point | 20% | 110% (off-screen) | Difference must match |
| Bottom point | 0% | 90% | Difference must match |
| Slope | 20% leftward | 20% leftward | **Identical** = parallel |
| Stripe width | 2.5% | 2.5% | Match for symmetry |

To adjust how much corner shows on the right, shift both right points equally:
- **More corner:** decrease values (e.g., 105%→85%)
- **Less corner:** increase values (e.g., 115%→95%)
- **No right corner:** use 120%→100% (line exits off-screen entirely)

### Photo Treatment

Images inside the broadcast cut should feel vivid and present — not faded or desaturated:

```css
.broadcast-photo img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 20%;
  filter: brightness(1.02) contrast(1.1) saturate(1.15);
}
```

### Mobile Behavior

Hide the broadcast photo element entirely below 767px. The diagonal geometry doesn't scale well to narrow viewports and competes with content:

```css
@media (max-width: 767px) {
  .broadcast-photo {
    display: none;
  }
}
```

### Design Lineage

This pattern draws directly from NFL broadcast graphics:
- **ESPN NFL** — angular geometric player frames with team-color accents
- **FOX Sports** — diagonal clip-path layouts with bold color bars
- **CBS NFL** — angled lower-thirds with gradient accent stripes

The parallelogram shape (vs. a simple trapezoid) was chosen because it creates visual motion — the parallel lines imply speed and dynamism, which is the exact energy sports broadcast graphics are designed to convey.

**Source:** `src/pages/theleague/players.astro` (hero section, confirmed 2026-03-02)

**Recommendation:** When a page needs flair beyond the editorial standard, reach for the broadcast diagonal cut. It pairs well with the editorial light background (gray-50) because the dark photo area creates natural contrast. Reserve it for one hero-level element per page to maintain impact.

---

## 2026-03-14 - Token Fallback Correctness in React Inline Styles

**Context:** Trade Builder design system alignment revealed widespread incorrect CSS variable fallbacks in inline `<style>` blocks within React components.

**Common mistakes found:**
- `--color-warning-dark` fallback was `#92400e` (amber-900) but token is `#d97706` (amber-600)
- `--color-error-light` fallback was `#fef2f2` (red-50) but token is `#fee2e2` (red-100)
- `--color-success-light` fallback was inconsistent (`#ecfdf5`, `#f0fdf4`, `#dcfce7`) — token is `#d1fae5`
- `--content-border` fallback was sometimes `#d1d5db` (gray-300) — token is `#e2e8f0` (slate-200)

**Rule:** When adding `var(--token, #fallback)`, always verify the fallback against `src/styles/tokens.css`. Never guess from memory.

**Focus-visible pattern:** Every interactive button in inline `<style>` blocks needs explicit `:focus-visible` — the global tokens.css rule may be overridden by inline specificity. Standard pattern:
```css
.my-btn:focus-visible {
  outline: 2px solid var(--color-primary, #1c497c);
  outline-offset: 2px;
}
```

**Contrast rule for small white-on-color text:** At `0.75rem` (12px), white text on `--color-error` (#dc2626) is borderline (~4.0:1). Use `--color-error-dark` (#b91c1c, ~4.87:1) for backgrounds with white text at small sizes.

---

## 2026-03-14 - CRITICAL: Use Inset Box-Shadow for Table Row Indicators, Never border-left

**Context:** League Summary page had a preferred team highlight using `border-left: 3px solid` on a `<tr>`. This created a visible white gap between the row border and the table header because `border-left` on table rows doesn't span the full visual row height — it's interrupted by row spacing, cell padding, and border-collapse behavior.

**Rule:** When highlighting a table row with a colored left indicator, **always use `box-shadow: inset` on the first `<td>`**, never `border-left` on the `<tr>` or `<td>`.

**Pattern:**
```css
/* ❌ WRONG — creates white gap between rows */
.table-row--highlighted {
  border-left: 3px solid var(--color-primary);
}

/* ❌ STILL WRONG — gap between cell border and row spacing */
.table-row--highlighted td:first-child {
  border-left: 3px solid var(--color-primary);
}

/* ✅ CORRECT — seamless indicator with no gaps */
.table-row--highlighted td:first-child {
  box-shadow: inset 3px 0 0 var(--color-primary, #1c497c);
}
```

**Why box-shadow works:** It paints inside the cell's box without affecting layout or creating gaps. Unlike `border-left`, it doesn't participate in border-collapse calculations and isn't interrupted by row spacing.

**When this applies:**
- Preferred/selected team highlighting in multi-team tables
- Active row indicators in any sortable data table
- "My team" highlighting in standings, league summary, or comparison views
- Any table where a colored left-edge indicator marks a specific row

**When border-left is fine:**
- Section titles (editorial accent) — block elements, not table rows
- Cards and panels — no row-spacing gap issue
- `<thead> <tr>` with nearly-invisible gray spacer borders

**Evidence:** `src/components/theleague/LeagueSummaryTable.astro` — preferred team row highlight.

**Known instances that need this fix:**
- **`src/pages/theleague/rosters.astro`** (lines 4095–4132): `.roster-row` uses `border-left: 4px solid transparent` with colored variants for active (green `#57b881`), practice (blue `#487ae7`), injured (red `#e56263`), and contract-action (amber `#f59e0b`). These are all on `<tr>` elements and will show the same gap. Fix: change all to `box-shadow: inset 4px 0 0 {color}` on the first `<td>`.
- **`src/pages/theleague/rosters.astro`** (line 4221): `.roster-row--contract-action` uses `border-left: 3px solid #f59e0b !important` — same issue.
- Any future multi-team table that highlights rows (standings, league comparison, draft order, etc).

**Pages where border-left is fine (not table rows):**
- Section titles, cards, chips, buttons — these are block/inline elements where border-left works correctly.

---

## 2026-03-15 - Chart.js Editorial Design Pattern (Canonical)

**Context:** First chart in the editorial design system — salary history page with multi-dataset line charts.

**Insight:** Chart.js renders on `<canvas>`, which cannot read CSS custom properties. Chart colors, grid colors, and font sizes must be passed as hex/rgba values directly in the JS config. CSS tokens exist for HTML elements (legend, tooltip) but JS must mirror them for canvas rendering.

**Canonical file:** `src/pages/theleague/salary-history.astro`

**Chart palette tokens** (added to `src/styles/tokens.css`):
```css
--chart-color-1: #3b6b9a;   /* Steel Blue */
--chart-color-2: #c0623a;   /* Burnt Sienna */
--chart-color-3: #1a7a6d;   /* Dark Teal */
--chart-color-4: #7b5ea7;   /* Slate Purple */
--chart-color-5: #b8860b;   /* Goldenrod */
--chart-color-6: #5a6672;   /* Graphite */
--chart-grid-color: rgba(0, 0, 0, 0.06);
--chart-tick-color: var(--color-gray-500);
--chart-border: var(--content-border);
```

**Key patterns:**
1. **Muted palette** — 6 colors chosen for distinguishability and editorial feel (no Chart.js defaults)
2. **Hidden points** — `pointRadius: 0, pointHoverRadius: 5` for clean lines with hover reveal
3. **Custom external tooltip** — `tooltip.enabled: false` + `external: handler` for DOM-based tooltip matching site typography
4. **Custom legend** — `legend.display: false` + JS-built legend with `role="toolbar"` for keyboard access
5. **No axis titles** — Context provided by section header, not chart chrome
6. **Compact currency** — `$14M` not `$14,000,000` via custom tick callback
7. **Segmented control tabs** — ARIA tablist pattern for switching datasets
8. **Collapsible data table** — `<details>` element with full tabular data for a11y

**ViewTransitions lifecycle:**
```js
// Dynamic Chart.js loading (replaces CDN <script> tag)
function ensureChartJS() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Cleanup on navigation
const ac = new AbortController();
document.addEventListener('astro:before-swap', () => {
  chart.destroy();  // Prevent canvas memory leak
  ac.abort();       // Remove resize listener
}, { once: true });
window.addEventListener('resize', handler, { signal: ac.signal });
```

**Gotchas:**
- CDN `<script is:inline src>` causes race condition with `astro:page-load` — use dynamic loading with `ensureChartJS()` instead
- Chart.js CDN `<script>` tags don't re-execute on ViewTransitions navigation — must use `astro:page-load` listener
- `chart.destroy()` on `astro:before-swap` prevents canvas memory leaks across navigations
- AbortController pattern prevents resize listener accumulation
- `aspectRatio` (not fixed height) for responsive charts: `isMobile ? 1.4 : 2.2`

**Recommendation:** All future charts should follow this file as the canonical reference. Reuse the palette tokens, the tooltip pattern, the legend pattern, and the ViewTransitions cleanup.

---

## 2026-03-15 - Container Query Units for Responsive Metric Cards

**Context:** Salary Analytics editorial redesign — 3-column metric grids showing dollar values ($4,209,425) overflowed on both mobile and desktop when position cards were narrow.

**Insight:** Fixed font sizes (even with mobile media queries) can't adapt to the actual card width. Using `container-type: inline-size` on the card and `clamp()` with `cqi` units makes text scale with the container, not the viewport.

**Pattern:**
```css
.position-card {
  container-type: inline-size;
}
.metric-value {
  font-size: clamp(0.875rem, 1.8cqi, 1.125rem);
}
.metric-label {
  font-size: clamp(0.5625rem, 1.2cqi, 0.6875rem);
}
```

**Why this works:** On desktop with 3 position cards per row, each card is ~400px so `cqi` maps to a comfortable size. On mobile at 375px full-width, the same units produce a slightly smaller but readable size. No separate media query needed.

**Also:** Use `min()` in grid templates to prevent cards from forcing horizontal scroll: `grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr))`.

---

## 2026-03-15 - JS-Created Rows Need :global() for Astro Scoped Styles

**Context:** Salary Analytics tables — `<tbody>` is empty at SSR and rows are injected by client-side JS (`buildPlayerRow()`).

**Insight:** Astro scoped styles add `[data-astro-cid-xxx]` attributes only to elements rendered at build time. JS-created elements don't have these attributes, so scoped selectors like `.editorial-table tbody tr:first-child td` won't match them.

**Fix:** Wrap the dynamic-element portion of the selector in `:global()`:
```css
/* ❌ Won't match JS-created rows */
.editorial-table tbody tr:first-child td { padding-top: 0.625rem; }

/* ✅ Scoped to the table (SSR), global for the rows (JS) */
.editorial-table :global(tbody tr:first-child td) { padding-top: 0.625rem; }
```

**Recommendation:** Any page with JS-populated table bodies, lists, or containers must use this pattern. The parent element (`.editorial-table`) stays scoped for isolation, but child selectors for dynamic content use `:global()`.

---

## 2026-06-24 - EventHeroShell Pill is White-on-Accent — Accents Must Clear Contrast

**Context:** TheLeague's branded homepage hero (`EventHeroShell.astro`) renders its eyebrow pill as `background: var(--ev-accent); color: #fff;`. The `--ev-accent` value comes per-event from `CATEGORY_ACCENT` in `src/utils/league-event-hero-view.ts` (keyed by calendar category: preseason / free-agency / draft / regular-season).

**Insight:** Because the pill is white text on the raw accent color (13px bold uppercase — *not* WCAG "large" text, which starts at 14pt bold / 18.66px), every accent must clear ≥4.5:1 against white for AA. The original preseason accent `#60a5fa` (light blue) measured only ~2.5:1 and rendered an unreadable pill. It was darkened to `#2563eb` (white-on-blue ≈ 5.2:1). The other accents already clear it: red `#dc2626`, green `#2e8743`, purple `#7c3aed`, navy `#1c497c`.

**Recommendation:** When adding or changing any value in `CATEGORY_ACCENT` (or passing a custom `accent` to `EventHeroShell`), check white-on-accent contrast before shipping — the pill, not the card background, is the binding constraint. `CATEGORY_ACCENT` / `CATEGORY_GLOW` are exported and are the single source of truth; the standalone preseason heroes (`TagExtensionHero`, `TaggedPlayerShowcaseHero`) reference `CATEGORY_ACCENT.preseason` rather than hardcoding the hex, so they stay in sync automatically.

**Parallel CSS tokens — keep in lockstep.** The same category palette is *also* declared as `--cat-*` CSS custom properties (`CalendarEventCard.astro`, `WhatsNextCard.astro`) and as `var(--cat-*, <fallback>)` fallbacks in `hero-resolver.ts`. They must hold the **same hex** as `CATEGORY_ACCENT` or "preseason blue" drifts into two values. When you change a category accent, grep `--cat-<category>` and the resolver fallbacks and update all of them together. As of 2026-06-25 the calendar cards are "mini heroes" (see below), so they now render the same **white-on-accent pill** as the hero — the AA contrast constraint above now applies to the cards too, not just `EventHeroShell`.

**Escape hatch — flip the pill ink instead of forcing the accent dark (2026-07-08).** The white-on-accent ≥4.5:1 rule pins every pill accent to a *dark* hex, which reads muddy on a dark card where you actually want the accent to glow. `WhatsNewRow.astro`'s `--cat-*` palette resolves the tension by making the pill text a token, `--cat-badge-ink` (white in light mode over deep accents), and in a `:global(html.dark) .whats-new-row` block it both **lifts the accents to 400-level** (`#4ade80`, `#a78bfa`, `#f87171`…) **and flips `--cat-badge-ink` to near-black** (`#0b0f16`). Dark ink on a bright pill clears AA the other direction, so the same stripe/icon/dot get to glow while the badge stays legible. So per theme you have two knobs, not one: if you want a light accent in dark mode, invert the ink rather than darkening the accent. (Note this diverges from the shared `--cat-*` values in the whats-new listing/detail pages, which kept white ink — the homepage row is a deliberately louder surface.)

## 2026-06-25 - "Mini Hero" Card Pattern (Calendar / What's Next)

**Context:** Calendar event cards (`CalendarEventCard.astro` for the full calendar, `WhatsNextCard.astro` for the homepage) were restyled to read as small versions of `EventHeroShell`: deep-navy `#0f1e2e` card, per-category accent on the icon chip, pill, glow wash, border, and a big tabular countdown number. No player images.

**Insight / reusable recipe** for making any card adopt the hero look:
- Set a per-category accent var on the root (`--card-accent`, defaulted then overridden by `.card--<category>`), plus a matching `--card-glow`. Glow is a low-alpha rgba of the accent; the chip tint uses `color-mix(in srgb, var(--card-accent) 22%, transparent)` exactly like the hero (`EventHeroShell.astro:231`).
- Layer order matters: an absolutely-positioned `__glow` element at `z-index:0` under a `z-index:1` `__body`, with `isolation: isolate` on the card so the glow's radial gradient doesn't bleed past the rounded corners.
- Title uses `--font-display` condensed uppercase; countdown number uses `--font-numeric` + `tabular-nums` in the accent color; links become on-navy chips (`rgba(255,255,255,.08)` bg, white-on-hover) mirroring `.tl-hero-panel__link`.
- State handling: `--past` drains `--card-accent` to gray + dims opacity; `--active` swaps the pill to `--color-success` and shows a pulsing dot (gated by `prefers-reduced-motion`); `--urgent` goes `--color-warning`.

**Gotcha:** the multicolor NFL sprite (`MULTICOLOR_ICONS = ['nfl']`) must NOT be tinted — give it a `--chip--multicolor` modifier that sets the chip bg to neutral `rgba(255,255,255,.1)` and the icon `fill: none`, otherwise the accent recolors the league logo.

**Evidence:** `src/components/theleague/CalendarEventCard.astro`, `src/components/theleague/WhatsNextCard.astro`, mirrors `src/components/theleague/EventHeroShell.astro`.

## 2026-06-24 - Per-League Theming via `html[data-league]` + Single-Value-Per-League Tokens

**Context:** AFL and TheLeague share `TheLeagueLayout.astro`, `Header.astro`, `Footer.astro`, and `tokens.css`. Before this change there was **no per-league theming hook in the Astro app** — both leagues resolved the identical `tokens.css`, so `--color-primary` was `#1c497c` blue for *both*. AFL's "red" identity only existed in the MFL skin (`_variables-afl.scss`), not the Astro site. Result: AFL homepage components rendered blue even though the design intent was red.

**The dead-fallback trap.** Nine AFL components carried `--afl-accent: var(--color-primary, #c41e3a)` — the author's intent (the `#c41e3a` red fallback) **never rendered**, because a `var()` fallback only applies when the referenced var is *undefined*, and `--color-primary` is always defined. So the components silently rendered blue. Same shape bit `var(--afl-red, #c41e3a)` in `AflEventHero` — except there `--afl-red` was genuinely undefined, so the red fallback *did* render. Lesson: `var(--x, <fallback>)` is not "prefer fallback for this league" — it's "fallback only if `--x` is missing." To get a per-league value you must actually *set* a different value per league.

**The pattern that works:**
1. Add `data-league={league}` to `<html>` in `TheLeagueLayout.astro` (the `league` var already exists there: `'afl'` | `'theleague'`). This is the scoping hook — it didn't exist before.
2. Define the token once in `:root` with the default (TheLeague) value: `--league-accent: var(--color-primary);`
3. Override in a scoped block: `html[data-league="afl"] { --league-accent: #c41e3a; }`. Specificity `(0,1,1)` beats `:root`'s `(0,1,0)`, so AFL wins. Custom-property declaration order inside the block is irrelevant — vars resolve at *use*, so `--breadcrumb-bar-bg: var(--afl-navy)` can reference `--afl-navy` declared on a later line.
4. Components consume the shared token (`var(--league-accent, …)`); they don't need to know the league.

**Tokens established (all in `tokens.css`):** `--league-accent` (TheLeague blue / AFL red `#c41e3a`), `--header-nav-icon-color` + `--header-nav-icon-hover-color` (TheLeague blue→green / AFL navy→red), `--breadcrumb-bar-bg` + `--inverse-bg` (AFL deep navy `#0f1e2e`, DRY'd into one `--afl-navy` since it appears 3×). Crucially `--color-primary` was left **untouched** for AFL — so links, headings, nav-active states, and table headers keep blue while only the deliberately-scoped accents change. Don't reach for overriding `--color-primary` per league unless you really want the blast radius; prefer a dedicated semantic token.

---

## 2026-06-27 - Two AFL golds: `--afl-gold` (orange) vs `--afl-trophy-gold` (badge metallic)

There are **two** AFL gold tokens and they are not interchangeable:
- `--afl-gold: #d97706` — an orange-amber (literally the same value as `--color-warning-dark`). Despite the comment calling it "trophy gold," it does **not** match the award-badge art.
- `--afl-trophy-gold: #c9a44c` (+ `--afl-trophy-gold-light: #e6c976`) — the actual metallic gold used in the trophy-badge SVGs. Use this for anything meant to read as the same gold as the trophies (progress-bar pips, tier-title accents, the championship hero).

Two gotchas when unifying gold:
1. `AflChampionshipHero.astro` **locally redefines** `--afl-gold` inside `.afl-champ-hero`, shadowing the global token — to retheme it, change the local override line, not the global token.
2. `#c9a44c` is a **low-contrast text color on white** (≈2:1). It's fine as fills/borders and as text on the navy badges, but for gold *text* on a light background (e.g. the hero kicker/"VS"), it's softer than the orange it replaced — neither passes WCAG AA for small text, so it's a judgment call, not a regression.

---

## 2026-06-25 - Font Token Architecture and Heading Font System

**Context:** Expanding UFC Sans Condensed from hero/display elements to all h1–h4 headings site-wide.

**Font tokens in `src/styles/tokens.css`:**
```css
--font-family-base: var(--font-vend-sans, 'Vend Sans'), system-ui, …;  /* body */
--font-display: 'UFC Sans Condensed', 'Arial Narrow', 'Oswald', system-ui, sans-serif;  /* headings/hero */
--font-numeric: 'UFC Sans', 'Vend Sans', system-ui, sans-serif;  /* numbers/stats */
--font-family-mono: Menlo, Monaco, …;  /* code */
```

**Vend Sans** is loaded via Astro's `Font` component (Google Fonts optimized) — configured in `astro.config.ts`. **UFC Sans** and **UFC Sans Condensed** are self-hosted `.woff2` files under `public/assets/fonts/`, registered with `@font-face` in `tokens.css`.

**Heading font-family lives in `TheLeagueLayout.astro`**, not `tokens.css` — the global `:global(h1)–:global(h4)` rules are the right place to apply `--font-display` to bare heading elements.

**`TheLeagueLayout.astro` is the real layout for both leagues.** AFL pages import `TheLeagueLayout`, not the base `Layout.astro`. If you're making a site-wide style change for AFL or TheLeague, edit `TheLeagueLayout.astro`. `Layout.astro` has a parallel copy of heading rules for edge-case pages (login, 404) — keep both in sync.

**Heading scale (as of 2026-06-25):**
| Level | Size |
|-------|------|
| h1 | 2.25rem |
| h2 | 1.75rem |
| h3 | 1.5rem |
| h4 | 1.125rem |

These are fixed rem values (not fluid clamps) because UFC Sans Condensed is a display face — its optical weight doesn't need fluid scaling the way body text does.

**Section title labels** (editorial uppercase headers with left border, e.g. `.afl-conf__title`) are separate from bare h3/h4 elements and have their own class-level `font-size` overrides. These are not affected by the global h3/h4 rule because class specificity wins. As of 2026-06-25: `0.9rem` (bumped from `0.75rem` to compensate for UFC Sans Condensed appearing slightly smaller at the same rem value as Vend Sans).

**Verification gotcha.** `@import`ed `tokens.css` inside an Astro `<style>` block does **not** reliably HMR — after editing tokens or a component's scoped style, *restart* the dev server for a clean compile, don't trust the live page. Also, `preview_inspect`/`getComputedStyle` reflects `:hover` if the synthetic cursor is parked over the element — a "resting" color reading that comes back as the hover value usually means the pointer is over it; read all sibling elements at once and the non-hovered ones show the true resting color.

---

## 2026-06-25 - Per-League Favicons and `<head>` Metadata in TheLeagueLayout

**Context:** Both AFL and TheLeague pages share `TheLeagueLayout.astro`, which previously served one `favicon.ico` and one `manifest.json` for both. The AFL design system ships a distinct favicon set (AFL football mark, navy `#002244` theme color, its own `site.webmanifest`).

**Pattern:** Gate the entire favicon/PWA `<head>` block on the `league` variable that's already derived from `leagueContext.slug` earlier in the layout frontmatter:

```astro
{league === 'afl' ? (
  <>
    <link rel="icon" type="image/svg+xml" href="/assets/afl/favicons/favicon.svg" />
    <link rel="icon" type="image/svg+xml" href="/assets/afl/favicons/favicon-dark.svg" media="(prefers-color-scheme: dark)" />
    <link rel="icon" type="image/x-icon" href="/assets/afl/favicons/favicon.ico" />
    <link rel="apple-touch-icon" href="/assets/afl/favicons/apple-touch-icon.png" />
    <link rel="manifest" href="/assets/afl/favicons/site.webmanifest" crossorigin="use-credentials" />
    <meta name="theme-color" content="#002244" />
    <meta name="apple-mobile-web-app-title" content="AFL" />
  </>
) : (
  <>
    {/* TheLeague defaults */}
  </>
)}
```

**AFL favicon asset location:** `public/assets/afl/favicons/` — includes `favicon.svg`, `favicon-dark.svg`, `favicon.ico`, `favicon-{16,32,48,192,512}.png`, `apple-touch-icon.png`, and `site.webmanifest`.

**Webmanifest gotcha:** The `site.webmanifest` from the AFL design system ships with *relative* icon paths (`"src": "favicon-192.png"`). When served from `/assets/afl/favicons/site.webmanifest`, relative paths resolve to `/assets/afl/favicons/favicon-192.png` correctly in most browsers — but to be safe and explicit, update the manifest to use **absolute** paths (`"/assets/afl/favicons/favicon-192.png"`) so it resolves correctly regardless of where the file is served from.

**Verification:** Inspect `Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="manifest"], meta[name="theme-color"]')).map(el => el.outerHTML)` on an `/afl-fantasy/` page to confirm the AFL block renders and the TheLeague defaults are absent.

---

## 2026-06-25 - SVG Sprite Icons Need `fill: currentColor` on the Wrapper

**Context:** AFL homepage Explore section — all icons appeared black except Playoffs, which was red.

**Root cause:** SVG `<use>` elements that reference sprite symbols inherit their fill from the symbol's own path attributes, not from the wrapper SVG's CSS `color`. The browser's default SVG fill is `black`. Setting `color: var(--afl-accent)` on the wrapper alone is insufficient — it only works if the path element inside the symbol has `fill="currentColor"` baked in.

In `public/assets/icons/sprite.svg`, `icon-playoff` had `fill="currentColor"` on its `<path>` elements; all other AFL icons did not.

**Fix:** Add `fill: currentColor` to the CSS rule targeting the wrapper SVG element:
```css
.afl-links__icon {
  color: var(--afl-accent);
  fill: currentColor;   /* required — CSS color alone doesn't cascade into SVG fill */
}
```

This overrides the SVG default for any path that doesn't have an explicit fill attribute, while leaving icons with hardcoded fills (e.g. multi-color logos like `icon-nfl`) unaffected (their paths have explicit fill values that win over the CSS rule).

**When to apply:** Any component that uses `<svg class="…"><use href="…" /></svg>` sprite icons and wants them to pick up an accent color via CSS. Always pair `color` with `fill: currentColor` on the icon wrapper.

---

## Loading State Standard (Phase 0 — June 2026)

A site-wide loading standard exists, adapted from the Alaska + Hawaiian guest-app loading framework. Core rule: **choose the loading indicator by elapsed wait time, not by screen** — a duration ladder (nothing < 0.3s → optimistic → skeleton/button-spinner in the 1–10s band → branded 10s+ moment for AI endpoints). It reuses the **structure-vs-skin** model directly: behavior/ARIA identical across both leagues, accent skinned only via `var(--league-accent)`.

The repo had **no shared loading infrastructure** before this — 5 distinct spinners, 1 real skeleton, ~18 ad-hoc text mutations, inconsistent reduced-motion coverage (`PendingTradesPanel` guards its pulse; the playoffs shimmer doesn't). New loaders follow the `PlayerCell` dual Astro + JS pattern and a mandatory `@media (prefers-reduced-motion: reduce)` guard.

**Status:** Phase 1 — primitives, the prototype (`/theleague/loading-prototype`, since removed), and the branded roster loader are built; migration of existing pages not yet started. Docs: [loading-standards.md](../../loading-standards.md), [loading-inventory.md](../../loading-inventory.md), [loading-roadmap.md](../../loading-roadmap.md), [loading-prd.md](../../loading-prd.md).

---

## 2026-06-29 - UFC Sans Condensed Only Ships 400 and 700 — Never Ask for 800

**Context:** The branded division-standings banner spec called for `font-weight: 800` at 26px. Rendered with the body font it looked dramatically bigger/wider than the design; even after switching to the display font, 800 still looked bloated.

**Insight:** The `@font-face` declarations in `src/styles/tokens.css` register UFC Sans Condensed at exactly two weights: 400 (CondensedMedium) and 700 (CondensedBold). Requesting any heavier weight (800/900) makes the browser synthesize faux-bold — it smears the glyphs wider, defeating the condensed face's whole purpose and reading as "too big" even when `font-size` matches the design px-for-px. The same applies to UFC Sans (400/500 only).

**Recommendation:** For display/headline text use `font-family: var(--font-display, 'UFC Sans Condensed', 'Arial Narrow', sans-serif)` with `font-weight: 700` — never 800+. If a design mock looks "smaller" than the implementation at the same px size, check the font family and synthesized weight before touching `font-size`.

---

## 2026-07-04 - AFL Red via `var(--color-primary, #c41e3a)` Is a Bug — the Fallback Never Fires

**Context:** 19 declarations across 7 AFL pages (about, keepers, calendar, rules, rules-chat, franchises index + [id]) used `var(--color-primary, #c41e3a)` or `var(--primary-color, #c41e3a)` intending "AFL red." Confirmed via computed styles: every one rendered TheLeague blue `#1c497c`, because `--color-primary` (and its `--primary-color` alias, tokens.css ~line 472) is always defined — a var() fallback only applies when the variable is *undefined*, not when its value isn't what you hoped. Under the dark-mode rescope, `--color-primary` becomes gold, so the same declarations would have silently turned gold in dark mode.

**Insight:** A red hex in the fallback slot of a blue-resolving token is a latent copy-paste trap — it looks league-aware in the source and even shows red in devtools' fallback preview, but never on screen. `--color-primary` is intentionally never overridden for AFL (see "Per-League Theming" insight above); the only correct way to say "AFL red / TheLeague blue" is `var(--league-accent, #c41e3a)`, which resolves red on AFL in both light and dark (`html[data-league="afl"]` sets it, and tokens-dark.css leaves it alone).

**Recommendation:** All 19 were swapped to `var(--league-accent, #c41e3a)` (2026-07-04). When writing or reviewing AFL styles, grep for the smell: `grep -rnE 'var\(--(color-primary|primary-color), ?#c41e3a\)' src/`. A fallback hex that differs in *hue* from the token's real value is almost always intent leaking into the wrong slot.

---

## 2026-07-04 - Dark Surface + Text Pairs Must Both Come From the Inverting Gray Scale

**Context:** The Asset Library banner (`.gallery-header` in `src/pages/theleague/assets.astro`) rendered white text on near-white gray — invisible. The CSS was `background: var(--gallery-content-bg, #1f2937); color: #fff`.

**Root cause (two-part):**
1. **A `var()` fallback is not design intent.** The dark `#1f2937` fallback never applies when the token is defined anywhere up the cascade — and the page's own `<style>` set `--gallery-content-bg: #eeeeee` for its card wells. If an element needs a specific color, point it at the token that IS that color (`--color-gray-800`); don't rely on a fallback that a token definition silently overrides.
2. **Picking the replacement text color:** in `tokens-dark.css` the gray scale inverts as a unit (`--color-gray-800` flips to light `#d8d8d8`, `--color-gray-50` flips to dark `#181818`) but `--color-white` stays `#ffffff` in both modes. So `gray-800` background + `--color-white` text would recreate the invisible-text bug in dark mode.

**Root cause (part 3 — found in review):** setting `color` on the container is NOT enough. `TheLeagueLayout.astro` has a global element-level rule (`h1, h2, h3, h4 { color: var(--primary-link-default-text-color) }`), and a direct declaration on the element always beats an inherited value — regardless of specificity. The banner's `<h1>` stayed dark (`#111827` on `#1f2937`, 1.21:1) even with `color: var(--color-gray-50)` on `.gallery-header`. The bug slipped past the first verification pass because only the container's computed color and a screenshot were checked. **Verify heading fixes by reading the heading element's computed color, not the container's and not a screenshot.**

**Recommendation:** For any surface/text pair that must keep contrast across light and dark modes, take BOTH sides from the gray scale so they invert together — e.g. `background: var(--color-gray-800, #1f2937); color: var(--color-gray-50, #f9fafb)`. Never pair a gray-scale background with `--color-white` / `--color-black` text. And when the surface contains headings or links, add an explicit rule for those elements (`.my-banner h1 { color: var(--color-gray-50, #f9fafb); }`) — the layout's global `h1`–`h4` and `a` color rules override anything the container tries to pass down by inheritance.

---

## 2026-07-04 - `:global()` Is Inert Outside Astro Scoped Styles — Dead CSS in React `<style>` Literals and `is:global` Blocks

**Context:** TradeBaitMarketplace.tsx (a React island) carried 8 dark-mode rules written as `:global(html.dark) .marketplace__header { ... }` inside its `<style>{marketplaceStyles}</style>` template literal. They shipped to the browser verbatim as literal, unmatchable CSS — the dark trade-builder page silently showed light-mode amber. The same pattern was dead in 4 other trade-builder TSX components and 5 `<style is:global>` pages (fixed in bulk on the dark-mode branch, commit `4445bf795d`: 31 dead rules total).

**Insight:** `:global()` is a directive for Astro's scoped-style compiler, not real CSS. It only means something inside a plain scoped `<style>` in a `.astro` file. In a React/JSX style tag, a `<style is:global>` block, or any CSS injected via `set:html`, nothing compiles it away — the browser sees `:global(html.dark)` as an invalid selector and drops the rule. The failure is silent: the page still renders, just without the override, so light-mode colors can "look OK by coincidence" in dark mode.

**Recommendation:** Match the selector style to the style context: Astro scoped `<style>` → `:global(html.dark) .foo`; everything else (React `<style>` literals, `is:global`, injected CSS) → plain `html.dark .foo`. To audit, curl the rendered page — the literal string `:global(` in the response body always means dead rules: `curl -s localhost:PORT/page | grep -c ':global('` should be 0.

---

## 2026-07-04 - Data-File `icon` Fields Store BARE Sprite Glyph Names — Validated Against sprite.svg by Tests

**Context:** The dark-mode What's New entry shipped `"icon": "icon-eye"` instead of `"eye"`. Every consumer renders `<use href={`${spriteUrl}#icon-${value}`}>`, so the double prefix resolved to the nonexistent `#icon-icon-eye` and the hero eyebrow chip silently rendered empty — no error, no broken-image indicator. A sweep then found two more long-standing dead references in `page-directory.json` (`draft`, `scroll` — glyphs that never existed in the sprite), meaning the 2026 Rookie Rankings and AFL Constitution directory cards had blank icons in production.

**Insight:** Every data file that references the shared sprite (`public/assets/icons/sprite.svg`) — `whats-new.json`, `page-directory.json`, `nav-config.json` — stores the bare glyph name; display code prepends `icon-`. A wrong value fails completely silently: `<use>` pointing at a missing fragment renders nothing. This class of bug is now blocked at PR time for all three files: `tests/helpers/sprite-icons.ts` exports `describeSpriteIconValidation(label, refs)`, which registers the standard three-test suite (sprite parse sanity, no `icon-` double-prefix, every value exists as a `<symbol>` glyph). Consumers: `whats-new-data.test.ts`, `page-directory-data.test.ts`, `nav-config-icons.test.ts` (the latter covers `icon`, `iconAFL`, and footer links).

**Recommendation:** When adding an icon reference to any data file, use the bare glyph name and pick from the sprite's actual inventory (`grep -o 'id="icon-[^"]*"' public/assets/icons/sprite.svg`). If a new data file starts referencing the sprite, call `describeSpriteIconValidation()` from `tests/helpers/sprite-icons.ts` in its data test — map each entry to `{ source, icon }` — rather than reimplementing the checks.

---
## 2026-07-04 - Dark-Mode Token Migration: The AFL Dead-Var Family

**Context:** Migrating older AFL Fantasy pages (`rules.astro`, `rules-chat.astro`,
`keepers.astro`, `franchises/index.astro`, `franchises/[id].astro`) plus
`theleague/design-system.astro` to be dark-mode-safe.

**Insight:** A cluster of AFL pages was written against a set of CSS custom
properties that were **never defined in `tokens.css`/`tokens-dark.css`**.
Because `var(--undefined-name, fallback)` still renders via its fallback, these
pages "worked" in light mode by accident — but the fallback is a fixed light
hex that never inverts, so every one of these was a dark-mode bug waiting to
surface. The dead-var → real-token mapping (consistent across all 5 files):

| Dead var (never defined) | Real token |
|---|---|
| `--text-muted` | `--content-text-muted` |
| `--text-default` (no fallback) | `--page-text` |
| `--border-color` | `--content-border` |
| `--primary-color` | `--color-primary` |
| `--bg-muted` / `--code-bg` | `--content-bg-muted` |
| `--surface` / `--surface-2` | `--card-bg` / `--content-bg-muted` |
| `--color-bg-subtle` / `--color-border-subtle` | `--content-bg-muted` / `--content-border` |
| `--color-text-strong` / `--color-text-muted` | `--color-gray-900` / `--content-text-muted` |

`--text-default` is the sneaky one: with no fallback value, an undefined
`var()` makes the whole declaration invalid, which for the inherited `color`
property computes to the inherited value — so it often *happened* to render
correctly (inheriting `--page-text` from `body`) while still being wrong to
leave in place (no dark-mode guarantee, easy to break if the DOM structure
changes). Grep for `var(--text-default)`, `var(--text-muted`, `var(--border-color`,
`var(--primary-color`, `var(--bg-muted`, `var(--surface` across any
not-yet-migrated AFL page — this exact list keeps recurring file to file.

**Second bug pattern found:** `var(--afl-navy, #0f1e2e)` used as a **text**
color (`franchises/[id].astro` — trophy-wall label + title-pips ratio).
`--afl-navy` (#0f1e2e) is deep navy — correct for text on a light card, but
it's *also* the dark-mode page background (`html.dark[data-league="afl"]`
sets `--page-bg: var(--afl-navy)`), so navy-on-navy text goes invisible.
Any raw `--afl-navy`/`--afl-gold`-style brand constant used as *text* (not a
background/border/accent) should be double-checked against dark mode — these
brand hexes are fixed, not part of the inverted token ramp.

**Same family, TheLeague side (2026-07-08):** the Schefter Ops admin dashboard
(`src/pages/theleague/admin/schefter.astro`) had the identical bug — its whole palette
runs on `--color-surface`, `--color-surface-alt`, `--color-text`,
`--color-text-muted`, `--color-border`, `--color-accent`, none of which are
defined in `tokens.css`/`tokens-dark.css`, so every card baked in a light
fallback and stayed white in dark mode while the body's inherited `--page-text`
went light on top (light-on-white, unreadable). **Fix technique — container
remap, not call-site rewrite:** when a page consistently reads *one family* of
undefined local tokens (dozens of `var()` sites), you don't have to touch each
site. Define those locals once at the page-root under
`:global(html.dark) .page-root { --color-surface: var(--content-bg); … }` —
custom properties inherit, so every descendant `var(--color-surface, …)`
resolves the dark value and light mode is untouched (the block is
`html.dark`-scoped, so the fallback still fires there). Only the handful of
spots that hardcoded a literal (`background: white` code chips, `#f1f5f9` bar
track, an amber-50 callout) still need their own `:global(html.dark)` override.
Local→real mapping used: `--color-surface`→`--content-bg`,
`--color-surface-alt`→`--content-bg-muted`, `--color-text`→`--color-text-primary`,
`--color-text-muted`→`--content-text-muted`, `--color-border`→`--color-border-default`,
`--color-accent`→`--color-primary`.

**Third pattern:** hardcoded per-button hex trios like
`background:#fff; color:#c41e3a; border:1px solid #c41e3a;` with a hover that
hardcodes a hand-picked darker shade (`#a01830`, `#a31a31`) — convert the base
three to `--card-bg` / `--color-primary`, and the hover darken to
`color-mix(in srgb, var(--color-primary) 80%, black)` rather than inventing a
new fixed hex — it tracks the token if the brand color ever changes and
self-adjusts in dark mode without a separate override.

**Known pre-existing gotcha (not fixed, flagged separately):** many AFL pages
write `var(--color-primary, #c41e3a)` intending "AFL red, red fallback" — but
`--color-primary` is *deliberately* never overridden for AFL (see the comment
block in `tokens.css` ~line 620: TheLeague blue is kept for links/headings/nav
on purpose). AFL's actual accent lives in `--league-accent` (red in both
light and dark AFL modes). This means those `var(--color-primary, #c41e3a)`
call sites resolve to blue at runtime, not red — the red only shows if you
read the fallback in devtools. This is a widespread, pre-existing pattern
across many AFL files (not introduced by dark-mode migration work) and needs
its own investigation/fix pass rather than a drive-by change during a
token-migration task.

**Preview switcher pattern (design-system.astro):** to add a page-local
light/dark toggle that never persists, call `window.__applyTheme('light'|'dark')`
(defined by `ThemeScript.astro`) directly — it only toggles the `dark` class +
theme-color meta + fires `theme-change`. Do **not** call
`setClientThemePreference()` (that's what writes the `theme_pref` cookie).
Restore the visitor's real theme on `astro:before-swap` (soft nav) and
`pagehide` (hard nav / tab close) by calling `window.__applyTheme()` with no
argument, which re-resolves from the cookie.

**Another dead-var family — the Schefter Ops page (`admin/schefter.astro`):** the
same "renders light in every theme" bug recurs here with a *different*, also-never-
defined token set: `--color-surface`, `--color-surface-alt`, `--color-border`,
`--color-text`, `--color-text-muted` (the un-suffixed legacy names; `tokens-dark.css`
only defines the *suffixed* `--color-surface-1/2/3`, `--color-text-primary/secondary`,
`--color-border-default/subtle`). `--color-accent` *is* defined, so only that one
themed. Fix technique — when a whole page/subtree shares one dead-var family, prefer
a **scoped remap** over rewriting every `var()` call site: define the legacy names on
the page container under `html.dark`, pointed at the real dark tokens —
```css
html.dark .ops-page {
  --color-surface: var(--color-surface-2, #1e1e1e);
  --color-surface-alt: var(--color-surface-3, #2a2a2a);
  --color-border: var(--color-border-default, #3a4056);
  --color-text: var(--color-text-primary, #e0e0e0);
  --color-text-muted: var(--color-text-secondary, #8a8a8a);
}
```
Custom properties set on a closer ancestor win for all descendants, so one block
darkens the entire page (every `var(--color-surface, …)` inherits it) without
touching the individual rules — light mode still uses the fallback hexes. Watch for
small hardcoded-hex accents left over (status text, pills) and lift those separately.

---

## 2026-07-04 - Dark Mode Migration Playbook

**Context:** ~37 commits' worth of per-page dark-mode fixes (theme engine,
per-page migrations, AFL navy ramp, team icon variants, QA harness) converged
on the same handful of failure signatures and recipes across every page.
Recording the playbook so future dark-mode work (new pages, or the remaining
migration tail) doesn't rediscover it page by page.

**Two failure signatures, in order of how often they bite:**

1. **Hardcoded light hex under inverting text/background.** Literal `white`,
   `--color-white`, or a hand-picked light hex used where a *surface* token
   belongs never inverts — the page goes dark around it but that one element
   stays light-mode. The AFL-specific variant: a raw brand constant like
   `--afl-navy` used as **text** color is fine on a light card but goes
   invisible once `html.dark[data-league="afl"]` repoints `--page-bg` to that
   same navy (see the 2026-07-04 dead-var entry above for the `[id].astro`
   trophy-wall case). Fix: surfaces route through `--card-bg`/`--input-bg`;
   any `color-mix(..., white)` must mix against `var(--content-bg, white)`
   instead of the literal keyword so the mix target inverts too.
2. **Dead vars** — a `var(--never-defined-name, fallback)` that "worked" in
   light mode purely because the fallback happened to match, then renders
   wrong (or invisible) in dark because the fallback is a fixed light hex
   that never inverts. See the dead-var → real-token mapping table above;
   the fix is always the same shape (grep for the dead name across
   not-yet-migrated pages, swap to the real token).

**Five recipe one-liners** (reach for these instead of re-deriving):
- Raised card in dark: `:global(html.dark) .card { box-shadow: 0 0 0 1px var(--content-border, #555), var(--shadow-lg); }` — dark surfaces swallow soft shadows, so elevation needs a hairline border-via-shadow plus the (already ~2.5x brighter) `--shadow-lg`.
- Tinted card/row: `color-mix(in srgb, <hue> 7-12%, var(--card-bg))` — mixes toward whatever `--card-bg` resolves to per theme, so one line covers both.
- Darkening a brand hex for a hover state: `color-mix(in srgb, var(--color-primary) 80%, black)` instead of inventing a new fixed hex — tracks the token if the brand color changes and self-adjusts per theme.
- Sprite icon color: pair `color: var(--accent)` with `fill: currentColor` on the `<use>` wrapper — CSS `color` alone doesn't cascade into SVG fill.
- Page-local preview toggle (no persistence): call `window.__applyTheme('light'|'dark')` directly (never `setClientThemePreference()`), restore on `astro:before-swap` + `pagehide` by calling it with no argument.

**The `:root {}`-in-scoped-Astro-style gotcha:** an Astro component's scoped
`<style>` block silently does **not** scope a `:root { --token: ...; }` rule
the way it scopes every other selector — but it's also easy to *think* you
declared a token there and then find it "not working" for an unrelated
reason. Never declare tokens inside a component's scoped styles; tokens only
belong in `tokens.css` / `tokens-dark.css`.

**Dev staleness (two independent traps, not dark-mode-specific but hit hard
during this migration because of the sheer page count touched)** — full
details in memory `project_dev_stale_css_gotchas.md`:
- The PWA service worker (`public/sw.js`) cache-firsts CSS/JS, so a tab that
  ever visited the site keeps serving pre-edit stylesheets across dev-server
  restarts/HMR. `TheLeagueLayout.astro` registers it prod-only and actively
  unregisters + clears caches in dev; manual escape hatch is DevTools →
  Application → Service Workers → Unregister.
- Vite file-watching in this worktree sometimes fires change events without
  actually refreshing the served transform. When styles look stale after an
  edit, `curl` the page/CSS from the dev server and `grep` it rather than
  trusting a browser tab — and restart the dev server after batch edits
  instead of trusting HMR to catch up.

---

## Franchise brand colors — three roles, two utils, one AFL trap

Each franchise now carries a **chart color** and **up to four brand colors**,
and conflating them is the easy mistake:

- **`color`** (config) — the legacy chart/graph color, used on the owner-activity
  page. **Do not repurpose it.** It was chosen for distinctness on a white bar
  graph, not for brand identity, so a team's `color` and `colorPrimary` often
  differ (e.g. Maverick's chart color is gold but its brand primary is black).
- **`colorPrimary` / `colorSecondary` / `colorTertiary` / `colorQuaternary`**
  (config) — hand-tuned brand colors sampled from each team's icon + banner.
  Primary + secondary always resolve; tertiary/quaternary are optional.

Two utilities, deliberately layered so the fallback logic lives in one place:
- **`src/utils/team-colors.ts`** — league-aware (`getTeamColor` = chart color,
  unchanged; `getTeamColorPrimary/Secondary/Tertiary/Quaternary(fid, 'theleague'|'afl')`).
  Secondary falls back to a 40%-darkened primary; primary falls back to the
  chart color then gray.
- **`src/utils/franchise-brand.ts`** — TheLeague-only; `FranchiseBrand` **reuses**
  the team-colors accessors for its brand fields rather than re-deriving. Keeps
  `color` for legacy callers. The playoff round heroes tint via
  `brand.colorPrimary` (not `color`) — `franchiseGradient(colorPrimary)` for the
  panel fill, `franchiseGlow(colorPrimary, 0.42)` behind the crest.

**AFL config trap:** `data/afl-fantasy/afl.config.json` teams have nested
`ownerHistory[]` entries that carry their **own `franchiseId`**. A naive
"insert colors after the first `franchiseId` match" mis-targets those nested
blocks — franchises `0016` (Swiftie) and `0021` (Chatmaster) got their colors
written into an `ownerHistory` entry instead of the top-level team. Always
target the **top-level** team object, and audit with a JSON parse (count teams
with `colorPrimary`, and count `colorPrimary` leaks inside `ownerHistory`)
rather than a line-based grep.

---

## 2026-07-21 - Inline `style` Colors in JS-Built Markup Are Invisible to Both the Token Guard and Dark Mode

The rosters-page contract-year chips (`.yrs-chip`) stayed light-mode in dark
theme for two reasons, and only one of them is catchable by tooling:

1. **Hardcoded light gradients in `:global()` page styles** (`#eff6ff`/`#dbeafe`
   blues, `#fef3c7` ambers) with no `html.dark` overrides. The design-token
   guard can't flag these — they're valid literals, just wrong for the theme.
   Fix pattern: add `html.dark` overrides using the badge token pairs
   (`--badge-info/warning/error/success-bg/-text`) — same approach as the
   rank-tier pills in the same file.
2. **Inline `style="color:#059669"` inside JS string-built HTML** (the approved
   asterisk). An inline style beats any `html.dark` CSS override at specificity,
   so no stylesheet fix can reach it — the color must move into a class rule.
   Grep target when sweeping a page for dark-mode issues: `style="color:` and
   `style='color:` in `.astro`/`.ts` client scripts that build markup via
   string concatenation; the token guard test never sees these.

---
## 2026-08-09 - Inverse Surfaces Need Their Own Focus Ring and Theme-INVARIANT Tokens

**Context:** Rebuilding the site footer, which sits on a dark league color
(`--inverse-content-bg` in light, `--breadcrumb-bar-bg` in dark).

**Insight:** Two distinct traps on any "dark panel inside a light page" surface:

1. **The global focus ring can be invisible.** `tokens.css` sets
   `:focus-visible { outline: 2px solid var(--color-primary) }`, and
   `--color-primary` (#1c497c) IS TheLeague's light-mode footer background —
   contrast 1.00:1, a literally invisible ring on every footer link. AFL navy
   gives 1.84:1 and best-ball green 1.33:1, so all three leagues failed WCAG
   2.4.7 on a component that renders on every page. Nothing catches this: the
   token exists, the rule is valid, the value is just wrong *for that surface*.

2. **Their tokens should NOT be a light/dark pair.** CLAUDE.md warns about
   defining a token whose light and dark values differ and picking the wrong
   one. The inverse case bites here: an inverse surface is dark in BOTH themes,
   so white-on-dark values are correct in both. Defining `--footer-*` twice
   (once in `tokens.css`, again in `tokens-dark.css`) would restate identical
   values and invite them to drift apart.

**Evidence:** `src/styles/tokens.css` — the `--footer-*` / `--trophy-*` family
is defined once under `:root` with an explicit "do not add overrides in
tokens-dark.css" note. `--footer-focus-ring` is re-pointed to white and applied
via `.site-footer :where(a, button, [tabindex]):focus-visible`.

**Recommendation:** When building any component on an inverse surface, (a)
scope a `:focus-visible` override to it rather than trusting the global ring —
check the ring color against the actual background, not against the page; and
(b) define its token family once, with a comment saying why there is no dark
block, so a future sweep doesn't "fix" the missing override.

---

## 2026-08-14 - Half-Tokenized Components Fail Worse Than Fully Hardcoded Ones

**Context:** The AFL player action modal (`AFLActionModal.astro`) rendered in
dark mode as a white card with near-white text on it — the player's name was
invisible. Nothing in the component was "wrong" in isolation.

**Insight:** The component was *half* tokenized. Its ink came from
`var(--color-gray-900, #111827)` / `--color-gray-600` (which invert to light
values under `html.dark`), while its surfaces were literals (`background: #fff`,
`border: 1px solid #e5e7eb`, pastel `#fef2f2` / `#ecfdf5` alert fills) that
cannot invert. Light mode is pixel-perfect, so it ships and stays shipped.

That's a third row for the table in the 2026-08-10 entry above:

| Failure | Symptom | Caught by the guard? |
|---|---|---|
| Token defined nowhere | Hardcoded fallback renders in BOTH themes | Yes |
| Token defined light-only | Light value renders in dark mode | No |
| **Ink tokenized, surface hardcoded** | **Inverted ink lands on a fixed light surface — worst contrast of the three** | **No** |

The tell is a component with *some* `var(--color-gray-*)` and *some* raw hex in
the same style block. Grep a suspect component for `#fff`/`#f9fafb`/`#e5e7eb`
next to `var(--color-`; the mixture is the bug, regardless of which half looks
correct.

**Fix pattern (preserves light mode exactly):** for each literal, check whether
the token's LIGHT value matches it byte-for-byte. `#6b7280` IS `--color-gray-500`,
`#374151` IS `--color-gray-700`, `#fff` IS `--card-bg` — those swap to tokens
with zero light-mode risk and invert for free. Where the light values differ
(`#e5e7eb` vs `--color-gray-200`'s `#dddedf`), keep the literal and add a
`:global(html.dark)` override instead. Don't tokenize on name plausibility.

**AFL dark collapses the card/panel elevation ramp — nested surfaces need
`--color-surface-3`.** Under `html.dark[data-league="afl"]`, `--card-bg`,
`--card-surface`, `--content-bg` and `--color-surface-2` are all the SAME value
(`#16283c`). So a child card painted with `--card-bg` inside a panel painted
with `--card-bg` is invisible — which is exactly what the modal's four action
rows did once the panel was themed. The elevated step is `--color-surface-3`
(`#1d3349` AFL, `#2a2a2a` generic dark), with `--content-border` for the edge.
Generic `html.dark` hides this: there `--card-bg` is a gradient over `#262626`
and surface-3 is `#2a2a2a`, different enough to look fine. Test nested surfaces
on the AFL palette, not TheLeague's.

**Corollary:** `--color-surface-3` is defined ONLY in `tokens-dark.css` — it has
no `:root` value. It passes `design-token-guard` (which asks whether a token is
defined *anywhere*) but renders its fallback in light mode. Dark-only tokens are
safe *only* inside a `:global(html.dark)` block. Check which theme file a token
lives in before using it in a theme-agnostic rule.

**Evidence:** `src/components/afl-fantasy/AFLActionModal.astro` — light rules
unchanged, all dark behavior in `:global(html.dark)` blocks. Verified with
`getComputedStyle` on the running page: panel `rgb(22,40,60)`, rows
`rgb(29,51,73)`, borders `rgb(46,69,96)`.
---
## 2026-08-14 - Franchise Foreground Colors Are a Theme-Pair TOKEN, Not a Config Hex

**Context:** The Pecking Order rendered rank numerals and card edges in each
franchise's raw `color`, which made half the column invisible in dark mode. The
fix had to be site-wide, not page-local.

**Insight:** A franchise color has two jobs and they need different plumbing.

- **Background fill** (deep-ink composite heroes, pick-reveal, dead-money) —
  white text sits ON the color, so the color itself can be anything dark. The
  existing `franchise-brand` / `getNflTeamColors` path is correct there.
- **Foreground** (text, numerals, borders, chart lines, legend swatches) — the
  color sits ON a card, so it must clear 3:1 against that card *in the theme
  being rendered*, and the server can't know the theme (preference 'auto'
  resolves client-side). A frontmatter hex is therefore always wrong for
  somebody.

That second case is now `--team-accent-<franchiseId>`, a global custom property
emitted per league by `src/utils/team-accent-css.ts` (light values plus an
`html.dark` block, scoped `html[data-league="…"]` because franchise ids collide
across leagues). Values come from `getTeamAccentPair`, which starts from the
config's hand-tuned `colorPrimaryDark` on dark surfaces and only nudges
lightness when a color still misses the floor — so colors that already worked
stay byte-identical.

**Evidence:** Before the sweep, TheLeague accents on the dark card: Bring The
Pain `#1a1a1a` = 1.15:1, Cowboy Up `#0d2b56` = 1.08:1, Wascawy Wabbits
`#5c5c5c` = 2.26:1. Light mode was broken too and nobody had noticed:
Midwestside `#ffcd00` = 1.50:1 on white, Mavericks `#c4b060` = 2.16:1.

**Two traps this surfaced:**

1. **An inline `style` can't be overridden by a dark-mode rule.** The first
   attempt set `--pr-accent` inline per card and tried to swap it under
   `:global(html.dark)` — inline always wins. Either emit BOTH values inline
   and have CSS choose (`--x-light`/`--x-dark`), or, better, have the inline
   style reference a var that is itself theme-switched. The token layer makes
   the second option free.
2. **`var()` does not resolve in an SVG presentation attribute.**
   `polyline.setAttribute('stroke', 'var(--team-accent-0001)')` renders nothing;
   `polyline.style.stroke = 'var(--team-accent-0001)'` works. Done via `style`,
   client-drawn charts follow the theme with no redraw and no theme listener
   (`OwnerActivityReport.astro`).

**Recommendation:** Reach for `teamAccentVar(fid)` for any new franchise-tinted
foreground; only bypass it for a full-bleed color fill with text on top.
`tests/team-accent-css.test.ts` fails the build if any franchise in any league
drops below 3:1 in either theme.

## 2026-08-15 - Two Badges at the Same Height Are Not the Same Size — Cap the Other Axis

**Context:** Putting the AFL tier crest (`premier.svg`, `dleague.svg`) and the
conference mark (`conferences/al.svg`, `nl.svg`) side by side as the headline of
two adjacent tiles on the AFL homepage's My Team card.

**Insight:** Sizing both to a shared height is the reflex, and it looks wrong.
The conference marks are ~2:1 (`viewBox="0 0 339.2 169.2"`) while the tier
crests are taller than wide (`0 0 270.2 338.9`), so at a shared 40px height the
AL badge rendered 80×40 against the crest's 32×40 — roughly twice the visual
mass, and it reads as a mistake rather than a hierarchy. What evens two
different-ratio marks up is constraining BOTH axes and letting `object-fit:
contain` pick the binding one: `height: 100%; width: auto; max-width: min(100%,
3.25rem)`. The cap is slack for the crest (unchanged) and binds on the
conference mark, which then draws at 52×26. Geometric mean — a decent proxy for
apparent size — lands at 35.8 vs 36.8, i.e. matched. The single rule needs no
per-asset flag and absorbs any future wide mark.

**Evidence:** Measured in the live page rather than eyeballed, which is worth
doing when the whole question is "do these look the same": read each `<img>`'s
`getBoundingClientRect()` and `naturalWidth/Height`, apply the contain scale
(`min(box.w/nat.w, box.h/nat.h)`), and print the drawn size. Before: `Premier
League: 32x40 | American League: 80x40`. After: `32x40 | 52x26`.

**Gotcha — the `-dark` variants draw smaller, and by DIFFERENT amounts, which
is what breaks an optical match.** Measured as rendered ink (alpha bounding box
in the real slot), not `getBoundingClientRect`:

| asset | drawn box | visible ink | geo. mean |
|---|---|---|---|
| `premier.svg` | 32.0x40.0 | 30.4x40.0 | 34.9 |
| `al.svg` | 52.0x26.0 | 51.1x23.8 | 34.9 |
| `premier-dark.svg` | 33.1x40.0 | 27.2x35.4 | 31.0 |
| `al-dark.svg` | 52.0x27.1 | 50.3x24.1 | 34.8 |

Light mode matches (34.9 vs 34.9). Dark mode does not (31.0 vs 34.8, ~11%
apart) — i.e. the tuning silently only half-applies. The cause is transparent
padding baked into the dark viewBoxes, in unequal amounts: `premier-dark` gets
30 units of slack per side (`-30 -30 330.2 398.9` around 270.2x338.9 of art),
`dleague-dark` gets asymmetric slack (`-55 -30 332 408.1`), and `al-dark` /
`nl-dark` only 8 (`-8 -8 355.2 185.2`). `object-fit: contain` fits the PADDED
box, so a 30-unit-padded crest loses ~13% of its ink while an 8-unit-padded
wordmark loses ~1%. Toggling the theme visibly shrinks the crest while its
neighbor barely moves.

**The padding is NOT dead space — it holds a halo, and that mattered.** An
early pass here concluded it was, on the evidence that `getBBox()` reports the
pair's ink as identical (`premier.svg` and `premier-dark.svg` both `14.4 -0.0
231.2 338.9`). That conclusion is wrong and it is recorded because acting on it
caused the second bug below: `getBBox()` returns the GEOMETRY box, excluding
stroke and filters, and the halo every dark badge paints so it reads on a dark
surface is exactly that — a stroke, and a `feMorphology` dilate on the crest.
The padding is sized to hold it. Centering is fine
(ink center offset is ≤0.9% of box on every asset), so nothing shifts sideways
on toggle; only scale is affected.

**Fixed in the ASSETS, not in CSS.** The four `-dark` viewBoxes were
re-authored to reproduce their light counterpart's ink-to-viewBox relationship
— the only layer that fixes it everywhere, since the discrepancy was live at
every other call site too — `.afl-tiers__logo`, `.badge-tier-logo` (20px),
`.promo-reg-logo` (50px), `.afl-playoffs-hero__bracket-logo`, StandingsTable's
`.tier-logo`/`.conference-logo`/`.division-conf-logo`,
`AflConferencePlayoffPreview`'s `.afl-conf__logo`, the sidenav tier crest
(`AFL_TIER_LINKS` in `NavLinks.astro`), and `AflEventHero` — and all of them
constrain with `height: X; width: auto`, so normalizing the
height fraction corrects each identically. Rendered ink in the real slot after
the fix: premier 34.9 light / 34.9 dark, al and nl 34.9 / 35.5, dleague 36.0 /
34.7. The dleague gap is artwork — its dark drawing is genuinely narrower — and
closing it means re-drawing, not moving a viewBox.

**`AflEventHero` makes this a LIGHT-mode change too.** Its panel is navy in
both themes, so it deliberately pins the dark badge on (`:global(.afl-event-hero
.afl-event-hero__badge.theme-img--dark) { display: block }`) regardless of
`html.dark`. Any edit to a `-dark` badge therefore ships to a light-mode surface
as well — worth checking the hero whenever you touch these files, and worth
saying out loud in a changelog entry that otherwise reads "dark mode only".

**The trap inside the trap: `getBBox()` does not include stroke, and the halo
IS a stroke.** The first attempt at this fix normalized against `getBBox()`,
which reported the dark ink as byte-identical to the light ink and therefore
"prove" the padding was dead space. It is not. Every `-dark` file paints a
white halo as a stroke on its paths so the mark reads on a dark surface, and
`getBBox()` returns the geometry box with the stroke excluded — so the padding
those viewBoxes carried was there to hold the halo, and normalizing to the
light viewBox clipped it on all four assets (measured overflow at a 40px
render: al/nl 1.19px off the left edge, premier 0.85px off the top, dleague
clipped on all four sides). It shipped looking fine in a screenshot because a
1px shaved off a white outline is invisible until you go looking.

Measure with an ALPHA bounding box over rendered pixels instead: render the SVG
large with `omitBackground: true`, scan the alpha channel for the extent, and
map back to user units through the viewBox. That counts stroke, filters, and
anything else that actually puts pixels down. Then solve each dark viewBox so
its true ink reproduces the light variant's fill fractions and margins, and
assert containment (`X <= inkX && X+W >= inkX+inkW`, both axes) rather than
trusting the arithmetic.

**Method note — three wrong turns, each measuring the wrong thing.** First
claim: the dark files declare bogus `width="200%"` / `width="10"` root
attributes. They don't — that came from grepping the head of each file, which
matched `width`/`height` on *child* elements. Second: measuring with
`getBoundingClientRect()` + `naturalWidth/Height` + the contain scale, which
measures the padded BOX, reports `32x40 | 52x26`, and shows a perfect match
while the dark mismatch sits undetected. Third: `getBBox()`, which finds the
mismatch but misses the stroke and leads to a fix that clips. Only the alpha
bbox answers the question that was actually being asked.

**Recommendation:** When a design puts two branded marks in equivalent slots,
check their viewBox ratios before picking a sizing rule. Equal height is only
correct for marks that share a ratio; otherwise constrain both axes and verify
with drawn pixel sizes, not by looking at a screenshot.

---

## `--color-secondary` on an AFL page renders TheLeague's green — and the guard test can't see it

**Context:** `/afl-fantasy/playoffs` labeled every bracket "Championship" in
green (`#10b981` in dark). The token behind it was `var(--color-secondary,
#2e8743)` — TheLeague's brand green, defined in `tokens.css` (light `#2e8743`)
and `tokens-dark.css` (dark `#10b981`).

**Insight:** This is the *sibling* of the documented `var(--color-primary,
#c41e3a)` trap, and it fails in the opposite direction, which makes it worse.
The blue trap is a fallback that never fires — the hex only shows in devtools.
`--color-secondary` genuinely **resolves**, on every AFL page, to the other
league's brand green, because the AFL blocks (`html[data-league="afl"]` in
tokens.css, `html.dark[data-league="afl"]` in tokens-dark.css) override
`--league-accent`, links, nav and the surface ramp but never touch
`--color-secondary`.

Nothing catches it. `tests/design-token-guard.test.ts` only asserts that a
referenced custom property is *defined somewhere* — `--color-secondary` is a
real token with real light and dark values, so the guard passes while the page
ships another league's identity. A "wrong league's token" bug is invisible to a
"token exists" test.

**Not every green is a brand leak, and the distinction decides the fix.**
Sweeping the AFL surfaces turned up three kinds:

- **Brand voice** (`.mfl-link:hover`, the draft-order OFFICIAL badge) → belongs
  on `--league-accent`. Red on AFL, blue on TheLeague, one token.
- **Semantic affirmative** (KeeperPlanner's filled-slot pip, primary button,
  finalize progress bar) → green is correct on any league; it was just sourced
  from the brand token. Move to `--color-success`, look unchanged.
- **Categorical palette** (`--lineup-pos-rb` in the position color set) → leave
  it. `src/pages/theleague/lineup.astro` declares the identical token block, so
  recoloring only the AFL diverges two sibling pages, and a red RB chip would
  collide with the error red on the same screen.

Grep `--color-secondary` under `src/pages/afl-fantasy/` and
`src/components/afl-fantasy/` when touching AFL styling; classify before
swapping.

**Gold as AFL foreground takes two tokens, not one.** `--afl-gold` (`#d97706`)
reads on a white card and muddies on the navy one; `--afl-trophy-gold`
(`#c9a44c`, matching the award SVG art) is 6.2:1 on the dark card and only
2.4:1 on white. The established pattern is the light/dark split already used by
`StandingsTable.astro`'s champion subtitle: `--afl-gold` in the base rule,
`--afl-trophy-gold` under `:global(html.dark)`. Note `--afl-gold` is ~3.2:1 on
white — under AA for small text; `#b45309` reaches 5:1 in the same family if a
surface needs it.

**One more asymmetry worth pricing in:** `--league-accent` is *not* the same
color in both themes (`#c41e3a` light, `#ef5350` dark), so a fill that carries
white text at 5.8:1 in light drops to 3.5:1 in dark. Flip the text to dark ink
(`#2a0808`, the pattern `.kp-btn--danger` already uses) rather than pinning the
light red.

**Follow-up from review (same PR).** Two things the first pass missed, both
found by an independent reviewer, both worth generalizing:

- **Grep the token name AND the literal hex.** The same page's live-refresh
  progress bar hardcoded `linear-gradient(90deg, #1c497c, #2e8743)` —
  TheLeague's blue-to-green brand pair, with no `var()` anywhere for a
  token-name grep to catch. It renders only on `[data-status='live']` cards,
  so it also survived every screenshot taken outside a live week. Anything
  gated behind a live/in-progress state needs its styles read, not screenshotted.
- **`--link-color-accent-hover` is NOT red on AFL light.** Only
  `html.dark[data-league="afl"]` pins it (`#ff8a80`); in AFL light it is still
  TheLeague's `#2e8743`. It is the right token for a dark-mode-only override
  (6.6:1 vs `--league-accent`'s 4.29:1 at 16px), but folding a light+dark pair
  into that single token reintroduces the green. Check a link token's value in
  *both* AFL themes before consolidating.

`tests/afl-brand-green-guard.test.ts` now enforces the whole rule: it scans the
AFL-only trees for `--color-secondary` and TheLeague's unambiguous brand-green
hexes, with an allowlist that documents why each sanctioned green is semantic
or categorical rather than brand. Two notes if you extend it — `#10b981` is
deliberately absent from the forbidden list (it is `--color-secondary` in dark
but also `--color-success` in light, so it cannot distinguish the bug from the
correct usage), and the scanner needs real block-comment state, since a wrapped
sentence inside `/* … */` often starts with an ordinary word rather than `*`.

**Third round, and the one with the widest blast radius: SHARED stylesheets.**
`src/styles/schefter-feed.css` is imported by `{theleague,afl-fantasy}/index`,
`/news`, and `/news/[id]` — six pages, two leagues, one file — and its article
and external-post accents were still `var(--color-secondary, #2e8743)`. A guard
that walks only `pages/afl-fantasy` and `components/afl*` cannot see it, which
is exactly how it survived the first two rounds of this PR.

The fix for a shared file is NOT the fix for an AFL-only file. TheLeague's
green is *correct* on TheLeague, so swapping the token would just move the bug
across the border. Scope it instead:

```css
html[data-league='afl'] .sf-post--article { border-left-color: var(--league-accent); }
```

`tests/afl-brand-green-guard.test.ts` encodes the distinction — for files in
`SHARED_STYLESHEETS` it asserts that any file using `--color-secondary` also
carries an `html[data-league="afl"]` override, rather than banning the token.

**Measurement trap that cost real time here.** Reading contrast after
`html.classList.remove('dark')` gives *plausible, wrong* numbers on any page
whose surfaces re-resolve from `prefers-color-scheme` — the Schefter card
measured 2.56:1 in "light" while its stylesheet plainly said `--card-bg: #fff`,
because the pane's own scheme was dark and the site's `auto` preference won.
Set the browser's color scheme (`resize_window { colorScheme: 'light' }`) and
reload, rather than toggling the class. The tell is a computed background that
contradicts the only CSS rule that matches the element.

One more non-text contrast note from the same round: `--content-bg-accent` is
`#66abea` in light — a saturated mid-blue, not a neutral. Nothing clears 3:1 as
a fill on it (the old TheLeague-green progress bar managed 1.84:1). For a
progress track or any recessed strip, `--content-bg-muted` is the right token.

**Where this actually lives: the SHARED component layer, not the AFL tree.**
Round three found four more, none of them in an `afl-*` directory:
`AssetsPage.astro` (AFL tier badge), `WhatsNewIndexPage.astro` (card read-more
hover), `schefter-feed-compact.css` (Roger's reply rail), and `NavHeader.astro`
(the league-switcher checkmark — on every page of both leagues). The lesson is
that "AFL pages wearing TheLeague green" is mostly not an AFL-page problem; it
is shared chrome that no per-league override was ever written for.

Two aliases do the smuggling, and neither contains the word "secondary" at the
call site:

- `--secondary-color` → `var(--color-secondary)`. Green, both themes.
- `--accent-link-hover-text-color` → `--link-color-accent-hover` → green in AFL
  **light** only, because just `html.dark[data-league="afl"]` pins it red. This
  is the same token the playoffs fix leans on for dark, which is exactly why it
  is dangerous: correct in one theme, TheLeague's brand in the other.

So when auditing, chase the alias chain to a literal before deciding a token is
league-safe, and treat a token that only ONE theme block overrides as
half-defined. `tests/afl-brand-green-guard.test.ts` now scans the shared files
for all three names — but its shared-file check only asserts that *an* AFL
override exists, so a wrong selector or an override on the wrong property still
passes. It narrows the gap; it does not close it.
