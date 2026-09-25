# Free Agents — the season points column

The column that reads "2026 Pts" on both Free Agents pages and on Projected
Free Agents. It replaced "Last Yr" on 2026-09-15, and the replacement was not
cosmetic: every one of the three things behind that label was wrong.

Shared rule and parser: `src/utils/stats-season.mjs`
(`resolveStatsSeasonYear`, `parseYtdPlayerScores`).
Guard: `tests/free-agent-season-points.test.ts`.

---

## 2026-09-15 - Three bugs wearing one label

**Context:** an owner screenshot of the AFL Free Agents page, WR tab, showing a
column headed LAST YR with a dash in nearly every row.

### 1. The season was picked on the Labor Day clock

`getCurrentSeasonYear()` rolls at **Labor Day**, so from Labor Day until
kickoff it names a season with zero games played and the column empties — in
waiver week, the week owners look at that page most. The season a points column
should show turns over at the league's start day: **NFL week 1 kickoff**
(`nflWeekOneKickoff`, the gate the Pecking Order, Schefter and the release
blackout already share).

`resolveStatsSeasonYear(getCurrentSeasonYear(now), now)` is the whole rule, and
the composition matters — **it is NOT `isSeasonWindowOpen`**. That window
*closes* 20 weeks after kickoff, and from February to Labor Day we still want
the season that just finished, not the one before it. Only the opening edge
moves the answer.

### 2. `weekly-results-raw` cannot see the subject of a free-agent page

It records a score only for the weeks a player sat on somebody's roster, so the
free-agent pool is structurally invisible in it. That is the wall of dashes: the
only free agents carrying a number were ones who had been rostered and dropped.
`TYPE=playerScores&W=YTD` is the full pool — see
`domains/mfl-api.md`, 2026-08-10 (restored and verified live 2026-09-15).

### 3. The numbers that DID show were doubled

This is the one to remember, because it is invisible unless you compare two
sources. **A franchise appears in two matchups in a doubleheader week**, so
summing player scores across `weeklyResults.matchup[].franchise[].player[]`
bills the same performance twice. Measured against MFL's own YTD totals for
2026 week 1:

| | agree | exactly 2x | other |
|---|---|---|---|
| TheLeague | 0 | **260** | 0 |
| AFL | 0 | 33 | 156 |

All 260 of TheLeague's scored players, no exceptions. Khalil Shakir's 9.00
shipped as 18.0; Isaiah Likely's 27.8 shipped as 55.6 on Projected Free Agents.
The AFL's "other" bucket is its conference structure on top of the same
mechanism — a player is routinely rostered in both conferences.

**So the weekly sum is not a degraded version of the YTD feed, it is a wrong
one, and must never be a fallback for a points total.** Show nothing instead.

**But a RATE over it survives**, which is why `games`/`ppg` still read the
weekly maps: the double lands in the numerator and the denominator and cancels.
PPG was correct all along. `games` (GP) is the column that inherits the double
— pre-existing, left alone, and worth knowing before someone "fixes" PPG by
pointing it at the YTD total, which carries **no games-played field at all**
and would price a one-week rental's whole season as a single game.

### Where it lives

Three pages carry the column and all three had all three bugs:
`theleague/players.astro`, `afl-fantasy/players.astro` (via its build-time
snapshot, `scripts/compute-afl-free-agents.mjs`) and
`theleague/projected-free-agents.astro`. The AFL's runs through the builder
because that page consumes a derived snapshot, so **the resolver call for the
AFL is in the script, not the page** — a grep of `src/pages/` alone will
report it missing.

### The header names the year

`{statsSeasonYear} Pts`, not "Pts". The column's whole failure mode was a label
that did not match its contents, and a reader cannot tell a 27.8 that means
"two weeks of this season" from one that means "all of last season" without
being told which.

### Two feeds had to be seeded

`playerScores-ytd.json` is written by `fetch-mfl-feeds.mjs` for the CURRENT
league year only, so the offseason branch (which reads the prior season) has no
feed unless someone backfills it. 2025 was seeded for both leagues at the same
time as the fix. A future season needs the same one-off if the offseason view
is to work its first year.

Also: **MFL answers `W=YTD` for a season with no games with a single BLANK ROW**
(`{ id: '', score: '' }`), not an empty list. A guard that counts rows accepts
it — which is exactly how an empty placeholder sat committed in both leagues'
2026 feed for a month. Require a row with a real id and a real score.

## 2026-09-25 - PPG had the same blind spot as the old points column

TheLeague's PPG divided `weeklyResults` points by `weeklyResults` weeks. That
is the rostered-weeks rate, so almost every free agent showed a dash: the same
blind spot as §2 above, in the column beside it. It now reads
`playerScores-by-week.json` (every player, every week) for BOTH the points and
the game count. A "game" is any week with a score, zeros included, which is the
player sheet's own Per Game rule, so the column and the card cannot disagree.
Don't mix the YTD total with a week count from a different feed; that pairing is
how the old code priced a one-week rental's whole season as one game.
