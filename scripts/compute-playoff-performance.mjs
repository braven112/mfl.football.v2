#!/usr/bin/env node
/**
 * Playoff performance — does the best regular season actually win anything?
 *
 * Writes `data/theleague/derived/playoff-performance.json`: one row per
 * completed season naming the true #1 seed, the all-play leader as of the end
 * of the regular season, and the champion — plus the all-time rates that are
 * the whole point of the report.
 *
 * ── Why the #1 seed is READ OFF THE BRACKET, not derived ───────────────────
 *
 * Every obvious source for "the #1 seed" is wrong somewhere in the archive:
 *
 *   - MFL's `playoffBracket` export carries no franchise ids before 2020 and
 *     none in 2024/2026 either, so it cannot name a seed for most seasons.
 *   - `leagueStandings` row order is NOT seed order. When two teams tie on
 *     overall record the display order and the bracket disagree, and they
 *     disagree in BOTH directions: the bye went to feed row 2 in 2008 and
 *     2010, and the last championship slot went to feed row 8 over row 7 in
 *     2018, 2019 and 2024.
 *   - The constitution's tiebreaker chains don't reproduce it either. Wild Card
 *     ties break on All Play first, which is exactly right for 2018/2019/2024
 *     and exactly WRONG for 2007 and 2016 — 2016 seated the team with both the
 *     worse all-play (.412 vs .541) and the worse points. A faithful
 *     implementation of the chain lands at 17/19 fields and 18/19 byes, and no
 *     single rule gets all 19.
 *
 * The games themselves have none of these problems. `schedule.json` has every
 * playoff week fully scored for all 19 seasons, so this walks the championship
 * bracket as a single-elimination tournament and takes the #1 seed to be the
 * team that sat out the opening round and entered in the semifinals. The bye is
 * structural — it cannot be tied, and it does not depend on any tiebreaker we
 * would have to guess at.
 *
 * Two things keep the walk honest:
 *   1. A candidate field is accepted ONLY if its final matches BOTH the
 *      champion and the runner-up in championship-history.json. A walk that
 *      looks plausible and is wrong is the failure mode here.
 *   2. `assertUniqueBracket` refuses a season where more than one bracket
 *      satisfies the schedule, and a completed season whose bracket cannot be
 *      found at all is a throw rather than a skip — silently dropping it would
 *      shrink the denominator of every rate on the page without changing
 *      anything visible. Note that prebuild's runner treats a failed step as
 *      non-fatal (`run()` in scripts/prebuild.mjs swallows the exit code), so
 *      these throws surface in the build LOG, not as a failed build. The real
 *      gate is `tests/playoff-performance-data.test.ts`, which pins all 19
 *      seasons and every champion, so stale or wrong output fails CI.
 * Cross-checked against MFL's own bracket for the five seasons that DO carry
 * franchise ids (2020-2023, 2025): identical field, all five.
 *
 * ── Why all-play is aggregated from MFL's weekly scores ────────────────────
 *
 * The report wants all-play as of the end of the REGULAR SEASON. MFL's
 * `all_play_pct` is a full-season figure that includes the playoff weeks — its
 * `all_play_wlt` totals 255 = 17 weeks x 15 opponents — which is circular for
 * "did the best all-play team win the title", because the champion's own title
 * run inflates it. Passing a week parameter does not help: leagueStandings
 * returns the same 17-week figure at W=13, W=14, W=17 and with no W at all
 * (verified live against 2015 and 2025; WEEK=, THRU_WEEK= and ENDWEEK= are all
 * ignored too). MFL simply does not expose a pre-playoff snapshot here.
 *
 * So all-play is summed from MFL's own weekly scores in weekly-results.json,
 * cut at `lastRegularSeasonWeek` from that year's league.json. This is not a
 * homebrew metric: run over all 17 weeks the same aggregation reproduces MFL's
 * published all_play_pct to three decimals in 11 of 11 seasons that have one,
 * which is what licenses using it for the shorter window. `verifyAllPlay`
 * below re-runs that check on every build and throws if it ever drifts.
 *
 * TheLeague only. The AFL runs two conferences and therefore two #1 seeds, so
 * "the overall #1 seed" is a different question there and needs its own model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAGUE_SLUG = 'theleague';
const league = getLeagueBySlug(LEAGUE_SLUG);
const FEEDS = path.join(ROOT, league.dataPath, 'mfl-feeds');
const OUT = path.join(ROOT, league.dataPath, 'derived', 'playoff-performance.json');
const CHAMPS = path.join(ROOT, league.dataPath, 'championship-history.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Overall record off a leagueStandings row. TheLeague's 2022 export ships
 *  h2hw/h2hl WITHOUT the combined h2hwlt string — reading h2hwlt alone makes
 *  every 2022 team 0-0-0. Same fallback as compute-franchise-history.mjs. */
