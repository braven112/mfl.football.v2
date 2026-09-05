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
| **Reveal triggers** | TDs, all FGs, **and** big non-scoring plays **[decided]** — see §4 for how the "3+ points" ask resolves |
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
does. That card is the differentiator and it already exists in this repo.

---

## 2. Data — no new sources, one extended parser

Everything the board needs is already served, and the rules in
`docs/claude/rules/live-scoring.md` all still apply.

| Need | Source | Status |
|---|---|---|
| Fantasy scores, starter rows, matchup pairings | `assembleLiveScoringData` → `/api/live-scoring` | reuse as-is |
| Team identity, colors, crests | `leagueConfig.teams` → `buildTeamsMap`, `getFranchiseBrand`, `franchiseGradient` | reuse as-is |
| Real NFL game state, clock, red zone | `/api/nfl-scoreboard` via `useNflScoreboard` | reuse as-is |
| Box-score stat lines | `/api/nfl-game-detail` → `PlayerBoxScore` | reuse as-is |
| Scoring plays, attributed to MFL player ids | `/api/nfl-game-detail` → `LiveScoringPlay` + `buildMoments` | reuse as-is |
| **Big non-scoring plays** | `parseScoringPlays` currently drops every `scoringPlay !== true` | **the one extension** — §4 |
| Throwback identities | `applyThrowbackToBoard` | reuse as-is, or the board dresses teams differently from the main page |

The route wrapper calls the same assembly function `/live-scoring` calls, so
the two pages cannot drift on what a score is.

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
src/utils/live-board.ts            pure: queue, triggers, rotation, scenes
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
"Two pollers on the page, not three" rule). It runs *without* `NflGamesStrip`,
so it is the only subscriber and can request a tighter interval — see the open
question in §9 about reveal latency.

**Everything pure goes in `src/utils/live-board.ts`** so it is testable without
a browser or ESPN: trigger classification, queue admission, rotation schedule,
scene timing. Same split that makes `draft-broadcast.ts` testable.

---

## 4. The reveal trigger — how the "3+ point play" ask resolves

You asked for TDs, all kicker FGs, **and** big non-scoring plays worth roughly
3+ fantasy points. The first two are free. The third needs care, and here is
the honest version of it.

**We cannot compute a per-play fantasy point value.** Two reasons, both
load-bearing:

1. **We don't model league scoring rules.** There is no rules feed on disk
   (`data/<league>/mfl-feeds/<year>/` has no `rules.json`), and MFL's rules
   export is a DSL we'd have to write an evaluator for. Two leagues, two rule
   sets, and every reveal would be a number we invented.
2. **Inferring one from poll deltas is a bug we already removed.** The old
   Moments feed diffed each starter's points between two 60s polls; a stat
   correction invented scoring events out of nothing and a swing spanning a
   poll boundary got attributed to the wrong moment. `buildMoments` is derived,
   not accumulated, precisely so that can't happen. Re-introducing a delta to
   size a reveal re-introduces the bug on the biggest surface we have.

**So the board never prints a number it made up.** Same discipline as the
`clockLabel()` rule — with no real clock we print the state, not a confident
fake. What it prints instead is all real:

> **PUKA NACUA** · 42 YD CATCH · Q2 7:14
> **18.6** pts today

The yardage is ESPN's own `statYardage`. The 18.6 is MFL's own live total for
that player. Nothing is derived.

**And the trigger is a yardage gate, not a points gate** — a proxy for "worth
3+ points" that needs no scoring rules and is honest about what it measures:

| Tier | Fires on | Source |
|---|---|---|
| **1 — scores** | Any TD by a rostered starter; any FG by a rostered kicker; safeties and 2-pt conversions | `LiveScoringPlay.typeAbbrev` — already parsed, already attributed |
| **2 — turnovers** | INT / fumble recovery credited to a rostered starter | `type.text`, already in the feed |
| **3 — big plays** | Non-scoring play by a rostered starter over a per-position yardage floor: **25+** rush/receiving, **40+** passing (tunable constants, one place) | needs the parser extension below |

Tier 3 is the only new parsing:

- `parseScoringPlays` becomes `parseNotablePlays` — it keeps scoring plays as
  today *plus* non-scoring plays that clear the floor, tagging each
  `kind: 'score' | 'turnover' | 'big'` and carrying `yards`.
- **The filter must run server-side.** A 16-game Sunday is ~2,900 plays; the
  route currently ships ~40. Shipping the raw slate to a TV browser every poll
  is not an option, and the rostered-starter join happens server-side anyway
  (an ESPN athlete id must never cross the response boundary).
- `LiveScoringPlay` gains `kind` and `yards`. `buildMoments` gains a filter so
  the *existing* live-scoring ticker keeps showing scores only — Tier 3 is for
  the board, and quietly changing what the main page's ticker means is not part
  of this.
- **Risk:** `tests/fixtures/espn-game-plays.json` is a 12-item trim with no
  non-scoring play carrying `statYardage`, and ESPN 403s from the sandbox. This
  needs a fuller re-recorded fixture before Tier 3 can be written with
  confidence, and verification on a preview deploy, not locally.

**Bench players never trigger a reveal.** `buildMoments` reads `players`, which
by design excludes bench (they travel in their own map). A bench touchdown on a
TV that says it's your matchup would be a lie. Don't opt in.

