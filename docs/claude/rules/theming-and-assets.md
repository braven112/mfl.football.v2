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


## Astro scoped CSS never reaches an element JS created

A `<style>` block in a `.astro` file compiles to selectors that require the
page's `astro-xxxx` scope class on the element itself. Anything built at
runtime — `document.createElement`, an `innerHTML` string, a `define:vars`
script's row builder — has no scope class, so *every* scoped rule silently
misses it and the element renders with browser defaults. Nothing errors; the
markup just looks unstyled.

That is how the Free Agents ranking headers shipped at 16px mixed-case
centered while every static header next to them was 10px uppercase gray: the
`<th>`s come from `src/utils/rankings-table.ts`, so `.players-table th
{ white-space: nowrap }` never applied and "My Rank" / "FBG ®" wrapped onto two
lines. The fix is global CSS keyed to something only the injected elements
carry (`th[data-ranking-col]`), in a shared stylesheet both sibling pages
import — `src/styles/ranking-columns.css`. A `:global()` block inside the page
works too, and the pages already use that for the ranking `<td>`s; a plain
`.css` file is the better home once two pages need the same rules.

Symptom to recognize: one row of headers or cells styled correctly and its
JS-built neighbors not, in the same table.

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



## `broadcastGradient` — the one franchise color that is NOT derived

Every franchise in `afl.config.json` and `theleague.config.json` carries a
`broadcastGradient`: a RAW CSS `background` string that the AFL draft
broadcast's reveal card paints **verbatim**, sitting in config next to `icon`
and the name fields. It is the deliberate exception to everything above — no
accent token, no 3:1 floor, no `toBroadcastPair` saturation. The card owns a 65"
screen for ~18 seconds, so the look is a design decision, not a computed one.

- **36 of the 40 entries were GENERATED**, not designed — each is exactly the
  gradient `toBroadcastPair(colorPrimary, colorSecondary)` already produced,
  written down, so introducing the field changed nothing for them.
  `tests/broadcast-gradient-config.test.ts` re-derives them and fails on drift,
  with a `HAND_AUTHORED` exempt set holding the four entries that ARE designed
  — Midwestside and Vitside, and note that is TWO franchises but FOUR entries,
  since each appears in both leagues (Aug 2026). Hand-authoring another means
  adding it to that set, not deleting the check.
- **Raw CSS means nothing else can catch a typo.** A stray `;` doesn't look
  wrong — it ends the inline declaration and the card renders with NO background
  at all, on the TV, in front of the league. `isSafeCssGradient`
  (`src/utils/draft-broadcast.ts`) is the gate: a charset with no `:` `;` `{` `}`
  or quotes, balanced parens, and EVERY comma-separated layer must be a gradient
  function — not just the first. That last part is not pedantry: anchoring the
  check to the head of the string let `linear-gradient(…), lnear-gradient(…)`
  validate, and one transposed letter in a second layer blanks the card exactly
  like the `;` does. A value that fails is IGNORED, not thrown on — the card
  falls back to the derived pair.
- **It drives every surface that paints a franchise, not just the broadcast.**
  As of Sep 2026 that is THREE: the reveal card, the on-the-clock idle board,
  and the two homepage heroes (`resolveHeroFranchiseBackdrop` →
  `AflEventHero` / `EventHeroShell`), which paint the signed-in owner's own
  gradient behind the promo card. A fourth would read the same field the same
  way; that is the point of the field. What follows is the original two-surface
  reasoning, and it generalizes — the reveal card and the on-the-clock
  idle board — off one string, and that is the point. `#638` had already made
  the two share a colour TREATMENT and they still disagreed, because each
  composed the pair its own way: the reveal at 115/315deg, `.dbc-idle` at 150deg
  with reversed stops and a stop running off the canvas at 130%. Midwestside
  proved it — a gold-dominant idle board handing off to a near-black reveal,
  twice a minute, for the same franchise. Both now paint
  `var(--dbc-gradient, <derived pair>)`, set from `resolveBroadcastGradient`
  (Brandon, Aug 2026). Adding a second field (`idleGradient`) was the
  alternative and was rejected: two strings per franchise to keep in sync is how
  they drift apart again.
  - This DID repaint the other 36 franchises' idle screens, from
    `150deg secondary→primary` to their reveal's `115deg primary→secondary`.
    That was the accepted cost. Legibility is safe by construction — both stops
    are already floored to 4.5:1 against white by `toBroadcastPair` — but any
    future change to the idle composition now shows up on the reveal too.
  - `tests/draft-broadcast.test.ts` pins that both components call
    `resolveBroadcastGradient`, that both hand it to the SAME custom property
    (two names would type-check and silently re-split the paint paths), and that
    both CSS rules read it with a real gradient fallback.
