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

---

## 2026-07-03 - Historical tier membership RECOVERED (supersedes "not recoverable")

**Context:** Brandon's screenshot of MFL's official 2021 all-play page revealed
our per-year tier tables were wrong for 2020-2024 (the page was falling back to
current `afl.config.json` tiers — five 2021 D-League teams rendered in Premier).

**The discovery:** MFL serves no tier markers, but the league's custom skin
does — per-year grouping scripts at
`https://mfl.football/afl-fantasy.com/assets/js/premierleague-<year>.js`
hardcode `premierteams` / `dleagueteams` as `#franchiseicon_00XX` selector
lists. Scripts exist for **2020-2024 only** (2016-2019 return 406), which also
confirms the tier competition began in 2020. Note: `mfl.football` 406s plain
curl — send a browser `User-Agent` (+ `Referer`) to fetch.

All five years were extracted and recorded into
`data/afl-fantasy/tier-history.json` `seasons[year].membership`
(`membershipSource` cites the script). The standings page's
`getTierMembership(year)` picks them up automatically — verified the rendered
2021 tables now match MFL's official page team-for-team.

**Identity-dating caveat (from Brandon):** owners sometimes renamed in MFL
*early* — after the NFL season but before MFL's season rollover — and/or
swapped banners early while keeping the old name. Per-year
`mfl-feeds/<year>/league.json` names can therefore be off-by-one on identity
around season boundaries. `afl.config.json` history entries (Brandon-confirmed
yearStart/yearEnd) are authoritative over raw feed names.

---

## 2026-07-03 - CORRECTION: js scripts exist 2018-2025 (not "2020-2024"), tier competition began 2017 (not 2020)

**Context:** The entry above ("Historical tier membership RECOVERED") was
written from a partial probe that only checked 2020-2024 and concluded the
competition began then. A follow-up session re-fetched every year 2015-2025
directly (`mfl.football/afl-fantasy.com/assets/js/premierleague-<year>.js`
with a browser User-Agent) and found scripts for **2018-2025**, 404 for 2017
and earlier. Brandon confirmed from memory: the competition began in **2017**
(the year after the last AFL Cup, whose bracket structure ran through 2017 on
MFL but last awarded a champion in 2016) as ONE combined 24-team all-play
table with no Premier/D-League branding; the 2018+ split is what the js
scripts capture. **2017 has no script because a single table needs no
grouping** — its absence is not evidence of "no competition."

**2017/2018/2019 recovered and verified:** 2018 and 2019 membership came from
the (previously un-fetched) js files. Verification technique worth reusing:
rank that season's all-play records (from `weekly-results.json`, cutoff-gated)
*within* the recovered tiers and confirm it reproduces the independently
hand-entered champions in `awards-history.json`. Both years reproduced exactly
(2018: Premier Thundering Herd/D-League Team Minty Fresh; 2019: Premier
Smokane FC/D-League Drunk Indians). For 2017 (no script, no split), the same
technique the other direction confirmed Brandon's memory: ranking the full
24-team 2017 table and taking the top 12 is an EXACT set-match for the 2018
Premier League roster — proving 2017 really was one table whose finish order
seeded the first split. The site brands this season **"AFL Cup"** — the
league's own name for it that year — with a promotion-line + green arrows on
the top 12, but zero Premier League logo/styling since no such tier existed
yet.

**A stale hand-entry surfaced and got corrected:** `awards-history.json` had
carried `premier-league`/`dleague-champion` awards for 2017 (Smokane FC /
Titsburgh Feelers, `manual:league-awards`) from before this was understood —
neither reproduces from the actual 2017 combined-table ranking (Smokane FC
finished 2nd, not 1st; there's no real "D-League champion" for a season with
no D-League). Removed both entries once confirmed. **Lesson: a `manual:*`
source tag means "hand-entered," not "verified" — cross-check hand-entries
against computable ground truth when the surrounding picture changes.**

**…and the cross-check itself was gated on the wrong week (2026-08-17).**
"Smokane FC finished 2nd, not 1st" above was computed through week 17. The
2017 competition ended at **week 16**,
and through week 16 Smokane FC finishes **1st** (259-109 to Fullybaked's
258-110). So the hand-entry had the right franchise under the wrong award
name: 2017's gold is the **AFL Cup** — the Cup's last season, run as an
all-play table instead of a knockout — not a Premier League title. Two things
generalize:

- **A cutoff week is a per-season fact, not a constant AND not a formula.**
  It resolves per season now
  (`afl.config.json#tierCompetition.cutoffWeekByYear` →
  `resolveTierCutoffWeek` in `src/utils/all-play.mjs`). One week either side
  of the finish line silently crowns a different champion, and the table looks
  entirely plausible either way. The first draft of this fix explained 2017's
  week 16 as "the week of that season's title game" — a tidy rule, stated in
  five files, and **wrong**: bracket 1 also resolves in week 16 in 2018, 2019
  and 2020, yet those seasons ran their all-play through 17, and recomputing
  2020 at 16 flips its recorded D-League champion from 0015 to 0013. Because
  `compute-afl-tier-movement.mjs` writes champions back, a future session
  "completing" the pattern would have committed that flip. Record the year;
  don't derive it. `tests/afl-tier-movement.test.ts` pins 2020 as the
  counterexample so the tempting generalization fails loudly.
- **A verification that reproduces a SET can pass while the ORDER is wrong.**
  The top-12 set-match held at both week 16 and week 17 — it proved 2017 was
  one table, and was never evidence about who won it. Pin the thing you
  actually care about (`tests/afl-tier-movement.test.ts` now pins both the
  cutoff and the #1).

**Confirmed out-of-band: the commissioner checked the season's payout
records, and the 2017 Cup money went to Smokane FC.** Worth noting how that
arrived — the correction started from a recollection that Thundering Herd won
it, which turned out to be the AFL Championship they took in that same week-16
final. Neither the recollection nor the computed table settled it alone; the
payouts did. **Money moved is the strongest evidence a fantasy league
produces** — it is contemporaneous, it required someone to act on the result
at the time, and unlike a bracket title or a standings row it cannot be
retroactively reinterpreted by us. When a historical award is contested and
the feed math is close (this one was one all-play win out of 368), ask what
was paid before deciding what was computed.

**The name was ours, not the league's.** "Founders Table" was invented during
this work to describe 2017 and shipped as the season's heading and in a What's
New entry. The league called it the AFL Cup. Naming a historical thing we only
partly understood made the misunderstanding harder to see — it read as a
deliberate distinction from the Cup rather than as a gap.

**2025 was also wrong:** tier-history's 2025 membership had been seeded from
an `afl.config.json` snapshot, not the js file. `premierleague-2025.js` has
0024 (No Soup For You) in Premier League and 0012 (Suh girls, one cup) in
D-League — the opposite of what was recorded. Corrected, and 2026's
roll-forward (`compute-afl-tier-movement.mjs`) was re-run from the fixed base
so 2026 membership + `afl.config.json` team tiers stayed consistent.

**Constants:** `TIER_COMPETITION_FIRST_SEASON = 2017`,
`TIER_SPLIT_FIRST_SEASON = 2018` in `src/utils/afl-tier.ts` — supersede any
earlier "2020" or "2016" assumption found elsewhere (this file's own entry
above was one such place).

---
## 2026-08-09 - Award Tiers Are the Lever for "What Counts"; Retirement Was Encoded by Omission

**Context:** Building the footer's champions band, which groups a season's
titles by team and names sweeps (Double / Treble).

**Insight:** Three things the award model already knew, and one it didn't:

1. **`tier` is the right lever for "does this count".** gold
   (Championship / Cup / Premier League) → earns a card; conference + division
   → ride along; silver (NIT, D-League) → excluded. Without excluding silver,
   real 2024 reads Drunk Indians as a Double off Premier League + NIT, which is
   a consolation bracket.
2. **The conference title is implied by the Championship.** You cannot reach the
   title game without winning your conference, so a card carrying
   `afl-championship` must drop `al-champion`/`nl-champion` or it double-counts
   one run — that's the difference between real 2025 rendering as a Quadruple
   and the Treble it actually is.
3. **The Cup's retirement lived only as an omission.** `ALWAYS_ACTIVE` (the
   locked-placeholder set) and `TITLE_TYPES` (progress pips) both left
   `afl-cup` out by hand. Nothing rendered it as winnable, but the reason was
   unwritten — the next list to be added would not have known. It is now
   `retired: 2016, replacedBy: 'premier-league'` on the AwardType, with
   `ACTIVE_AWARD_TYPES` / `isAwardRetired()` exposed.

**Consequence:** with the Cup gone, only two gold awards can ever coexist
(Championship + Premier League — Cup 2015-16, Premier League 2018 on, never the
same season), so **the Treble is the modern ceiling**: two gold plus a division.