const parseRecord = (f) => {
  const parts = String(f?.h2hwlt ?? '').split('-').map(Number);
  const [w = 0, l = 0, t = 0] = parts;
  if (w || l || t) return { w, l, t };
  return { w: num(f?.h2hw), l: num(f?.h2hl), t: num(f?.h2ht) };
};
const fmtRecord = ({ w, l, t }) => `${w}-${l}${t ? `-${t}` : ''}`;

// ── Feed readers ───────────────────────────────────────────────────────────

const seasonYears = () =>
  fs
    .readdirSync(FEEDS)
    .filter((d) => /^\d{4}$/.test(d))
    .map(Number)
    .sort((a, b) => a - b);

const feed = (year, file) => {
  const p = path.join(FEEDS, String(year), file);
  return fs.existsSync(p) ? readJson(p) : null;
};

/** Scored games for one week, as {a,b,winner,loser}. Byes and unplayed weeks
 *  drop out: a matchup only counts when BOTH sides actually scored. */
const weekGames = (schedule, week) => {
  const w = arr(schedule?.schedule?.weeklySchedule ?? schedule?.weeklySchedule).find(
    (x) => Number(x.week) === week
  );
  return arr(w?.matchup)
    .map((m) => arr(m.franchise))
    .filter((f) => f.length === 2 && f[0].id !== f[1].id && f.every((x) => num(x.score) > 0))
    .map((f) => {
      const [a, b] = f;
      const aWon = num(a.score) > num(b.score);
      return {
        a: a.id,
        b: b.id,
        aScore: num(a.score),
        bScore: num(b.score),
        winner: aWon ? a.id : b.id,
        loser: aWon ? b.id : a.id,
      };
    });
};

const combinations = (items, k, start = 0) =>
  k === 0
    ? [[]]
    : items
        .slice(start)
        .flatMap((_, i) => combinations(items, k - 1, start + i + 1).map((rest) => [items[start + i], ...rest]));

// ── The bracket walk ───────────────────────────────────────────────────────

/**
 * Every field consistent with the schedule AND with the recorded final.
 *
 * TheLeague's championship bracket has been the same shape since 2007: seven
 * teams, three opening games, the #1 seed on a bye entering in the semifinals.
 * So: pick 3 opening games, take a bye that plays a first-round winner the
 * following week, require exactly 2 semifinals among the survivors, and require
 * a final between the two semifinal winners that matches the recorded champion
 * and runner-up.
 */
const solveBracket = (year, schedule, startWeek, truth) => {
  const r1Pool = weekGames(schedule, startWeek);
  const r2Pool = weekGames(schedule, startWeek + 1);
  const r3Pool = weekGames(schedule, startWeek + 2);
  const solutions = [];

  for (const r1 of combinations(r1Pool, 3)) {
    const played = new Set(r1.flatMap((g) => [g.a, g.b]));
    if (played.size !== 6) continue;
    const survivors = r1.map((g) => g.winner);

    const byeCandidates = new Set(r2Pool.flatMap((g) => [g.a, g.b]).filter((id) => !played.has(id)));
    for (const bye of byeCandidates) {
      const alive = new Set([bye, ...survivors]);
      const r2 = r2Pool.filter((g) => alive.has(g.a) && alive.has(g.b));
      if (r2.length !== 2) continue;
      if (!r2.some((g) => g.a === bye || g.b === bye)) continue;

      const finalists = r2.map((g) => g.winner);
      const final = r3Pool.find(
        (g) =>
          (g.a === finalists[0] && g.b === finalists[1]) ||
          (g.a === finalists[1] && g.b === finalists[0])
      );
      if (!final) continue;
      if (final.winner !== truth.champion || final.loser !== truth.runnerUp) continue;

      const eliminated = r2.map((g) => g.loser);
      solutions.push({
        bye,
        field: [bye, ...played],
        rounds: [r1, r2, [final]],
        champion: final.winner,
        runnerUp: final.loser,
        thirdPlaceGame:
          r3Pool.find(
            (g) =>
              (g.a === eliminated[0] && g.b === eliminated[1]) ||
              (g.a === eliminated[1] && g.b === eliminated[0])
          ) ?? null,
      });
    }
  }
  return solutions;
};