- **`.dbc-reveal__wash` still paints on top** — 58% black at the left edge, 45%
  at the right. Author around it: a bottom-right accent loses ~45% of its
  luminance, so a corner hue has to be a genuinely bright one to still read as
  itself from ten feet. Midwestside's `#ffd400` corner lands ~`#8c7100` on
  screen, which is the intended "just a bit of gold".

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

### The missing-headshot fallback is drawn, not fetched

When there is no photo, the fallback is `buildNoHeadshotPlaceholder(team)` —
an inline `data:image/svg+xml` painting the SAME gradient stops as the chip,
with a translucent white silhouette over them. It used to be MFL's
`no_photo_available.jpg`: a **white disc**, which loaded on top of the
team-color chip and blanked it out completely (Sept 2026). Three things about
it are load-bearing:

- **The gradient is baked into the SVG, not left to the chip.** Only the
  player-cell surfaces have a team-colored chip; dead money, MVP, the draft
  board and the lineup accordion draw a neutral gray one, and a translucent
  silhouette on gray is the same invisible smudge. Painting it inside makes the
  placeholder correct on any background, and identical stops mean it coincides
  seamlessly with the chip where there is one.
- **It carries `id="no-headshot"`, and `player-cell.css` matches on it**
  (`img[src*="no-headshot"]`) to skip the ESPN-cutout zoom. The src is swapped
  in by an inline `onerror` handler, so there is no element to add a class to.
  Without that rule the silhouette blows past the chip edge.
- **The legacy MFL URL is still recognized as "no headshot"**
  (`isPlaceholderHeadshot` / `resolveHeadshotSrc` in
  `src/constants/roster-constants.ts`). This is defensive, not a fix for
  anything observed — no committed data file carries that URL today — but two
  feed scripts still emit it for a player with no MFL id, and it loads with a
  **200**, so it would never fire an `onerror` and the cascade could not catch
  it. Recognizing the string is the only place that can.

`DEFAULT_HEADSHOT_URL` is the team-less form of the same placeholder, so a
renderer that ignores all this still gets a silhouette rather than a white
hole — but pass the team wherever you have it.
`tests/no-headshot-placeholder.test.ts` pins the color match, the id, and the
`'`-free encoding that keeps the URI safe inside a single-quoted inline
`onerror` string.


## A surface that is dark in BOTH themes must resolve its own crest

Every crest mechanism on this site is keyed on `html.dark`: the artwork swap in
`team-icon-dark-css.ts` (`html.dark img[src="<light>"] { content: url(<dark>) }`)
and the measured white ring in `crest-dark-stroke-css.ts` both fire only for a
viewer whose SITE THEME resolved to dark. That is exactly right for a card that
follows the theme, and it does **nothing** for the growing set of surfaces that
paint deep ink in both themes — the player modal band, the draft broadcast
board, the recap composite hero, the lineup faceoff panels. A light-theme owner
looking at one of those gets the light crest on near-black, unringed, forever.
The bug is invisible to anyone testing in dark mode.

So those surfaces resolve the crest **server-side**, through
`resolveDarkSurfaceCrest` (`src/utils/dark-surface-crest.ts`). That looks like a
violation of "never pick a theme on the server" and it isn't: there is no theme
to resolve, because the surface has only one.

