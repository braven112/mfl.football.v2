# Theming and assets — tokens, franchise colors, logos, service worker

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Design tokens — every var(--x) must reference a token that exists

The theme system is `src/styles/tokens.css` (light) + `tokens-dark.css`
(html.dark overrides). Styling against a token name that is defined nowhere
(`var(--color-text, #0f172a)`, `--color-surface`, …) renders the hardcoded
fallback in BOTH themes — light mode looks perfect, dark mode ships white
cards on a black page. That's how the Admin Hub broke in July 2026, and a
repo-wide sweep found the same pattern in ~40 files.
`tests/design-token-guard.test.ts` now enforces this: it scans src/ and
fails if any `var(--x)` references a custom property with no definition
anywhere (global token files, local declarations, `define:vars`,
`setProperty`, JSX `['--x' as any]` keys all count). Use the real tokens —
`--page-text`, `--content-text-muted`, `--card-bg`/`--card-surface`,
`--content-bg`/`--content-bg-muted`, `--content-border`, badge pairs — and
check `tokens-dark.css` before hand-rolling a `:global(html.dark)` override.
One more gotcha from the sweep: a token's light and dark values differ, so
when swapping a hardcoded color to a token, verify the token's LIGHT value
matches what was rendering — otherwise keep the light literal and override
only under `html.dark` (see the admin-hub gate pills for the pattern).


## Franchise colors as foreground — use the accent token, never the raw hex

A team color used as FOREGROUND (text, a rank numeral, a border, a chart line,
a legend swatch) must come from the site-wide token `--team-accent-<franchiseId>`,
via `teamAccentVar(fid)` (`src/utils/team-accent-css.ts`). The token carries a
light value and an `html.dark` override, both forced to clear 3:1 against that
theme's card surface by `getTeamAccentPair` (`src/utils/team-colors.ts`).

Raw config colors cannot do this: several franchises wear a near-black or navy
primary that lands ~1.1:1 on a dark card (Bring The Pain, Cowboy Up), and the
yellows/golds do the same on a white one (Midwestside at 1.5:1). That's how the
Pecking Order shipped invisible rank numbers in dark mode (August 2026).

- **Never pick a theme's color in frontmatter.** With theme preference 'auto'
  the server doesn't know the resolved theme; a CSS custom property keyed on
  `html.dark` does. Same reasoning as the NFL logo / league icon dark swaps.
