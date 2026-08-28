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

One real consequence: `pnpm build:tools` (`scripts/build-league-tools.mjs`)
calls `vite build`, so re-running it now minifies with Vite 8 and the committed
bundles under `public/assets/js/dist/` change by ~100 bytes. Functionally
equivalent, but don't be surprised by the diff.

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
AFL skin would spend budget on a combination that never ships. That lands at
(8 x 2) + (14 x 4) = 72 snapshots per full build, ~69 full builds a month,
before TurboSnap.

**Snapshots are billed at CAPTURE time, not at approval time.** Every build
captures the stories in scope whether or not you have accepted anything, and
each capture counts against the quota. Approving is a review action; it never
retroactively adds or frees snapshots. The one discount: *rerunning* an
existing build only charges for its denied and unreviewed tests.

**A "turbosnap" is 0.2 of a billed snapshot, not free.** When TurboSnap copies
an unchanged story's snapshot from the baseline it still bills a fifth. So a
narrow PR here costs roughly `(changed stories x modes) + (0.2 x everything
else)` — for a 4-story change that's about 21 billed, against 72 for a full
build. Real savings, but not an order of magnitude.

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
full 72-snapshot build.

**One build per push, not two.** The workflow fires on `push` only. Adding
`pull_request` as well would bill two builds for the same change — one for the
PR head, one for the merge commit. Chromatic tracks baselines per branch from
push events and reports via commit status, so the check still lands on the PR.

**A story that can't be deterministic should opt out, not flake.**
`BrandedLoader/CyclingNarration` cycles narration on a 2.5s timer, so it
carries `chromatic: { disableSnapshot: true }`. A test that fails at random
teaches you to ignore failures. Covering it properly needs the component to
accept an injectable clock — a component change, not a story change.

The playoff heroes load real ESPN headshots, the one external dependency in
the fixtures. `delay: 300` in preview.ts keeps a slow CDN response from being
captured mid-load; if they still flake, stub the images rather than raising
the delay.
