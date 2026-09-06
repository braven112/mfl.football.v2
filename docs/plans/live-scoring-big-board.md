# Live Scoring — Big Board

> Status: PLAN. Nothing built yet.
> Branch: `claude/live-scoring-tv-feature-xt1msk`
> Decisions taken with Brandon, 2026-09-05, recorded inline as **[decided]**.

A second live-scoring surface built for a screen across the room: the matchup
board sits idle most of the time, and a full-screen card takes over the moment
one of your players does something. The draft broadcast
(`/theleague/draft/broadcast`) is the template for scale, layering and
restraint — this is its Sunday-afternoon sibling.

It is **not** a variant of `/live-scoring`. That page is an interactive tool for
one person at a laptop (expandable rosters, bench disclosure, week picker). This
one takes zero input and is read from ten feet away.

---

## 1. What we're building

| | |
|---|---|
| **Route** | `/theleague/live-scoring/board`, `/afl-fantasy/live-scoring/board` **[decided]** |
| **Link label** | "Big Board", on the live-scoring page **[decided]** |
| **Leagues** | TheLeague + AFL. Best Ball is out of scope (no head-to-head matchup to idle on) **[decided]** |
| **Idle screen** | The signed-in owner's matchup; with no session, rotate every matchup **[decided]** |
| **Reveal triggers** | A **MFL fantasy-point gain of 3.0+** by a rostered starter, plus every TD and every kicker FG regardless of value **[decided]** |
| **Source of truth** | **MFL for fantasy points. ESPN is supporting content** — the caption, the clock, the game state **[decided]** |
| **Latency** | Reveals land on the MFL poll boundary (up to ~60s late). Accepted, in exchange for real numbers **[decided]** |
| **Win probability** | On **both** screens — idle and reveal **[decided]** |
| **Wording** | Nothing anywhere says TV, broadcast, cast or big screen **[decided]** |

### Prior art we looked at

