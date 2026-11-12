/**
 * Playoff odds — a Monte Carlo of the rest of the regular season.
 *
 * Plain .mjs because two callers need the SAME numbers: the Playoff Odds page
 * (SSR, src/components/shared/playoff-odds/) and the Saturday Matchup Preview
 * (node, scripts/article-types/matchup-preview.mjs), which snapshots them on
 * the post. A preview and the page it links to must not disagree about the
 * same week, so both build their input here and run the same seeded draw.
 *
 * The model is deliberately simple and says so on every surface that prints
 * it ("an estimate"):
 *   - each team scores Normal(mean, sd) each remaining week, where mean is its
 *     season average shrunk toward the league average (a team three weeks in
 *     is not yet what its three weeks say) and sd is the league's pooled
 *     week-to-week spread;
 *   - a doubleheader week is ONE score against both opponents, like MFL;
 *   - seeding follows the league's registry `playoffOdds` format: the top
 *     `divisionPlaces` of every division qualify, then `wildCards` more,
 *     within each group (the whole league, or each conference); the best
 *     `byes` qualifiers get a first-round bye;
 *   - ties are broken on points for (or Victory Points first, `rankBy: 'vp'`).
 *     The constitutions' full tiebreak chains (head-to-head, All-Play, Power
 *     Rank) are not reproduced; that is the main reason this is an estimate.
 *
 * The draw is seeded, so a page refresh never flickers the numbers.
 */

const toArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const num = (x) => {
  const n = Number.parseFloat(x);
  return Number.isFinite(n) ? n : null;
};

/** How many weeks of league-average scoring a team's own average is blended with. */
const SHRINK_WEEKS = 3;

/** Small, fast, seedable PRNG (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * The simulator's input, from the committed MFL feeds.
 *
 * @param {object} args
 * @param {any} args.league     MFL `TYPE=league` export
 * @param {any} args.standings  MFL `TYPE=leagueStandings` export
 * @param {any} args.schedule   MFL `TYPE=schedule` export (played weeks carry scores)
 * @param {{divisionPlaces:number, wildCards:number, byes:number, groupBy?:'league'|'conference', rankBy?:'pct'|'vp', vpBuckets?:number[]}} args.format
 * @param {number} [args.lastRegularWeek]  defaults to the league export's lastRegularSeasonWeek
 */
