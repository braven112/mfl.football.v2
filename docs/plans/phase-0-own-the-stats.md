# Phase 0 — Own the NFL facts

**Status:** SPEC. The central claim is already PROVEN — see Proof below.
**Parent:** `docs/plans/mfl-replacement-feasibility.md`
**Branch:** `claude/mfl-stats-provider-replacement-n6q2v1`
**Written:** Sept 2026.

Phase 0 gives us raw NFL production and a scoring engine that reproduces MFL
exactly. It changes nothing owner-facing and needs no owner vote. It is worth
doing whether or not MFL is ever replaced.

---

## Proof — this already works

`scripts/prototypes/scoring-reconcile.mjs` scores every player-week from free
NFLverse data under each league's own rules and diffs the result against MFL's
`playerScores-by-week` feed.

```
$ node scripts/prototypes/scoring-reconcile.mjs
The League 2026 — NFLverse vs MFL
  Week  1:  392/392 exact (100.00%)
  Week  2:   24/24  exact (100.00%)
  TOTAL: 416/416 exact (100.00%)

$ node scripts/prototypes/scoring-reconcile.mjs --league afl-fantasy
  TOTAL: 416/416 exact (100.00%)
```

**Both leagues, every player, to the cent, from $0 of data.** The first naive
run was 99.2%; the remaining gap was four discovered rules, below.

### Four rules reconciliation found that no rules doc states

1. **`fumbles_lost_total`, not the component columns.** MFL charges −2 for a
   fumble lost on a RETURN, where `rushing_/receiving_/sack_fumbles_lost` are
   all zero. Cost: 2 players in one week.
2. **Return yardage is NETTED across punt + kickoff** before scoring.
3. **…then clamped at zero.** A −5 yard punt return scores 0, not −0.15.
   Clamping each return type separately is wrong and was a 0.15 miss on a
   player with −5 punt and +62 kickoff.
