---
slug: broadcast-matchup-clock
status: shipped
severity: P1
opened: 2026-09-13
hotfix_pr: https://github.com/braven112/mfl.football.v2/pull/1079
hotfix_sha: c7623ba
followup_issue: 1080
followup_pr: https://github.com/braven112/mfl.football.v2/pull/1082
shipped: 2026-09-14
followup_session: session_01KvjeQTyQKQ6dXp9mBvGVCd
worked_session: session_01YDGskVyKiYsDz2YtKeBZsb
---

# Follow-up: the broadcast board's to-play counts and matchup clock

## What broke

From a photo of a live board on the afternoon of 2026-09-13, mid week 1:

- A cell printed a lone **"1 to play"** that read as a fact about the matchup.
  It was the owner's count alone: both counts lived in the cell foot and
  `oppytp` was rung ONE of the drop ladder, so at three cells or more — two
  leagues with a doubleheader each, the ordinary Sunday — the opponent's was
  dropped and the survivor lost the only thing disambiguating it.
- The clock read **"1:33 - 1st"** while the rest of the slate was final. It was
  ESPN's real clock for the ONE game most of the owner's starters were in, and
  late on a Sunday the only games still `in` are the ones that kicked off last.
  The string was true of that game and true of nothing else on the cell.

## What the hotfix did

Forward fix, no revert.

- `src/components/shared/live-broadcast/BroadcastScoreHeader.tsx` — each team's
  count renders on that team's own row (`.lbc__ytp`, `.lbc__ytp.is-opp`); the
  cell foot keeps the win-probability label and the clock.
- `src/utils/broadcast-layout.ts` — `matchupTimeLeft` replaces
  `matchupGameClock`: sum the real seconds left across both sides' starters
  (ESPN `period` + `displayClock` only) and print the fraction as a position on
  one 60-minute clock, spelled `3rd 4:08 left` so it cannot be read as one
  game's clock. `DROP_LADDER` reordered to
  `wplabel, projword, oppytp, clock, proj, wpbar` so both counts survive tier 3.
- `src/styles/live-broadcast.css`, `tests/broadcast-layout.test.ts`,
  `tests/broadcast-score-header-ssr.test.ts` (new, wired into the path-guard
  map), rules + insights docs, changelog staging.

Three further bugs were caught and fixed **before** the merge, all of the same
shape (a confident number over a feed we could not read, or over data we did not
have): a clock derived entirely from MFL's non-ticking seconds when the ESPN
fetch fails (`games: []`), a bye starter in the denominator flooring the meter
so `Final` never printed, and the `unavailable` panel printing a clock beside
em-dashes.

## Deferred items

- [x] **F1 — `progressClockLabel` rounds a live matchup to `Final`** — WORKED
  - Source: Copilot review (suppressed comment), PR #1079
  - Where: `src/utils/broadcast-layout.ts` — `progressClockLabel`,
    `const secs = Math.round(...)`
  - What: `matchupTimeLeft` passes `left / (rows.length * 3600)`, so the label
    computes `round(left / N)`. With 9 starters the cell prints `Final` once the
    slate has under ~4.5 real seconds left, while a game is still being played.
  - Why deferred: the finding landed after the merge (the fast path does not
    wait on Copilot), and the window is the last few seconds of the last game —
    it self-corrects on the next poll. It is still a wrong assertion of exactly
    the kind this PR exists to remove.
  - Fix shape: floor at one second for any positive fraction, and add a
    multi-starter boundary case to `tests/broadcast-layout.test.ts`.
  - **Re-validated 2026-09-14: still true.** The code was unchanged and the
    arithmetic reproduces exactly as described.
  - **Shipped as written.** `progressClockLabel` clamps first, returns `Final`
    only for a fraction of exactly nothing, and floors every positive fraction
    at one second — the last second of a matchup reads `4th 0:01 left`. Two
    cases in `tests/broadcast-layout.test.ts` (the label at 4/9s of a second,
    and the same through `matchupTimeLeft` with nine starters); both fail
    against the pre-fix code and pass after.

