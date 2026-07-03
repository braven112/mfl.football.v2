# AFL Trophy Wall (franchise awards)

Insights for the AFL franchise award/trophy-wall feature
(`src/utils/afl-awards.ts`, `scripts/compute-afl-awards.mjs`,
`data/afl-fantasy/awards-history.json`, rendered on
`src/pages/afl-fantasy/franchises/[id].astro`).

---

## 2026-06-25 - Building the award data pipeline: four load-bearing data gotchas

**Context:** Added a 10-badge "trophy wall" to AFL franchise pages (AFL/AL/NL
championships, 4 division titles, NIT, + Premier League / D-League tiers).
Eight badges auto-derive from MFL; two are hand-entered. The hard part was
data sourcing, not UI.

**1. Pre-2024 local AFL feeds are CONTAMINATED with TheLeague data.**
`data/afl-fantasy/mfl-feeds/<year>/` for 2020–2023 contains TheLeague (13522)
franchises, not AFL. e.g. `0001` is "Smokane FC" on the real AFL but the local
2023 cache resolves it to a TheLeague team. Always validate a cached
`league.json` against the canonical AFL names in `afl.config.json` (stable
franchise IDs) before trusting it — `compute-afl-awards.mjs#isGenuineAfl` does
this and falls back to online fetch (`www44`/L=19621) when the local cache is
contaminated. 2024+ local caches are genuine AFL.

