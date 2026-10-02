# League themes — one theme file drives the site and the MFL skin

Status: **phases 1 and 4 done** (Oct 2026) — theme library + generator (zero
visual change), CTAs on theme slots, and the per-league review pages. PR #1308.

## Goal

Onboarding a new league's look should be: the league hands over a few colors
and fonts → we generate a full proposed theme → they approve it on a review
page → one committed file restyles this site AND produces their MFL skin.
Every league uses the same building blocks and the same semantic tokens; only
the values differ.

## Decisions (from the planning conversation)

| Question | Decision |
|---|---|
| Who edits | Brandon, in code. Build-time only — no runtime/commissioner editor. |
| What a league controls | Every semantic token, light AND dark, plus fonts. |
| Reuse | Any theme can be used by any league. **No inheritance** — a theme is complete on its own; reuse means pointing at the same theme id or copying the file. |
| Approval | A page on the site that shows every token plus heroes, buttons and the other common design elements. |
| Fonts | Part of the theme (headline / body / numeric). |
| MFL skin | Generated from the same theme file — **new leagues only for now**. TheLeague's and the AFL's existing skins are not regenerated. |
| Status colors (success / warning / danger, win / loss) | Shared defaults; a theme may override them. |

## Where things stand today

- Palettes are hand-written `html[data-league="…"]` blocks in
  `src/styles/tokens.css` + a twin in `tokens-dark.css`. TheLeague is the bare
  `:root` default; AFL (+ keeper, by sharing the selector), bb1 and `mfl` each
  override a **different subset** — the AFL keeps TheLeague blue for
  `--color-primary`, `mfl` re-points it and restates ~20 more tokens. Every
  gap falls back to TheLeague blue, i.e. the missing-token trap in
  `docs/claude/rules/theming-and-assets.md`.
- League-named tokens in shared code: `--afl-accent`, `--afl-navy`,
  `--afl-gold*` (12 files), `--bb-green`.
- Brand hexes outside the token files: `#1c497c` ~175 files, `#c41e3a` ~45,
  `#0f1e2e` 12, `#0e8a5f` 8 (some are only `var()` fallbacks).
- 11 files outside the token files carry `[data-league="<slug>"]` selectors.
- Fonts: `--font-display` / `--font-numeric` (self-hosted UFC Sans) and Vend
  Sans via Astro's font API (`astro.config` `fonts:` + `<Font>` in all four
  layouts). OG images load UFC Sans TTFs separately.
- MFL skins: `src/assets/css/src/_variables-<name>.scss` built by
  `pnpm build:styles` (`scripts/build-styles.mjs`); MFL token vocabulary in
  `.claude/skills/mfl-skin-builder/references/token-map.md`. **Never
  `scripts/build-themes.js`** — it wipes `dist/` and rewrites every skin.

## Design

### 1. Theme library — `src/themes/<theme-id>.json`

```jsonc
{
  "id": "afl-red-navy",
  "seeds": { "primary": "#…", "accent": "#…", "ink": "#…", "gold": "#…" },
  "fonts": { "display": "…", "body": "…", "numeric": "…", "source": "google|self" },
  "light": { "<semantic-token>": "#…", … },
  "dark":  { "<semantic-token>": "#…", … },
  "status": { … }          // optional; absent = shared defaults
}
```

The registry (`leagues-data.mjs`) gets `theme: '<theme-id>'` per league.
There is no `extends` key, and the validator rejects one.

### 2. The semantic token contract

One list (`src/themes/tokens.ts`) names every token a theme must define:
surfaces (page / content / card / overlay), text (primary / muted / inverse),
borders, primary + hover/active steps, accent, ink (breadcrumb strip, footer,
resting nav icons), link, focus ring, gold family, nav states, button set,
status set. Derived rgba values (focus-ring shadow, nav-active tint,
box-shadow tints) are computed by the generator, not hand-entered — those are
exactly the literals the `mfl` block had to restate by hand.

Guard test `tests/league-themes.test.ts`:
- every registry league names a theme that exists;
- every theme defines every token in both `light` and `dark`;
- contrast floors on the pairs that matter (body text on card ≥ 4.5:1, white
  on primary ≥ 4.5:1, accent/link text on card ≥ 4.5:1, ink chrome text ≥
  4.5:1, focus ring ≥ 3:1) in both modes;
- no theme carries an inheritance key.

### 3. Proposal generator — `scripts/generate-league-theme.mjs`

Input: seed colors + fonts. Output: a complete draft theme JSON — steps and
tints derived from each seed, a dark-mode counterpart, every pair clamped to
its contrast floor (reuse the clamping in `getTeamAccentPair`,
`src/utils/team-colors.ts`). The draft is hand-tunable before review.

### 4. Review page — `/<league>/theme` (or `/themes/<theme-id>`)

Admin-visible, so a theme can be reviewed before any league uses it (route
takes the theme id; `?theme=` preview). Shows, in light and dark side by side:
- every semantic token as a swatch with name, hex and contrast ratio;
- type specimens for each font role;
- the real components: hero shells, buttons (all variants and states), nav and
  breadcrumb strip, cards, standings/roster tables, badges, empty/error states,
  status colors, footer;
- a preview of the generated MFL skin (header, menu, table, button).

Built with `/new-page`, needs its `page-directory.json` entry. Probably sits
next to the Brand Book (`/<league>/brand`) and links to it.