- [~] **F2 — Nobody has seen this on a television** — OVERTAKEN, and it was right
  - Source: deferred at implementation
  - Where: `src/styles/live-broadcast.css` — `.lbc__ytp`
  - What: the counts moved onto a row whose width budget is already documented
    as tight (`.lbc__tn`'s `min-width: 25%` floor exists because the team name
    once collapsed to nothing at a doubleheader cell width). `.lbc__ytp` is
    `flex: 0 1 auto` with ellipsis, so it degrades rather than wrapping — a
    second line in that row grows the cell and `.lbc__panel { overflow: hidden }`
    eats the opponent's score — but "degrades" at tier 4/5 on a real 65" panel
    is a judgement only the board can settle.
  - Why deferred: the board is auth-gated and needs a live Sunday plus a TV;
    the session had neither. SSR tests assert the markup, not the pixels.
  - Fix shape: look at `/broadcast` at tiers 3, 4 and 5 during games. If the
    count crowds the name at tier 4, its drop rung (`oppytp`) already exists —
    consider a second rung for the owner's own, below `clock`.
  - **Re-validated 2026-09-14: overtaken by #1081, which happened the same
    evening.** The board WAS looked at on the television and the item's worry
    was exactly right: on a real doubleheader cell the counts ellipsised to
    `1 to ...` and `0 t...`. #1081 took a different route from the one
    suggested here — rather than a second drop rung, the count moved OFF the
    row and under the name, into a new identity column, and `.lbc__proj`'s
    `margin-left: auto` (which had been eating the row's slack) came off.
  - **But #1081 shipped inert, which is F3.** Nothing to do for F2 itself; the
    outcome it wanted is what F3 delivers. What is still unseen on a panel is
    the 38% floor, which takes effect for the first time with this PR.

- [x] **F3 — `.lbc__who` is two components, so #1081's width floor never
  applied** — WORKED (folded in after the fact)
  - Source: Copilot review on #1081, posted 2026-09-13 23:30 UTC — after that
    PR merged, and after the brief was written. Not in the original item list.
  - Where: `src/styles/live-broadcast.css` — `.lbc__who` at two top-level
    blocks, ~500 lines apart.
  - What: `live-broadcast.css` is one global sheet for nine components and a
    bare single-class rule has no scope. #1081 named the scoreboard's new
    identity column `.lbc__who`, which the player strip had already been
    using. Same specificity, later rule wins, so the strip's
    `flex: 1; min-width: 0` overrode the scoreboard's
    `flex: 1 1 auto; min-width: 38%` on every screen — and because #1081 had
    also handed `.lbc__tn`'s old 25% floor over to that column, the board went
    from one width floor to none at all. `tests/broadcast-shell-guards.test.ts`
    passed throughout: its `/\.lbc__who\s*\{([^}]*)\}/` matched the FIRST
    block, which is not the one that wins.
  - Severity: this is F2's user-visible bug, still live in production.
  - Shipped: the scoreboard's column is `.lbc__ident` (CSS, both JSX sites,
    both tests); `.lbc__who` stays the strip's. New guard in
    `tests/broadcast-shell-guards.test.ts` fails on ANY `lbc__*` class that two
    components under `src/components/shared/live-broadcast/` both use and the
    stylesheet styles with a bare single-class rule — comments stripped, and
    descendant-scoped rules deliberately exempt. Exactly one violation existed
    across nine components: this one. Verified failing against the collision
    and passing after.

## Context to start cold

- **The clock is allowed to be derived, and that is a deliberate, bounded
  exception** to `docs/claude/rules/live-scoring.md`'s "never fabricate a
  clock". The bound is written there and pinned by test: ESPN-only inputs, no
  starter placed → no clock, and a spelling ESPN never uses. Do not "simplify"
  it back toward MFL's `gameSecondsRemaining`; that is the bug the rule exists
  for, and it was re-introduced and caught once inside this PR already.
- **`matchupTimeLeft` takes BOTH sides' starters.** The cell prints one clock
  and it is the matchup's, so a night game on the opponent's roster has to count
  toward it. A per-team clock was considered and rejected: the foot has room for
  one.
- **What made the difference was the render test.** Both original bugs were
  computed correctly and then placed where they said something else, which is
  invisible to a pure-function test and to the scan guards. Adding
  `tests/broadcast-score-header-ssr.test.ts` found a third instance within
  seconds. Anything new this component prints belongs behind `readable`, and
  belongs in that test.
- **What was NOT wrong:** the ESPN data, the poll cadence, the week resolution
  (`getCurrentNFLWeek` and ESPN both said week 1), and `yetToPlay` itself. The
  counts were right the whole time; only their placement lied.