**2. Playoff bracket WINNERS live under `playoff-brackets.json#brackets[id]`,
not `playoffBrackets.playoffBracket[id]`.** The latter is metadata only
(`bracketWinnerTitle`, `teamsInvolved`). The former has the games with
`franchise_id` + `points`. Winner = higher `points` in the final round. Bracket
ids: 1=AFL, 2=AL, 3=NL, 6=NIT (4/5/7/8/9 are placement games we don't badge).
Online, fetch each via `export?TYPE=playoffBracket&BRACKET_ID=<id>`.

**3. Division winner: older standings expose `divwlt` but not `divpct`.**
2023+ `leagueStandings.franchise[]` carries `divpct` directly; 2020–2022 only
have `divwlt` ("W-L-T"). Derive pct from `divwlt` as a fallback
(`divisionPct()`), then pick the max per division (tie-break `divpf`, then
`pf`). Map franchise→division from per-year `league.json`
(00=North,01=South,02=East,03=West), NOT static config, so historical
realignment stays correct.

**4. Tier membership (Premier/D-League) is NOT in any MFL server response.**
The all-play page (`O=101&SORT=ALLPLAY`) returns a SINGLE all-play-sorted list
of all 24 teams with no tier markers — the AFL skin splits the two tiers
client-side from per-year membership data that isn't served. Current
`afl.config.json` membership can't be back-applied because teams are
promoted/relegated (e.g. Titsburgh Feelers was Premier in 2023, D-League now).
So tier champions are HAND-ENTERED into `awards-history.json` (slugs
`premier-league` / `dleague-champion`, `source: "manual:tier-champion"`) and
the compute script's per-year merge PRESERVES them on re-run. The commissioner
reads each season's tier champion off the skin's standings page header
("YYYY Champions: NAME").

**Re-run contract:** `compute-afl-awards.mjs` reads the existing JSON, refreshes
the 8 auto-derived slugs, and merges — hand-entered tier rows survive. `--offline`
skips network (no pre-2024, since those local caches are contaminated).

**UI:** full 10-badge "locker" — every badge always rendered;
`getFranchiseAwards()` returns all 10 `AwardType`s with a `years[]` array (empty
= locked, shown grayscale + dimmed via `[data-earned='false']`). Badges are
full-color `<img>` brand marks in `public/assets/afl/awards/`, resolved through
`getAwardBadge()` (never hardcode the path — mirrors `afl-tier.ts`/
`afl-conference.ts`). Gold accent uses the new `--afl-gold` token in
`tokens.css`.

---

## 2026-06-25 - Backfill to 2016 + the AFL Cup era (eras differ; match brackets by NAME)

**Context:** Extended the data window from 2020 back to 2016, which crosses a
format change, and added an 11th award (`afl-cup`).

**The 2016-2017 "AFL Cup" era.** Before 2018 the AFL had no AL/NL conference
championships. Instead bracket 1 was the AFL Championship and a separate
multi-round **AFL Cup** (brackets 9-15, final = "AFL Cup Finals") ran alongside
it; the NIT was bracket **5**, not 6. In 2018 the conference format arrived
(brackets 2=AL, 3=NL, 6=NIT) and the AFL Cup was retired. So **bracket IDs are
not stable across eras** — `compute-afl-awards.mjs` now matches brackets by
**name** (`bracketNameToSlug`) via the `TYPE=playoffBrackets` metadata, not by
fixed ID. Don't reintroduce a hardcoded id→slug map.

**AFL Cup champions are NOT in MFL.** The pre-2020 AFL Cup bracket export
returns only seed pointers (`winner_of_game`/`loser_of_game`, no `franchise_id`
or `points`), so the cup winner can't be derived. `afl-cup` is HAND-ENTERED
(like the tier awards) and preserved by the merge. Its badge art
(`afl-cup.svg`) started as a placeholder — replace with real art when supplied.

**Division labels hold across eras.** 2016 already had conferences (00=American
League, 01=National League) and divisions (00=North,01=South,02=East,03=West)
identical to 2018+, so the `DIVISION_SLUG` map is correct for the AFL Cup years
even though those years had no conference-championship brackets.

**Per-era award sets.** A season carries only the awards it actually held:
2016-2017 → afl-championship + afl-cup + nit + 4 divisions (no AL/NL, no tiers);
2018-2019 → afl/al/nl + nit + 4 divisions + tiers; 2020+ → adds nothing new.
The locker still renders all 11 slots every time — absent awards are just
locked. Still pending hand-entry: AFL Cup champions (2016-2017) and tier
champions for 2018-2019.

---

## 2026-06-27 - Backfill to 2004, owner attribution, the tiered room, and SVG year-stamping

Major expansion: history back to **2004**, a four-tier "trophy room" UI, 13 award
types, year-stamped editable badges, and locked placeholders. The non-obvious
parts:

**1. Pre-2016 the AFL was a NEW MFL league every season — IDs are stable but
owners are NOT.** Each year has its own host + leagueId
(`data/afl-fantasy/year-host-map.json`; `fetchExport` uses `hostFor(year)`).
Slot numbers (`0001`…`0024`) persist, but owners turned over AND some owners
moved slot numbers (e.g. "Chatmaster" was slot 0007 in 2007, is 0021 now;
0007 is "Avenging Amish" today). So **attribute pre-2016 awards by TEAM NAME →
current franchise (name+alias), never by slot id**. `compute-afl-awards.mjs`
does this in `computeYear` (`currentIdForName(histName)`); unmatched names are
defunct owners → recorded with `franchiseId: null` (kept for a future
league-history page, never shown on a wall). 2016+ uses the slot id directly
(continuous league). Known modern slot turnover stays in `OWNERSHIP_CHANGES`
(only `0013` Delirium Tremens → Muck Juggling Micks, since 2020).

**2. Division structure changed: 6 divisions (2004–2012) → 4 (2013+).**
2004–2012 had North/Central/South (AL) + East/West/Pacific (NL); 2013 dropped
to North/South + East/West. So **map divisions by NAME, not id**
(`DIVISION_NAME_SLUG`) — ids renumbered across eras. AL Central / NL Pacific are
their own badges/slugs but only ever appear when won (no locked placeholder).
2003 exists in MFL but recorded zero division play (`divw/divl/pf` all 0) — not
derivable; `FIRST_YEAR = 2004`.

**3. AFL Champion ⇒ conference champion that year.** Winning the title means you
won your conference, so every `afl-championship` winner also gets `al-champion`
or `nl-champion`. Brackets capture this 2018+; for earlier years a post-process
in `main()` infers the conference from the division the champ played in that
year, else the opposite of the other recorded conference champ.

**4. Manual data must survive auto re-runs.** The merge in `main()` keeps any
slug whose `source` starts with `manual:` and only refreshes auto-derived
slugs. This protects the hand-curated League Awards table (AFL Cup, tier
champions, pre-2016 League Champions) from being clobbered by a bracket/standings
re-derive. The script is the reproducible source of truth — a clean run
regenerates identical credited data (verified: 137 credited awards unchanged).

**5. MFL rate-limits hard (429) on bursts.** `fetchExport` sleeps 1400ms between
calls; a full 2004→present run still trips a few 429s. The merge makes this
safe (failed years keep prior values), but for a guaranteed-clean run, space it
out or re-run the failed years with `--year`.

**6. Editable-year badges: inline the SVG, stamp per instance.** Badge art
(`public/assets/afl/awards/*.svg`) carries an editable year — circular
"medallion" badges on a `<textPath href="#yearArc">★ YYYY ★</textPath>`,
shield badges as a flat `<text>★ YYYY ★</text>`. An `<img src>` can't be edited
per win, so the page loads SVGs raw (`import.meta.glob('…/*.svg', {query:'?raw'})`)
and `renderBadge(badge, year, uid)` (a) makes the `#yearArc` id unique per
instance (avoid duplicate-id collisions when several medallions share a page),
and (b) replaces the year. **Match the year by content (the `★…\d{4}…★`
pattern), not a fixed `y=` coordinate** — successive art revisions moved the
shield year from `y=266` to `y=270`.

**7. Trophy ROOM, not wall: 4 tiers + locked placeholders.** `AWARD_TIERS`
groups the 13 award types into Championships / Conference Titles / Division
Titles / Consolation Titles (labels are display-only; keys are `gold`,
`conference`, `division`, `silver`). `getFranchiseTrophyCase` expands every win
into its own year-stamped item (dated awards). `getFranchiseTrophyRoom(id,
{divisionSlug, conferenceSlug})` adds greyed-out locked placeholders for the
ACTIVE awards a franchise hasn't won — the universal majors (AFL Championship,
Premier League, D-League, NIT) plus the team's OWN current division + conference
title. Retired types (AFL Cup, AL Central, NL Pacific) never get a locked
placeholder. Locked badges render the SVG with the year blanked + grayscale at
~12% opacity, with a "No <thing>" overlay (`lockedLabel()`), and double as the
`aria-label`.