export function buildOddsInput({ league, standings, schedule, format, lastRegularWeek }) {
  const lg = league?.league ?? league ?? {};
  const lastWeek = lastRegularWeek ?? (Number.parseInt(lg.lastRegularSeasonWeek, 10) || 14);

  // MFL puts a franchise's CONFERENCE on its division, not on the franchise
  // (the AFL's league export): read it there, or every conference collapses
  // into one seeding group.
  const divisionConference = new Map(
    toArray(lg.divisions?.division).map((d) => [String(d?.id ?? ''), d?.conference ?? '']),
  );
  const conferenceNames = Object.fromEntries(
    toArray(lg.conferences?.conference).filter((c) => c?.id).map((c) => [c.id, c.name ?? c.id]),
  );
  const teams = new Map();
  for (const f of toArray(lg.franchises?.franchise)) {
    if (!f?.id) continue;
    teams.set(f.id, {
      id: f.id,
      division: f.division ?? '',
      conference: f.conference ?? divisionConference.get(String(f.division ?? '')) ?? '',
      wins: 0, losses: 0, ties: 0, pf: 0, vp: 0,
    });
  }
  for (const r of toArray(standings?.leagueStandings?.franchise ?? standings?.franchise)) {
    const t = teams.get(r?.id);
    if (!t) continue;
    const [w, l, tt] = String(r.h2hwlt ?? '').split('-').map((x) => Number.parseInt(x, 10));
    t.wins = Number.isFinite(w) ? w : Number.parseInt(r.h2hw, 10) || 0;
    t.losses = Number.isFinite(l) ? l : Number.parseInt(r.h2hl, 10) || 0;
    t.ties = Number.isFinite(tt) ? tt : Number.parseInt(r.h2ht, 10) || 0;
    t.pf = num(r.pf) ?? 0;
    t.vp = num(r.vp) ?? 0;
  }

  // Played scores (one per team per week) and the games still to play.
  const weekly = new Map(); // id -> number[]
  const remaining = []; // {week, a, b}
  let completedWeek = 0;
  const weeks = toArray(schedule?.schedule?.weeklySchedule ?? schedule?.weeklySchedule)
    .slice()
    .sort((x, y) => Number(x.week) - Number(y.week));
  for (const w of weeks) {
    const wk = Number(w.week);
    if (!(wk > 0) || wk > lastWeek) continue;
    let anyScore = false;
    const seen = new Set();
    for (const m of toArray(w.matchup)) {
      const sides = toArray(m?.franchise);
      if (sides.length !== 2 || !teams.has(sides[0]?.id) || !teams.has(sides[1]?.id)) continue;
      const [x, y] = sides;
      const sx = num(x.score);
      const sy = num(y.score);
      if (sx != null && sy != null) {
        anyScore = true;
        for (const [id, s] of [[x.id, sx], [y.id, sy]]) {
          if (seen.has(id)) continue; // doubleheader: one score a week
          seen.add(id);
          if (!weekly.has(id)) weekly.set(id, []);
          weekly.get(id).push(s);
        }
      } else {
        remaining.push({ week: wk, a: x.id, b: y.id });
      }
    }
    if (anyScore) completedWeek = Math.max(completedWeek, wk);
  }

  // Score model.
  const all = [...weekly.values()].flat();
  const leagueMean = all.length ? all.reduce((s, x) => s + x, 0) / all.length : 100;
  let resid = 0;
  let n = 0;
  const means = new Map();
  for (const t of teams.values()) {
    const s = weekly.get(t.id) ?? [];
    const own = s.length ? s.reduce((a, b) => a + b, 0) / s.length : leagueMean;
    for (const x of s) { resid += (x - own) ** 2; n += 1; }
    means.set(t.id, (own * s.length + leagueMean * SHRINK_WEEKS) / (s.length + SHRINK_WEEKS));
  }
  const sd = n > 1 ? Math.sqrt(resid / (n - 1)) : leagueMean * 0.2;

  return {
    format: { groupBy: 'league', rankBy: 'pct', vpBuckets: [3, 2, 1], ...format },
    teams: [...teams.values()].map((t) => ({ ...t, mean: means.get(t.id) })),
    conferenceNames,
    remaining,
    completedWeek,
    lastWeek,
    sd,
  };
}

/** Rank key, higher is better. */
function rankKey(rankBy, t) {
  const pct = (t.wins + t.ties * 0.5) / Math.max(1, t.wins + t.losses + t.ties);
  return rankBy === 'vp' ? [t.vp, t.pf] : [pct, t.pf];
}
const byKey = (rankBy) => (a, b) => {
  const ka = rankKey(rankBy, a);
  const kb = rankKey(rankBy, b);
  return kb[0] - ka[0] || kb[1] - ka[1];
};
const byPct = byKey('pct');

