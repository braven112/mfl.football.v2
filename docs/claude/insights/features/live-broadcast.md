# Live Scoring Broadcast — the second-TV board

## Context

`/theleague/broadcast` + `/afl-fantasy/broadcast` (Sep 2026). A zero-input
display for a second television while the NFL games are on the first one. It
answers one question all afternoon — **is something happening to one of my
teams, in any league** — from ten feet, without being touched.

Neither page's variant: `/live-scoring` is one league's interactive board built
for a laptop, `/draft/broadcast` follows a draft. This follows a Sunday, across
every league the owner is in at once. It shares the DATA layer with live
scoring and the CHROME vocabulary with the draft board, and nothing else.

See `docs/plans/live-scoring-broadcast.md` for the decisions table and the
design spec.

## Key files

| File | Role |
|------|------|
| `src/utils/broadcast-moments.ts` | Pure: what earns a reveal, whose it is, staleness, the queue |
| `src/utils/broadcast-live-source.ts` | Per-league snapshot, matchup discovery, scoring, projections |
| `src/utils/broadcast-board.ts` | The ONE assembler — page and API route both call it |
| `src/utils/broadcast-layout.ts` | Pure: density tiers, the drop ladder, strip paging, the cell clock |
| `src/components/shared/live-broadcast/LiveBroadcast.tsx` | The island: poll, stage, rotation, drift |

## Read this, then grep

