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
holding onto: **main runs `chromatic --auto-accept-changes`**
(`.github/workflows/chromatic.yml`), so a wrong render on main does not merely
look wrong once — it becomes the accepted baseline, and the suite goes blind to
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
franchise fell back silently — the Pecking Order's sixteen rank numerals all
rendered the same blue.

This is worse than a cosmetic bug in a visual suite: baselining the fallback
bakes wrong colors into Chromatic and blinds it to precisely the accent
regressions it exists to catch (see `theming-and-assets.md` — the Pecking Order
shipped invisible rank numbers in dark mode exactly this way).

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

## Chromatic (visual regression)

Set up Aug 2026. Runs from CI only — `.github/workflows/chromatic.yml`,
path-filtered so it doesn't add an install to every data-sync PR. The
project token lives in the `CHROMATIC_PROJECT_TOKEN` repo secret and must
never be committed.

```bash
pnpm chromatic   # needs CHROMATIC_PROJECT_TOKEN in env; runs TurboSnap
```

**Modes multiply your bill.** The free plan is 5,000 snapshots/month and
testing pauses (rather than bills) at the cap. `.storybook/modes.ts` splits
them deliberately: every story gets light + dark, and only genuinely
cross-league components (the shared/loading tier) also get the two AFL modes.
The playoff heroes are TheLeague-only surfaces — snapshotting them under the
AFL skin would spend budget on a combination that never ships.

Measured on build 1: **68 snapshots** for 22 stories across 7 components,
captured in 2m06s. The arithmetic is (8 playoff x 2 modes) + (13 loading x 4
modes) = 68 — note 13, not 14: `BrandedLoader/CyclingNarration` carries
`disableSnapshot` and contributes zero. That is ~73 full builds a month before
TurboSnap.

**Snapshots are billed at CAPTURE time, not at approval time.** Every build
captures the stories in scope whether or not you have accepted anything, and
each capture counts against the quota. Approving is a review action; it never
retroactively adds or frees snapshots. The one discount: *rerunning* an
existing build only charges for its denied and unreviewed tests.

**A "turbosnap" is 0.2 of a billed snapshot, not free.** When TurboSnap copies
an unchanged story's snapshot from the baseline it still bills a fifth. So a
narrow PR here costs roughly `(changed stories x modes) + (0.2 x everything
else)` — for a 4-story change that's about 20 billed, against 68 for a full
build. Real savings, but not an order of magnitude.

**The first build is auto-accepted and has no baseline**, so it always captures
everything and reports "Build 1 auto-accepted". There is no review queue to
work through on day one.

**TurboSnap needs three things**, and all of them fail quietly:
- `storybook build --stats-json` (the `build:storybook:stats` script), which
  emits `storybook-static/preview-stats.json`.
- `fetch-depth: 0` on checkout. `actions/checkout` defaults to depth 1, which
  degrades both TurboSnap and Chromatic's baseline detection without erroring.
- An `externals` list in `chromatic.config.json` covering every untraceable
  visual input. **This one is the dangerous default — in BOTH directions.**
  TurboSnap does not trace CSS and other externally-processed static assets
  through the module graph, so without this flag a change to `tokens.css` or
  `tokens-dark.css` can be treated as affecting NOTHING and skip the very
  stories it broke. Given that this repo's most expensive recurring bug class
  is exactly undefined/mismatched theme tokens, that failure mode would make
  Chromatic quietly useless for the thing it was bought to catch. The flag
  forces a full rebuild whenever any file under `src/styles/` changes.

  `.storybook/static/**` is there for the same reason and is easy to miss: a
  `staticDirs` mount is a visual input that lives entirely OUTSIDE the module
  graph — the built CSS keeps the literal `url('/storybook-fonts/...')` and the
  woff2 is only copied next to it. Swap or re-subset the font without this
  glob and TurboSnap inherits every snapshot, so the regression ships green.
  `public/assets/**` was already listed for exactly this reason; any future
  `staticDirs` entry needs the same treatment.

A full rebuild is also forced automatically when Storybook's own config
changes (`main.ts`, `preview.ts`, `modes.ts`) or when dependency versions in
`package.json` move — those can change how any story renders. Since
`preview.ts` imports the global stylesheets, expect touching theming to cost a
full 68-snapshot build.

**Iterating on a PR is free — that is the whole budget model.** The workflow
originally fired on `push` to ANY branch, one build per commit. Measured over
Aug 28-31 2026 that was **60 builds x 160 snapshots = ~9,600 snapshots, about
2x the entire 5,000/month free plan in four days**, and 49 of the 60 were
feature-branch pushes. A single branch (`draft-broadcast-image-loading`) spent
**16 builds — half a month's plan — iterating on one PR**.

It now fires on:

- `push` to **main only** (the baseline run, the one that auto-accepts)
- `pull_request` with `types: [opened, ready_for_review, labeled, synchronize]`
- the `visual-check` label on demand — remove and re-add it to re-run

**The cost control is the `paths:` list, NOT the trigger type.** A revision of
this change dropped `synchronize` to make PR iteration free, and that was a
coverage hole: a commit pushed after the PR opens would get its FIRST capture
from the merge build on main, which runs `--auto-accept-changes` — so it would
be blessed as the baseline having never been reviewed. Exactly the failure this
page keeps warning about.

Checked against the real burn rather than assumed: the 16-build
`draft-broadcast-image-loading` branch touches only draft-broadcast components,
styles, pages and types, none of which are in the closure, so it triggers
**zero** builds under the narrowed paths. Build #117 still triggers, correctly,
because it edited `src/config/leagues-data.mjs`. Narrow paths buy the savings;
restricting the trigger type bought nothing but the hole.

An earlier version of this section argued against `pull_request` because
push+PR would double-bill. That was true only while `push` was unrestricted.
With push scoped to main, a change is built once on its PR and once on merge.

Drafts are skipped until marked ready (a draft PR is still iterating), and the
`labeled` trigger is gated to the one label in the job's `if:` — `labeled`
fires for *every* label otherwise.

**The `paths:` filter is GENERATED, not hand-written.** It used to trigger on
`src/utils/**` — 247 files, of which **45 actually reach a story**. So most
builds re-snapshotted the whole suite for code no snapshot renders.

`scripts/chromatic-story-deps.mjs` walks the real import graph from every
story *and* from `preview.ts` (which imports utils of its own to build the
accent and dark-logo CSS) and prints the closure ready to paste. Run it and
paste into **both** `paths:` lists.

Narrowing this is safe in exactly one direction, and
`tests/chromatic-path-filter.test.ts` is what enforces it: a file that renders
but is NOT matched means the regression never triggers a build, ships, and is
then blessed by `--auto-accept-changes` on main — a visual test that certifies
the bug. Extra patterns are always safe; missing ones fail the suite.

**Filter by what a glob already covers, never by a path prefix.** The generator
briefly ended in `.filter(f => f.startsWith('src/'))`, which silently dropped
three files the walk had correctly found — `data/afl-fantasy/afl.config.json`
(AFL brand colors, reached through both `PeckingOrderIssue` and
`franchise-band-brand`), `data/afl-fantasy/tier-history.json` and
`data/best-ball-1/bb1.config.json`. They render, matched no `paths:` entry, and
the coverage assertions could not see it: a filtered-out file is not
"uncovered", it is invisible. `tests/chromatic-path-filter.test.ts` now pins
them by name for that reason.

Generating the closure also exposed a **real hole in the old filter**:
`src/config/**`, `src/constants/**`, `src/data/**` and `src/types/**` all
reach stories (the league registry, `throwback-config.ts`, `roster-constants.ts`,
`league-events.ts`) and none of them were listed. A change to any of those
altered rendering and never triggered a build. They are covered now — but only
the ~14 hand-maintained `src/data` files that are genuinely in the closure. The
cron-written feeds (`schefter-feed.json`, `mfl-feeds/**`) are NOT in it and must
stay out, which the guard test also asserts: if one ever enters, a snapshot has
started reading live data.

**A story that can't be deterministic should opt out, not flake.**
`BrandedLoader/CyclingNarration` cycles narration on a 2.5s timer, so it
carries `chromatic: { disableSnapshot: true }`. A test that fails at random
teaches you to ignore failures. Covering it properly needs the component to
accept an injectable clock — a component change, not a story change.

The playoff-hero fixtures are fully offline: headshots are inline data URIs
and crests resolve from `public/` via `staticDirs`. They started as live
`a.espncdn.com` URLs and were stubbed precisely because Chromatic waits for
network idle before capturing — a slow CDN response is a timeout and an
intermittent one is a false diff. `delay: 300` now only covers font
application and layout settle. **Never reintroduce a third-party URL into a
fixture.**

## Timing, measured

Build 1 (first authenticated run, no baseline, full capture):

| Step | Time |
|---|---|
| Checkout (`fetch-depth: 0` + `filter: blob:none`) | 15s |
| pnpm install | 10s |
| Chromatic: build, upload, capture 68 snapshots | 3m 07s |
| **Total job** | **3m 40s** |

Without `filter: blob:none` the checkout alone was **4m 40s** — full history
across this repo's several hundred branches took longer than everything else
combined.

A cautionary note for whoever debugs this next: GitHub does not serve a job's
step logs until the job **finishes**, so a Chromatic run in progress is opaque.
Resist reading that as a hang. Build 1 was diagnosed mid-flight as "stuck for
40 minutes" when it had in fact already passed in 3m40s — the diagnosis came
from polling on a mistaken sense of elapsed time, not from evidence. Wait for
the job to end, then read the log; `timeout-minutes: 25` is there so a genuine
hang ends itself and becomes readable.