- **Client-drawn marks must set colors via `style`, not `setAttribute`** —
  `var()` resolves in a style declaration, never in an SVG presentation
  attribute (see `OwnerActivityReport.astro`'s polylines). Done that way, charts
  follow the theme with no redraw.
- Blocks are scoped `html[data-league="…"]` because franchise ids collide
  across leagues (both TheLeague and the AFL have an 0001).
- The exception is a team color used as a BACKGROUND FILL with white text on
  top (deep-ink composite heroes, pick-reveal, dead-money) — different contrast
  question, different rule; see the player-headshot section below.
- `tests/team-accent-css.test.ts` fails the build if any franchise in any league
  falls under 3:1 in either theme, or if the layout drops `TeamAccentStyles`.


## Player headshots on team colors — use the shared avatar helpers

A player headshot on a team-color backdrop must go through
`getPlayerAvatarBackground` / `getPlayerAvatarBorder`
(`src/utils/nfl-team-colors.ts`) — usually via `<PlayerCell>` or
`buildPlayerCellHTML`, which set the `--player-avatar-bg`/`--player-avatar-border`
properties consumed by `player-cell.css`. Don't hand-roll gradients from
`getNflTeamColors`: a third of the NFL wears near-black primaries, and a raw
primary behind a dark-jerseyed headshot is invisible in dark mode (July 2026,
Cam Ward on Titans navy). The helpers pick a readable anchor (lighter
secondary for near-black primaries), floor its luminance, and add the radial
head-spotlight. The one sanctioned exception is the deep-ink composite family
(hero panels, player modal band, OG images, pick-reveal, dead-money) — dark
full-bleed surfaces with white text on the colored area, allowlisted in
`tests/team-color-backdrop-guard.test.ts`, which fails the build for any new
direct `getNflTeamColors` consumer.


## NFL team logos — committed files, guard-tested, must never 404

Every player cell renders self-hosted `/assets/nfl-logos/{CODE}.svg`. Two
hard-won facts (Aug 2026 "missing team images" saga):

- **The files are committed** in `public/assets/nfl-logos/` — one SVG per
  canonical ESPN code AND per MFL/legacy alias (`TBB`, `NOS`, `OAK`, `RAM`,
  `SDC`, `STL`, …), because several pages render the raw feed code without
  normalizing. They were originally never committed (only existed in local
  working trees), so production 404'd every light-mode logo for weeks.
  `tests/nfl-logo-assets.test.ts` now fails CI if any code emitted by
  `TEAM_CODE_MAP`/`getAllNFLTeamCodes` — or any `team` value appearing in any
  committed players feed — lacks a valid SVG. Add a logo file + map entry
  together, and never gitignore this directory.
- **A logo 404 is cache-poisonous, not cosmetic.** Cloudflare used to stamp
  `cache-control: max-age=14400` on responses *including 404s*, so one broken
  window kept rendering broken icons on owners' phones for hours after the
  origin was fixed (that's why past fixes "didn't take"). **That setting is
  now fixed** — Browser Cache TTL is on "Respect Existing Headers", verified
  live 2026-08-18: the apex serves the origin's own
  `public, max-age=0, must-revalidate`. Don't re-file it as a to-do. Defense
  in depth remains: player-cell logo `<img>`s carry the `NFL_LOGO_ONERROR`
  fallback (roster-constants) — hide the img on failure. No substitute crest
  (owner decision: a wrong logo is worse than none). Dark mode is separate:
  the `content: url()` swap fires no error event, which is why the dark logos
  are prebuild-mirrored (see `nfl-logo-dark-css.ts`).
- **The service worker is now the longest-lived cache in front of an asset,
  not the CDN.** `public/sw.js` holds `/assets/**` on stale-while-revalidate,
  so a bad copy survives exactly one more page view; it is cache-first ONLY
  for `/_astro/*`, where the content hash is the version. Never widen
  cache-first to an unversioned path — that pins a 404 until `CACHE_NAME` is
  bumped, which is unbounded and worse than anything Cloudflare did.


## Service worker — bounded staleness, versioned cache-first

`public/sw.js` is registered in production only (`TheLeagueLayout.astro`;
dev actively unregisters it). Three invariants, each one a bug that shipped:

- **Cache-first is for `/_astro/*` and nothing else.** Those filenames carry
  a content hash, so the URL changes when the bytes do and a cached entry can
  never be stale. Every other static path (`/assets/**` — team icons, NFL
  logos, the sprite) is unversioned and runs stale-while-revalidate.
- **A cached HTML document expires.** Pages are SSR and personalized, and
  their `<link>` tags name content-hashed CSS *for the build that rendered
  them*. Replaying an old document therefore pairs old markup with a retired
  stylesheet — that is how the homepage hero shipped with no background at
  all, white ink on the bare page, "fixing itself" after a few navigations
  (owner report, 2026-08-18). `HTML_STALE_MAX_AGE_MS` (12h) caps it; past
  that the offline page wins, because an honest "you're offline" beats a
  broken page that looks live.
- **An aborted request is not a network failure.** `fetch` rejects when the
  user taps a second link mid-navigation, which is constant on mobile. The
  old handler treated every rejection as offline and replayed stale HTML.
  `AbortError` now propagates.

Bumping `CACHE_NAME` is the ONLY lever that reaches a phone already holding
a poisoned entry — activate deletes every other cache. Bump it whenever a
caching rule changes.

`tests/service-worker-cache.test.ts` executes the real `sw.js` against a
stubbed `caches`/`fetch`/`Date` and asserts on the Response it hands back.
Do NOT swap it for greps: every one of these bugs is invisible in the source
text (7 of its 10 cases pass a source-level reading of the old file and fail
on its behavior).

