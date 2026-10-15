# Broadcast board on phones and tablets — the handheld mode

Status: PLANNED 2026-10-15. Not started. Start this only AFTER the broadcast
landing-page redesign (design A, QR pairing — the "Premium broadcast landing
page" thread) has merged; Brandon's order is landing page first, handheld last.

The TV board (`/<league>/broadcast`, `LiveBroadcast.tsx`) is a zero-input
display read from ten feet. This plan adds a second way to read the SAME board:
a phone or tablet lying next to you while the games are on, usually in
landscape, glanced at often and touched sometimes.

**The one hard rule: the TV board does not change.** Not its layout, not its
moments, not its chrome rules, not its burn-in protection. Every change below is
scoped to handheld mode and a TV must render byte-for-byte what it renders
today. Read `docs/claude/insights/features/live-broadcast.md` before touching
anything — every rule in it is a bug that shipped on a real television.

## Decisions (Brandon, 2026-10-15)

| Question | Decision |
|---|---|
| Where it lives | The SAME `/broadcast` URL, adapting to the device. No second page (CLAUDE.md: a second copy is how 24 forked siblings happened) |
| First-cut features | Landscape layout, screen stays awake, big plays as a slide-in banner, tap a matchup to expand, tap a player for a mini card, swipe between leagues, "on the field now" row |
| Big-play takeovers on a handheld | Shrink to a slide-in banner; never full screen |
| Tablets | Get the touch features too, same as phones |
| Order | After the landing-page redesign merges; TV board untouched |

Ideas NOT in the first cut (kept for later, see
`/mnt/project-files/broadcast-phone/brainstorm.md` in the project): haptics,
pin a matchup, hide a league for the day, play-feed drawer, game picker that
follows the TV, sweat meter, what-if slider, trash-talk shortcut, phone as a TV
remote.

## User story

As an owner watching the games, I want my phone or tablet next to me to show
every one of my matchups at a glance in landscape, and let me tap into a
matchup or a player when something happens, so I don't need a second TV or a
laptop to follow my teams.

## Acceptance criteria

- [ ] A phone in landscape (e.g. 844x390, 932x430) shows every enabled matchup
      on one screen without scrolling up to ~6 cells; more than fit become
      swipeable league pages with page dots.
- [ ] A phone in portrait and a tablet in either orientation get a usable
      handheld layout (no overlapping panels, no 50px crushed leagues).
- [ ] The screen does not sleep while the board is open and visible (Wake Lock,
      re-acquired on `visibilitychange`); a browser without Wake Lock still
      works.
- [ ] A touchdown or big play shows as a slide-in banner across the top/bottom,
      never a full-screen takeover, and never covers the matchup the owner has
      expanded.
- [ ] Tapping a matchup expands it: both starting lineups, live points, projection,
      yet-to-play, and who is on the field right now. Tap again or swipe down to
      close.
- [ ] Tapping a player opens a mini card: live points, projection left, NFL game
      score and clock, opponent, red-zone state.
- [ ] An "on the field now" row shows headshots of the owner's players whose
      NFL team has the ball, highlighted in the red zone.
- [ ] The TV board is unchanged: a guard proves a TV-sized, non-touch render
      carries no handheld attribute, class or listener.
- [ ] Every new surface works in light and dark (the board's own tokens) and
      in `prefers-reduced-motion`.
- [ ] `pnpm test:unit` passes; `pnpm test:types` does not move up.

## What already exists, and the two gaps

- The poll (`BroadcastPollResponse`, `src/types/live-broadcast.ts`) already
  carries each team's STARTER rows (`BroadcastTeamScore.players`, each a
  `LivePlayerRow` with `live`, `secondsRemaining`, `status`), win probability,
  all NFL games with `possession` and `situation.isRedZone`, moments and
  red-zone alerts. Expand and "on the field now" are display work over data
  already on the client.
- **Gap 1, bench: the expanded matchup is STARTERS ONLY in this cut.**
  `scoreLeague` (`src/utils/broadcast-live-source.ts`) deliberately returns
  starter rows only; bench rows stay in `snapshot.bench` so nothing can sum
  them into a projection or win probability by accident. Do not add bench to
  `players`. A bench view, if wanted later, is a separate field that stays out
  of every total.
- **Gap 2, per-player projections are NOT on the rows today.** `scoreLeague`
  feeds the league's projections into the team totals but returns the raw
  snapshot rows, so `row.projected` is unset on the broadcast poll. The mini
  card needs it: enrich the rows in `scoreLeague` with `attachRowProjections`
  (`live-scoring-view.ts`), the same way `mfl-live-board.ts` (~line 303) does,
  and compute "projection left" from that full-game value. This is a small
  server change; confirm the TV board renders identically after it (it adds a
  field, and nothing on the TV should read it).
- Wake Lock is already done once, in `DraftBroadcast.tsx` (~line 648). Reuse
  its shape; consider extracting a shared hook.
- `MomentLowerThird.tsx` is already a non-occluding banner (`occludes:
  'none'`). The handheld banner for a takeover should reuse it or its layout,
  not invent a third moment component.
- Before showing a per-player stat line on the mini card, check whether the
  live-scoring data carries one. If it does not, the card ships without it;
  do not add a new fetch for this cut.

## The trap: telling a phone from a TV

This is the part most likely to break the TV, so settle it first.

- **Width alone is wrong.** A landscape phone (844 wide) and some TV browsers
  (Fire TV Silk reports ~960x540) overlap. The board's existing
  `@media (max-width: 900px)` rule already catches landscape phones by accident
  and gives them the PORTRAIT stacked layout — that is why landscape looks bad
  today.
- **`pointer: coarse` alone is wrong.** The stylesheet records coarse-pointer
  set-top boxes (Xbox thumbstick pointer).
- **Proposal:** handheld = `navigator.maxTouchPoints > 0` AND
  `matchMedia('(pointer: coarse)')` AND short side of the screen ≤ ~1100 CSS px.
  Decide once on the client, write it to `data-mode="handheld"` on the `.lbc`
  root, and let an explicit override win: `?mode=tv` / `?mode=handheld`,
  remembered in a cookie (same pattern as `bc_sound`). The override is the
  escape hatch for any TV or tablet the heuristic gets wrong.
- Server render stays TV. The handheld attribute is applied after hydration, so
  a TV never even downloads a different first paint. Accept the one-frame
  switch on phones; mask it if it shows (e.g. hide the board until mode is
  decided, only when touch is present).
- Every handheld CSS rule is scoped under `.lbc[data-mode='handheld']`. Do NOT
  edit the existing `max-width: 900px` / portrait blocks; override them inside
  the handheld scope.

## Phases

Each phase is its own PR, and each leaves the TV board identical.

### Phase 1 — mode, landscape layout, awake screen, banners

1. Mode detection + override + cookie, as above. Pure decision function in
   `src/utils/broadcast-layout.ts` (or a new `broadcast-mode.ts`) so it is
   unit-testable without a DOM.
2. Handheld landscape layout: one row per matchup — crest, my score vs theirs,
   win-probability bar, players left. Reuse the density tiers and the drop
   ladder (`densityTier`, `dropsForTier`) rather than a second sizing system;
   the handheld may need its own tier thresholds, expressed as a parameter.
3. Portrait phone and tablet layouts under the same scope.
4. Wake Lock while visible; release on hide.
5. Takeovers render as the slide-in banner in handheld mode. The moment queue,
   staleness rule and 90-second drop stay exactly as they are; only the
   rendering changes.
6. Handheld turns OFF the TV-only behaviour that makes no sense in a hand:
   burn-in drift, hidden chrome/cursor and the screensaver. Decide per item and
   write the reason down (the screensaver may still be right when nothing is
   live).
7. Guard test: TV-sized non-touch render has no `data-mode`, and the handheld
   CSS is fully scoped (scan the stylesheet: every new rule sits under the
   handheld selector).

### Phase 2 — tap to dig in

1. Tap a matchup → expanded view (sheet or in-place), both STARTING lineups
   from `teams[franchiseId].players` (no bench, see Gap 1), using the existing player
   name/headshot resolution (`playerMeta`). Close by tap, swipe down or Escape.
2. Tap a player → mini card. First land Gap 2 (rows enriched with
   `attachRowProjections` in `scoreLeague`). Projection is `row.projected`,
   never `playerMeta.projected` (see the insights doc's 2026-09-21 entry — it is a
   deliberate 0 in the shared map).
3. A banner that arrives while a matchup is expanded must not cover it.
4. Expanded state survives a poll (key by league + matchup index, not array
   position).

### Phase 3 — swipe and "on the field now"

1. Swipe between league pages when the matchups don't fit; page dots;
   keyboard arrows on a tablet with a keyboard. Pause the existing strip
   rotation while the owner is interacting.
2. "On the field now" row: the owner's starters whose NFL team code equals the
   game's `possession`, highlighted when `situation.isRedZone` — the same
   possession check the red-zone banner uses, so a player is never flagged
   while his team is on defense.

## Things to verify before building

- The ClientRouter lifecycle: any new listeners (touch, swipe, visibility) go
  through the island's own effects, not `document` listeners that survive a
  swipe-away navigation. Run `clientrouter-lifecycle-auditor` on the PR.
- How the landing page's QR pairing hands a phone to the board, once that
  thread merges — the phone should arrive straight in handheld mode.
- Screenshots on the PR: landscape phone, portrait phone, tablet, each light and
  dark, plus a TV-sized screenshot proving nothing moved.

## Key files

| File | Role |
|------|------|
| `src/components/shared/live-broadcast/LiveBroadcast.tsx` | The island: where mode is decided and passed down |
| `src/styles/live-broadcast.css` | All handheld rules, scoped under `.lbc[data-mode='handheld']` |
| `src/utils/broadcast-layout.ts` | Density tiers and drop ladder to reuse |
| `src/components/shared/live-broadcast/MomentLowerThird.tsx` | The banner shape to reuse for handheld takeovers |
| `src/components/shared/draft-broadcast/DraftBroadcast.tsx` | Existing Wake Lock to reuse |
| `docs/claude/insights/features/live-broadcast.md` | Read first |
