# Icon sets — a league picks its icons the way it picks its style and colors

**Status:** live on staging (Oct 2026). TheLeague, the AFL and Archie's draw the
`line` set; every other league stays `classic`. Switching a league is one line —
see *Switching a league* below. Decisions
marked **[DECIDED]** came from Brandon (Oct 2026); **[OPEN]** ones still need a call.

## The model — three independent choices

A league signing up picks three things, in any combination **[DECIDED]**:

| Choice | Options | Where it lives today |
|---|---|---|
| **Style** | Prime Time, Editorial, more later | being built now (`homeStyle` on the registry is the first piece: `'classic' \| 'front-page'`) |
| **Icon set** | `classic` (today's sprite), `line` (this plan), more later | **this plan** |
| **Color scheme** | the files in `src/themes/` | `theme` on the registry entry |

Each choice is a folder of interchangeable parts that share one contract, so a
fourth or fifth option is "add a folder", never "teach pages about it". For
icons the contract is the glyph id: pages ask for `#icon-<name>` and never know
which set is loaded.

## What is where

| File | What it is |
|---|---|
| `public/assets/icons/sets/line/sprite.svg` | The `line` set — all 140 glyph ids of the classic sprite, redrawn |
| `docs/plans/icon-sets/line-review.html` | Open in a browser: every classic glyph beside its `line` redraw, at size and in an active colour |
| `tests/icon-set-parity.test.ts` | Every set under `sets/` must define EXACTLY the classic sprite's ids (wired into the `theming-and-assets` path-guard domain) |
| `src/config/leagues-data.mjs` → `iconSet` | The league setting; absent = `classic`. Read with `leagueIconSet(slug)` |
| `src/utils/sprite-url.ts` | `spriteUrlFor(Astro.url)` — the page's sprite, with a per-file content hash |
| `src/utils/sprite-url-client.ts` | `clientSpriteUrl()` for browser code, read from `<html data-sprite-url>` |
| `src/utils/sprite-url-context.ts` | `SpriteUrlContext` / `useSpriteUrl()` for React islands |
| `tests/sprite-url-guard.test.ts` | No literal sprite path in `src/`; every layout stamps `data-sprite-url`; the resolver's league lookup |

`public/assets/icons/sprite.svg` is untouched and stays the `classic` set at
its current path, so nothing moves for any page or test that reads it.

## The `line` set

- 24 × 24 grid, every glyph `viewBox="0 0 24 24"`.
- **1.25px stroke**, round caps and joins, no fill — set once per symbol on a
  wrapping `<g fill="none" stroke="currentColor" stroke-width="1.25" …>`, so
  colour follows `currentColor` exactly like the classic set and no CSS
  change is needed. (Checked: no stylesheet sets `fill` on sprite icons in a
  way that would fight it.)
- **One artboard for every glyph:** drawn content (stroke included) stays
  inside the 2–22 live area and is centred to within 1px on both axes, so any
  two icons sit side by side at the same visual weight. Wide marks (rivalry,
  lineup, the handshake) are scaled down to fit 20px wide, with the stroke
  compensated so it still renders at 1.25px. Basic UI glyphs (close, plus,
  check, chevrons, arrows, sort) are deliberately smaller, at 13–16px — the
  usual convention, so a chevron does not outweigh a trophy.
- Detail level was tuned with Brandon over several rounds: realistic shapes,
  minimal interior lines, nothing that turns to mush at 18–24px.
- **Edit the sprite directly** — paths are short, hand-written and readable.
  Keep the wrapping `<g>`; a path that sets its own `stroke-width` is
  compensating for a `transform` (only `rivalry` does this).

### Brand marks are not redrawn **[DECIDED]**

`paypal`, `venmo`, `lion` (the Premier League's lion), `premier-league` and
`nfl` keep the exact classic artwork.

`archie` and `archie-dark` are Archie's league mark, TRACED from
`public/assets/logos/archies-head.png` (never redrawn) and added to every set
— classic included — so they share the parity contract. Both are one colour
(`currentColor`). A one-colour portrait cannot be right on both grounds, so
there are two cuts, the same light/dark idea as the league logos:
`archie` is the line cut for LIGHT grounds; `archie-dark` is the solid cut
(face filled, lines knocked out) for DARK grounds — on a dark ground the line
cut reads as a photo negative. Swap on `html.dark` the way the logo cuts do.

`schefter` (Tip Schefter's mark, Oct 2026) and `schefter-mono` are Claude
Schefter in a suit: hand-inked over a reference portrait, not traced, with
stubble. `schefter` has an orange-and-white striped tie in a fixed
`#B5531F`, the only fixed colour in the drawing; `schefter-mono` is all
`currentColor`, with a dark striped tie, and is the drop-in if a league wants
the mark one-colour. Each SYMBOL carries both cuts and **swaps itself**:
`<g style="display:var(--icon-cut-light, inline)">` and
`<g style="display:var(--icon-cut-dark, none)">`, flipped by
`html.dark { --icon-cut-light: none; --icon-cut-dark: inline }` in
`polish.css`. Custom properties inherit into a `<use>` clone even from the
external sprite file, so every caller gets the right cut with one id and no
class. A surface dark in both themes sets the dark pair on itself. Archie's
two-id cuts predate this and could move to it. The paths are traced output;
to change the drawing, redraw and re-trace rather than hand-editing them.

**A sprite must be well-formed XML.** It is fetched as a document, and the
parser stops at the first error, blanking every symbol after it while the
ones before keep working. The line sprite shipped without `xmlns:xlink`
while the Premier League mark uses `xlink:href`, which blanked every brand
mark at the end of the file; `tests/icon-set-parity.test.ts` now checks every
prefix is declared. PayPal, Venmo and the lion are wrapped in
`fill="currentColor"` so they take the theme colour like every other icon; the
Premier League shield and NFL shield keep their own brand colours.

### Per-glyph calls Brandon made

- `submit`, `lineup`, `chalkboard` follow the classic compositions exactly (X's,
  O's and the route arrow) — only the stroke changed. `chalkboard` is a single
  frame, no inner border; the route arrow leaves the O, nothing runs into it.
- `numberone` is a foam finger with a **1** on it (not a pointing hand).
- `scoreboard` reads **7-0**; `scoreboard-2` is the two-team board.
- `transactions-2` is a real handshake. **Layout note:** classic's handshake is
  `viewBox="2 26 124 76"` (1.6:1, letterboxed — see
  `docs/claude/rules/theming-and-assets.md` § Sprite icons carry meaning); the
  `line` one is square, so it fills its slot in the header instead of sitting at
  ~18×11.
- `helmet-2` is a simplified side-view helmet; `kick` is the ball in flight
  with speed lines; `fans` is a jersey with a centred 12.
- `bookmark` stays a mortarboard (what classic actually draws), `champ` a
  title belt, `franchise-tag` a price tag.
- Meanings are unchanged: `bell` is notifications only, `transactions-2`
  (handshake) is trades, `exchange` is a trade event.

## Nav icons (Oct 2026)

An audit of TheLeague's and the AFL's nav (`src/config/nav-config.json`)
found pages sharing one icon or wearing a vague one. Sixteen new glyphs were
drawn for them, in BOTH sets (classic gets them as 2px outlines, since the
parity test requires every set to carry every id). `nav-config.json` and
`page-directory.json` point at them for EVERY league's copy of the page, so a
page wears one mark wherever it is searched from:

| Nav link | Today | New glyph |
|---|---|---|
| Throwback Week (AFL + admin) | `history` | `throwback` |
| Draft Results | `history` | `draft-results` |
| Keeper Report Card | `history` | `report-card` |
| Draft Order | `draft-podium` | `draft-order` |
| Draft Room | `draft-podium` | `draft-room` |
| Draft Broadcast | `podium-empty` | `broadcast` |
| Live Scoring (pinned) | `goals` | `live-score` |
| What's New | `star` | `sparkle` |
| Constitution | `gavel` | `scroll` |
| Schedule Release | `calendar` | `calendar-reveal` |
| Custom Rankings | `standings` | `rank-reorder` |
| Top Players | `bar-chart` | `jersey-star` [DECIDED]; `player-star` (person with a star) is the unused alternative |
| Owner Activity | `activity` | `pulse` |
| Tip Schefter (nav, search, TheLeague header) | `user-secret` / `news` | `schefter` — Claude Schefter himself [DECIDED] |
| Roster (pinned, both leagues) | `banknote` (TheLeague) / `helmet` (AFL) | `roster` — a jersey numbered 25, a nod to the 25-man roster limit [DECIDED] |
| Roster (AFL family: nav, header, search) | `roster` | `roster-16` — the same jersey numbered 16, the AFL's roster size [DECIDED] |
| Live Scoring (AFL / TheLeague: nav, header, search) | `live-score` (7-0) | `live-score-03` (AFL, founded '03) / `live-score-07` (TheLeague); `scoreboard-03` / `scoreboard-07` are the matching board-only cuts, drawn as options and not yet wired [DECIDED] |

`jersey-ir` — a jersey lettered **IR** — is drawn for injured-reserve
surfaces (today the IR / injury actions in `AFLActionModal` and
`PlayerDetailsModal` use `ambulance`); no nav link maps to it yet.

Four more need no new art, only a different existing glyph: Trade Builder
`exchange` → `transactions-2` (the handshake IS the trade tool — see
`theming-and-assets.md` § Sprite icons carry meaning; site search already
uses it); Standings `shield` → `standings` (the shield is Franchises);
Playoffs `champ` → `playoff`; Admin Hub `gavel` → `wrench` — done in the same
change, nav and search together.

## Switching a league

Change `iconSet` on the league's entry in `src/config/leagues-data.mjs`
(`'line'` or `'classic'`) and deploy. Nothing else: every page resolves its
sprite from the request, so the whole league moves at once.

How a page finds its set, so a new page does not bypass it
(`tests/sprite-url-guard.test.ts` fails on a literal path):

- **`.astro`** — `const spriteUrl = spriteUrlFor(Astro.url);` The league comes
  from the path prefix (which a league apex is rewritten to) or the host; a page
  outside every league (`/live`, `/instructions`) gets classic.
- **Browser code** (`<script>`, `src/utils/*` that runs client-side) —
  `clientSpriteUrl()`, which reads `<html data-sprite-url>`. Every layout stamps
  it and the ClientRouter copies it on a soft navigation, so read it per call,
  never into a module-level constant. A `define:vars` script cannot import, so
  it reads `document.documentElement.dataset.spriteUrl` directly.
- **React islands** — the island's `.astro` parent passes
  `spriteUrl={spriteUrlFor(Astro.url)}`; the island root wraps its tree in
  `SpriteUrlContext.Provider`; leaves call `useSpriteUrl()`. Not
  `clientSpriteUrl()`: an island also renders on the server, where there is no
  document, and the two renders would disagree.

## Still to do

1. **The sign-up chooser.** Style, icon set and colours picked together with a
   live preview, changeable later (Launcher / package-league flow).
2. **Archie's two cuts.** `archie` / `archie-dark` are in every set but nothing
   renders them yet; when something does, swap them on `html.dark`.
3. **The icons drawn inline** — see *Not covered*.

## Adding a third (fourth, fifth) set

Create `public/assets/icons/sets/<name>/sprite.svg` with every classic glyph id,
add `<name>` to the `IconSet` union, and run `tests/icon-set-parity.test.ts` —
it names every missing or extra id. Adding a glyph to the classic sprite makes
the same test fail until every set has a drawing of it, which is the point.

## Open questions

- **[OPEN] Per-owner override.** Brandon's model is a per-league choice made at
  sign-up. If owners should also be able to override it on `/preferences`,
  that is a cookie read by the layout before render — read
  `docs/claude/rules/viewer-preferences.md` first (resolving writes a cookie,
  so it belongs to the route).
- **[OPEN] Should a style imply a default icon set?** e.g. Editorial →
  `line`. Keep them independent in the registry either way; a default is a
  sign-up suggestion, not a coupling.

## Not covered

About 230 inline `<svg>` elements in components (≈70 in `theleague/`, ≈150 in
`shared/`) draw their own icons rather than using the sprite. Some are charts
or logos, not icons. They were not audited; any that are icons need moving into
the sprite (and every set) before an icon set can restyle them.
