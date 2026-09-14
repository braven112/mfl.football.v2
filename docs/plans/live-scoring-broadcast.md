# Live Scoring Broadcast — the second-TV board

Status: BUILDING 2026-09-12 on branch `claude/live-scoring-draft-broadcast-0du7uy`.

A zero-input display for a second TV while the NFL games are on the first one.
It answers one question all afternoon — **is anything happening to one of my
teams, in any league** — and it answers it from ten feet away without being
touched.

The draft broadcast is the shape; live scoring is the data. This is neither
page's variant: `/live-scoring` is a single league's interactive board built
for a laptop, and `/draft/broadcast` follows a draft. This follows a Sunday,
across every league the owner is in at once.

## Decisions (from Brandon, 2026-09-12)

| Question | Decision |
|---|---|
| Which teams | Every MFL league the signed-in owner plays in, via `myleagues` — the same resolution Sunday Ticket already does |
| Default set | TheLeague + AFL on; Best Ball and every outside league OFF until picked |
| Picker | Remembered per device, so the TV keeps its set |
| Reveal triggers | Touchdowns; big plays (40+ yd, 2pt, DEF TD/turnover); red-zone alerts |
| Collisions | Queue one at a time, full moment each; drop anything older than ~90s |
| Opponent scores | Shown, but smaller and shorter — a lower-third card, not the full screen |
| Idle screen | Fixed scoreboard header that never moves + rotating player strip below |
| Header contents | Score, projected final, win probability, yet-to-play, real ESPN game clock |
| Doubleheaders | Both matchups side by side within that league's panel |
| Red zone | Persistent banner for as long as the drive lasts |
| Audio | Silent by default; opt-in flag |
| Off hours | Full screensaver, burn-in safe |
| Route | One league-neutral cross-league page + thin per-league wrappers for nav |

## User story

As an owner with teams in several MFL leagues, I want a second screen that
watches all of them at once, so that I never miss one of my players scoring —
or one of my opponents' — while I am watching the actual games.

## Acceptance criteria

- [ ] The board covers every league the signed-in owner plays in; TheLeague and
      the AFL are on by default, everything else is off until picked.
- [ ] The picker's choice survives a reload on that browser and does not
      disturb the Sunday Ticket board's own selection.
- [ ] The fixed header shows, per matchup: both scores, projected final, win
      probability, yet-to-play counts, and the real ESPN clock where we have
      one — and NO clock at all where we do not.
- [ ] A doubleheader week renders both of that league's matchups side by side.
- [ ] A touchdown by one of the owner's starters, in any enabled league, takes
      the full screen. Big plays (40+ yd from scrimmage, 2pt, DEF TD, turnover)
      do too.
- [ ] An opponent's scoring play renders as a lower-third card, shorter.
- [ ] Two scores landing together are queued, not merged or dropped; a moment
      older than 90 seconds is dropped rather than shown late.
- [ ] The red-zone banner is on screen exactly while one of the owner's players'
      teams has the ball inside the 20 — never while that team is on defense.
- [ ] With nothing live, the board runs the screensaver instead of an empty
      scoreboard.
- [ ] The page makes no sound unless asked.
- [ ] `pnpm test:unit` passes; `pnpm build` succeeds.

## Technical context

### Reuse, do not rebuild

| Need | Existing implementation |
|---|---|
| Every league the owner is in | `fetchMyLeagues` (`src/utils/my-leagues.ts`) |
| League picker + defaults | `sunday-ticket-selection.ts` — `isHomeLeague`, `defaultLeagueSelection`, `parseLeagueSelection`, `toggleLeagueSelection` |
| One league's live payload | `loadLiveScoringPayload` (`src/utils/live-scoring-source.ts`) |
| Is this week real? | `hasLiveSignal` (`src/utils/live-scoring-snapshot.ts`) |
| Outside-league reads | `loadOutsideContribution`, `fetchOutsideBundle` (`sunday-ticket-sources.ts`) |
| Scoring plays → owner rows | `buildMoments` (`src/utils/live-scoring-view.ts`) |
| Real clock, red zone, down & distance | `formatGameClock`, `isPlayerInRedZone`, `resolveGameState` (same file) |
| Reveal card at TV scale | `BroadcastRevealCard.tsx` + `src/styles/draft-broadcast.css` |
| Screensaver + idle cycle | `DraftBroadcast.tsx` scene machinery, `SCREENSAVER_*` in `draft-broadcast.ts` |
| Two-team legible colors | `resolveTeamColorPair` (`src/utils/team-color-contrast.ts`) |
| Image 404 cascade | `BroadcastFace.tsx` |