/** Seeds one finished season: {id -> {seed, bye, divisionPlace}} for qualifiers. */
export function seedSeason(teams, format) {
  const groups = new Map();
  for (const t of teams) {
    const g = format.groupBy === 'conference' ? t.conference : '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  const out = new Map();
  const order = byKey(format.rankBy);
  for (const members of groups.values()) {
    const divs = new Map();
    for (const t of members) {
      if (!divs.has(t.division)) divs.set(t.division, []);
      divs.get(t.division).push(t);
    }
    // Division places go on record (MFL's own division sort leads with PCT).
    const placed = [];
    for (const d of divs.values()) {
      d.sort(byPct);
      d.slice(0, format.divisionPlaces).forEach((t, i) => placed.push({ t, place: i }));
    }
    // Division winners outrank runners-up, and within a place, the better team.
    placed.sort((x, y) => x.place - y.place || order(x.t, y.t));
    const placedIds = new Set(placed.map((p) => p.t.id));
    const wild = members.filter((t) => !placedIds.has(t.id)).sort(order).slice(0, format.wildCards);
    const seeds = [...placed.map((p) => p.t), ...wild];
    seeds.forEach((t, i) => out.set(t.id, { seed: i + 1, bye: i < (format.byes ?? 0) }));
  }
  return out;
}

/**
 * Run the season out `iterations` times.
 *
 * @param {ReturnType<typeof buildOddsInput>} input
 * @param {{iterations?: number, seed?: number, force?: {week:number, a:string, b:string, winner:string}}} [opts]
 * @returns {Map<string, {playoff:number, bye:number}>}
 */
export function simulateOdds(input, { iterations = 5000, seed = 20261, force, trackWeek } = {}) {
  const { format, teams, remaining, sd } = input;
  const rand = seededRandom(seed);
  const n = teams.length;
  const index = new Map(teams.map((t, i) => [t.id, i]));
  const made = new Float64Array(n);
  const byes = new Float64Array(n);
  const buckets = format.vpBuckets ?? [3, 2, 1];
  const vpMode = format.rankBy === 'vp';

  // Games grouped by week, as team indexes; the forced game resolved once.
  const byWeek = new Map();
  for (const g of remaining) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    const forced = force && g.week === force.week &&
      ((g.a === force.a && g.b === force.b) || (g.a === force.b && g.b === force.a));
    byWeek.get(g.week).push({
      a: index.get(g.a),
      b: index.get(g.b),
      forcedWinner: forced ? index.get(force.winner) : -1,
    });
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b).map((wk) => {
    const games = byWeek.get(wk);
    const playing = [...new Set(games.flatMap((g) => [g.a, g.b]))];
    return { games, playing };
  });

  // Conditional tallies for one week's games: of the runs where A won, how
  // often did A (and B) make it — the "what this game is worth" numbers, read
  // off the same draw instead of re-running the season per outcome.
  const tracked = trackWeek != null ? byWeek.get(trackWeek) ?? [] : [];
  const tally = tracked.map(() => ({ aWon: 0, made: new Float64Array(4), bye: new Float64Array(4) }));
  const trackedWinner = new Int32Array(tracked.length);

  // One working copy per team, reset each iteration (no per-iteration allocation).
  const sim = teams.map((t) => ({ ...t }));
  const score = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const t = teams[i];
      const s = sim[i];
      s.wins = t.wins; s.losses = t.losses; s.ties = t.ties; s.pf = t.pf; s.vp = t.vp;
    }
    for (const { games, playing } of weeks) {
      // A doubleheader week is ONE score against both opponents.
      for (const i of playing) {
        score[i] = teams[i].mean + gaussian(rand) * sd;
        sim[i].pf += score[i];
      }
      for (const g of games) {
        const w = g.forcedWinner >= 0 ? g.forcedWinner : score[g.a] >= score[g.b] ? g.a : g.b;
        g.lastWinner = w;
        const l = w === g.a ? g.b : g.a;
        sim[w].wins += 1;
        sim[l].losses += 1;
        if (vpMode) sim[w].vp += 2;
      }
      if (vpMode && buckets.length) {
        // Weekly scoring buckets: the teams that played, split into equal thirds by score.
        const ranked = playing.slice().sort((x, y) => score[y] - score[x]);
        const per = Math.ceil(ranked.length / buckets.length);
        ranked.forEach((i, k) => { sim[i].vp += buckets[Math.min(buckets.length - 1, Math.floor(k / per))]; });
      }
    }
    for (let k = 0; k < tracked.length; k++) trackedWinner[k] = tracked[k].lastWinner;
    const seeded = seedSeason(sim, format);
    for (const [id, s] of seeded) {
      const i = index.get(id);
      made[i] += 1;
      if (s.bye) byes[i] += 1;
    }
    for (let k = 0; k < tracked.length; k++) {
      const g = tracked[k];
      const aWon = trackedWinner[k] === g.a;
      const T = tally[k];
      if (aWon) T.aWon += 1;
      // slots: 0 = A's odds when A won, 1 = A's when A lost, 2 = B's when A won, 3 = B's when A lost
      const sa = seeded.get(teams[g.a].id);
      const sb = seeded.get(teams[g.b].id);
      const off = aWon ? 0 : 1;
      if (sa) { T.made[off] += 1; if (sa.bye) T.bye[off] += 1; }
      if (sb) { T.made[2 + off] += 1; if (sb.bye) T.bye[2 + off] += 1; }
    }
  }
  const out = new Map();
  teams.forEach((t, i) => out.set(t.id, { playoff: made[i] / iterations, bye: byes[i] / iterations }));
  if (trackWeek != null) {
    out.conditional = tracked.map((g, k) => {
      const T = tally[k];
      const aLost = iterations - T.aWon;
      const base = (i) => out.get(teams[i].id);
      // An outcome the draw never produced falls back to today's odds.
      const rate = (arr, slot, n, i, key) => (n > 0 ? arr[slot] / n : base(i)[key]);
      return {
        a: teams[g.a].id,
        b: teams[g.b].id,
        aWinShare: T.aWon / iterations,
        aIfWin: { playoff: rate(T.made, 0, T.aWon, g.a, 'playoff'), bye: rate(T.bye, 0, T.aWon, g.a, 'bye') },
        aIfLoss: { playoff: rate(T.made, 1, aLost, g.a, 'playoff'), bye: rate(T.bye, 1, aLost, g.a, 'bye') },
        bIfWin: { playoff: rate(T.made, 3, aLost, g.b, 'playoff'), bye: rate(T.bye, 3, aLost, g.b, 'bye') },
        bIfLoss: { playoff: rate(T.made, 2, T.aWon, g.b, 'playoff'), bye: rate(T.bye, 2, T.aWon, g.b, 'bye') },
      };
    });
  }
  return out;
}