---

## 5. The idle screen

The matchup, at scale, in both franchises' colors. Full-bleed gradient per side
(`franchiseGradient`), crest, and:

- Team name + score at hero size, the way `BroadcastRevealCard` sizes a player
  name — `vw`/`vh` with `clamp()`, never rem.
- Projected final and "yet to play" under each score (`computeTeam`).
- Win-probability bar between them.
- Both starting lineups: player, position, live points, game state (`Q3 4:12`,
  `FINAL`, kickoff time), red-zone flag — gated on
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
franchise gradient, crest, huge name, the play line, the real clock, the
player's live total, and the matchup score **as it now stands** — the reveal is
the only moment the room is definitely looking, so it should answer "am I
winning" at the same time.

Reuse verbatim from the draft broadcast, because these rules are site-wide:
`isSplashCutoutEligible`, `resolveSplashColors`, the espncdn-only 404 cascade
(`docs/claude/insights/features/player-composites.md`).

**Queue discipline** — the part that decides whether this is delightful or
maddening on a 1pm slate:

- **Seed the seen-set on mount.** Plugging the TV in at 3pm must not replay
  every touchdown since 1pm. First payload marks everything seen and shows
  nothing; the draft board solves the identical problem with its warm-up.
- **Derived data, presentational seen-set.** The play feed stays recomputed
  every poll (idempotent, no drift). The seen-set governs *what has been shown
  on screen*, nothing else. These are different things and must not merge.
- **One card at a time, ~10s each.** The draft board holds 18s because a pick
  is the only thing happening. On a Sunday, eight games score in bursts.
- **Cap the queue at 3.** Six scores in ninety seconds must not put the board
  two minutes behind the live game — a reveal for a TD the room watched
  three minutes ago is worse than no reveal. Overflow collapses into one
  "3 more scores" strip on the idle board.
- **Your players jump the queue** when the board is locked to an owner.
- **AFL: one play, two owners.** With `duplicatePlayers`, 85 of 131 starters
  are shared. `buildMoments` already keys `playerId -> fid[]`; the reveal must
  *name the owners* ("started by Pacific Pigskins and Motor City") rather than
  firing twice or silently picking one.

---

## 7. Rules this must not trip over

Straight from `docs/claude/rules/live-scoring.md` — each one already shipped as
a bug once:

- `res.ok` is not "the data is good". Gate on `data.ok === false`; `{}` is
  truthy and gating on `data.players` wiped a live board once.
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

**Phase 1 — the page (no new parsing).**
Routes, shared component, idle matchup board, rotation + owner lock + `?fid=`,
reveals on Tier 1 (TD/FG/safety) and Tier 2 (turnovers), queue discipline,
fullscreen affordance, page-directory entries. Ships the whole experience using
only data the route already returns.

**Phase 2 — Tier 3 big plays.**
Re-record a full plays fixture, extend the parser to notable non-scoring plays
server-side, add `kind`/`yards` to the type, tune the yardage floors on a live
Sunday. Gated behind `?bigplays=1` until it's been watched through a real slate.

**Phase 3 — the dead-window scenes** (the screensaver's analogue).
Thursday 4pm with nothing playing is this page's email-draft problem. Candidate
scenes, cycling: league-wide scoreboard grid (the octobox idea), today's top
performers, closest matchups, who's still yet to play. Same "borrow the reveal
layer, any real event ends it instantly" mechanism `buildScreensaverPlaylist`
uses.

---

## 9. Open questions

1. **Reveal latency vs. upstream load.** The ESPN detail poller runs at 60s and
   the route caches a live game 25s, so a TD could be ~60-85s old when the card
   appears — noticeable in a room where the game is on the other TV. Tightening
   to a 20s poll + 15s TTL is roughly +67% upstream fetches on a route already
   fanning out to 16 games. **Recommendation: 25s poll, leave the TTL alone** —
   worst case ~50s, which reads as a replay rather than a lag. Worth a decision.
2. **Does this page get its own Throwback dressing**, or inherit whatever
   `/live-scoring` shows? Inheriting is one line and is my default.
3. **Reveal length** — 10s is my starting number; it wants a real Sunday to tune.
4. **Homepage hero for the What's New entry.** New pages require the entry
   (with a screenshot and inline links); hero eligibility is explicitly your
   call, not mine.

---

## 10. Test surface

- `tests/live-board-queue.test.ts` — seed-on-mount shows nothing; cap at 3;
  owner priority; a play never reveals twice.
- `tests/live-board-triggers.test.ts` — Tier 1/2/3 classification, per-position
  yardage floors, bench players excluded, AFL dual-owner attribution.
- `tests/live-board-rotation.test.ts` — lock vs. rotate vs. `?fid=`, pause and
  resume around a reveal.
- Extend `tests/espn-game-detail.test.ts` for `parseNotablePlays` (Phase 2).
- `tests/page-fork-ratchet.test.ts` — wrappers stay under 80 lines, no new
  forked sibling.
- `tests/page-directory-data.test.ts` — both entries, 10+ tags each.
- `tests/whats-new-data.test.ts` / `whats-new-links.test.ts` — the launch entry.
- Add the new files to `.claude/hooks/path-guard.json` under the live-scoring
  domain so these run on every edit here.