### What ESPN actually gives us (verified against live payloads, 2026-09-12)

The core plays API (`sports.core.api…/plays`) carries, per play:
`statYardage`, `isTurnover`, `scoringPlay`, `scoreValue`, `type.text`,
`type.abbreviation`, `scoringType.name`, `pointAfterAttempt.text`, `period`,
`clock.displayValue`, `participants[].athlete.$ref`.

Two things this forces:

1. **`parseScoringPlays` returns SCORING plays only** (`item.scoringPlay !==
   true` → skip). A 57-yard catch that does not score, and every turnover, are
   invisible to it. Big plays therefore need their own parse over the same
   already-fetched payload — not a second fetch.
2. **`statYardage` is big on plays that are not highlights.** In one real game
   the 40+ yard plays included a 58-yard MISSED field goal, a 48-yard missed
   field goal, and four kickoff returns. A bare `statYardage >= 40` puts
   "Missed 58 Yd FG Wide Left" on a 65-inch screen as a big play. The
   classifier takes a play-TYPE allowlist first and the threshold second.

`priority` exists on every play and is `false` on all 193 of them — it is not
ESPN's "notable" flag and must not be used as one.

### Files to create

- `src/utils/broadcast-live-source.ts` — cross-league snapshot assembler
- `src/utils/broadcast-moments.ts` — big-play/red-zone classifiers + reveal queue
- `src/utils/broadcast-selection.ts` — the TV's own league picker cookie
- `src/types/live-broadcast.ts` — the wire + prop shapes
- `src/components/shared/live-broadcast/*` — the props-only TV shell
- `src/pages/api/broadcast-live.ts` — the one poll the TV makes
- `src/pages/broadcast.astro` + per-league thin wrappers
- `src/styles/live-broadcast.css`
- tests per guard below

### Rules that bind here

- `docs/claude/rules/live-scoring.md` — the whole file. Especially: never
  fabricate a clock; bench rows travel in their own map; `res.ok` is not "the
  data is good"; a page must never fetch its own API to render itself; an
  unplayed week is a full payload of zeros; AFL duplicate rosters mean
  `playerId -> fid[]`, never a `Map<playerId, fid>`.
- `docs/claude/rules/theming-and-assets.md` — and the design-system head's
  hard-won line: **a surface that must stay dark in both themes takes a
  literal (`#111827`), never `--color-gray-900`**, which resolves to near-white
  under `html.dark`. A broadcast panel is exactly that surface.
- `docs/claude/rules/viewer-preferences.md` — cookie writes belong to the
  ROUTE, never an imported component.
- CLAUDE.md — registry over literals; `getCurrentSeasonYear()` for anything
  results-shaped (this board is); page-directory entry with 10+ tags.

## Guard tests to write

| Rule | Test |
|---|---|
| A missed FG / kick return is never a big play | `broadcast-moments.test.ts` |
| A moment older than 90s is dropped, not shown late | same |
| An opponent's play reveals SMALL, the owner's LARGE | same |
| Red zone needs possession, not just `isRedZone` | same |
| AFL duplicate rosters credit BOTH owners | same |
| The picker cookie is not Sunday Ticket's | `broadcast-selection.test.ts` |
| Default set is TheLeague + AFL, others off | same |
| The page never fetches its own API | `broadcast-self-fetch-guard.test.ts` |
| No fabricated clock reaches the shell | `broadcast-moments.test.ts` |

## Design spec (frontend-ux-architect, 2026-09-12) — the load-bearing decisions

Class prefix `lbc-`, stylesheet `src/styles/live-broadcast.css`. Design target
is a 1080p/4K TV in landscape; a laptop must not break.

**The contract.** From ten feet, in under a second, the screen answers: is
something good happening to one of my teams, or something bad happening to me.
Everything else is subordinate.

- **`2.2vh` is the hard minimum glyph height** (~12 arc-minutes at 10 ft).
  Nothing shrinks below it to fit — it gets DROPPED instead, on a fixed ladder.
- **A field of colour means good news**, and that channel is spent once. My
  player's reveal is a full-bleed franchise gradient; an opponent's is house ink
  with a coloured hairline. Never a full field for an opponent.
- **Six layers, one `Stage` at a time**, with an `occludes: 'none' | 'strip' |
  'all'` field. The draft board hides the idle layer whenever any stage exists;
  that is wrong here, because the lower-third must COEXIST with the idle deck.
- **The red-zone banner sits ABOVE the stage layer**, including takeovers. It is
  a persistent state, not an event — as a stage it would be preempted by the
  next reveal and the drive would vanish for 14 seconds.