- **The order is theme first: `groupMeDark → iconDark → groupMe → icon`.** The
  dark cuts are hand-authored, 100x100 (`iconDark`) or 400x400 (`groupMeDark`);
  the light art is the same two sizes. Everything using this renders the crest
  between ~40px and ~300px, where a 100px source upscales at most ~3x and — at
  the 0.12–0.35 watermark opacities these surfaces use — shows nothing. Getting
  the right ARTWORK is the whole game at that size. The draft broadcast's 68vh
  reveal crest is the one exception and keeps its own order (below).
- **`iconStrokeDark` is a human's answer in both directions.** A colour string
  opts a crest in and picks the colour; `false` opts it out entirely. It
  outranks everything, including the measurement. A JSON `true` is type-legal,
  so it MEANS opt-in-at-default — never let it reach CSS as a colour, or
  `drop-shadow(… true)` invalidates the whole composed `filter` and the crest
  loses its drop shadow too.
- **Having an `iconDark` at all is read as "this franchise's light art fails on
  dark."** `measure-crest-contrast.mjs` skips those teams — correct everywhere
  else, since they swap — so it is their only signal on an order that can strand
  them on light artwork.
- **The ring is applied INLINE by the caller**, which also outranks the global
  `html.dark` rule keyed on the same src, so a crest can never wear two rings.
- **Never render the light `icon` of a franchise that HAS an `iconDark`.**
  `TeamIconDarkStyles` ships in the shared layout head on every page, so that
  exact src would swap under `html.dark` and the crest would follow the VIEWER's
  theme on a surface that has none. The order above guarantees this; anything
  hand-rolled beside it must too.