- **A projection belongs to a player IN A LEAGUE, not to a player.** The same
  back is worth different points under two rule sets, so a player-keyed map
  shared across a cross-league board cannot hold projections at all. They ride
  separately (`scoreLeague`'s `projections`), per league. The first cut
  hardcoded `projected: 0` in a shared `playerMeta`, which made every
  `projectedFinal` equal the live score and pinned every win-probability bar to
  a hard 100%/0% — `winProbability` takes a `remainingPoints <= 0` branch — at
  noon on a Sunday with the whole slate to play.
- **`toBroadcastPair` cannot make a colour visible.** It only ever DARKENS, so
  it makes a colour safe to write white text on and returns an already-dark one
  untouched. Seven of TheLeague's sixteen franchises are `#181818`, which is
  1.14:1 against this board's `#05070b` ground — so the takeover's whole
  mine-vs-theirs signal, a full-screen field of the club's colour, was a black
  rectangle. `ensureFieldOn` (`team-color-contrast.ts`) lifts a field until it
  separates from the GROUND while keeping white ink legible; there is a wide
  band between those two constraints. A mark on the header PANEL is a third
  question again — different surface, different answer (`ensureContrastOn`).
- **Doubleheaders come from the FEED, never the calendar.** MFL simply puts the
  franchise in two pairings. Verified live: 2026 week 1 in TheLeague has 16
  pairings for 16 franchises, every one playing twice against two distinct
  opponents. The calendar derivation is the thing this repo has got wrong twice.
- **ESPN's `statYardage` is big on plays that are not highlights.** In one real
  game the 40+ yard plays included a 58-yard MISSED field goal, a 48-yard miss
  and four kickoff returns. The big-play classifier takes a play-TYPE allowlist
  first and the distance second, or the board shouts "Missed 58 Yd FG Wide
  Left" at a room. `priority` is on every play and is `false` on all 193 — it is
  not ESPN's notability flag.
- **`parseScoringPlays` returns SCORING plays only.** A 57-yard catch that does
  not score, and every turnover, are invisible to it. `parseNotablePlays` reads
  the same already-fetched payload a second way rather than costing a second
  fetch.
- **`wallclock` is the only honest basis for staleness.** The game clock STOPS,
  so "Q1 11:49" is equally true five seconds and three hours after a play. A
  moment we cannot date is treated as STALE, never fresh: showing an undateable
  play full-screen risks revealing a first-quarter touchdown at 4pm, while
  dropping it costs one reveal of something the scoreboard already shows.
- **`occludes` is the layer model, and the draft board's is wrong here.** That
  board hides its idle layer whenever any stage exists. The lower third must
  COEXIST with the scoreboard — an opponent's score is not worth taking the
  board away for — so each stage declares `'none' | 'strip' | 'all'`. The
  red-zone banner sits ABOVE the stage layer: it is a persistent STATE, and as
  a stage it would be preempted by the next reveal and the drive would vanish
  for the fourteen seconds it most needs to be visible.
- **A transition never runs on mount.** The strip carried a correct-looking
  `transition: opacity` and hard-cut every twelve seconds, because only one page
  was ever mounted. The incoming page needs `@keyframes`; the outgoing one
  transitions. Both have to be mounted for a cross-fade to have something to
  fade from.
- **React treats `inert=""` as FALSE** and warns. The empty-string spelling
  silently never applied, leaving occluded layers in the a11y tree for the whole
  930ms `visibility` delay. `inert={hidden}`.
- **A page with no layout has no font.** Rendering the shared component bare
  dropped the board to the UA serif — which has no `tabular-nums`, so every
  score would jitter its column width on each tick — with no `lang`, no
  `<title>` and no viewport meta. The stylesheet's own comment claimed it
  "renders inside the league layout"; it did not.
- **The dim schedule has to sit INSIDE the contrast budget.** This surface
  spends most of its life at `--lbc-dim: 0.86` or `0.72`, so a token measured
  only at 1.0 is measured in a state the board is rarely in.
- **Burn-in drift must be a `transform` on the ROOT**, or it re-lays out the
  whole board every 90 seconds for eight hours. The counter-drift on the
  brightest glyphs has to be a RING sized to more than one stroke width — the
  first cut was a two-position square wave of ±0.15vh, about 3px against ~20px
  strokes, so the pixels it existed to protect never left their own stroke
  cores. Sub-perceptual and sub-protective is the wrong side of that trade.

## Two hazards that are not about this feature

- **`pnpm build` dirties 18 cron-owned data files in a sandbox.** Prebuild
  regenerates `nfl-dark-logos-manifest.json`, `college-dark-logos-manifest.json`
  and the derived `data/**` payloads, and the sandbox cannot reach the logo
  CDNs — so it writes manifests with entries MISSING. A `git add -A` after a
  build swept those into a commit here and broke two logo suites
  (`draft-broadcast-preflight`, `storybook-dark-logo-mirror`) in a way that
  looked like a code regression. Check `git status -- data/ src/data/` after any
  build, and take main's copy.
- **A scan-style guard must strip comments first.** Five of the first shell
  guards failed on the prose DOCUMENTING each trap — the CSS explaining why it
  carries no `html.dark`, the page explaining why it does not call
  `Astro.redirect()`. A guard that fails loudest on the file that documents
  itself best is worse than no guard.

## Sep 2026 — what the first cut got wrong about who scored

Three findings from the follow-up pass, all of the same shape: the board drew
the right thing for the wrong person, and every one of them looked plausible on
screen.

- **A team defense is a CLUB, not a person, so it has no ESPN athlete id and
  can never appear in `play.playerIds`.** Every defensive touchdown, takeaway
  and safety therefore produced no reveal at all — two of the four triggers
  this board was specified to have, silently doing nothing, with nothing in the
  logs and nothing missing from the screen to notice. Not a corner case: 32
  team defenses are rostered in TheLeague and 28 in the AFL (`position: 'Def'`,
  normalized to `'DEF'` by `player-map.ts`). A `Def` row must be joined by NFL
  TEAM, never by athlete.

  The join is `isTurnover`, and it is better than it looks: ESPN sets it
  exactly when `start.team !== end.team`, and on every such play attributes the
  play to the team that ENDED with the ball — the defense. So `play.nflTeam` is
  already the scoring club, and one flag covers takeaways AND defensive
  touchdowns, since a pick six is still a turnover. A "Fumble Recovery (Own)"
  correctly arrives as `false`. Read backwards, this credits the defense that
  just gave the ball away, which is why `tests/fixtures/espn-game-plays-turnovers.json`
  pins the direction across eleven real turnovers — a mutation of it fails five
  tests. MFL and ESPN disagree on team codes (`NEP` vs `NE`), so both sides go
  through `normalizeTeamCode`.

  **Still open:** a safety is not a turnover, and no recorded play carries one,
  so which team ESPN attributes it to is unverified. Guessing credits the wrong
  defense and looks fine, so it is deliberately not implemented.

- **ESPN's `participants` lists everyone INVOLVED, not everyone credited**, and
  the trap is `kicker`. Three real rows:

  | Play | Roles |
  |---|---|
  | Field Goal Good | `kicker, scorer, snapper, holder` |
  | Rushing Touchdown | `rusher, scorer, kicker, patScorer` |
  | Kickoff | `kicker, returner, tackler, penalized, other` |

  On the field goal the kicker IS the scorer (same athlete, deduped, so the
  allowlist can drop `kicker` for free); on the kickoff he is the OTHER team's
  placekicker, credited on a return he was trying to prevent. Participants
  carry no team of their own — only `athlete`, `order`, `type` — so a role
  allowlist is the only mechanism available.

  Turnovers need a SECOND, narrower list: an interception lists `passer` and a
  fumble return lists `receiver`, so the ordinary allowlist hands a full-screen
  TOUCHDOWN to the quarterback who threw the pick and to the receiver who
  fumbled — each named, at 68vh, for the worst play of their afternoon.
  `patScorer` is excluded on purpose: the extra point is real scoring, but a
  TOUCHDOWN takeover naming your kicker for someone else's touchdown is the
  wrong framing for one point.

- **Two crest fields assigned the same value is invisible at the call site.**
  `icon` and `iconSmall` were both `brand.icon`, so the takeover's 68vh
  background crest — ~734px on a 1080p TV — was the ~100px rail asset upscaled
  7.3x. `resolveBroadcastCrest` already encoded the split (resolution-first for
  the big surface, theme-first for the small ones) for the draft board; the
  live board simply never called it. All 40 franchises resolve to 400x400
  GroupMe art now, making it a 1.8x upscale.

  Two things this surfaced. The manifest keys the AFL as `afl` while the route
  directory is `afl-fantasy`, and passing the slug straight through finds no
  measured stroke AT ALL — silently, with no AFL crest measured today to notice
  it — so `crestLeagueKey` moved out of `hero-crest.ts` into
  `dark-surface-crest.ts`, which owns the contract. And a guard for this has to
  be BEHAVIOURAL: the regression was two fields holding the same string, which
  no amount of reading the call site reveals.
