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
