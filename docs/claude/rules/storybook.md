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
`process.env` hydration — a story gets none of it.

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
- `--externals 'src/styles/**/*.css'`. **This one is the dangerous default.**
  TurboSnap does not trace CSS and other externally-processed static assets
  through the module graph, so without this flag a change to `tokens.css` or
  `tokens-dark.css` can be treated as affecting NOTHING and skip the very
  stories it broke. Given that this repo's most expensive recurring bug class
  is exactly undefined/mismatched theme tokens, that failure mode would make
  Chromatic quietly useless for the thing it was bought to catch. The flag
  forces a full rebuild whenever any file under `src/styles/` changes.

A full rebuild is also forced automatically when Storybook's own config
changes (`main.ts`, `preview.ts`, `modes.ts`) or when dependency versions in
`package.json` move — those can change how any story renders. Since
`preview.ts` imports the global stylesheets, expect touching theming to cost a
full 68-snapshot build.

**One build per push, not two.** The workflow fires on `push` only. Adding
`pull_request` as well would bill two builds for the same change — one for the
PR head, one for the merge commit. Chromatic tracks baselines per branch from
push events and reports via commit status, so the check still lands on the PR.

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

## TurboSnap is withheld until 10 CI builds

```
⚠ TurboSnap not available for your account
TurboSnap is not available until at least 10 builds are created from CI.
```

`--only-changed` is a no-op until then, so **every build costs the full 68**
until build 10, regardless of how small the diff is. Budget for roughly
680 snapshots of runway before the discount starts. After that a narrow PR
drops to ~20 billed. The `turboSnapEnabled` flag in the job summary and on the
Overview page says which regime you are in.