### 5. Outputs

- **Site CSS**: a prebuild step writes
  `src/styles/league-themes.generated.css` — one `html[data-league="<slug>"]`
  and one `html.dark[data-league="<slug>"]` block per league, every token, so
  no block can be partial. Replaces the hand-written league blocks in
  `tokens.css` / `tokens-dark.css` (TheLeague's `:root` values become its
  theme file). Written with `writeJsonIfChanged`-style idempotence so an
  unchanged theme commits nothing.
- **Fonts**: Google fonts go into `astro.config`'s `fonts:` array generated
  from the theme library; `<Font>` in the layouts is rendered per league. The
  theme maps the families onto `--font-display` / `--font-body` /
  `--font-numeric`. Each new font needs metric-matched fallbacks (the
  polish layer's no-reflow rule). Open: OG images need the TTFs too.
- **MFL skin**: the same file generates
  `src/assets/css/src/_variables-<league>.scss` + `<league>_main.scss` through
  a fixed site-token → MFL-token map (token-map.md made code), then
  `pnpm build:styles`. New leagues only; existing skins untouched.

### 6. Cleanup that makes tokens actually drive the site

- Rename league-named tokens to roles: `--afl-navy` → `--league-ink`,
  `--afl-accent` → `--league-accent`, `--afl-gold*` → `--league-gold*`,
  `--bb-green` → `--league-ink`.
- Remove the 11 out-of-band `[data-league="…"]` selectors (ratchet them first).
- Ratchet brand hexes outside token files (same idiom as
  `design-literal-baseline.json`), then sweep — AFL / bb1 literals first,
  since those are the ones a new league would inherit wrongly.
- Keeper stops sharing the AFL selector and names a theme id.
- Code that cannot read CSS vars (OG images, push payloads, manifests) reads
  a `leagueTheme(slug)` helper over the registry.

## Phases

1. **Foundation, zero visual change.** Theme files for theleague, afl-fantasy,
   keeper, bb1, mfl with today's exact values; the generator emits the CSS;
   delete the hand blocks; screenshot-diff every league in both themes. The
   `mfl` app is not a registry league — its theme is applied by
   `MflAppLayout.astro` directly, same as today.
2. **Token renames + out-of-band selector removal + hex ratchet.**
3. **Contract guard + proposal generator.**
4. **Review page.** Done — `/<league>/theme/light` and `/theme/dark`.
5. **Fonts per theme.**
6. **MFL skin generation** (validate against a scratch league, not an existing
   skin).
7. **First new league** end to end.

Each phase is its own PR. Phase 1 is the riskiest (it touches every page's
colors); everything after it is additive.

## Resolved

- **CTAs wear the league's colour** — the theme slots `--cta-fill` /
  `--cta-fill-hover` / `--on-cta-fill` feed `src/styles/cta.css`, set to each
  league's accent at an AA-passing step (guarded per theme and mode).
- **Review pages: one per theme per mode** — a light page and a dark page for
  every theme, not one page with both side by side.

- **Logos** stay in the league registry, not the theme.
- **Review page** — the league being onboarded can open it (and the site)
  before launch, not only admins.
- **Fonts carry through to share (OG) images** — `astro.config` lists the UFC
  Sans TTFs explicitly today, so phase 5 has to feed the theme's fonts there.

## Phase 1 — as built

- `src/themes/{theleague,afl,bb1,archies,mfl-live}.json`; the keeper slot
  names `afl`. Values are each league's EXACT pre-migration cascade, kept as declared
  (a value may still be a `var()` of another token — Archie's palette layer
  depends on it) over the 141 tokens any league block used
  to override (Archie's palette layer included) — that set seeded `src/config/theme-tokens.mjs`.
- Those 141 tokens were removed from `tokens.css` `:root` and
  `tokens-dark.css` `html.dark`, with all five league blocks.
- Verified in Chromium: every custom property on `<html>` across 10 pages ×
  light/dark, plus every theme swapped onto two pages and no `data-league` —
  40,050 computed values, 0 differences. Two pages had to move a `:root`
  override to `:root:not(.dark)` to get there.
- Still league-named (phase 2): `--afl-*`, `--bb-green`, `--mfl-ink*`, and
  `null` values where a theme leaves a token unset.

## Phase 4 — as built

- `src/pages/<league>/theme/{light,dark,index}.astro` for theleague,
  afl-fantasy, best-ball-1 and archies; the body is
  `src/components/shared/theme/ThemePage.astro`. `/theme` redirects to light.
- `TheLeagueLayout`'s `themeLock` prop writes `<html data-theme-lock>`, and
  `ThemeScript` resolves to that mode whatever the preference, so a review
  page cannot be flipped by the toggle or by prefers-color-scheme.
- Everything renders through the live tokens. Resolved values and contrast
  ratios are read in the browser, because only the browser knows where a
  `var()` chain ends.
- Directory entries are `visibility: admin`: a review tool, linked to the
  league, not an owner page in search or the footer.
- The page found the first real defect on day one. On the AFL's navy dark
  ground, `--color-primary` cannot both be text and carry white, so
  `--color-primary-fill` now splits the fill from the text (see the AFL
  theme's note). TheLeague and Best Ball dark still fail the same pair at
  3.68:1, and each needs one `--color-primary-fill` value.

