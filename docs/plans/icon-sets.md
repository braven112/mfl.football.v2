# Icon sets — a league picks its icons the way it picks its style and colors

**Status:** assets and guard landed; the switch is NOT wired yet. Nothing on the
site reads the new set until the steps under *Wiring it up* are done. Decisions
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

## What landed in this PR

| File | What it is |
|---|---|
| `public/assets/icons/sets/line/sprite.svg` | The `line` set — all 139 glyph ids of the classic sprite, redrawn |
| `docs/plans/icon-sets/line-review.html` | Open in a browser: every classic glyph beside its `line` redraw, at size and in an active colour |
| `tests/icon-set-parity.test.ts` | Every set under `sets/` must define EXACTLY the classic sprite's ids (wired into the `theming-and-assets` path-guard domain) |

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
cut reads as a photo negative. Swap on `html.dark` the way the logo cuts do. PayPal, Venmo and the lion are wrapped in
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
  ~18×11. Check the Transaction Hub button when the switch is wired.
- `helmet-2` is a simplified side-view helmet; `kick` is the ball in flight
  with speed lines; `fans` is a jersey with a centred 12.
- `bookmark` stays a mortarboard (what classic actually draws), `champ` a
  title belt, `franchise-tag` a price tag.
- Meanings are unchanged: `bell` is notifications only, `transactions-2`
  (handshake) is trades, `exchange` is a trade event.

## Nav icons — drawn, not yet wired (Oct 2026)

An audit of TheLeague's and the AFL's nav (`src/config/nav-config.json`)
found pages sharing one icon or wearing a vague one. Fifteen new glyphs were
drawn for them, in BOTH sets (classic gets them as 2px outlines, since the
parity test requires every set to carry every id). `nav-config.json` is NOT
changed yet — point each link at its glyph when the switch lands:

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
| Top Players | `bar-chart` | `player-star`, or `jersey-star` (jersey with a star) — Brandon to pick |
| Owner Activity | `activity` | `pulse` |
| Roster (pinned, both leagues) | `banknote` (TheLeague) / `helmet` (AFL) | `roster` — a jersey numbered 25, a nod to the 25-man roster limit [DECIDED] |

Four more need no new art, only a different existing glyph: Trade Builder
`exchange` → `transactions-2` (the handshake IS the trade tool — see
`theming-and-assets.md` § Sprite icons carry meaning; site search already
uses it); Standings `shield` → `standings` (the shield is Franchises);
Playoffs `champ` → `playoff`; Admin Hub `gavel` → `wrench`. Change the matching `page-directory.json`
entries in the same edit so search and the nav agree.

## Wiring it up (not done)

1. **Registry field.** Mirror `homeStyle` exactly: `iconSet?: IconSet` on the
   league entry (`src/config/leagues.ts`), `export type IconSet = 'classic' |
   'line'`, and `leagueIconSet(slug)` returning `'classic'` for a league that
   names none — so no league changes until someone opts in.
2. **One resolver.** `src/utils/sprite-url.ts` today exports a single
   `spriteUrl` with an md5 cache-buster. Make it `spriteUrlFor(set)` (one hash
   per file, computed once at module load) and resolve the league's set where
   the layout already writes `window.__spriteUrl` for client components. Keep
   the content hash — `public/sw.js` serves `/assets/**` stale-while-revalidate,
   and the hash is what makes an edited sprite show up.
3. **Retire the hardcoded links.** 41 `<use href="/assets/icons/sprite.svg#…">`
   in 20 files bypass `spriteUrl` and would stay on classic forever:
   `AFLActionModal.astro` (8), `theleague/rosters.astro` (5),
   `PlayerDetailsModal.astro` (5), `theleague/players.astro` (3),
   `FreeAgentsPage.astro` (3), `SuggestionBoxPage.astro` (2),
   `RulesChatPage.astro` (2), and one each in `player-modal-trigger.ts`,
   `types/nav.ts`, `instructions.astro`, `SuggestionBox.tsx`, `IdeaDetail.tsx`,
   `IdeaComposer.tsx`, `IdeaCard.tsx`, `custom-rankings/PlayerRow.tsx`,
   `SchefterPostCardCompact.astro`, `SchefterPostCard.astro`,
   `SchefterNewsPage.astro`, `SchefterFeedCompact.astro`,
   `PlayerActionModal.astro`. `rosters.astro` needs
   `scripts/roster-parity-check.mjs` before and after. Then pin it: a scan
   guard that fails on a literal `sprite.svg#` outside `sprite-url.ts` and the
   `icons.astro` catalogue pages (`/guard-test`).
4. **Catalogue + theme pages.** `/<league>/icons` should show the league's own
   set; the theme preview pages are the natural place to show both sets.
5. **The sign-up chooser.** Style, icon set and colours picked together with a
   live preview, changeable later (Launcher / package-league flow).
6. **Try it on one league first** — set `iconSet: 'line'` on one entry and run
   `/launch-check` in light and dark.

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