/**
 * Everything a surface prints: each team's odds today, and for each game of
 * `week` what a win or a loss would do to both sides.
 *
 * @param {ReturnType<typeof buildOddsInput>} input
 * @param {{week?: number, iterations?: number, swingIterations?: number, seed?: number}} [opts]
 */
export function playoffOddsReport(input, { week, iterations = 10000, seed = 20261 } = {}) {
  const targetWeek = week ?? (input.remaining.length ? Math.min(...input.remaining.map((g) => g.week)) : null);
  const base = simulateOdds(input, { iterations, seed, trackWeek: targetWeek });
  const games = [];
  const done = new Set();
  for (const c of base.conditional ?? []) {
    const key = [c.a, c.b].sort().join('-');
    if (done.has(key)) continue;
    done.add(key);
    const side = (id, win, loss, winShare) => ({
      franchiseId: id,
      playoff: base.get(id).playoff,
      bye: base.get(id).bye,
      winChance: round(winShare),
      win: { playoff: round(win.playoff), bye: round(win.bye) },
      loss: { playoff: round(loss.playoff), bye: round(loss.bye) },
    });
    const a = side(c.a, c.aIfWin, c.aIfLoss, c.aWinShare);
    const b = side(c.b, c.bIfWin, c.bIfLoss, 1 - c.aWinShare);
    games.push({ week: targetWeek, a, b, stakes: gameStakes(a, b) });
  }
  games.sort((x, y) => y.stakes.swing - x.stakes.swing);
  return {
    completedWeek: input.completedWeek,
    week: targetWeek,
    lastWeek: input.lastWeek,
    format: input.format,
    conferenceNames: input.conferenceNames ?? {},
    iterations,
    teams: input.teams.map((t) => ({
      franchiseId: t.id,
      division: t.division,
      conference: t.conference,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pf: Math.round(t.pf * 100) / 100,
      playoff: round(base.get(t.id).playoff),
      bye: round(base.get(t.id).bye),
    })),
    games,
  };
}

/** Four decimals: plenty for a percentage, and a stable diff for a committed file. */
const round = (x) => Math.round(x * 10000) / 10000;

/**
 * What a game is played for: the bye when both teams' playoff odds are settled
 * either way but the bye is not, otherwise the playoffs. `swing` is the larger
 * of the two sides' win-minus-loss gap, the number games are ranked by.
 */
export function gameStakes(a, b) {
  const gap = (s, k) => Math.abs(s.win[k] - s.loss[k]);
  const playoff = Math.max(gap(a, 'playoff'), gap(b, 'playoff'));
  const bye = Math.max(gap(a, 'bye'), gap(b, 'bye'));
  return bye > playoff ? { kind: 'bye', swing: round(bye) } : { kind: 'playoff', swing: round(playoff) };
}