## Tracking snapshot usage

Two places, one authoritative:

- **Per build** — `scripts/chromatic-usage-summary.mjs` parses
  `chromatic-diagnostics.json` and writes a cost table into the GitHub Actions
  job summary. **`--diagnostics-file` must be passed explicitly** or there is
  nothing to parse: the CLI logs "Wrote Chromatic diagnostics report to
  chromatic-diagnostics.json" whenever it uploads metadata, but only
  *persists* the file to disk when the flag is given as a string
  (`persistDiagnosticsFile = typeof diagnosticsFile == 'string' || debug`).
  The log line without the flag is about the upload, not a file you can read. It runs with `if: always()` because Chromatic exits 1 on visual
  changes (the normal "a human should look" path) and that build's cost still
  needs reporting. It never fails the job.
- **This build, on the Storybook itself** — the `Overview` story fetches
  `/.chromatic/chromatic-diagnostics.json` at runtime. Chromatic uploads that
  file next to the published Storybook on every build, same origin, so the
  homepage reports the build you are looking at with no token and no API call.
  Locally the file is absent and the panel says so instead of showing zeros.
  It carries `disableSnapshot` — it renders live data, so snapshotting it would
  diff on every build and train everyone to rubber-stamp changes. It still
  counts as a story (build 3 reported "23 stories across 8 components,
  captured 68 snapshots") — the story count rises, the snapshot count does
  not.
- **Monthly quota** — only Chromatic's Manage screen. Neither of the above can
  see the account total; they report one build each.

## TurboSnap: `--externals` was disabling it on EVERY build

The note here used to read "withheld until 10 builds are created from CI".
**That was wrong twice over** — it was stale, and it sent the next reader
looking at the account tier and the Vite builder, neither of which was the
problem. Two hypotheses died before the log gave it up:

- *"the free plan withholds it"* — build #117 still reported it off.
- *"builder-vite emits no stats file"* — it does. `pnpm build:storybook:stats`
  writes `storybook-static/preview-stats.json` with 119 modules in the right
  `{id, name, reasons}` shape.

The actual line is in the Chromatic step log, above the summary:

```
⚠ TurboSnap disabled due to matching --externals
Found 2 files with changes:
→ src/styles/accounting.css
→ src/styles/draft-broadcast.css
```

**Neither file renders into a single story.** TurboSnap was available,
configured and working — and switched off on almost every build by our own
flag. From the CLI source (`node-src-*.cjs`):

```js
for (const e of externals) {
  const n = changedFiles.filter(f => picomatch(e, f));
  if (n.length > 0) { changedFiles = undefined; break; }  // TurboSnap dead
}
```

One match anywhere disables it for the WHOLE build. The old list was
`src/styles/**/*.css` (26 stylesheets, 9 render) plus `public/assets/**`
(which holds the What's New screenshots this repo adds constantly). Between
them, virtually every build tripped it.

`externals` now comes from `scripts/chromatic-story-deps.mjs --externals` and
lives in `chromatic.config.json`. **It is tight in one direction and complete
in the other**, and gets both wrong if hand-edited:

- too broad -> TurboSnap disabled, every story at full price (the old bug)
- too narrow -> TurboSnap inherits a snapshot for a file it cannot trace, and
  the regression ships GREEN

`public/assets/fonts/**` is the entry that looks droppable and is not: the
story stylesheets `@font-face` against it, and a re-subset font reflows every
snapshot. `.storybook/static/**` stays for the same reason (Trap 4b).

Verified by replaying build #117's real changed-file list through picomatch:
old externals bail on `src/styles/**/*.css`; new externals do not match, so
TurboSnap stays on.

**Config moved to `chromatic.config.json`.** `package.json`'s script is now
just `chromatic`. The file is strict-schema validated — an unknown key fails
the run outright — and `--externals` requires `onlyChanged`, so both live
there together. The workflow still appends `--auto-accept-changes` on main.

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
reports nothing beyond them. Concretely: `PeckingOrderIssue.astro` imports
`src/utils/team-accent-css` on line 21 and has four stories, but querying
`src/utils/team-accent-css.ts` returns **"no stories found"**. So does
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

| Team declares | Dark-mode result | Story |
|---|---|---|
| `iconDark` | `content: url(<dark>)` swap, no filter | `DarkSwapAvailable` |
| nothing, but measured illegible | default white stroke | `StrokeDefaultWhite` |
| `iconStrokeDark: "#rrggbb"` | that color as the stroke | `StrokeCustomColor` |
| `iconStrokeDark: false` | **no stroke at all** | `StrokeExplicitlyOptedOut` |

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