- **A takeover never covers the header.** The header is what makes the takeover
  mean something ("he scored, and here is what it did to the matchup").
- **Never put an in-transition on the stage layer.** Two curves of the same
  length compound to their square and the layer beneath dips toward black at
  the midpoint of every reveal — the draft board shipped that.

### Tokens: `.lbc` consumes ZERO colour tokens

Every colour token here either inverts under `html.dark`, is floored against a
surface this page does not have, or flips brightness. `draft-broadcast.css`
already takes this posture. So no `var(--color-*)`, `--card-*`, `--content-*`,
`--league-accent` or `teamAccentVar()` anywhere inside `.lbc`. Literals:

```
--lbc-ink #05070b · --lbc-panel #0b1220 · --lbc-panel-2 #121c2e
--lbc-text #fff · --lbc-text-dim rgba(255,255,255,.72) · --lbc-text-faint rgba(255,255,255,.52)
--lbc-live #16a34a (FILL ONLY, 5.74:1) · --lbc-live-text #4ade80 (10.7:1)
--lbc-alert #fbbf24 (11.2:1) · --lbc-redzone #b91c1c (#fff on it = 6.5:1)
```

Contrast floor is STRICTER than AA because the panel is dimmed for most of its
life and a living room loses a point to ambient wash: **7:1 under 4vh**,
4.5:1 at or above it, measured against the literal and never the token.

Franchise colour has exactly three sanctioned paths: `toBroadcastPair` (one
franchise), `resolveBroadcastGradient` (a franchise that declares its own look),
and `resolveTeamColorPair(..., { background: '#0b1220' })` for two franchises in
one header cell — and that background is `--lbc-panel`, NOT LiveScoreboard's
`#262626`. The wrong background gives a confident, wrong legibility answer.
`background: var(--lbc-gradient)` must be split into `background-color` (a
literal mid-stop) + `background-image`, or a rejected value resets the property
to `transparent` rather than to the cascade winner.

### Burn-in — eight hours on a real panel

Root **orbital drift**: the island writes `--lbc-drift-x/y` every 90s around a
12-point Lissajous ring of radius `0.6vw × 0.6vh`, applied as a `transform`
(never `top`/`left`/`margin`, which would re-lay out the board every 90s for
eight hours) on the ROOT, so the header still never moves relative to its own
content. It is sub-perceptual (~0.5 px/s) and therefore deliberately EXEMPT
from `prefers-reduced-motion` — say so in a comment or someone will "fix" it.
The score numerals and red-zone banner counter-drift on a co-prime 97s period
so the brightest pixels never retrace the root's path. Luminance schedule:
1.00 live, 0.86 idle, 0.72 screensaver. No element over `2vw²` exceeds 80%
luminance — there is no white card anywhere on this page.

**The red-zone banner is never animated at any rate.** No blink, no pulse: a
persistent flasher for a whole drive is intolerable, and anything near 3 Hz is
a photosensitivity hazard.

### Rendering

SSR always (`prerender = false`) — owner-scoped, cookie per request, runtime
clock. **`getCurrentSeasonYear()`**, never the league year: this board is
results-shaped. Auth gate and redirect in the ROUTE; cookie writes in the ROUTE.
Exactly ONE island, `client:load` (the TV is opened and walked away from, so
`client:idle` can be minutes and `client:visible` is meaningless at full
viewport). First paint carries the complete header with real numbers, the first
strip page and the right ground — **no skeletons**, because the content is
already in the HTML and a dropped poll must degrade to "numbers from 40 seconds
ago", never to a blank screen.

Poll: 8s, 20s backoff after 3 errors, 15s `AbortSignal.timeout`, and a **40s
watchdog** — the loop is a self-chaining timeout, so a hung fetch does not delay
the chain, it BREAKS it. That exact failure froze the 2026 draft rehearsal board
at pick 7, and this screen runs unattended for eight hours.

### Accessibility (a display nobody touches — what still applies)

- The win-probability bar is `aria-hidden`; a `visually-hidden` sentence carries
  the numbers. Never `role="img"` + `aria-label` on it — that makes the element
  a leaf and nothing inside is ever announced.
- One `role="status" aria-live="polite"` announcer, firing on stage OPEN only,
  rate-limited to one per 4s. Red zone announces once on entry and once on exit,
  polite, never re-announced while it persists.
- Reduced motion must kill all THREE motion sources — `@keyframes`, the strip's
  page `transition`, and the reveal's gradient re-paint. The playoffs shimmer
  shipped with `animation: none` alone and kept moving.