| Product | What it does | What we take |
|---|---|---|
| [ScoreProTV](https://apps.apple.com/app/id6756029448) (Android TV) | Connects Yahoo/Sleeper, renders a matchup on the TV, fires "Big Play alerts" on TDs and turnovers | The core loop — idle matchup, interrupt on a big play — is exactly the shape asked for. Confirms turnovers belong in the trigger set alongside scores. |
| [Sleeper Big Screen Mode](https://support.sleeper.com/en/articles/2083195-how-to-cast-your-draft-to-the-big-screen) | Draft board cast to a TV in a second browser tab while you draft in the first | The "second tab, no input, plain URL" delivery model. No casting protocol, no app — a URL you open on the TV's browser or an HDMI'd laptop. Our draft broadcast already works this way. |
| [NFL RedZone octobox](https://support.nfl.com/hc/en-us/articles/35869733293844-What-is-NFL-RedZone) | Up to 8 live games in a grid, cutting to whoever is about to score | The whip-around instinct: the screen's job is to be *pointed at the thing happening right now*. Also a Phase 3 idea — a league-wide grid scene during a dead window (§8). |
| [DataForce live scoring](https://www.dataforceff.com/live-scoring) (MFL-native) | Every league game side-by-side, widened to full screen | Confirms the rotation fallback matters: with no session, showing one arbitrary matchup is worse than showing all of them in turn. |
| [ESPN on smart TVs](https://support.espn.com/hc/en-us/articles/40379185094676-How-can-I-view-my-fantasy-sports-matchup-or-pick-em-games-in-real-time-on-my-smart-TV-or-living-room-device) | Sign in on the TV, browse matchups | The thing we're avoiding — signing into a TV browser is the friction that makes the `?fid=` override (§5) necessary. |

Nobody in that list does the **full-screen player reveal** the draft broadcast
does, and nobody shows a **win-probability swing** on the moment it happens.
That card is the differentiator and half of it already exists in this repo.

---

## 2. Data — no new sources, one extended parser

| Need | Source | Status |
|---|---|---|
| **Fantasy points — the source of truth** | MFL `liveScoring` → `/api/live-scoring` → `LivePlayerRow.live` | reuse as-is |
| Matchup pairings, starter rows, remaining game-time | same | reuse as-is |
| **Win probability + projected finals** | `src/utils/live-win-probability.ts` — pure, tested, computed client-side from data the board already holds | reuse as-is |
| Team identity, colors, crests | `leagueConfig.teams` → `buildTeamsMap`, `getFranchiseBrand`, `franchiseGradient` | reuse as-is |
| Real NFL game state, clock, red zone | `/api/nfl-scoreboard` via `useNflScoreboard` | reuse as-is |
| Box-score stat lines | `/api/nfl-game-detail` → `PlayerBoxScore` | reuse as-is |
| Scoring plays, attributed to MFL player ids | `/api/nfl-game-detail` → `LiveScoringPlay` | reuse as-is |
| **Big non-scoring plays, for captions only** | `parseScoringPlays` currently drops every `scoringPlay !== true` | **the one extension** — §4 |

The route wrapper calls the same `assembleLiveScoringData` that `/live-scoring`
calls, so the two pages cannot drift on what a score is.

---

## 3. Architecture

Repo rules force the shape here and they're the right shape anyway
(`tests/page-fork-ratchet.test.ts`, and `Astro.redirect()` only redirects from a
page):

```
src/pages/theleague/live-scoring/board.astro     ~55 lines  route wrapper
src/pages/afl-fantasy/live-scoring/board.astro   ~55 lines  route wrapper
  └─ src/components/shared/live-board/LiveBoardPage.astro   the whole page
       └─ LiveBoard.tsx            client:load — layers, queue, rotation
            ├─ BoardMatchup.tsx    the idle screen
            ├─ BoardReveal.tsx     the full-screen moment
            └─ BoardPregame.tsx    before kickoff
src/utils/live-board.ts            pure: triggers, queue, rotation, scenes
src/styles/live-board.css          vw/vh scale, dark in both themes
```

**Each route wrapper holds** the feature gate (`leagueHasFeature(slug,
'liveScoring')`), the redirect, its league's static config import, and nothing
else. Everything below is one shared component — same shape as
`src/pages/theleague/division-strength.astro`.

**Layers, not alternatives.** Idle and reveal both stay mounted and cross-fade
on one shared duration token, exactly as `draft-broadcast.css` documents — a
hard swap reads as somebody changing the channel.

**Polling.** The page reuses `live-poll-store.ts`; no third poller (see the
"Two pollers on the page, not three" rule). MFL at 60s, ESPN at 60s with the
route's existing 25s cache — **unchanged from `/live-scoring`**, because the
latency decision in §4 removes the reason to tighten either one.

**Everything pure goes in `src/utils/live-board.ts`** so it is testable without
a browser or ESPN: trigger classification, queue admission, rotation schedule,
scene timing. Same split that makes `draft-broadcast.ts` testable.

---

## 4. The reveal trigger — MFL measures, ESPN captions

This is the heart of the feature and the part that changed once you said MFL is
the source of truth and lateness is acceptable.

### The two-source rule

> **MFL's point delta decides *whether* a card fires and *what number* it
> shows. An ESPN play decides *what the card says*. Both are required.**

Every 60s MFL poll, each starter's `live` total is compared against the
previous poll. That delta is **real, authoritative fantasy points** — MFL's own
number, not a model, not an estimate. It is what the card shows.

Requiring a corroborating ESPN play in the same window is what makes this safe.
The Moments feed was removed because a bare poll-delta *invents events*: a stat
correction produces a positive swing with nothing behind it, and the old code
would announce it. Here a delta with no ESPN play behind it fires **nothing**.
The consequences of that guard, all of them good:

- A stat correction can never produce a card.
- If ESPN is 403 or down, the board still works completely — scores, projected
  finals, win probability, all from MFL. It just stops interrupting itself.
- The delta is anchored to a real play with a real game clock, so we never
  fabricate a clock (the `clockLabel()` rule).

### The threshold

| Fires when | Rationale |
|---|---|
| MFL delta **≥ 3.0 points** for a rostered starter, with a corroborating play | Your original ask, now measurable because MFL supplies the number |
| **Any TD**, whatever it scored | It's a touchdown |
| **Any FG by a kicker**, whatever it scored | Explicitly asked for **[decided]** |
| A **turnover** credited to a rostered starter | Free, and ScoreProTV confirms it belongs |
| Never on a **negative** delta | That's a correction, not a moment |
| Never without a **prior sample for that player** | No baseline ⇒ nothing to diff — see below |

3.0 is one constant in one file, tunable after a real Sunday. PATs are excluded
(they ride the TD's play text and would double-card the kicker).

### Baseline, and not replaying history

The SSR props already carry a full snapshot of every starter's live points
(`initialPlayers`), so the first MFL poll after mount diffs against *that*, not
against zero. Plug the TV in at 3pm and the board starts from where the day
actually is — no dump of every touchdown since one o'clock. Same problem the
draft board's warm-up solves, solved here for free by the page's own initial
data.

**The guard is per PLAYER, not per poll.** "Skip the first poll" is not enough:
a row can appear mid-afternoon carrying points it scored before we ever saw it
— a lineup correction, a franchise whose feed was incomplete, `initialPlayers`
absent because the page was served without it (the prop is optional on
`LiveScoringPageProps`). Diffing a first sighting against zero turns a player
who is already on 12.4 into a 12.4-point "moment" that never happened. So: no
prior sample for that player id ⇒ **record the baseline, fire nothing**, and
diff from the next poll on. Same rule, applied at the right granularity.

### Multiple plays in one window

A 60s window can hold two catches by the same player. The delta covers the
window, so **the card covers the window too**: one card, both plays named, one
number. We never split a delta across plays and we never claim a specific play
was worth a specific amount when the window held more than one. The caption
says what happened; the number says what it was worth in total.

### What the parser extension is now for

Tier 3 (big non-scoring plays) still needs `parseScoringPlays` widened, but its
job has changed from **measuring** to **captioning**:

- It becomes `parseNotablePlays`, keeping scoring plays as today plus
  non-scoring plays where a rostered starter is a participant and
  `statYardage >= 10`, tagged `kind: 'score' | 'turnover' | 'big'` with `yards`.
- **Server-side, always.** A 16-game Sunday is ~2,900 plays and the route
  currently ships ~40; and the rostered-starter join has to happen server-side
  anyway, because an ESPN athlete id must never cross the response boundary.
- The yardage floor no longer has to approximate fantasy value, so getting it
  slightly wrong costs a caption, never a wrong number.
- `buildMoments` gains a filter so the *existing* live-scoring ticker keeps
  showing scores only. Quietly changing what the main page's ticker means is
  not part of this.
- **Risk:** `tests/fixtures/espn-game-plays.json` is a 12-item trim with no
  non-scoring play carrying `statYardage`, and ESPN 403s from the sandbox. Needs
  a fuller re-recorded fixture before this is written, and verification on a
  preview deploy rather than locally.

### Bench players never trigger a reveal

`buildMoments` reads `players`, which by design excludes bench (they travel in
their own map). A bench touchdown on a screen that says it's your matchup would
be a lie. Don't opt in.

---

## 5. The idle screen

The matchup, at scale, in both franchises' colors. Full-bleed gradient per side
(`franchiseGradient`), crest, and:

- Team name + score at hero size, sized the way `BroadcastRevealCard` sizes a
  player name — `vw`/`vh` with `clamp()`, never rem.
- **Win probability, large.** A percentage under each team plus the split bar,
  from `winProbability(...)` — the same model `/live-scoring` draws, so the two
  pages always agree **[decided]**.
- Projected final and "yet to play" under each score (`projectTeamFinal`,
  `projectTeamRemaining`).
- Both starting lineups: player, position, **live fantasy points**, game state
  (`Q3 4:12`, `FINAL`, kickoff time), red-zone flag — gated on
  `situation.possession === player's nflTeam`, never on the game alone.
- Recent scoring ticker along the bottom (`selectMatchupMoments`).

**Which matchup:**

1. Signed-in owner (`getAuthUser` → `franchiseId`) → **their matchup, locked**.
2. No session → **rotate all matchups**, ~20s each, in schedule order.
3. `?fid=0007` → pin any matchup. This is how a TV that can't practically sign
   in gets pinned to one team — the friction the ESPN smart-TV route has.
4. `?rotate=1` → force rotation even when signed in.

Rotation **pauses while a reveal is up** and resumes on the matchup the reveal
belonged to, so the room's eyes land on the right board when the card clears.

---

## 6. The reveal, and the queue behind it

`BoardReveal.tsx` is `BroadcastRevealCard` retargeted: player cutout on the
franchise gradient, crest, huge name — and now a real stat block, because
holding the card until MFL has caught up is precisely what buys us one:

```
        PUKA NACUA          LAR · WR
   42 YD TD PASS FROM STAFFORD        Q2 7:14

        +14.2                  24.6
      this score            today

   PACIFIC PIGSKINS  118.4  ·  92.1  MOTOR CITY
   win probability   38% ──→ 61%
```

Every number on that card is real and sourced:

| Element | Source |
|---|---|
| `+14.2` | MFL delta across the poll window |
| `24.6` | MFL live total for the player |
| Team scores | MFL live totals |
| `38% → 61%` | `winProbability()` evaluated on the before and after snapshots |
| Play text, clock, yardage | ESPN |

**The win-probability swing is the best thing on this card.** We hold both
snapshots anyway to compute the delta, so the before/after is free — and "that
touchdown moved you from losing to winning" is the sentence a room actually
reacts to. It is also the answer to "am I winning", asked at the one moment
everybody is definitely looking up.

Reuse verbatim from the draft broadcast, because these rules are site-wide:
`isSplashCutoutEligible`, `resolveSplashColors`, the espncdn-only 404 cascade
(`docs/claude/insights/features/player-composites.md`).

**Queue discipline:**

- **One card at a time, ~10s each.** The draft board holds 18s because a pick is
  the only thing happening; on a Sunday, eight games score in bursts.
- **Cap the queue at 3.** The 60s poll boundary already batches a window's
  worth of moments; a fourth card in the same burst puts the board minutes
  behind. Overflow collapses into one "3 more scores" strip on the idle board.
- **Your players jump the queue** when the board is locked to an owner.
- **AFL: one play, two owners.** With `duplicatePlayers`, 85 of 131 starters are
  shared. `buildMoments` already keys `playerId -> fid[]`; the reveal must *name
  the owners* ("started by Pacific Pigskins and Motor City") rather than firing
  twice or silently picking one. Note that each franchise's own delta and win-prob
  swing are different, so a shared play can legitimately show two different
  numbers — the card names whose matchup it is showing.
- **Derived data, presentational queue.** The play feed stays recomputed every
  poll (idempotent, no drift). The queue governs what has been *shown on
  screen*, nothing else. These are different things and must not merge.

---

## 7. Rules this must not trip over

Straight from `docs/claude/rules/live-scoring.md` — each one already shipped as
a bug once:

- `res.ok` is not "the data is good". Gate on `data.ok === false`; `{}` is
  truthy and gating on `data.players` wiped a live board once. **Critical here:**
  an `ok: false` poll must not be treated as a snapshot, or every player's delta
  reads as a huge negative and then a huge positive on recovery.
- A failed poll keeps the last good data and flips status — the board shows a
  stale-feed pill, never a blank screen. A TV that goes white is the worst
  possible failure here.
- Never fabricate a clock. No ESPN game → print the state, no numbers.
- Never ship an ESPN athlete id to the client.
- `host` never goes in a query string (a WAF 403'd exactly that pattern on
  2026-09-03). Send `L`; the server resolves the host from the registry.
- Bench rows stay out of `players`.
- No league literals — `getLeagueBySlug`, `leagueHasFeature`
  (`tests/league-literal-guard.test.ts`).
- Season clock, not league clock: this is results-shaped, so
  `getCurrentSeasonYear()` / `getCurrentNFLWeek()`, matching `/live-scoring`.

---

## 8. Phasing

**Phase 1 — the page.**
Routes, shared component, idle matchup board with win probability, rotation +
owner lock + `?fid=`, the MFL-delta trigger with ESPN corroboration on *scoring*
plays only, the reveal card with delta / total / score / win-prob swing, queue
discipline, fullscreen affordance, page-directory entries. Ships the whole
experience — including the 3.0-point threshold — using only data the routes
already return.

**Phase 2 — big non-scoring plays.**
Re-record a full plays fixture, widen the parser to notable non-scoring plays
server-side, add `kind`/`yards` to the type. This only *adds captions*: a 42-yard
catch that already cleared 3.0 points in Phase 1 fires a card captioned
"receiving" from the box score; Phase 2 makes it say "42 yd catch from Stafford".
Gated behind `?bigplays=1` until it's been watched through a real slate.

**Phase 3 — the dead-window scenes** (the screensaver's analogue).
Thursday 4pm with nothing playing is this page's email-draft problem. Candidate
scenes, cycling: league-wide scoreboard grid (the octobox idea), today's top
performers, closest matchups by win probability, who's still yet to play. Same
"borrow the reveal layer, any real event ends it instantly" mechanism
`buildScreensaverPlaylist` uses.

---

## 9. Open questions

1. **Reveal length** — 10s is my starting number; it wants a real Sunday to tune.
2. **The 3.0 threshold** — same. One constant, one file.
3. **Does this page get its own Throwback dressing**, or inherit whatever
   `/live-scoring` shows? Inheriting is one line and is my default.

*(Resolved: reveal latency — 60s MFL poll accepted in exchange for real numbers,
so no upstream cost increase and no cache retuning.)*

*(Resolved: the launch What's New entry is **not** hero-eligible **[decided]** —
it carries `excludeFromHero: true`. It still needs a screenshot and inline
league-neutral links, since `new-page` requires both.)*

---

## 10. Test surface

- `tests/live-board-triggers.test.ts` — the two-source rule end to end: a delta
  with no ESPN play fires nothing; a play with no delta fires nothing; a
  negative delta fires nothing; a player's FIRST sighting fires nothing however
  many points he already has;
  TD/FG always fire; 3.0 is the gate otherwise; bench excluded; AFL dual-owner
  attribution carries per-franchise numbers.
- `tests/live-board-queue.test.ts` — cap at 3, owner priority, a moment never
  shown twice, overflow strip.
- `tests/live-board-rotation.test.ts` — lock vs. rotate vs. `?fid=`, pause and
  resume around a reveal.
- `tests/live-win-probability.test.ts` — extend for the before/after swing pair.
- Extend `tests/espn-game-detail.test.ts` for `parseNotablePlays` (Phase 2).
- `tests/page-fork-ratchet.test.ts` — wrappers stay under 80 lines, no new
  forked sibling.
- `tests/page-directory-data.test.ts` — both entries, 10+ tags each.
- `tests/whats-new-data.test.ts` / `whats-new-links.test.ts` — the launch entry.
- Add the new files to `.claude/hooks/path-guard.json` under the live-scoring
  domain so these run on every edit here.