/**
 * A season we cannot pin down is a season we do not publish. Throw.
 *
 * Dedupes on the BYE as well as the field: the bye is what this report
 * publishes as the #1 seed, and two solutions can agree on which seven teams
 * played while disagreeing on which of them sat out the opening round. Checking
 * only the field would let `solutions[0]` pick the #1 seed arbitrarily.
 */
const assertUniqueBracket = (year, solutions) => {
  const shapes = new Set(
    solutions.map((s) => `${s.bye}|${s.champion}|${[...s.field].sort().join(',')}`)
  );
  if (shapes.size > 1) {
    throw new Error(
      `${year}: ${shapes.size} different championship brackets satisfy the schedule — refusing to guess`
    );
  }
};

// ── All-play, summed from MFL's own weekly scores ──────────────────────────

const allPlayThrough = (weekly, maxWeek) => {
  const acc = {};
  for (const wk of weekly?.weeks ?? []) {
    if (maxWeek != null && Number(wk.week) > maxWeek) continue;
    const scores = Object.entries(wk.scores ?? {}).filter(([, s]) => Number.isFinite(Number(s)));
    if (scores.length < 2) continue;
    for (const [id, score] of scores) {
      acc[id] ??= { w: 0, l: 0, t: 0 };
      for (const [other, otherScore] of scores) {
        if (id === other) continue;
        if (Number(score) > Number(otherScore)) acc[id].w += 1;
        else if (Number(score) < Number(otherScore)) acc[id].l += 1;
        else acc[id].t += 1;
      }
    }
  }
  const out = {};
  for (const [id, r] of Object.entries(acc)) {
    const n = r.w + r.l + r.t;
    if (n) out[id] = { wlt: `${r.w}-${r.l}-${r.t}`, pct: (r.w + r.t / 2) / n };
  }
  return out;
};

/**
 * The licence for the line above. Over ALL weeks this aggregation must
 * reproduce MFL's published all_play_pct; if it ever stops doing so, the
 * regular-season cut is no longer MFL's definition and the build should fail
 * rather than quietly publish a different statistic.
 */
const verifyAllPlay = (year, weekly, standingsRows) => {
  // Check every row that HAS the column rather than skipping the whole season
  // when one row lacks it — a partial export should still be verified on the
  // part it does carry. Seasons before 2015 carry no all-play at all and fall
  // out via the empty-deltas guard below.
  const mine = allPlayThrough(weekly, null);
  const deltas = standingsRows
    .filter((r) => r.all_play_pct !== undefined && mine[r.id])
    .map((r) => Math.abs(num(r.all_play_pct) - mine[r.id].pct));
  if (!deltas.length) return null;
  const worst = Math.max(...deltas);
  if (worst > 0.0015) {
    throw new Error(
      `${year}: all-play aggregation drifted from MFL's published all_play_pct by ${worst.toFixed(4)}`
    );
  }
  return worst;
};

// ── Build ──────────────────────────────────────────────────────────────────

const championships = readJson(CHAMPS).championships ?? [];
const seasons = [];
const skipped = [];

