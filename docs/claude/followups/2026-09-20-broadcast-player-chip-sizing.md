---
slug: broadcast-player-chip-sizing
status: open
severity: P0
opened: 2026-09-20
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1175
hotfix_sha: bf572d7
followup_issue: 1176
followup_pr:
followup_session:
---

# Follow-up: broadcast player cells rendered as a band of cropped face

## What broke

Every row of the live broadcast board's player strip (`/broadcast`, both
leagues) drew its headshot as a full-bleed horizontal band of cropped face
instead of a circular chip, pushing the name and score columns out of
alignment. Reported from a TV mid-gameday, 2026-09-20, in demo mode.

Not a regression from a recent commit: the rule had been wrong since the strip
switched from a bare `<img className="lbc__face">` to the shared
`BroadcastFace` chip. The leftover `object-fit: cover` on what is now a
`<span>` is the fossil of the older markup.

## What the hotfix did

`src/styles/live-broadcast.css` — `.lbc__face` now sets
`--player-avatar-size: min(62cqh, 8vw)` plus `box-sizing: border-box`, instead
of `width` / `height` / `border-radius` / `object-fit` / `background`.

The mechanism, because it is the whole point of the fix: `.lbc__face` and
`.player-cell__avatar` tie on specificity (0,1,0), so a raw `width` on the
caller's class is decided by **stylesheet order**. `player-cell.css` is
imported from `BroadcastFace.tsx` (a React component) and `live-broadcast.css`
from `LiveBroadcastPage.astro`, so the component's sheet lands last. Its
`width: var(--player-avatar-size)` then has no property to resolve, is
invalid-at-computed-value-time, computes to `auto`, and the flex item sizes to
the `<img>`'s intrinsic width — the ESPN cutout's 352x256. `.lbc__row`'s
`overflow: hidden` crops that to the row height, which is the band.

Sizing through the custom property removes the tie entirely: nothing else sets
`--player-avatar-size` on that element, so no bundle order reproduces it.

Also shipped: `tests/player-cell-chip-sizing-guard.test.ts` (F1 is therefore
NOT open), wired into the `live-broadcast` path-guard domain.

A second commit recomputed `data/afl-fantasy/derived/top-players.json`, which
was red on clean `origin/main` and blocking the merge — see F3.

## Deferred items

- [ ] **F1 — `player-cell.css` cannot defend itself against an undefined size**
  - Source: deferred at implementation
  - Where: `src/styles/player-cell.css:46-47`
  - Why deferred: it changes the shared chip used by every roster table, the
    trade builder and `/cr` — not a diff to widen while a board is broken on a
    Sunday
  - The fix: `width: var(--player-avatar-size, 40px)` (same for `height`), so a
    caller that forgets the property gets a default-sized chip rather than
    `auto`. That turns this entire bug class from "unusable" into "slightly
    wrong size", which is the difference between a hotfix and a nit. Check
    first whether any current caller *relies* on `auto` — the DEF chip
    (`--def` sets `overflow: visible`) is the one to look at.

- [ ] **F2 — The new guard only runs on `live-broadcast` edits**
  - Source: cross-cutting lens, step 5
  - Where: `.claude/hooks/path-guard.json` (the `live-broadcast` domain)
  - Why deferred: adding domains for `player-cell.css` and
    `draft-broadcast.css` means picking their rules docs and suite lists, which
    is a considered edit, not a hotfix one
  - Neither `src/styles/player-cell.css` nor `src/styles/draft-broadcast.css`
    is matched by any domain today, so an edit to either can reintroduce this
    without the hook firing. The guard itself already covers all three
    `BroadcastFace` call sites; only its trigger is narrow.

- [ ] **F3 — Nothing recomputes `top-players.json` when the roster sync moves a feed**
  - Source: discovered while clearing the merge gate
  - Where: `scripts/compute-top-players.mjs`, and whichever workflow commits
    `data/<league>/mfl-feeds/**` rosters
  - Why deferred: a scheduling/pipeline change, unrelated to the board
  - `tests/top-players-data.test.ts` was failing on clean `origin/main`:
    Chatmaster (AFL 0021) dropped Keenan Allen, `rosters.json` updated, the
    derived artifact did not. **CI only runs on pull requests**, so a cron
    commit straight to `main` can leave the tree red with nothing reporting it
    — the next PR to open is the one that discovers it, which here was a
    gameday hotfix. Either recompute the derived artifact in the sync job
    beside the feed write, or run the suite on `main` pushes so the gap is
    reported to someone rather than to the next person in a hurry.

- [ ] **F4 — Header showed one franchise in two matchups (unconfirmed)**
  - Source: the user's photograph, not reproduced
  - Where: `src/components/shared/live-broadcast/BroadcastScoreHeader.tsx`,
    `src/utils/broadcast-board.ts`
  - Why deferred: out of the reported scope, and I could not tell from a photo
    whether it is a bug
  - In the report's screenshot the header carried four tiles: Pigskins vs CPU
    Jocks AND Pigskins vs Music City; Smokane FC vs Suh girls AND Smokane FC vs
    Indians. Demo mode replays invented plays over REAL matchups
    (`broadcast-demo.ts` reads `panel.matchups`), so the duplication is not
    fabricated by the demo. Ask the user before chasing it — a cross-league
    board showing an owner's teams in two leagues could look like this
    legitimately.

## Context to start cold

- **The repro harness is the cheapest way back in.** The bug is a cascade
  order effect, so it does not reproduce from reading either stylesheet alone.
  Render the real `.lbc__row` markup in a plain HTML file with
  `live-broadcast.css` linked BEFORE `player-cell.css`, point the `<img>` at
  anything with a non-square intrinsic size, and measure `.lbc__face` in
  Chromium (`/opt/pw-browsers/chromium` is preinstalled; pass it as
  `executablePath`). Broken measures 352x256; fixed measures square, 62% of the
  row height.
- **`cqh` resolves against `.lbc__row`**, which is `container-type: size`. A
  custom property is substituted at the use site, and the use site
  (`.player-cell__avatar`) is the same element, so moving the value into the
  property did not change which container it measures against.
- **Theories ruled out:** not a recent regression (the rule predates the
  session's shallow history and matches the older `<img>` markup); not missing
  container-query support on the TV browser (that would have dropped
  `.lbc__name`'s `min(34cqh, 1.8rem)` too, and the photo's type is sized
  correctly); not the `--player-avatar-bg` backdrop (the team gradient visible
  behind the face is correct and specificity-protected at 0,3,0).
- **The draft board was never affected** — `.dbc-idle__row-avatar` and
  `.dbc-panel__face-chip` already size through the property, and
  `draft-broadcast.css:2020` carries the comment explaining why. That comment
  is the prior art the live board's rule should have copied.
