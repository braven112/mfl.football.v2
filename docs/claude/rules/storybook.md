# Storybook — component workbench for `.astro` + React islands

> Added Aug 2026 as a spike. Storybook is **dev-only**: it is devDependencies
> plus `.storybook/` and `stories/`, it never enters `astro build`, and nothing
> in it is reachable from a page. The shipped Vercel bundle is byte-identical
> with or without it.

## Why it exists

A story is a mechanical test of reusability: **a component you can't render
from props alone isn't reusable.** As of the spike, 185 of 264 components in
`src/components/` are imported by one file or zero — page fragments wearing a
component directory. Storybook makes that measurable instead of arguable, and
is the safety net for extracting the shared core out of the 1,500–2,300-line
`*Page.astro` components.

```bash
pnpm storybook        # dev server on :6006
pnpm build:storybook  # static build -> storybook-static/ (gitignored)
```

## Stories live in `stories/`, NOT beside their component

This is load-bearing, not taste. Three repo guards scan `src/` and a story
placed there trips them:

| Guard | What it would do |
|---|---|
| `tests/league-literal-guard.test.ts` | Scans `src/` + `scripts/` + workflows for `'13522'` / `'19621'` / `'data/theleague'`. Story fixtures use franchise and league ids freely — instant failure. |
| `tests/design-token-guard.test.ts` | Scans all of `src/` for `var(--x)` with no definition anywhere. |
| `pnpm test:types` | Ratchets the `astro check` error total and fails if it moves in **either** direction. New files under `src/` move it. |

Keeping stories at the top level means none of those baselines move. Verified:
273 test files / 6,965 tests pass unchanged with the stories present.

## Trap 1 — an unguarded `document` SILENTLY DELETES your stories

`.astro` stories are pre-rendered at build time in Node (the Astro Container
API), and **preview decorators are composed during that pass**. A decorator
that touches `document` throws there, and storybook-astro's response is to drop
the story from the static build:

```
[storybook-astro] Dropped story "loading-spinner--default" from the static
build: decorator composition failed (document is not defined).
```

**The build still exits 0.** The first version of `.storybook/preview.ts` lost
all 22 stories this way and reported success. Into Chromatic that reads as "no
snapshots to compare", not as an error — a green build with zero coverage.

Guard every DOM access in `preview.ts`:

```ts
if (typeof document === 'undefined') return;
```

Skipping the DOM work during prerender is correct anyway: theme and league are
applied by CSS at view time, in the browser.

After any change to `preview.ts`, check the build output for `Dropped story`,
and confirm `storybook-static/index.json` still has the expected entry count.

## Trap 2 — a component's own CSS import does not reach the canvas

`Spinner.astro` does `import '../../../styles/loading.css'` in its frontmatter.
That stylesheet **does not load in Storybook**. The story module bundled for
the canvas carries only a component *marker*, not the component's real module
graph, so the frontmatter CSS import never reaches the browser.

The failure is quiet and misleading: correct DOM, zero rules applied. The
spinner renders as a bare inline `<span>` — `width: auto`, `animation: none`,
`border-top-color` inherited to black. It looks like a broken component rather
than a missing stylesheet.

**Every stylesheet a story needs must be imported in `.storybook/preview.ts`.**
That covers both causes:

1. Components that never import their own CSS because the page does — the
   playoff heroes say so in their own header comments ("loaded once by
   `SeasonDailyHero`").
2. Components that *do* import it in frontmatter, per above.

Rule of thumb: **if a story looks unstyled, add its stylesheet to
`preview.ts`.**

## Trap 3 — an `.astro` client `<script>` 404s in the static build

A plain `<script>` in an `.astro` component is extracted by Astro and emitted
as a module URL pointing at the source file:

```
/home/user/.../ChromaticReport.astro?astro&type=script&index=0&lang.ts  → 404
```

The dev server resolves that; **`storybook build` does not**. So the script
works in `pnpm storybook` and silently does nothing in the static build — which
is the build Chromatic snapshots and publishes. Nothing errors; the markup just
sits there unhydrated.

Use `<script is:inline>`, which leaves the script in the HTML with nothing to
resolve. The catch: `is:inline` means Astro does not process it, so it must be
**plain JS** — a TypeScript annotation is a syntax error that fails just as
quietly.

## Trap 4 — Storybook does not load `astro.config.ts`

None of the project's Astro config reaches a story. The one that bites is
`compressHTML: true`, which the app sets specifically to keep Astro 6's
whitespace behaviour; without it, Astro 7's JSX-style handling strips the
newline between an inline element and its neighbour, so

```html
Use the <strong>Theme</strong> and
<strong>League</strong> controls
```

renders as "and**League**". Keep an inline element and its surrounding spaces
on ONE source line. The same applies to `fonts`, `integrations`, and the
`process.env` hydration — a story gets none of it. `fonts` is the one that had
already shipped a wrong canvas; see Trap 4b.

## Trap 4b — the FONTS are two separate misses, and both look like "close enough"

Every story rendered in **Times New Roman** (body) and Storybook's own Nunito
Sans (headings) until Aug 2026, with `document.fonts` reporting **zero** loaded
faces. It reads as a slightly-off canvas rather than as a bug, which is why it
survived the whole spike.

Two independent causes, and fixing either alone leaves the canvas wrong:

1. **`--font-vend-sans` does not exist.** `astro.config.ts` registers Vend Sans
   via `fontProviders.google()`, and the layouts emit the @font-face plus the
   variable with `<Font cssVariable="--font-vend-sans" />` (`astro:assets`).
   Storybook loads neither (Trap 4), so tokens.css's
   `--font-family-base: var(--font-vend-sans, 'Vend Sans'), system-ui, …`
   resolved past the variable AND past the unloaded family to the system stack.
2. **Nothing APPLIES the tokens.** The `html`/`body` `font-family`, the
   `h1–h4 { font-family: var(--font-display) }` rule and the `code` rule all
   live in `TheLeagueLayout`'s own `<style>` block. A component carries none of
   them, so even 'UFC Sans Condensed' — which tokens.css already @font-faces and
   `staticDirs` already serves — never reached a single heading.

`.storybook/preview-layout-globals.css` fixes both: it declares Vend Sans, sets
`--font-vend-sans`, and mirrors the layout's global rules. Keep it in sync with
the layout's `<style>` block.

**The fonts were the loudest instance, not the only one.** Cause 2 is
structural — the layout owns rules no component carries — so the same gap
existed for every other `:global()` rule in that block. The review of this
change caught `:global(a)` / `a:hover` / `a:focus`: every anchor with no
component color of its own was rendering on the **UA default blue**, measured
`rgb(0,0,238)` light / `rgb(158,158,255)` dark against production's `#111827` /
`#60a5fa`. `.table-wrapper` was in the same position (no storied component uses
it *yet*, which is the only reason it cost nothing).

That one is worse in consequence than the fonts, and the reason is worth
holding onto: **a visual-regression run that auto-accepts on main** (Chromatic did, until
Oct 2026) turns a wrong render into the accepted baseline, and the suite goes blind to
the very regressions it exists to catch.

So when porting from the layout, **enumerate the whole `<style>` block** rather
than the rules that motivated the trip. The full set as of Aug 2026: `html`,
`body`, `h1`–`h4`, `code`, `a` / `a:hover` / `a:focus`, `.table-wrapper`. The
rest of the block (`main`, `.page-wrapper`, the nav-drawer rules) targets
elements the layout itself renders, which a story never has — correctly not
ported. One layout serves both leagues (61 TheLeague + 36 AFL pages import
`TheLeagueLayout`), so there is one source to track, not a per-league pair.

**The font is self-hosted, not linked from fonts.googleapis.com.** Chromatic
waits for network idle before capturing, so a third-party font request is a
timeout risk and an intermittent one is a false diff — the same reasoning that
stubbed the playoff-hero headshots to data URIs. It also matches production,
where Astro's font pipeline self-hosts too. The file lives in
`.storybook/static/fonts/` and is mapped to `/storybook-fonts` by `staticDirs`
— deliberately NOT in `public/`, so the shipped Vercel bundle stays
byte-identical. One 36 KB variable woff2 (latin subset) covers 400/500/600/700,
declared as four faces exactly as Google delivers it.

Verified in Chromium against the static build:

| | before | after |
|---|---|---|
| `html` / `body` font | `"Times New Roman"` | `"Vend Sans", system-ui, …` |
| `h1` font | Nunito Sans (Storybook's) | `"UFC Sans Condensed", …` |
| `html` font-size | 16px (browser default) | 16px — deliberately left alone, see below |
| loaded faces | none | UFC Sans Condensed 700, Vend Sans 400/700 |

**The one rule NOT copied from the layout is `html { font-size:
var(--font-size-base) }`**, a clamp that lands near 18.9px rather than the
browser's 16px. Root font-size is the rem basis, so reproducing it re-scales
every rem-sized rule in the canvas at once and moves **every** Chromatic
baseline in the suite. That is a deliberate change with its own full-capture
build and review pass, not a side effect of a font fix.

So the canvas is now right on TYPEFACE and still one step off production on
SIZE. Know that before reading a story's spacing as pixel-accurate — and when
someone does take the size step, expect to review all 68 snapshots, since a
`preview.ts` change forces a full rebuild regardless.

Entry count unchanged at 67 with no `Dropped story` (Trap 1) on either side.

`tests/storybook-layout-globals.test.ts` pins the chain — the `preview.ts` import, the
`--font-vend-sans` declaration, the `staticDirs` mapping, that every
`@font-face` src resolves to a file on disk, and that the `html` rule carries
no `font-size` (so the baseline-moving step stays a decision, not a drive-by).
Every link in it fails silently (the font 404s, the canvas falls back, the
build stays green), which is the whole reason it is a test and not a comment. It also fails if a third-party
font URL is reintroduced, or if the font is moved into `public/`.

## Trap 5 — the layout injects styles a story never gets

`TheLeagueLayout` renders `<TeamAccentStyles />`, which defines
`--team-accent-<franchiseId>` for every franchise with an `html.dark`
override, each forced to clear 3:1 on its theme's surface. A story has no
layout, so **every one of those tokens was undefined** and anything tinting by
franchise fell back silently to one flat blue — found via the Pecking Order
story's sixteen rank numerals, which all rendered identically.

This is worse than a cosmetic bug in a visual suite: baselining the fallback
bakes wrong colors into Chromatic and blinds it to precisely the accent
regressions it exists to catch (see `theming-and-assets.md` — the Pecking Order
shipped invisible rank numbers in dark mode exactly this way).

That story is gone (see "Deleted: the Pecking Order stories" below) and **no
story reads `--team-accent-*` today**, so this injection currently guards
nothing. It stays anyway: it is layout parity, it costs nothing while nothing
consumes it, and the next franchise-tinted story would otherwise reopen the
hole silently.

`preview.ts` now calls the SAME `buildTeamAccentCss()` the layout does and
injects it once, so there is one source of truth. Verified: franchise 0002
resolves `#8b6914` light / `#3f7fb0` dark, its real contrast pair.

The same reasoning applies to the other head-injected style components
(`NflLogoDarkStyles`, `TeamIconDarkStyles`, `CollegeLogoDarkStyles`). If a
story starts showing the wrong logo variant in dark mode, that is why.


**The `TeamIconDarkStyles` gap is now CLOSED**, and how it was closed is the
point. It was the only one of the four head-injected sheets Storybook did not
reproduce, because it is not a zero-argument builder but a COMPOSITION — four
builder calls across both leagues' configs and two icon directories, which are
pairing-sensitive (the stroke fallback must use the same `franchiseIconDir` as
the swap for its league or the selectors miss). Copying that into `preview.ts`
was exactly the drift risk the shared builders exist to avoid.

The composition now lives in `src/utils/team-icon-dark-styles.ts`
(`buildAllTeamIconDarkCss()`), called by both `TeamIconDarkStyles.astro` and
`preview.ts`. Verified byte-identical to the old inline version at extraction
time: 51 rules, ~7.4 KB, covering 11 of TheLeague's 16 franchises and 10 of the
AFL's 24. Until then every franchise crest rendered its LIGHT artwork in
dark-mode stories — and Chromatic would have baselined that as correct.

`Theming/TeamIconCell` is the standing guard on that wiring. If the injection
is ever dropped, `DarkSwapAvailable` stops differing between themes.

## Trap 6 — no Node globals in a fixture module

Story and fixture modules are bundled for the BROWSER. A fixture that built a
data URI with `Buffer.from(...).toString('base64')` threw on import, so the
args never constructed and every one of that component's stories rendered
**empty** — no error in the console, just nothing. Write the literal instead.

Symptom to recognize: a story that builds and appears in `index.json` but
renders zero characters, while its siblings from another fixture are fine.

## Trap 8 — a story over a REACT component needs two things, or it errors only in Chromatic

Every story here rendered an `.astro` component until the shared live-scoring
kit arrived. A story whose `component:` is a React `.tsx` needs BOTH of these,
and neither is optional:

1. **`parameters: { renderer: 'react' }` on the story.**
   `@storybook-astro/renderer`'s `render()` short-circuits only on an
   `isAstroComponentFactory` marker. A plain function component falls through
   to the renderer named in parameters — and the framework's own preview sets
   that to `'astro'` globally, which is never a key in the fallback registry.
2. **`framework.options.integrations: [react()]` in `.storybook/main.ts`**,
   imported from `@storybook-astro/framework/integrations`. The framework does
   **NOT** read `astro.config.ts` for this. That option is the sole input to
   `virtual:storybook-renderer-fallback`, the registry a non-Astro story
   consults; ours was `options: {}`, so the registry was an empty module.

**Why this is Chromatic-only.** The throw happens in the browser at render
time. `storybook build` exits 0, the story is indexed, and the static output
looks complete. Chromatic reports it as a component ERROR, not a diff — 18 of
them on build 455, one per snapshot, which is how the arithmetic gives the
story away (3 stories × 6 modes). The tell in the error text is the empty
list: `Renderer 'astro' not found. Available renderers:` with nothing after
the colon means the registry is empty, i.e. fault 2; a populated list means
fault 1 alone.

Guard: `tests/storybook-story-renderer.test.ts` checks both ends — every story
over a non-`.astro` component names a renderer, and every renderer it names is
registered in `main.ts` (and is one `astro.config.ts` actually runs). Fixing
either half alone still fails, so it asserts both.

**Modes widen; they never narrow.** Storybook DEEP-merges parameters, so a
story-level `chromatic.modes` map is unioned with the component-level one
rather than replacing it. Put the CHEAP map at component level and let
individual stories opt UP. `Live/WinProbBar` originally did the reverse and
`Mini`'s attempt to drop back to two modes silently still cost six.

## Trap 9 — `chromatic.modes` and `chromatic.viewports` on one story kills the BUILD

Not the story. The whole build, with zero snapshots taken:

```
✖ Failed to extract stories from your Storybook
Error: Chromatic does not support viewports and modes on the same story.
       in story 'live-matchupdetail--phone-width'
 ELIFECYCLE  Command failed with exit code 23.
```

That was build 460, from one story declaring
`chromatic: { modes: themeModes, viewports: [390] }`. Modes supersede the
older `viewports` array and a mode may carry its own `viewport`, so the two
are alternatives, not a pair.

**The width goes INSIDE the mode**, which is what `phoneModes` in
`.storybook/modes.ts` is for:

```ts
export const phoneModes = {
  'Phone light': { theme: 'light', league: 'theleague', viewport: { width: 390, height: 1200 } },
  'Phone dark':  { theme: 'dark',  league: 'theleague', viewport: { width: 390, height: 1200 } },
} as const;
```

**Nothing local catches this**, which is why it is a guard and not a note.
`storybook build` exits 0, the story indexes, it renders correctly in a
browser, and driving all 102 stories through Chromium shows no error display —
the same verification that DID catch Trap 8. The constraint belongs to
Chromatic's story extractor, so only a Chromatic build says so, and it says so
by failing everything.

Guard: `tests/storybook-story-renderer.test.ts` scans each `chromatic: { … }`
block for both keys. Proven to bite by putting the pair back.

It is also expensive in a way a normal red build is not: a build that fails
extraction takes no snapshots, so the push buys no visual signal at all and
needs a full re-trigger (remove and re-add `visual-check`) once fixed.

## Trap 7 — a snapshot's network request can live in the CSS, not in the args

**"Fixtures are offline" is checked at the wrong layer if you only check
story args.** The whole suite's fixtures are already deliberately offline —
headshots are inline data URIs, crests come from `staticDirs` — and
`Roster/PlayerCell` still failed Chromatic intermittently on the Bengals mark
(Sep 2026). No story named a URL. The fetch came from a stylesheet
`preview.ts` injects.

The mechanism, and why it is invisible from the story file:

1. `buildNflLogoDarkCss()` swaps every NFL logo `<img>` in dark mode via
   `content: url(...)`.
2. It serves the self-hosted mirror for teams listed in
   `src/data/nfl-dark-logos-manifest.json`, and **falls back to
   `a.espncdn.com` for everything else**.
3. That mirror is written by prebuild into `public/assets/nfl-logos/dark/`
   and is **gitignored**. `storybook build` never runs prebuild.
4. So in CI the manifest is its committed `{"codes": []}` default and ALL 32
   teams fall back to the CDN. Same story for `buildCollegeLogoDarkCss()` and
   its 258 rules.
5. `content:` images have **no error fallback** — a failed load renders a
   broken/blank mark, not the light SVG still sitting in `src` — and
   Chromatic's `delay: 300` covers font and layout settle, not a cross-origin
   round trip.

Result: ESPN's weather failed builds that had nothing wrong with them, and on
`main` (`--auto-accept-changes`) a bad capture would have been blessed as the
baseline.

The fix is two halves, both pinned by
`tests/storybook-dark-logo-mirror.test.ts`:

- **Storybook carries its own committed mirror.**
  `.storybook/static/nfl-dark/` (32 PNGs, ~2.3 MB), served at
  `/storybook-nfl-dark` — its own prefix, same reasoning as
  `/storybook-fonts`: obviously Storybook's, and it cannot collide with a
  `public/` mirror a local prebuild left behind. Refresh with
  `pnpm mirror:storybook-dark-logos`, which restores the previous manifest and
  exits non-zero rather than leaving a partial one behind (ESPN's edge answers
  a burst's first request with a spurious 404 often enough that this fires in
  practice — the script fans out at 3, and re-run means re-run). The manifest
  is the artifact that has to be all-or-nothing: extra PNGs are harmless, a
  manifest claiming 31 is what `preview.ts` would trust. **Committed on purpose** — a visual baseline has to be
  reproducible from a checkout alone, so re-fetching per CI run would move the
  same flake earlier rather than remove it.
- **`sameOriginOnly: true` on both builders, plus a pinned manifest.**
  `sameOriginOnly` DROPS a swap that would point off-origin instead of emitting
  it. It proves ORIGIN, not EXISTENCE — which is why the college call also pins
  `manifestIds: []` and the NFL call pins Storybook's own: the tracked
  `*-dark-logos-manifest.json` files are prebuild-REWRITTEN, so a developer who
  runs a local build and commits the result would otherwise have Storybook emit
  same-origin swaps at a gitignored directory it does not serve — a guaranteed
  broken-image icon in place of an intermittent one. That is the backstop, and it is the
  half that generalizes: a missing mirror file degrades to the light mark in
  dark mode — a deterministic, visible diff a human accepts or rejects — never
  to a network request that usually works. No college cut is mirrored, so all
  258 college rules simply do not exist in Storybook; correct today (no story
  renders a college logo — `PlayerDetailsModal` leaves `#detail-college-logo`
  at `src=""` because its client script never runs) and safe the day one does.

`sameOriginOnly` is a **Storybook-only posture**. Production wants the CDN
fallback: a failed prebuild fetch must degrade to the remote dark cut, never
to no dark cut at all — that is the Aug 2026 AFL players-page bug in reverse.
The builders memoize the default configuration only, so a Storybook build can
never poison the CSS the SSR layout head reads.

The generalizable rule: **before adding anything to `injectLayoutStyles()`,
ask what URLs its rules resolve to in a build with no prebuild.** A `var()` or
a color is free; a `content: url()`, a `@font-face src`, a `background-image`
or a `mask-image` is a network request in every snapshot that matches it.

## Theme × league is pure CSS — which is why the matrix works

Both axes are CSS-only in this codebase:

- light/dark → `html.dark` (`src/styles/tokens-dark.css`)
- league skin → `html[data-league="..."]` (`src/styles/tokens.css:703`)

Nothing is decided in frontmatter. That is why a story pre-rendered *once*
still re-skins correctly across all four combinations, and why these map
directly onto the Chromatic modes below. Verified end to end on
`--league-accent`:

| | light | dark |
|---|---|---|
| theleague | `#1c497c` | `#3b82f6` |
| afl | `#c41e3a` | `#ef5350` |

## Not every component can have a story

The playoff heroes (`playoff-heroes/`) take a single resolved
`view: PlayoffRoundView` plus a path resolver — no feeds, no clock, no auth —
so they story cleanly, including states the live site can only reach for a few
hours a year.

The season heroes (`season-heroes/`) cannot be driven from args at all: they
`await import()` league feed JSON in frontmatter, call `getCurrentSeasonYear()`
and `getPlayerMap(year)`, and import `theleague.config.json` directly. That is
a finding, not a Storybook limitation — it is also why they can't be reused by
a second product.

## Coverage of the shared components — derived, and it only goes up

`node scripts/story-coverage.mjs` reports how much of `src/components/shared/`
is in a snapshot (`--all` lists every bucket). Each shared `.astro`/`.tsx`
lands in exactly one bucket, and every bucket but one is DERIVED from source
(`scripts/lib/story-coverage.mjs`), never hand-labelled:

| Bucket | Meaning |
|---|---|
| story | a story imports it |
| covered | a storied component renders it, so it is in a snapshot anyway |
| page | `*Page.astro`/`*Page.tsx` — feeds, clock and session; args cannot drive it |
| dataBound | resolves its own data in frontmatter (session, cookies, feed globs, `await import`, the year clocks, `fetch`), or a React island that fetches — a story of it would snapshot live data (see "Deleted: the Pecking Order stories") |
| nonVisual | renders no element besides `<style>`/`<script>` (`ThemeScript`, the `*DarkStyles` sheets) |
| exempt | presentational but genuinely unstoryable — the ONLY hand-made bucket, and each entry carries a written reason in the baseline |
| backlog | presentational, storyable, no story yet |

`tests/story-coverage.test.ts` freezes the backlog in
`tests/fixtures/story-coverage-baseline.json` and lets it only shrink: a NEW
presentational shared component fails until it ships with a story (or an
`exempt` reason a reviewer can read), and a backlog entry that got a story
fails until the baseline is retightened with `--write` — which refuses to grow
it. Oct 2026: 270 shared components, backlog 145 → 138 after the first batch
(the seven remaining `Lv*` leaves — `LvGroupPicker` landed on staging while
the batch was in flight), then → 126 with the draft room (`Draft Room/*`).

**Draft-room stories — three things that were not obvious.**
`draft-room.css` is imported only by `DraftRoom.tsx`, which no story can
render, so it is imported in `preview.ts` (every selector is `.draft-room`- or
`.dr-`-scoped, so it cannot restyle another story) and every story wraps in a
`.draft-room` element reset to natural height (`stories/draft-room/decorator.ts`).
The timer banner is driven by `mockClockSeconds`, which overrides its
wall-clock countdown outright — never by a pick timestamp relative to
`Date.now()`. And `PickRevealSplash` carries `disableSnapshot`: it dismisses
itself on a real 3.6s timer, so a capture is a race; an injectable hold time
would fix that, and is a component change.

**It reads the DISK, not `git ls-files`.** The first version listed files from
the git index, so a story or component nobody had `git add`-ed yet was
invisible — the guard passed while its author was writing the very file it
exists to see. A new file is exactly the state the guard has to judge.

**Ticking components need minute-scale fixture ages.** `LvFeedStatus` and
`LvStaleNotice` re-read `Date.now()` every second, so a fixture age in seconds
would differ between story load and capture. `minutesAgo(n + 0.5)` in
`stories/fixtures/live-kit.ts` gives "nm ago" with thirty seconds of slack
either side.

## One cast of teams across the whole suite

Every story that needs a franchise draws from one small cast: **Pacific
Pigskins**, **The Mariachi Ninjas**, **Cowboy Up**, **Wascawy Wabbits**
(TheLeague), plus **Suh girls, one cup** and **The Boondock Saints** (AFL). The
playoff fixtures used to carry six unrelated franchises, `TeamIconCell` four
more, and the name-fallback stories a seventh.

The two AFL entries are not preferences — they hold the custom-stroke and
default-white branches respectively (see below). Those two slots are dictated by
the data, and the data moves: the custom-stroke slot was The Show, then No Soup
For You, and is now Suh girls, each time because the previous holder gained an
`iconDark` and left the branch. Expect to move it again.

Adding a franchise to a story is a real change, not set dressing: check
`crest-dark-stroke-manifest.json` for which branch it lands on. Five teams
cover every branch but one, and the sixth exists solely to cover that one.

**An asset batch can gut a story without opening `stories/`.** Giving a
franchise dark art silently changes what the story TESTS: an `iconDark` removes a franchise from the stroke set by
construction, so a story pinned to it as a stroke example quietly becomes a
second swap example and keeps passing. Nothing in the suite catches that. It has now happened twice to the same story,
`StrokeCustomColor` (The Show in #685, then No Soup For You right after), and
the second time the fix was to repoint it at Suh girls.

So before shipping dark art: grep `stories/` for that franchise's light file.
If it is named there, decide what the story was pinning before you change the
data under it.

## Deleted: the Pecking Order stories

`stories/shared/PeckingOrder.stories.ts` (four stories, eight snapshots) was
removed in Sept 2026. It is worth recording WHY, because the trap it hit is
one any future story can walk into.

The story froze its *data* correctly — a copied issue JSON, never an import of
the cron-written file. But `PeckingOrderIssue.astro` does not take franchises
as a prop: it builds its team lookup from the league config, and those configs
point `icon` at live files under `public/assets/<league>/icons/`. So the story
rendered whatever crest was on disk that day.

That is a snapshot reading live data through a side door. Both league asset
trees were in `STORY_ASSET_GLOBS` and in the workflow's `paths:` at the time,
so an owner swapping a logo, or the sync bot doing it for them, both TRIGGERED
a Chromatic build and GUARANTEED a diff on all eight snapshots. Every one of those needed a human to
approve a change nobody made. Full-page snapshots of a 16-row ranking with a
crest per row are the worst possible shape for this.

**The general rule: a frozen fixture only freezes what the component takes as
args.** Anything the component resolves itself — a config import, an asset path
built from one — is still live, and a full-page story pulls in a lot of it.
Before adding a story, ask what it renders that no arg controls.

`TeamIconCell` deliberately keeps its live crests: icons ARE its subject, so a
diff there is the test working. The Pecking Order was rendering them as
scenery.

If this ever comes back, it needs a `teams` prop (or a frozen copy of the two
configs under `stories/fixtures/`) so the crests are args like everything else.

## Toolchain note

`storybook-astro` requires Vite ≥ 6.4.1; the root `vite` devDep was `^5.0.0`
and pnpm resolves the framework's peer from the root, so it was bumped to
`^8.1.5` (the version Astro 7 already uses internally). `vitest@1.6.1` depends
on vite `^5` directly rather than as a peer, so it keeps its own nested 5.4.21
and is unaffected.

**That bump changed a SHIPPED artifact, and the output contract is now pinned.**
`pnpm build:tools` (`scripts/build-league-tools.mjs`) calls `vite build` to
produce `public/assets/js/dist/*-tools.js` — bundles that are injected into
MFL's own pages. Under Vite 8 the emitted IIFE silently **lost its
`"use strict"` prologue** and downlevelled top-level `const` to `var`, because
neither `build.target` nor `rollupOptions.output.strict` was pinned and both
defaults moved.

Losing strict mode on a third-party page is a real semantic change, not
cosmetic: a failed assignment becomes a silent no-op and an accidental global
leaks to page scope, alongside scripts we do not control. Both settings are now
explicit in the build script, so the output survives the next bundler upgrade.
The bundles were regenerated and committed with that pinning in place, so the
change is attributable to the PR that caused it rather than ambushing whoever
next runs the script.

(The `"use strict"` now sits at file top rather than inside the IIFE. That is
equivalent here — the directive is per-script, so it governs this bundle only
and does not leak to MFL's other scripts.)

## Visual regression — Chromatic was removed (Oct 2026)

Chromatic ran the stories as visual-regression snapshots from Aug to Oct 2026.
It was removed because the free plan's snapshots ran out within days and the
check started blocking work. A free replacement is being chosen; until it
lands, no CI job captures the stories, and visual review is a human look at
`/promote` step 5b.

What was learned running it (budget arithmetic, TurboSnap's path filter and
`externals`, the per-file crest trigger list) is kept in
`docs/claude/insights/features/chromatic-visual-testing.md` and in the git
history of `scripts/chromatic-story-deps.mjs` and
`tests/chromatic-path-filter.test.ts`. Read those before building the
replacement's trigger: a path filter that misses a file that renders is the
failure that lets a regression ship green.

The stories still carry `parameters.chromatic` (`modes`, `delay`,
`disableSnapshot`). Storybook ignores them; they are kept because the
theme × league matrix in `.storybook/modes.ts` is exactly what a replacement
needs to know which combinations to capture.

## Choosing modes

**`themeModes` is not theme-only.** It pins `league: 'theleague'` as well as
the theme, because every snapshot needs *some* league global. Read the name as
"the TheLeague pair", not "the neutral pair" — that misreading shipped AFL
stories rendering under TheLeague's palette, and both the review and Copilot
caught it independently.

Three cases, and the middle one is the trap:

| The component… | Use | Why |
|---|---|---|
| takes no league input; styles read a league token | `allModes` | Four genuinely different renders |
| takes `league` as a PROP | `themeModes` for the TheLeague stories, `leagueModes` for the AFL ones | The args pick the CONTENT; the mode must pick a matching SKIN. Not a second axis — each story still gets 2 snapshots, just the right 2. |
| takes no league input; styles read NO league token | `themeModes` | An AFL snapshot would be pixel-identical. `PlayerCell` and `LineupGameStrip` are here — checking cost 32 wasted snapshots a build to discover. |

Before reaching for `allModes`, actually grep the component's stylesheet for
`--league-accent` and `data-league`. If neither appears, the league axis does
not exist for it.

Rule: **a mode must change something the args cannot, and must not contradict
what the args already said.**

## What is reachable from `rosters.astro`

The roster page is the biggest risk surface in the repo (~12,500 lines in
TheLeague, ~1,000 of the type-error baseline) and it is NOT storyable itself.
What it is built from splits cleanly:

| From the roster page | Storyable? |
|---|---|
| `PlayerCell` | **Yes** — richly prop-driven, both leagues, storied |
| `PlayerDetailsModal` (1,444 lines) | Shell only. Props are `class` + `hideContract`; everything visible is injected by client JS through `initPlayerModalTrigger`. A story renders empty chrome. |
| `PlayerInjuryModal` | Same — `class` only |
| `ContractDeclarationModal`, `CutdownPlanPanel`, chart cards | TheLeague-only; not yet assessed |

**`PlayerCell` is where the safety actually is**, because it carries a bug
class the docs already record: the avatar backdrop must come from
`getPlayerAvatarBackground` / `getPlayerAvatarBorder`, never a raw
`getNflTeamColors` primary — about a third of the NFL wears a near-black
primary and a dark-jerseyed headshot on it disappears in dark mode (Cam Ward
on Titans navy, July 2026). Six near-black teams are pinned as standing
guards. Verified working: TEN's navy `#0C2340` renders an anchor of
`rgb(138,184,232)`, BAL's near-black purple `rgb(128,120,174)`.

### Making `PlayerDetailsModal` storyable — why NOT extraction

The obvious move is to extract the modal's body into a prop-driven child. Do
not: the file is 1,444 lines of which only ~146 are template, and the other
1,300 are 610 lines of **scoped** `<style>` plus 658 of client script. Astro
scopes styles per component, so moving the markup into a child orphans every
one of those CSS rules.

What works instead is optional `preview` / `previewOpen` props ON the component
itself, which server-render the same elements the client script targets. Omit
them and the output is byte-equivalent to what always shipped; the runtime path
is untouched because the script overwrites the content on open either way.

The `Skeleton` story is the guard on that equivalence — it passes no `preview`
at all, so it pins the production shape: 47 ids, `pdm-owner` still
`display: none`, every placeholder still an em dash, news and weekly-results
sections still collapsed.

The `preview` fields are PRE-FORMATTED STRINGS deliberately. Formatting lives
in the client script and a story cannot run it; duplicating it in fixtures
would let the story drift from production. These stories pin layout, styling
and the shape of each state — not the formatting logic. Be honest about that
rather than implying more coverage than exists.

## The Storybook MCP server (`@storybook/addon-mcp`)

Enabled in `.storybook/main.ts`. It serves an MCP endpoint at `/mcp` **from
the running dev server** — `pnpm storybook`, then point an agent at
`http://localhost:6006/mcp`. It is not wired into `.mcp.json` on purpose: the
endpoint only exists while the dev server is up, and a committed entry would
fail on every session that isn't running Storybook. Add it per-user instead:

```bash
claude mcp add --transport http storybook http://localhost:6006/mcp
```

**Verified against this repo's Astro setup**, not assumed. Four tools register:

| Tool | What it does |
|---|---|
| `get-stories-by-component` | source file → the `storyId`s that render it |
| `preview-stories` | `storyId`s → preview URLs |
| `get-changed-stories` | stories marked new/modified/related |
| `get-storybook-story-instructions` | canonical story-writing conventions |

**Two of the three toolsets are dead here, and that is a property of the
framework, not a setting to flip.** The addon gates each toolset on a runtime
capability rather than a framework allowlist:

- **docs** needs a component-manifest generator. `@storybook-astro/framework`
  ships none (only React frameworks do today), so `getManifestStatus` reports
  no manifests and the toolset never registers.
- **test** needs `@storybook/addon-vitest`. We don't have it, and portable
  stories don't work for `.astro` anyway.

**THE BLIND SPOT — `get-stories-by-component` does not traverse `.astro`
frontmatter imports.** It resolves direct story→component links correctly and
reports nothing beyond them. Concretely: `TeamIconCell.astro` imports
`src/utils/team-icon-dark-css` on line 41 and has six stories, but querying
`src/utils/team-icon-dark-css.ts` returns **"no stories found"**. So does
`src/styles/tokens.css`, which affects every story in the suite.

Treat a "no stories found" on a util or a stylesheet as **unknown, not
uncovered**. Acting on it as though the file were unstoried is how you skip
the visual check on a token change — the single most expensive bug class in
this repo (see `docs/claude/rules/theming-and-assets.md`). This is the same
shape as TurboSnap's CSS blindness, which is why the story stylesheets are
listed in `chromatic.config.json`'s `externals` (individually — the old
`src/styles/**/*.css` glob was disabling TurboSnap outright).

It does not affect the static build: `pnpm build:storybook` produces the same
52 entries with the addon on or off, so Chromatic is unchanged. `pnpm add`
reports one unmet peer (`valibot@^1.4.0` against the installed 1.2.0); the
server initializes and answers `tools/call` regardless.

## The three dark-mode branches a crest can take

`TeamIconCell` looks like a trivial `<img>` and is the most branch-heavy
component in the suite, because none of the branching is in the component —
it is all in the CSS the layout injects (see Trap 5). A crest in dark mode
takes exactly ONE of these, and `Theming/TeamIconCell` pins all four states:

| Team declares | Dark-mode result | Story (team) |
|---|---|---|
| `iconDark` | `content: url(<dark>)` swap, no filter | `DarkSwapAvailable` (Pigskins, TL) |
| `iconDark`, AFL side | same swap, AFL's rule set | `DarkSwapAvailableAfl` (Ninjas, AFL) |
| nothing, but measured illegible | default white stroke | `StrokeDefaultWhite` (Boondock Saints, AFL) |
| `iconStrokeDark: "#rrggbb"` | that color as the stroke | `StrokeCustomColor` (No Soup For You, AFL) |
| `iconStrokeDark: false` | **no stroke at all** | `StrokeExplicitlyOptedOut` (Cowboy Up, TL) |

**The stroke branches are a SHRINKING POOL, and a story on one can go stale
with no edit to the story.** Every `iconDark` the asset sync adds removes a team
from the stroke set — the manifest and `withStrokeColors` both exclude any team
carrying one — so a crest picked for a stroke branch silently becomes a second
swap test the day someone commits its dark artwork.

That is not hypothetical. The Sept 2026 dark sweep (#680, #682, #683, #685)
landed on main while the branch that chose these crests was open, and moved
**The Show** off custom-stroke and **Running down the Dream** off default-white.
Both stories kept passing while testing the wrong branch; the `_dark` derivation
in `computeStoryAssetLiterals()` is what caught it, by demanding a
`the_show_dark.png` the trigger did not list.

Standing as of that sweep: **custom stroke has exactly one team left** (No Soup
For You) and default white has three (Harambe, Badd Boys, Boondock Saints — all
AFL). If the sweep reaches those, the branch loses its last representative and
the fix is a synthetic fixture, not a repoint. **Re-derive from
`crest-dark-stroke-manifest.json` and the configs before trusting any crest in
this file** — including the ones this doc names.

**Both leagues need a swap story.** `buildAllTeamIconDarkCss()` is four builder
calls across two configs and two icon directories, and the pairing is
load-bearing — a league's stroke fallback must use the same `franchiseIconDir`
as its swap or the selectors miss. Until Sept 2026 every AFL crest here was a
stroke case, so a composition that dropped the AFL swap rules rendered light
artwork in dark mode with nothing failing.

The swap and the stroke are mutually exclusive by construction: both the
manifest and `withStrokeColors` exclude any team carrying an `iconDark`.

**The opt-out is the one worth guarding.** `false` means "measured as
illegible, and we still don't want a stroke", so a truthiness filter
(`filter(t => t.iconStrokeDark)`) silently reclassifies it as "never set" —
which puts the crest back on the DEFAULT white stroke, the exact treatment the
`false` exists to refuse. `crest-dark-stroke-css.ts` carries a comment warning
about this; `StrokeExplicitlyOptedOut` is what actually catches it.

**Pick real teams when writing these stories, and check the config first.** The
first draft of this file used Minty Fresh and Ditka as the stroke examples;
both set `iconStrokeDark: false`, so both stories asserted a stroke that by
design never renders. A story is only a guard if the fixture takes the branch
you think it does — verify by reading the computed `filter` in the browser, not
by assuming from the manifest.

Which is why **swapping a crest for a nicer-looking team is not a cosmetic
edit**. Read `src/data/crest-dark-stroke-manifest.json` against the league
config before you do: `iconDark` = swap, `iconStrokeDark: "#hex"` = custom,
`iconStrokeDark: false` = opt-out, in the manifest with neither = default
white. A replacement on the wrong branch silently doubles up one state and
leaves another untested.

## `ThemeImage` — the one component whose light and dark captures MUST differ

Everything else in this suite re-skins between themes. `ThemeImage` swaps the
asset itself: it renders BOTH `<img>` elements server-side (with theme
preference `auto`, the server cannot know the resolved theme) and lets
`src/styles/theme-image.css` decide which is visible.

That makes a regression invisible in whichever theme you happen to be looking
at — drop the `.theme-img--dark` rule and light mode stays perfect while dark
shows the wrong badge or both stacked. The light/dark pair is the only thing
that catches it.

The assertion to write is **exactly one visible `<img>` per theme**, not a
pixel diff. A pixel comparison of the same story across themes ALWAYS differs
because the canvas background changes with the theme — that says nothing about
the swap. Read `getComputedStyle(...).display` on both images instead.

`theme-image.css` is loaded from `preview.ts`: the component imports it in
frontmatter, which is Trap 2.