for (const year of seasonYears()) {
  const truth = championships.find((c) => c.year === year);
  const schedule = feed(year, 'schedule.json');
  const leagueFeed = feed(year, 'league.json')?.league;
  const weekly = feed(year, 'weekly-results.json');
  const standingsRows = arr(feed(year, 'standings.json')?.leagueStandings?.franchise);

  if (!truth || !schedule || !leagueFeed || !weekly || !standingsRows.length) {
    skipped.push({ year, reason: 'season not complete in the archive' });
    continue;
  }

  const lastRegularSeasonWeek = num(leagueFeed.lastRegularSeasonWeek);
  if (!lastRegularSeasonWeek) {
    skipped.push({ year, reason: 'league.json has no lastRegularSeasonWeek' });
    continue;
  }

  const solutions = solveBracket(year, schedule, lastRegularSeasonWeek + 1, truth);
  if (!solutions.length) {
    // A season with a recorded champion is a season that finished, so failing
    // to find its bracket is a broken input, not a season to quietly leave out
    // of the rates. Silently skipping it would shrink the denominator of every
    // headline number on the page without changing anything visible.
    throw new Error(
      `${year}: championship-history records a champion but no bracket in the schedule matches it ` +
        `— refusing to publish rates that silently exclude a completed season`
    );
  }
  assertUniqueBracket(year, solutions);
  const bracket = solutions[0];

  verifyAllPlay(year, weekly, standingsRows);
  const allPlay = allPlayThrough(weekly, lastRegularSeasonWeek);
  // Break an all-play tie the way the constitution does — total points scored
  // is the step after All Play in both tiebreaker chains — then on franchise id
  // so the result never depends on MFL's key order in weekly-results.json.
  // The margin has been a single all-play game in 2012 and again in 2025, so a
  // tie here is a live possibility, not a theoretical one.
  const pointsFor = new Map(standingsRows.map((r) => [r.id, num(r.pf)]));
  const ranked = Object.entries(allPlay).sort(
    (a, b) =>
      b[1].pct - a[1].pct ||
      (pointsFor.get(b[0]) ?? 0) - (pointsFor.get(a[0]) ?? 0) ||
      a[0].localeCompare(b[0])
  );
  if (!ranked.length) {
    skipped.push({ year, reason: 'no weekly scores to build all-play from' });
    continue;
  }
  const [allPlayLeaderId, allPlayLeader] = ranked[0];

  // Trim: MFL stores at least one franchise name with a leading space
  // (`0016` is " Running Down The Dream" in both the 2015 and 2020 feeds),
  // which renders as a visibly misaligned cell in the season table.
  const names = new Map(
    arr(leagueFeed.franchises?.franchise).map((f) => [f.id, String(f.name ?? '').trim()])
  );
  const records = new Map(standingsRows.map((r) => [r.id, fmtRecord(parseRecord(r))]));
  const team = (id) => ({
    franchiseId: id,
    name: names.get(id) ?? id,
    record: records.get(id) ?? null,
  });

  seasons.push({
    year,
    lastRegularSeasonWeek,
    topSeed: { ...team(bracket.bye), allPlayPct: allPlay[bracket.bye]?.pct ?? null },
    champion: team(bracket.champion),
    runnerUp: team(bracket.runnerUp),
    allPlayLeader: {
      ...team(allPlayLeaderId),
      allPlayWlt: allPlayLeader.wlt,
      allPlayPct: allPlayLeader.pct,
    },
    topSeedWonTitle: bracket.bye === bracket.champion,
    topSeedReachedFinal: bracket.bye === bracket.champion || bracket.bye === bracket.runnerUp,
    allPlayLeaderWonTitle: allPlayLeaderId === bracket.champion,
    allPlayLeaderReachedFinal:
      allPlayLeaderId === bracket.champion || allPlayLeaderId === bracket.runnerUp,
    topSeedIsAllPlayLeader: bracket.bye === allPlayLeaderId,
  });
}

const count = (fn) => seasons.filter(fn).length;
const payload = {
  generatedAt: new Date().toISOString(),
  league: LEAGUE_SLUG,
  yearsCovered: seasons.map((s) => s.year),
  skipped,
  totals: {
    seasons: seasons.length,
    topSeedTitles: count((s) => s.topSeedWonTitle),
    topSeedFinals: count((s) => s.topSeedReachedFinal),
    allPlayLeaderTitles: count((s) => s.allPlayLeaderWonTitle),
    allPlayLeaderFinals: count((s) => s.allPlayLeaderReachedFinal),
    topSeedIsAllPlayLeader: count((s) => s.topSeedIsAllPlayLeader),
  },
  seasons,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

const { totals } = payload;
const pct = (n) => (totals.seasons ? `${Math.round((100 * n) / totals.seasons)}%` : '—');
console.log(`playoff-performance: ${totals.seasons} seasons -> ${path.relative(ROOT, OUT)}`);
console.log(`  #1 seed won the title        ${totals.topSeedTitles}/${totals.seasons} (${pct(totals.topSeedTitles)})`);
console.log(`  all-play leader won it       ${totals.allPlayLeaderTitles}/${totals.seasons} (${pct(totals.allPlayLeaderTitles)})`);
if (skipped.length) console.log(`  skipped: ${skipped.map((s) => `${s.year} (${s.reason})`).join(', ')}`);