4. **The AFL does not score return yards at all** — and
   `docs/claude/afl-rules.md` said it did. **RESOLVED: the doc was wrong.**
   Only TheLeague uses return yards (owner's ruling, Sept 2026), and MFL's
   `TYPE=rules` export confirms it independently.

Finding the doc drift before shipping anything is the entire argument for this
phase.

---

## Stop transcribing rules. Fetch them.

Chasing finding #4 to its source turned up the real lesson. MFL publishes the
live scoring config at `export?TYPE=rules&L=<id>&JSON=1` — free, unauthenticated,
36 rules for TheLeague and 66 for the AFL. Every behaviour reverse-engineered
above is stated in it explicitly:

| Discovered empirically | What the rules export says |
|---|---|
| Return yards netted across punt + kickoff | the event is literally **`UY+KY`** — one summed event, not two |
| …then clamped at zero | its **`range` is `1-999`** — a net of 0 or less is outside the scoring range |
| AFL scores no return yards | the AFL has **no `UY`/`KY` event at all** |

**Both rules docs were also materially wrong about team defense**, which no
amount of reading them would have revealed:

- `league-rules.md` said "Points Allowed 0-35 = **15**". Two rules stack over
  that range — `OPA 15 range 0-35` **and** `OPA *-.6 range 1-35` — so it is a
  slide: shutout 15, PA 20 → 3.00, PA 35 → −6.00. Verified exact to the cent
  against MFL's own scores on 14 team-weeks spanning PA 10→59.
- `afl-rules.md` said six tiers. The AFL actually runs a **per-point scale of
  36 rules**, 0→15 down to 35→−6. Its table understated a shutout by 5 points.

**So work item #6 changes.** Do not hand-transcribe scoring rules into the
registry. Fetch `TYPE=rules`, store it per league-year alongside the other
feeds, and generate the scorer's config from it. A rule set that drifts from
MFL then shows up as a reconciliation failure the same week, instead of living
undetected in a markdown table for years — which is what just happened twice.

### The crosswalk is a solved problem

Phase 0's stated hardest piece — mapping MFL ids to a stat provider's — is
already published. DynastyProcess's `db_playerids.csv` carries **`mfl_id` as
its first column**, alongside `gsis_id`, `espn_id`, `sleeper_id`, `pfr_id` and
15 others. Measured against live rosters:

| | TheLeague | AFL |
|---|---|---|
| Rostered players | 399 | 228 |
| In crosswalk | **100%** | **100%** |
| With `gsis_id` (the NFLverse join key) | 92.0% | 93.0% |
| Real players missing a `gsis_id` | **0** | **0** |

Every miss is a team defense, which joins on team code and has no player id by
definition. **The crosswalk is effectively 100%.** This removes the risk I
flagged as Phase 0's worst, and it is why the estimate below is 2–3 weeks
rather than 3–5.

---

## Sources

| Source | URL | Use |
|---|---|---|
| NFLverse player-week stats | `nflverse-data/releases/download/stats_player/stats_player_week_<yr>.csv` | 150 cols; every offensive scoring input |
| NFLverse team-week stats | `.../stats_team/stats_team_week_<yr>.csv` | 138 cols; every DST input |
| NFLverse play-by-play | `.../pbp/play_by_play_<yr>.csv.gz` | ~19 MB/season; only if a rule needs play detail |
| NFLverse players | `.../players/players.csv` | identity, birth dates, draft |
| DynastyProcess ids | `dynastyprocess/data/master/files/db_playerids.csv` | the MFL crosswalk |

All free, all public, all back to 1999. No provider contract in Phase 0.

### Coverage check against both rule sets

Every category in both constitutions has a column. Confirmed present:

- **Offense** — `passing_yards/tds/interceptions/2pt`, `rushing_*`,
  `receiving_*`, `receptions`, `fumbles_lost_total`
- **Kicking** — `pat_made`, and **`fg_made_list`**, which gives the exact
  distance of each made FG (`'51;43'`), satisfying the FG 31+ = 0.1/yd rule
  without touching play-by-play
- **Returns** — `punt_return_yards`, `kickoff_return_yards`
- **DST** — `def_sacks`, `def_interceptions`, `def_fumbles`, `def_safeties`,
  `def_punt_blocks`, `def_pat_blocks`, `def_fg_blocks`, `def_tds`,
  `def_2pt_made`. Points allowed comes from the game score.

**No gaps in coverage — but DST does not reconcile yet: 17/34 team-weeks.**

This is the one open technical problem in Phase 0, and it is narrower than the
number suggests. The points-allowed function is **correct** — implied OPA
matches to the cent on every team-week where it matches at all, across PA 10 to
59 and both branches of the rule. Every failure is a **positive residual**
(+2.00, +4.00, +6.20, +18.20): MFL counts defensive events that NFLverse's
`stats_team_week` does not attribute the same way, mostly fumble recoveries and
interceptions.

Two candidate causes, both cheap to test and neither yet confirmed:
1. `def_fumbles` counts recoveries differently than MFL's `FC` event — the
   per-play `fumble_recovery_opp` columns may be the right input instead.
2. MFL's points-allowed may **exclude points scored against the defense by the
   opponent's offense-independent units** (a pick-six or return TD), which
   would shift PA itself rather than the events. The +18.20 outlier fits this.

Resolve with play-by-play, which carries the attribution the team-week
aggregate loses. Budget half a week. Player-level scoring is unaffected and
remains 416/416.

---

## Two traps, both already hit

1. **Do not reuse `parseCSV` from `scripts/lib/snap-counts.mjs`.** It splits on
   bare commas. This feed quotes `headshot_url`, whose value contains
   `f_auto,q_auto` — measured, that shifts **every column after it by one** and
   fails silently, so every number downstream would be its neighbour. The
   prototype ships an RFC4180 parser; that is the one to extract.
2. **`fg_made_list` is SEMICOLON separated**, not comma. Splitting on comma
   yields one FG and silently drops the rest.

Third, inherited: **`NA` is the literal null** in both NFLverse and
DynastyProcess. `Number('NA')` is `NaN`, and a `NaN` propagates through a score
to make the whole week `NaN`.

---

## Schema

Neon Postgres. Five tables; everything else derives.

```sql
-- Identity. MFL id stays canonical (see feasibility doc, open question 3).
CREATE TABLE player_ids (
  mfl_id      text PRIMARY KEY,
  gsis_id     text UNIQUE,
  espn_id     text,
  pfr_id      text,
  sleeper_id  text,
  full_name   text NOT NULL,
  position    text,
  refreshed_at timestamptz NOT NULL
);
CREATE INDEX ON player_ids (gsis_id);

-- Raw NFL production. Provider-neutral; one row per player per game-week.
CREATE TABLE player_week_stats (
  gsis_id     text NOT NULL,
  season      smallint NOT NULL,
  week        smallint NOT NULL,
  season_type text NOT NULL DEFAULT 'REG',
  nfl_team    text,
  opponent    text,
  stats       jsonb NOT NULL,      -- the 150 columns, verbatim
  source      text NOT NULL,       -- 'nflverse' | provider name
  ingested_at timestamptz NOT NULL,
  PRIMARY KEY (gsis_id, season, week, season_type)
);

CREATE TABLE team_week_stats (
  nfl_team    text NOT NULL,
  season      smallint NOT NULL,
  week        smallint NOT NULL,
  season_type text NOT NULL DEFAULT 'REG',
  points_allowed smallint,
  stats       jsonb NOT NULL,
  source      text NOT NULL,
  ingested_at timestamptz NOT NULL,
  PRIMARY KEY (nfl_team, season, week, season_type)
);

-- Scored output. One row per player per week PER LEAGUE — the same stat line
-- scores differently in each, which is the whole point.
CREATE TABLE player_week_scores (
  league_slug text NOT NULL,
  mfl_id      text NOT NULL,
  season      smallint NOT NULL,
  week        smallint NOT NULL,
  points      numeric(7,2) NOT NULL,
  breakdown   jsonb NOT NULL,      -- per-category, so a dispute is answerable
  rules_version text NOT NULL,     -- which config produced this
  scored_at   timestamptz NOT NULL,
  PRIMARY KEY (league_slug, mfl_id, season, week)
);

-- The audit trail. Never deleted; this is the evidence for Phase 1.
CREATE TABLE score_reconciliation (
  league_slug text NOT NULL,
  mfl_id      text NOT NULL,
  season      smallint NOT NULL,
  week        smallint NOT NULL,
  our_points  numeric(7,2) NOT NULL,
  mfl_points  numeric(7,2),
  diff        numeric(7,2) GENERATED ALWAYS AS (our_points - mfl_points) STORED,
  checked_at  timestamptz NOT NULL,
  PRIMARY KEY (league_slug, mfl_id, season, week, checked_at)
);
```

`stats jsonb` rather than 150 typed columns is deliberate: NFLverse adds
columns between seasons, and a provider swap in Phase 3 should not be a
migration. The scorer reads named keys; unknown keys ride along free.

**Storage:** ~1.4 M player-weeks and ~1.1 M plays across 1999–2026, but Phase 0
needs no play-by-play. Player + team week stats for 28 seasons land well under
2 GB — roughly **$0.70/month** at Neon's $0.35/GB-month, plus scale-to-zero
compute.

---

## Work breakdown — 2–3 weeks

| # | Deliverable | Notes |
|---|---|---|
| 1 | Neon project, schema, `src/utils/pg-client.ts` | Mirror `redis-client.ts`: lazy dynamic import, memoized, degrade to null rather than crash |
| 2 | `scripts/lib/nflverse-csv.mjs` | RFC4180 parser + `NA` handling, extracted from the prototype. Fixture-tested on a quoted-field row |
| 3 | `scripts/fetch-player-ids.mjs` | Crosswalk → `player_ids`. Daily cron. Guard: 100% of rostered players resolve, matching `espn-athlete-id-coverage.test.ts` |
| 4 | `scripts/fetch-nfl-stats.mjs` | Player + team week stats → Postgres. `--season` for backfill |
| 5 | **`scripts/lib/scoring-engine.mjs`** | Pure, config-driven, both rule sets. Fixture-tested. The prototype is the reference implementation |
| 6 | Scoring rules into the registry | `src/config/leagues-data.mjs` per CLAUDE.md. NOT a constant in the engine — two leagues already disagree |
| 7 | `scripts/backfill-scores.mjs` | Score 1999→2026 for both leagues. **The prize: 44 league-seasons of player-level scoring that has never existed** |
| 8 | `scripts/reconcile-scores.mjs` | Prototype, productionized. Writes `score_reconciliation`. Exits non-zero below threshold |
| 9 | Tuesday cron | After MNF finalizes. Reuses `isSeasonWindowOpen`; follows `/new-cron` |
| 10 | Admin page at `/admin/scoring-reconciliation` | Exact-match rate by week, worst diffs, drill-through to `breakdown`. Needs a `page-directory.json` entry, `visibility: admin`, 10+ tags |

**Not in Phase 0:** no owner-facing surface, no live/Sunday data, no provider
contract, no change to how anything is scored today. Those are Phase 1+.

---

## What Vercel provides (and what it does not)

Checked Sept 2026 against the live project (`prj_Ab677jUnJXlKpHmVLaAYeJIbdG9E`,
team "Brandon's projects"). Three of these change decisions above.

### Use it

- **Neon through the Vercel Marketplace** — `vercel install neon`. There is no
  separate "Vercel Postgres" product any more; it folded into this integration,
  so the marketplace route IS the Neon route and the pricing math in the
  feasibility doc is unchanged. What it adds over signing up with Neon
  directly: one invoice, and **connection env vars injected automatically into
  production, preview and development**. That last part matters more here than
  it looks — `CLAUDE.md` already documents that `.env`/`.env.local` are
  untracked and **worktrees start without them**, which is a standing source of
  local breakage. A marketplace-provisioned database does not have that failure
  mode. Provision with `--plan free` first; the Phase 0 dataset outgrows it.
- **Vercel Blob for raw provider snapshots.** Already in use here
  (`@vercel/blob` 2.2.0, public store, `blobDomain` in the league config).
  NFLverse CSVs are immutable, chunky and read rarely — a per-season snapshot
  in Blob is a cheaper provenance archive than Postgres rows, and it makes
  "re-score 2019 from exactly the bytes we ingested" possible. **Postgres holds
  what you query; Blob holds what you keep.**
- **A 4th Vercel cron for the Tuesday ingest** — *not* a GitHub `schedule:`.
  `vercel.json` already carries three at `*/5`, which is only possible on Pro
  (Hobby caps at 2/day), so there is headroom. This overrides work item #9's
  default: `CLAUDE.md` § "GitHub's `schedule` is not a cadence" records that
  GitHub **drops this repo's scheduled events in bulk** — a five-minute cron
  delivered 5–8 runs a day, not 288 — which is exactly why the Vercel cron is
  the only real trigger and bridges the three workflows. A weekly stat ingest
  that silently does not fire is the worst possible failure for Phase 1's
  evidence, so it goes where the trigger is reliable.

### The Phase 2 payoff is a Vercel feature

Reading league state from Neon at request time with ISR/revalidation, instead
of baking it into the bundle, is what actually retires the
sync-commit-is-a-production-build cycle — **91% of the Vercel bill**
($22.36 of $24.70). The database is not an added cost so much as a swap of a
build-CPU cost for a storage cost roughly an order of magnitude smaller.

### Do not use it for

- **The 28-season backfill.** It will not fit a serverless function's duration
  budget. Run it from GitHub Actions or locally, writing to Neon directly.
  Only the weekly incremental ingest belongs in a function.
- **Edge Config** — real (sub-ms reads at the edge) but marginal here. A
  current-week pointer or `rules_version` would fit; nothing in Phase 0 needs it.

### Caveat

Marketplace billing puts Neon on the Vercel invoice. Convenient, but it hides a
new line item inside the one that is already 91% build CPU. Watch the split
after Phase 2 lands, or the saving it is supposed to produce will be
unmeasurable.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| NFLverse changes a column name between seasons | Medium | `jsonb` absorbs additions; the scorer reads named keys and a reconciliation drop surfaces a rename within a week |
| NFLverse is a volunteer project and could lapse | Medium | The schema is provider-neutral (`source` column). A paid provider drops in without migration — that is Phase 3's purchase anyway |
| Stat corrections land Tue–Wed | Low in Phase 0 | Nothing is owner-facing. Re-score on every ingest; `scored_at` records which pass produced a number |
| 2000s-era data is thinner | Low | Backfill is a bonus, not a dependency. Reconciliation is only possible for 2026 regardless — MFL never gave us the rest |
| Scope creep into Phase 1 | **High** | The admin page is the boundary. If a number is shown to an owner, that is Phase 1 and needs a season of validation first |

---

## Open questions

1. ~~The AFL return-yards discrepancy needs a ruling.~~ **RESOLVED Sept 2026:
   the AFL does not use return yardage; only TheLeague does. The rules doc was
   wrong and has been corrected.** No league-governance issue, no misconfigured
   league, nothing owed to any owner.
2. Backfill to 1999, or only to each league's first season (2007 / 2003)?
   Marginal cost either way; 1999 gives pre-league player careers.
3. Neon or Supabase? Neon assumed here — cheaper storage, scale-to-zero. Supabase
   wins only if its auth is wanted later, which is a Phase 3 concern.