**8. Page is one lockup, badges are bare.** The header is a single
`.franchise-lockup` (banner anchors; pill + division + actions in one attached
bar; the `<h1>` team name is visually-hidden when a banner exists since the
banner art carries the name). Trophy badges render with no card chrome at 200px
(4-across desktop); the small team icon sits left of each tier heading.

---

## 2026-06-25 - Tier champions are now AUTO-DERIVED (manual gap closed)

**Context:** The tier (Premier League / D-League) movement system landed —
a per-season tier source of truth plus a season-end compute/roll-forward
pipeline. With it, tier champions no longer need hand-entry.

**What changed (supersedes data gotcha #4 above):** Tier membership now lives
in `data/afl-fantasy/tier-history.json` (keyed by year → franchiseId → tier) —
the single source of truth, since MFL still serves no tier markers.
`scripts/compute-afl-tier-movement.mjs` (+ pure logic in
`scripts/lib/afl-tier-standings.mjs`) ranks each tier's cutoff-week all-play
(`afl.config.json#tierCompetition.cutoffWeek`), names the two champions, applies
the constitution promotion/relegation rule (bottom-2 PL relegated, top-2 DL
promoted, plus the 4-team swing playoff PL 9/10 vs DL 3/4 decided by all-play),
and writes next season's makeup back into the same file.

`compute-afl-awards.mjs` now reads `tier-history.json` for the
`premier-league` / `dleague-champion` slugs (`source: "tier-history"`) instead
of preserving hand-entered rows. Verified the auto-derived champions match the
previously hand-entered values exactly (2025 Premier 0015 / D-League 0017; 2024
0002 / 0008; 2023 0002 / 0014; 2022 0002 / 0017; 2021 0002 / 0008; 2020 0020 /
0015). The 2025 champions are *computed* from weekly scores; 2020-2024 are the
recorded values carried in tier-history (membership for those years was never
captured and isn't recoverable from MFL, so only their champions are stored).

**Offline vs online:** `--offline` only refreshes 2024-2025 tier rows (the
genuine-local years); a `--online` run fetches the genuine-AFL feeds for
2020-2023 and flips those tier rows to `source: "tier-history"` too. Pre-2024
local feeds are still contaminated (gotcha #1), so the genuine-AFL validation
guards both scripts.

**Note for whoever merges this with the trophy-wall branch:** the tier pipeline
shipped on a separate branch; `compute-afl-awards.mjs` and `awards-history.json`
are the integration point and reconcile additively.

---

## 2026-06-26 - All-play is computed ONCE; the live page reads per-year tiers

**Context:** Wired the tier pipeline into the live standings page and removed a
duplicated all-play calc. Three things a future session must not undo.

**1. There is ONE all-play accumulator: `src/utils/all-play.mjs#accumulateAllPlay`.**
Both the live standings page (via `src/utils/standings.ts#calculateAllPlayFromWeekly`,
now a thin typed wrapper) and the node tier scripts
(`scripts/lib/afl-tier-standings.mjs#computeAllPlayThroughCutoff`) import it. Do
NOT reimplement the week-by-week all-play loop anywhere — import this. It lives
in a `.mjs` (not `.ts`) on purpose: a plain-`node` cron script can import a
`src/**/*.mjs` directly (same pattern `scripts/schefter-scan.mjs` uses for
`src/config/leagues-data.mjs`), while Vite/Astro bundles it for the page — one
file, no `tsx` in the cron path. The record now carries `pf` (total points, the
constitution promotion/relegation tiebreak); the page ignores it.

**2. The standings page groups by PER-YEAR tier membership, not static config.**
`getTierAllPlayStandings(franchises, config, calculatedAllPlay, tierMembership?)`
takes an optional `{ franchiseId: tier }` override. `standings.astro` passes
`getTierMembership(selectedYear)` (from `src/utils/afl-tier.ts`, reading
`tier-history.json`), falling back to `config.tier` when a year isn't recorded.
Why it matters: `afl.config.json#teams[].tier` is the CURRENT makeup only — it
verifies the latest completed season but is wrong for every prior year (and for
next year after roll-forward). Never rank historical tiers off `config.tier`.

**3. Week-17 all-play is intentionally uneven — rank by pct, and it's robust.**
2025 week 17 has scores for only 18 of 24 teams, so all-play *games* per team
range 368–385 (not equal). Ranking is by all-play **pct** (a rate stat), so the
unevenness doesn't distort order, and cutoff 16 vs 17 produce the *identical*
promotion/relegation outcome. Don't "fix" this by forcing equal games or moving
the `tierCompetition.cutoffWeek` — the live page uses the same inclusive cutoff,
so script and page stay in lockstep.

---

## 2026-06-27 - Title-type progress bar, the stamper comment-trap, and the two golds

Added a compact "how many of the title TYPES have you won" progress bar to the
franchise lockup, plus a brand-gold cleanup. Non-obvious bits:

**1. Six TITLE TYPES ≠ 13 award slugs.** `getFranchiseTitleProgress(id)` collapses
the award taxonomy into six *types* (`TITLE_TYPES` in `afl-awards.ts`): AFL,
Premier, **Conference** (al-champion OR nl-champion), **Division** (any of the 6
division slugs), D-League, NIT. Conference/Division map to multiple slugs because
teams realign over the years — "won a division title" means *any* division, not
the current one. `afl-cup` is deliberately NOT a type (retired). Returns `wonCount`
(0–6, distinct types won) + per-type `years[]`. `getFranchiseGrandSlam` now
*derives* from this (`completed ⇔ wonCount === 6`) so the badge phase and the bar
can never disagree — don't reimplement the "won everything" check separately.

**2. The progress strip lives INSIDE the lockup, forced full-width with
`flex-basis:100%`.** `.lockup-trophies` is the 3rd child of the flex
`.franchise-lockup__bar` (after meta + actions); `flex-basis:100%` wraps it onto
its own row directly under the identity line. Pips are `.title-pips__pip`
(`data-won` toggles fill); inline separators use `__count::before { content:'·' }`
scoped to the count only — a generic `* + *::before` middot orphans a stray dot at
the start of a wrapped line on mobile.

**3. `stampBadgeYear` targets the FIRST `<textPath>` — multi-arc badges require
ordering.** For badges with multiple arcs (e.g., year + label), the year arc MUST
be first in document order, or the stamper will overwrite the wrong one. The
regex `(<textPath\b[^>]*>)[\s\S]*?(</textPath>)` is greedy and will match the
first occurrence. **Never write the literal tag name `<textPath>` in a comment
inside a stampable SVG** — the regex will match the comment first and clobber the
real arc's attributes. Tests lock both constraints (`tests/afl-badge.test.ts`
covers multi-arc ordering). The per-award drift-guard test iterates
`public/assets/afl/awards/*.svg` to ensure all badges are stampable.

**4. There are TWO AFL golds and `--afl-gold` is NOT the badge gold.**
`--afl-gold` (#d97706) is an orange-amber (same value as `--color-warning-dark`).
The actual metallic gold on the award SVGs is **#c9a44c** (+#e6c976 highlight).
Added `--afl-trophy-gold` / `--afl-trophy-gold-light` tokens for the real
badge gold and moved the trophy-wall accents (pips, tier-title left borders) +
the championship hero onto them. Gotcha: `AflChampionshipHero.astro` *locally
redefines* `--afl-gold` inside `.afl-champ-hero`, shadowing the global token —
change the local override, not just the token. Caveat: #c9a44c as small text on a
white background is low-contrast (the hero kicker/VS sit on white); it reads fine
as fills/borders and on the navy badges, but watch contrast for gold *text* on
light.

**5. Dev/HMR trap: editing scoped `.astro` `<style>` across an open tab desyncs
the `data-astro-cid` hash → the page renders UNSTYLED** (classes present, no rules
match). A fresh SSR load is consistent; a hard reload (Cmd+Shift+R) fixes it.
Verify "is the CSS actually broken" by curling the SSR HTML and confirming the
markup's `data-astro-cid-XXX` matches the `<style>` rule's selector hash before
chasing a phantom bug.

**6. Previewing phase-gated heroes: `?testDate`.** The championship hero only
renders during AFL Week 16 (championship-week event start → +7 days =
`isInChampionshipPhase`). That date = Labor Day + 3 (Thu kickoff) + 15 weeks. For
2025 that's **2025-12-18 .. 2025-12-24**, so `?testDate=2025-12-20` on
`/afl-fantasy` forces the championship hero. Standings feeds exist for every year
back to 2007, so any past season works.