**Evidence:** `src/utils/afl-awards.ts` (`retired`, `ACTIVE_AWARD_TYPES`,
`isAwardRetired`, the retired filter in `getFranchiseTrophyRoom`'s lockable
set); `src/utils/footer-champions.ts` for the grouping; `tests/afl-awards.test.ts`
and `tests/footer-champions.test.ts` pin both rules against real seasons.

**Recommendation:** Anything that offers an award as *achievable* — locked
placeholders, progress pips, admin pickers — must filter on `isAwardRetired()`,
not on a hand-maintained list. Anything rendering *history* must not: past
winners keep their badges and still count toward totals and tier ranks.

---

## 2026-08-11 - CORRECTION: division titles come from MFL's row order, and cache validation is by LEAGUE ID (supersedes gotchas 1 and 3 above)

**Context:** Commissioner review of historical division titles. Two claims in
the 2026-06-25 entry at the top of this file were wrong and actively
misleading; both are corrected here.

**CORRECTION to gotcha 3 ("pick the max per division, tie-break `divpf`, then
`pf`").** That is not the league's rule and never was. The AFL constitution
(`src/pages/afl-fantasy/docs/rules.html#standings-tiebreakers`) makes **overall
W-L-T% the primary** key; division record is only tiebreaker #2, behind
head-to-head. Sorting by `divpct` first — never mind a raw-`pf` tiebreak —
miscredited **22 division titles between 2004 and 2025**, including 2025
al-south (a 9-8 team over a 12-5 team) and 2017 nl-west (12-5 over 14-3). It
also made Smokane FC look like the all-time trophy leader; the real leader is
Drunk Indians, 19 to 17.

The rule now: **`divisionWinners()` takes the first row of each division in
MFL feed order and does not sort.** MFL's `leagueStandings` rows arrive in the
league's official final order with the constitution's tiebreakers already
applied (see the 2026-08-11 entry in `domains/mfl-api.md`). `source` changed
from `standings:divpct` to `standings:mfl-order`. `divisionPct()` survives only
as the "was this season actually played" guard.

**CORRECTION to gotcha 1 ("validate a cached `league.json` against the
canonical AFL names in `afl.config.json` (stable franchise IDs)").** Franchise
ids are *not* owner-stable pre-2016 — the AFL was recreated as a brand-new MFL
league every season, with its own id and its own franchise numbering (see
`data/afl-fantasy/year-host-map.json`). The name-majority check therefore
**rejected every 2004-2012 season as "contaminated"**, silently forcing those
years online where they 403'd, so a decade of history quietly stopped
recomputing. `isGenuineAfl(leagueJson, year)` now compares
`leagueJson.league.id` against that year's expected AFL league id from
`year-host-map.json`, falling back to the old name check only when a cache
carries no league id. With that fixed, 2004-2012 recompute from the committed
local feeds — which is where 10 of the 22 corrections came from.

**Verification pattern worth reusing.** The repo already had a
constitution-faithful tiebreaker chain built for the draft predictor
(`src/utils/afl-draft-utils.ts`, worst-first). Rather than reimplementing it,
`rankDivisionStandingsBestFirst` exposes the forward view, and
`tests/afl-division-titles.test.ts` uses it to independently re-rank every
division and assert agreement with MFL's row order — it agrees in all 100+
division-seasons. Two implementations that must agree is a much stronger guard
than one implementation nobody can check. Note `overallPct` needed a fallback
to `h2hw/h2hl/h2ht` because pre-2020 feeds carry no `div*`/`nondiv*` split.

**Gotcha for whoever changes attribution next:** the pinned ground truth in
`tests/afl-awards.test.ts` moved (leader 0002 at 19, Smokane FC 0001 at 17),
and 2023 Drunk Indians became a **Treble** in `tests/footer-champions.test.ts`
(Championship + Premier League + the al-north title they'd been denied). Those
pins are commissioner-confirmed — if one fails, investigate the data, don't
re-derive the expectation.

**Evidence:** `scripts/compute-afl-awards.mjs` (`divisionWinners`,
`isGenuineAfl`); `tests/afl-division-titles.test.ts`;
`data/afl-fantasy/awards-history.json`.

---

## 2026-08-11 - Reusing badge art for an aggregate (non-dated) context: strip, don't blank

**Context:** The AFL franchises index (`src/pages/afl-fantasy/franchises/index.astro`)
showed title-type counts (AFL, Premier, Conference, Division, D-League, NIT) with
generic emoji (🏆👑🎖️🛡🥈🎗️) — swapped them for the real branded badge art so a
glance actually tells the types apart.

**Insight 1: a card showing a lifetime count is not a "locked/unwon" placeholder,
so `stampBadgeYear(svg, '')` is the wrong tool.** That call blanks the year but
keeps the ★  ★ star frame rendering (right behavior for a locked trophy-room
slot, where "un-won" still needs to look like an empty version of the same
badge). An aggregate count icon needs the whole year element gone, stars
included — added `stripBadgeYear(svg)` in `afl-badge.ts` as a sibling function
rather than overloading `stampBadgeYear`'s year param with a third meaning.
Verified via a drift-guard test (mirroring the existing stamp one) that it
actually removes `★` from every shipped badge in `public/assets/afl/awards/`.

**Insight 2: Premier League and D-League's OWN championship banners are the
wrong art for a compact icon — they're layout-identical to the AFL medallion.**
`premier-league.svg` / `dleague-champion.svg` are the same circular medallion
frame as `afl-championship.svg` (same viewBox, same gold/navy ring construction
— see gotcha 4 in the 2026-06-25 entry above about the "two AFL golds"), so at
badge-icon size they read as "another AFL trophy," not "Premier League." The
tier LOGO marks used elsewhere (`/assets/afl/premier.svg` /
`/assets/afl/dleague.svg` + `-dark` variants, via `getTierLogo`/`getTierLogoDark`
in `afl-tier-logo.ts` + `<ThemeImage>`, same pattern as the standings page promo
strip) are visually distinct from the medallion and were the better fit for
those two title types specifically. Conference/division shield art (`al-champion`,
`al-north`, etc.) doesn't have this collision — shields and medallions are
already distinct shapes — so only Premier/D-League needed the swap.

**Evidence:** `src/utils/afl-badge.ts` (`stripBadgeYear`); `tests/afl-badge.test.ts`;
`src/pages/afl-fantasy/franchises/index.astro` (`timelessBadge`, `badgeFilenameFor`).

## 2026-08-16 - Badge art at ICON size: the viewBox is mostly margin, and the filename is derivable

**Context:** The AL/NL playoff-standings card on the AFL homepage
(`AflConferencePlayoffPreview.astro`) marked its top two seeds with a `Div`
text chip; replaced it with that team's own division shield. Same "strip, don't
blank" call as the entry above, but at ~25px instead of trophy-room size, which
surfaced two things that don't come up at full size.

**Insight 1: the shield art's 260x336 viewBox is ~26% empty margin, so a CSS
height is NOT the size the badge appears.** The shield path spans y=50..300 of
336 — roughly 15% dead space above, 11% below. Set `height: 1.75rem` and the
painted shield is about 1.3rem tall. That's fine (arguably good — it self-insets
next to a team crest) but it means sizing this art by eye against a neighbouring
`<img>` misleads: at the same CSS height the shield reads distinctly smaller
than a crest, and matching them visually takes ~30% more height on the shield.
Budget for it rather than discovering it after a screenshot. Don't "fix" it by
tightening the viewBox — the margin is shared by every badge and the trophy wall
depends on the current framing.

**Insight 2: the award filename is `<conference>-<division>`, so derive it —
don't write another division→slug map.** `getConferenceShort(code).toLowerCase()
+ '-' + division.toLowerCase()` resolves all four current divisions AND the
retired pre-2013 pair (`al-central`, `nl-pacific`) with no table to maintain.
The existing `DIVISION_SLUG` map in `franchises/index.astro` is a hardcoded
4-entry version of this that structurally cannot cover the six-division
2003-2012 layouts — fine there (that page only shows current teams), but the
derived form is the one to copy into anything that touches historical seasons.
Guard the lookup and fall back to the old text chip on a miss, since a division
with no art is a real state.

**Insight 3: `namespaceBadgeIds` is still required for two DIFFERENT shields on
one page, and the reason is not the one in its doc comment.** That comment
justifies namespacing as protection against the same file inlined once per
franchise. Two different shields collide too — every shield declares
`id="sh"` for its clip path. Today it happens to be harmless in both cases for
the same reason (the clip path geometry is byte-identical across shields, so
the first-wins duplicate resolves to the right shape), but the gradients are
already per-division (`g_north` vs `g_south`), which is exactly the divergence
that would make `sh` diverge next. Namespace on inline and stop reasoning about
whether today's art happens to be uniform.

**Evidence:** `src/components/afl/hp-sections/AflConferencePlayoffPreview.astro`
(`divisionBadgeFor`, `.afl-conf__div-badge`); `public/assets/afl/awards/al-*.svg`,
`nl-*.svg`.