- **Era artwork (Throwback Week) inherits none of it.** An era crest has no dark
  variant and was never measured, so `getThrowbackFranchiseBrand` drops
  `iconDark` / `groupMeDark` and sets `iconStrokeDark: false` — `false`, not
  cleared, because the stroke index is keyed by `franchiseId` and passed in
  separately, so merely dropping the field still rings a flagged franchise with
  a ring measured against the crest it is no longer wearing. Only when the
  franchise ACTUALLY threw back: `resolveThrowbackIdentity` falls through to the
  current identity for one with no eligible era, and stripping its dark art
  there strands that franchise on light art for the week (`eraCrestOverrides`,
  split out because that branch is unreachable through today's config).

**Three surfaces got this wrong independently**, which is why it is written down
here rather than in one of them: the broadcast (#681), the recap hero, and
TheLeague's lineup page — whose AFL sibling had resolved it server-side since it
launched, so the two sibling pages disagreed about the same panel. The helper is
never the regression; a NEW dark-in-both-themes surface reaching straight for
`brand.groupMe` is. `tests/dark-surface-crest.test.ts` pins the rule, sweeps
both configs asserting this surface is never weaker than the themed ones beside
it, and asserts the known call sites still route through the helper.

**Still unconverted, and known:** the playoff heroes
(`hero-data/playoff-round-data.ts` hands `brandOf` a bare `groupMe`, painted on
a `franchiseGradient` — near-black in both themes) and the tagged-player
showcase (`theleague/index.astro` passes `tc?.icon`). Both are seasonal
surfaces; both are the same bug. Convert them when you are next in there rather
than adding a third hand-rolled order.

## The player modal band wears the FRANCHISE, and it is dark in both themes

`player-modal-band.ts` paints the header of every player modal
(PlayerDetails / PlayerNews / PlayerInjury / ContractDeclaration). A ROSTERED
player's band brands by the fantasy franchise that owns him — gradient hues +
crest watermark; a player with no `franchiseId` falls back to the NFL palette.
The map it reads (`franchise-band-brand.ts`) is server-rendered ONCE per page
by `FranchiseBandBrands.astro` in the shared layout `<head>`, and is already
Throwback Week-resolved. Four things there are load-bearing:

- **The crest is picked server-side as the DARK artwork, and the measured
  stroke is applied INLINE** — the dark-in-both-themes rule above, which this
  band was the first surface to need. It predates `dark-surface-crest.ts` and
  still resolves `iconDark || icon` itself, so it does NOT see the 400x400
  `groupMeDark` cuts: a franchise with a `groupMeDark` and no `iconDark`
  (Running down the Dream) wears light art here and dark art on every other
  such surface. That franchise is an `iconStrokeDark: false` opt-out — a human
  saying its light mark reads fine on ink — so this is a follow-up, not a live
  bug. Do not "fix" one call site into agreement; move the band onto the shared
  helper or leave it.
- **The gradient anchor is the chart hue `color`, floored to 3:1 vs white.**
  `colorPrimary` is `#181818` for five TheLeague franchises, so anchoring
  there makes five teams the same near-black band. The chart hue is the
  identifiable one — but it includes Midwestside's `#ffcd00` at 1.5:1 against
  the band's white type, so `ensureContrastOn(…, '#ffffff')` darkens it just
  far enough. Same for era colors during a Throwback Week.
- **The map is re-read per call, never captured at module load** — the
  `rankings-scope.ts` trap: one module instance survives a ClientRouter
  navigation between leagues, and a captured map paints the wrong league's
  crest.
- **`crestLight` is the SECOND crest, for the modal's "Rostered by" strip.**
  That strip sits on the card, not the band — a franchise-tinted wash that
  follows the theme — so it is the one consumer of this map with a theme to
  resolve. It therefore renders the LIGHT src and lets `TeamIconDarkStyles`
  do both jobs (dark-cut swap, measured ring). It shipped the other way: the
  band's dark artwork on a black chip drawn behind it in both themes, which is
  the dark-in-both-themes recipe applied to a surface that isn't. Two rules
  follow from the fix and neither is style — the chip must stay gone (it is a
  black box behind art drawn for the card), and nothing may set an inline
  `filter` on that img (an inline filter outranks the global `html.dark` rule
  and rings the crest in light mode too). `tests/player-modal-owner-strip.test.ts`
  pins both, plus that `crestLight` really is each franchise's `icon`.

`tests/franchise-band-brand.test.ts` pins the first three, plus the requirement that
exactly one component emits the map.

## The draft broadcast picks its own crests, and it needs TWO of them

The board is dark in both themes, so the rule above applies and
`resolveBroadcastCrest` (`src/utils/broadcast-crest.ts`) picks the artwork
server-side. It shares every primitive with `dark-surface-crest.ts` — the ring
signals, the dark-cut test, the manifest index. What is NEW here is that one
crest is not enough.

- **The reveal crest is 68vh** — ~734px on a 1080p TV, the biggest image on the
  site — and the idle board's is ~367px. The hand-authored `iconDark` cuts are
  100x100 and the GroupMe art is 400x400, so on those two surfaces the dark cut
  costs a 7x upscale. Resolution wins there (Brandon, Sep 2026, off a
  side-by-side of Music City at reveal size): `groupMeDark → groupMe → iconDark
  → icon`, and the legibility is bought back with an outline instead.
- **The panel crest (~151px) and the rail icons (~40px) take the dark cut** —
  `groupMeDark → iconDark → groupMe → icon`. Nothing at that size shows a 100px
  source, so there is no trade to make. `DraftRoomTeam` therefore carries
  `icon` AND `iconSmall`, and the same franchise CAN wear different artwork on
  the big crest and the rail. That is deliberate, not the inconsistency the
  stroke doc warns about — at 40px the two cuts are indistinguishable.
- **`groupMeDark` leads both orders**, so every 400x400 dark cut added to a
  league config takes over the big crest on its own and drops that franchise's
  outline. Adding one is a config + asset change; this file needs no edit.
- **The outline has a third signal the site-wide manifest cannot give it.**
  `measure-crest-contrast.mjs` skips any team with an `iconDark` — correct
  everywhere else, since they swap — but those are exactly the franchises the
  resolution rule strands on light art here. So HAVING an `iconDark` is itself
  taken as "this franchise's light artwork fails on a dark surface".
  `iconStrokeDark` still outranks it in both directions.
- **The ring WIDTH belongs to the surface, not the filter.** Each crest rule in
  `draft-broadcast.css` sets `--dbc-crest-ring-w` to ~0.5% of its own rendered
  size and reads `var(--dbc-crest-ring)` inline alongside its own drop shadow —
  `filter` does not compose across rules, so an un-stroked crest needs the
  no-op `opacity(1)` default rather than nothing.
- Neither order can render the light `icon` for a franchise that HAS an
  `iconDark`, and that is load-bearing: `TeamIconDarkStyles` ships on this page,
  so that exact src would swap under `html.dark` and the crest would follow the
  VIEWER's theme on a board that has none.

**Where this actually bites today is the AFL.** #680 gave every TheLeague crest
that needed one a 400x400 `groupMeDark`, so all sixteen resolve to dark art on
every surface and TheLeague's board is byte-identical before and after this
rule — correct by complete coverage rather than by rule, which is the state
this exists to survive. The AFL is 12 of 24 changed. Do not read a no-op
diff on one league as the rule not working; check the other.

`tests/broadcast-crest.test.ts` pins all of it, including a sweep asserting that
every franchise left on light art either carries a ring or opted out. Its
manifest cases deliberately use AFL franchises for the same reason.

## Replacing a team's art is only a logo swap if no ERA changes

`/publish-assets` regenerates three derived files (crest manifest, both asset
registries) and that is complete for a straight refresh of a crest. It is NOT
complete when the old look is being **retired into a `history[]` era**, which is
what "new artwork for 2026 forward" always means here. Four more committed files
bake a resolved icon path per franchise-season and will keep serving the old
path forever:

```bash
pnpm run compute:franchise-history   # season-ledger.json, franchise-history.json
pnpm run compute:owner-tenures       # owner-tenures.json
pnpm run compute:division-strength   # division-strength.json
```

Nothing catches this: the JSON stays valid, the image still 200s, and the full
suite passes. Two other rules travel with it — **snapshot the outgoing art into
`history/` BEFORE overwriting the live file** (five TheLeague eras still point
`icon` straight at the live path, so the overwrite would silently repaint
history), and give the era an `eraLabel`, which is how the Throwback picker
tells apart eras that share a name. Full recipe, including the banner re-cut and
the one-grep check that catches a stale derived file:
`docs/claude/insights/features/franchise-history.md` (2026-09-01).

Also note the era edit itself puts the change OUTSIDE `/publish-assets`'s
allowlist — `yearEnd`/`eraLabel` are not branding keys. It goes through `/live`.

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
- **A dark cut fixes dark OUTLINES, not a dark BODY.** ESPN's `500-dark` cut
  re-inks a mark's outline light; a mark that is black all the way through
  (the Panthers — 75% near-black pixels, hairline blue edge) still dissolves
  into a `#1e1e1e` card at 16px after the swap. `NFL_DARK_STROKE_CODES` in
  `nfl-logo-dark-css.ts` adds the league-crest white ring (the
  `crestStrokeFilter` drop-shadow stack) on top of the swap for those codes,
  at 1px rather than the crests' 0.5px hairline: a solid silhouette with no
  bright interior needs the heavier edge at 16px (owner's call, 2026-09-05).
  The ring is emitted twice: under `html.dark` keyed on the LIGHT srcs (the
  themed pages), and with NO theme guard keyed on the dark cut's own URLs — the
  draft broadcast and Sunday Ticket multi-view are dark in both themes and ship
  the dark cut as `src` directly, where an `html.dark` rule never reaches a
  light-theme viewer (the blind spot from 2026-08-28).
  Both are wrapped in `:where()` so they carry zero specificity: `filter` is
  not additive, and a bare `html.dark img[src=…]` (0,2,2) would have replaced
  the Free Agents hero's 16%-opacity `.hero-spotlight__logo { filter:
  grayscale(.1) }` watermark with white halos. The ring is a default; a
  surface's own class-level filter must win. The rule also sets
  `--nfl-logo-ring`, so a dark surface that wants its own depth shadow AND the
  ring composes `filter: var(--nfl-logo-ring, opacity(1)) drop-shadow(…)`
  (the player-modal band and the broadcast origin line do; same idiom as
  `--dbc-crest-ring`). A new `filter` on an NFL logo `<img>` must either
  compose that var or be a deliberate dimming — `tests/nfl-logo-dark-css.test.ts`
  pins the known composers and the watermark exclusion. Before adding one, measure the ALPHA channel and render the cut
  on the dark card: ESPN's PNGs store RGB white under alpha-0 pixels, so any
  alpha-dropping check reports a false "opaque white fill" (the Raiders' cut
  was reported that way on 2026-09-04 and is fine). The ring composes with
  `content: url()`; do not put a stroked code in `knownMissing`, which would
  drop the dark cut it is meant to complement.
- **The service worker is now the longest-lived cache in front of an asset,
  not the CDN.** `public/sw.js` holds `/assets/**` on stale-while-revalidate,
  so a bad copy survives exactly one more page view; it is cache-first ONLY
  for `/_astro/*`, where the content hash is the version. Never widen
  cache-first to an unversioned path — that pins a 404 until `CACHE_NAME` is
  bumped, which is unbounded and worse than anything Cloudflare did.


## Overlays on a phone — size against `dvh`, never bare `vh`

`vh` is the LARGE viewport: the page as it would be with the browser chrome
hidden. On a phone with the URL bar and the bottom bar showing, the visible
area is smaller, so a panel capped at `88vh` is taller than what the owner can
actually see. Which edge they lose depends on how it is anchored — the My Rank
sheet is bottom-pinned (`align-items: flex-end`), so the overflow went off the
TOP and took the title and the close button with it, leaving an owner inside a
modal they could barely close (report, 2026-08-22).

Cap against `dvh` (the visible viewport, which tracks that chrome as it moves),
with a plain `vh` line above it as the fallback:

```css
max-height: 88vh;   /* fallback first */
max-height: 88dvh;  /* the one that's right on a phone */
```

The same applies to `height` and to any `calc()` that mixes one in. It is
invisible on a desktop browser and in Playwright, where `vh` and `dvh` are
equal — the only way to see it is a real phone, or arithmetic against the
reporter's viewport. `tests/my-rank-editor-css.test.ts` pins the sheet;
`draft-room.css` still has three bare `100vh` caps that were out of scope for
that fix.


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

## TV network marks get the crest treatment, from their own manifest

`public/assets/tv-logos/` (the channel and Sunday Ticket carrier marks the
Sunday Ticket board draws) follows the team-crest rules exactly, through a
sibling pipeline rather than the crest one:

- `scripts/measure-tv-logo-contrast.mjs` (`pnpm measure:tv-logo-contrast`)
  scores every mark `data/theleague/broadcast-mappings.json` can render, plus
  the RedZone mark, against BOTH card surfaces and writes
  `src/data/tv-logo-stroke-manifest.json`. `tests/tv-logo-theme-stroke.test.ts`
  fails when the committed manifest drifts from what the assets measure.
- A mark with a `logoDark` in the mapping file (white artwork — DAZN's,
  YouTube TV's) SWAPS under `html.dark` and is never stroked; a mark below the
  threshold takes the same four-shadow ring as a crest
  (`src/utils/tv-logo-theme-css.ts`, keyed on exact `src`).
- **The marks stroke in BOTH directions, and the crests do not.** A crest is
  league artwork and skews dark; a network mark is whoever holds the rights,
  and two of them are pale by brand — Channel 5's yellow 5 and Kayo's light
  green are on a WHITE card what a black crest is on #262626, with no
  light-mode artwork to swap to. Those take the same ring in
  `TV_LOGO_LIGHT_STROKE_COLOR` under `html:not(.dark)`. The light pass uses a
  STRICTER threshold (0.25 vs 0.5) on purpose: on white the common shape is a
  mark whose interior is pale — CBS's white lettering, NBC's peacock, Prime's
  arrow — which reads fine off its dark silhouette, and the dark bar would put
  a halo on all four. The light rule is guarded on `html:not(.dark)` rather
  than left unguarded, or it would ink a dark ring around the white artwork a
  `logoDark` swaps in.
- It is composed into `buildAllTeamIconDarkCss()`, so the layout head and
  Storybook's preview inject it from one source.

**Not a white plate.** The board first shipped the marks on a white pill; that
draws the mark's bounding box, which on a transparent PNG is a white rectangle
on a dark card — the exact thing the crest ring exists to avoid.

