/**
 * Simulates the demo league's seasons: fictional franchises draft and auction
 * real NFL players, set lineups each week, and score what those players
 * actually scored that week. Everything league-shaped — rosters, contracts,
 * results, standings, playoffs, transactions — is invented here; only the
 * players and their weekly points are real (scripts/demo/lib/nfl-facts.mjs).
 *
 * Output is plain objects in the SHAPE of MyFantasyLeague's exports (see
 * scripts/demo/lib/mfl-feeds.mjs for the final serialization), so the site's
 * existing parsers and derivation scripts run over it unchanged.
 */

import { seasonTotals } from './nfl-facts.mjs';

export const LEAGUE_RULES = {
  salaryCap: 45_000_000,
  rosterSize: 22,
  minSalary: 425_000,
  taxiSize: 3,
  regularSeasonWeeks: 14,
  playoffStartWeek: 15,
  endWeek: 17,
  rookieRounds: 3,
  maxContractYears: 5,
  // QB 1, PK 1, Def 1, and RB/WR/TE 1-4 each, 9 starters in all.
  starters: { QB: 1, PK: 1, Def: 1, flexMin: { RB: 1, WR: 1, TE: 1 }, flexExtra: 3 },
};

const SKILL = ['RB', 'WR', 'TE'];

/** Round to MFL's salary grain. */
const salaryGrain = (n) => Math.max(LEAGUE_RULES.minSalary, Math.round(n / 25_000) * 25_000);

/**
 * @param {object} args
 * @param {number[]} args.years         seasons to simulate, oldest first
 * @param {Map<number, object>} args.facts  loadSeasonFacts() per year
 * @param {number} args.currentYear     the season in progress (simulated to `currentWeek`)
 * @param {number} args.currentWeek     last completed week of `currentYear` (0 = preseason)
 * @param {object[]} args.franchises    DEMO_FRANCHISES
 * @param {object} args.rng             createRng()
 * @param {(year:number, week:number) => number} args.weekStart  unix seconds of that NFL week's start
 * @param {'dynasty' | 'keeper'} [args.mode]  'keeper': no cap or contracts — each
 *   offseason every team keeps its best KEEPERS and re-drafts the rest
 */
export function simulateLeague({ years, facts, currentYear, currentWeek, franchises, rng, weekStart, mode = 'dynasty' }) {
  const ids = franchises.map((f) => f.id);
  /** fid → Map<pid, {salary, contractYear, status, acquired}> */
  const rosters = new Map(ids.map((id) => [id, new Map()]));
  const seasons = [];
  let previousOrder = null; // franchise ids, worst → best, for the rookie draft

  for (const year of years) {
    const f = facts.get(year);
    if (!f) throw new Error(`demo generator: no NFL facts for ${year}`);
    const prior = facts.get(year - 1);
    const lastWeek = year === currentYear ? currentWeek : LEAGUE_RULES.endWeek;
    const srng = rng.fork(`season-${year}`);
    const tx = [];
    const ts = (week, dayOffset = 0, hour = 12) =>
      weekStart(year, week) + dayOffset * 86_400 + hour * 3_600 + srng.int(0, 3_599);

    const value = valuation(f, prior, year === currentYear ? currentWeek : Infinity, srng);
    const known = (pid) => f.players.has(pid) && value.has(pid);

    // --- Offseason -------------------------------------------------------
    const auctionResults = [];
    const draftPicks = [];
    const salaryAdjustments = [];

    const isStartup = year === years[0];
    if (mode === 'keeper') {
      keeperOffseason({ year, isStartup, ids, rosters, value, f, srng, tx, draftPicks, previousOrder, weekStart, known });
    }
    if (mode !== 'keeper' && !isStartup) {
      for (const [fid, roster] of rosters) {
        for (const [pid, c] of roster) {
          c.contractYear -= 1;
          if (c.contractYear <= 0 || !known(pid)) {
            roster.delete(pid);
            if (c.contractYear > 0) {
              // Released with years left: the cap hit lingers as dead money.
              const dead = Math.round((c.salary * 0.5) / 1000) * 1000;
              salaryAdjustments.push({
                franchise_id: fid,
                amount: String(dead),
                description: `${year} Dead money`,
                timestamp: String(ts(1, -150)),
              });
            }
          } else if (c.status === 'TAXI_SQUAD' && c.contractYear <= 1) {
            c.status = 'ROSTER';
          }
        }
      }
    }

    const rostered = () => new Set([...rosters.values()].flatMap((r) => [...r.keys()]));
    const capUsed = (fid) => [...rosters.get(fid).values()].reduce((s, c) => s + c.salary, 0);

    if (mode !== 'keeper') {
    // Auction (March): every free agent worth rostering, best first, to a team
    // with room — the richest bidder most often, but not always.
    const rookieSlots = isStartup ? 0 : LEAGUE_RULES.rookieRounds;
    const auctionTarget = LEAGUE_RULES.rosterSize - rookieSlots;
    // Leave room under the cap for this year's rookie contracts.
    const rookieReserve = rookieSlots ? 3_500_000 : 0;
    const auctionTime = weekStart(year, 1) - 170 * 86_400;
    let t = auctionTime;
    const freeAgents = [...value.entries()]
      .filter(([pid]) => !rostered().has(pid) && (isStartup || f.players.get(pid).draftYear !== year))
      .sort((a, b) => b[1] - a[1]);
    const topValue = freeAgents[0]?.[1] ?? 1;
    for (const [pid, v] of freeAgents) {
      const needy = ids.filter((fid) => rosters.get(fid).size < auctionTarget && needsPosition(rosters.get(fid), f.players.get(pid).position, f));
      if (!needy.length) continue;
      const withRoom = needy
        .map((fid) => ({ fid, room: LEAGUE_RULES.salaryCap - rookieReserve - capUsed(fid) - (auctionTarget - rosters.get(fid).size - 1) * LEAGUE_RULES.minSalary }))
        .filter((b) => b.room > LEAGUE_RULES.minSalary);
      if (!withRoom.length) continue;
      withRoom.sort((a, b) => b.room - a.room);
      const winner = srng.chance(0.55) ? withRoom[0] : srng.pick(withRoom);
      const ask = salaryGrain(((v / topValue) ** 1.5) * 11_000_000 * (0.8 + srng.next() * 0.45));
      const salary = Math.min(ask, salaryGrain(winner.room * 0.6));
      const years = srng.int(1, LEAGUE_RULES.maxContractYears);
      rosters.get(winner.fid).set(pid, { salary, contractYear: years, status: 'ROSTER', acquired: 'auction' });
      t += srng.int(600, 5_400);
      auctionResults.push({ player: pid, franchise: winner.fid, winningBid: String(salary), timeStarted: String(t - 3_600), lastBidTime: String(t) });
      tx.push({ type: 'AUCTION_WON', franchise: winner.fid, transaction: `${pid}|${salary}|`, timestamp: String(t) });
    }

    // Rookie draft (May): worst-to-best by last season's finish.
    if (!isStartup) {
      const order = previousOrder ?? srng.shuffle(ids);
      const rookies = [...value.entries()]
        .filter(([pid]) => f.players.get(pid).draftYear === year && !rostered().has(pid))
        .sort((a, b) => b[1] - a[1])
        .map(([pid]) => pid);
      let dt = weekStart(year, 1) - 120 * 86_400;
      for (let round = 1; round <= LEAGUE_RULES.rookieRounds; round++) {
        order.forEach((fid, i) => {
          const pid = rookies.shift();
          if (!pid) return;
          const salary = salaryGrain([1_500_000, 900_000, 600_000][round - 1] * (1 - i * 0.03));
          const taxi = round === 3 && [...rosters.get(fid).values()].filter((c) => c.status === 'TAXI_SQUAD').length < LEAGUE_RULES.taxiSize;
          rosters.get(fid).set(pid, { salary, contractYear: 3, status: taxi ? 'TAXI_SQUAD' : 'ROSTER', acquired: 'draft' });
          dt += srng.int(1_800, 14_400);
          draftPicks.push({ round: String(round).padStart(2, '0'), pick: String(i + 1).padStart(2, '0'), franchise: fid, player: pid, timestamp: String(dt), comments: '' });
          tx.push({ type: 'DRAFT', franchise: fid, transaction: `${pid},`, timestamp: String(dt), internal: true });
        });
      }
    }
    } // mode !== 'keeper'

    // Trim to the roster limit (taxi squad doesn't count): cheapest, least
    // valuable first, the way an owner makes cut-down day.
    for (const [fid, roster] of rosters) {
      const active = () => [...roster.entries()].filter(([, c]) => c.status !== 'TAXI_SQUAD');
      while (active().length > LEAGUE_RULES.rosterSize) {
        const [pid] = active().sort((a, b) => (value.get(a[0]) ?? 0) - (value.get(b[0]) ?? 0))[0];
        roster.delete(pid);
        tx.push({ type: 'FREE_AGENT', franchise: fid, transaction: `|${pid},`, timestamp: String(ts(1, -3)) });
      }
    }

    // Fill any team still short (injuries, a thin pool) with minimum deals.
    fillRosters(
      rosters,
      value,
      f,
      srng,
      (fid, pid) => tx.push({ type: 'FREE_AGENT', franchise: fid, transaction: `${pid},|`, timestamp: String(ts(1, -10)) }),
      (fid, pid) => tx.push({ type: 'FREE_AGENT', franchise: fid, transaction: `|${pid},`, timestamp: String(ts(1, -10)) }),
    );

    // --- Season ---------------------------------------------------------
    const schedule = buildSchedule(ids, srng);
    const weekly = [];
    const scoresSoFar = new Map(); // pid → {points, games} this season, for lineup decisions

    for (let week = 1; week <= Math.min(lastWeek, LEAGUE_RULES.regularSeasonWeeks); week++) {
      inSeasonMoves({ week, rosters, value, f, srng, tx, ts, scoresSoFar });
      const games = schedule[week - 1];
      const weekScores = f.scores.get(week) ?? new Map();
      const lineups = new Map(ids.map((fid) => [fid, setLineup(rosters.get(fid), f, weekScores, scoresSoFar, value, srng)]));
      weekly.push({ week, regularSeason: true, games: games.map(([home, away]) => [lineups.get(home), lineups.get(away), home, away]) });
      for (const [pid, s] of weekScores) {
        const acc = scoresSoFar.get(pid) ?? { points: 0, games: 0 };
        acc.points += s;
        acc.games += 1;
        scoresSoFar.set(pid, acc);
      }
    }

    const regWeeksPlayed = Math.min(lastWeek, LEAGUE_RULES.regularSeasonWeeks);
    const standings = computeStandings(ids, weekly, franchises);
    const playoffs = regWeeksPlayed === LEAGUE_RULES.regularSeasonWeeks
      ? playPlayoffs({ standings, lastWeek, rosters, f, scoresSoFar, value, srng, weekly, franchises })
      : null;

    // MFL publishes all-play over EVERY scored week, playoffs included
    // (compute-playoff-performance.mjs verifies it that way).
    recomputeAllPlay(standings, weekly);

    // Next season's rookie draft order: worst first.
    previousOrder = [...standings].reverse().map((s) => s.id);

    const picks = futurePicks(ids, year, srng, tx);
    seasons.push({
      year,
      lastWeek,
      schedule,
      weekly,
      standings,
      playoffs,
      rosters: mode === 'keeper' ? withoutSalaries(snapshotRosters(rosters)) : snapshotRosters(rosters),
      auctionResults,
      draftPicks,
      salaryAdjustments,
      transactions: tx.filter((x) => !x.internal).sort((a, b) => Number(b.timestamp) - Number(a.timestamp)),
      players: f.players,
      futurePicks: picks,
    });
  }
  return seasons;
}

/** A keeper league keeps this many players each offseason (the AFL's rule; KEEPER_LIMIT). */
export const KEEPERS = 7;

/**
 * A keeper league's offseason: every team keeps its KEEPERS most valuable
 * players and releases the rest, then a straight (not snake) draft — worst
 * finisher first — refills the rosters. The startup season drafts every
 * roster from scratch, in a random order.
 */
function keeperOffseason({ year, isStartup, ids, rosters, value, f, srng, tx, draftPicks, previousOrder, weekStart, known }) {
  const cutTime = weekStart(year, 1) - 40 * 86_400;
  if (!isStartup) {
    for (const [fid, roster] of rosters) {
      const ranked = [...roster.keys()].filter(known).sort((a, b) => (value.get(b) ?? 0) - (value.get(a) ?? 0));
      const keep = new Set(ranked.slice(0, KEEPERS));
      for (const pid of [...roster.keys()]) {
        if (keep.has(pid)) continue;
        roster.delete(pid);
        tx.push({ type: 'FREE_AGENT', franchise: fid, transaction: `|${pid},`, timestamp: String(cutTime + srng.int(0, 86_400)) });
      }
    }
  }
  const order = !isStartup && previousOrder ? previousOrder : srng.shuffle(ids);
  const taken = new Set([...rosters.values()].flatMap((r) => [...r.keys()]));
  const pool = [...value.entries()].filter(([pid]) => !taken.has(pid)).sort((a, b) => b[1] - a[1]).map(([pid]) => pid);
  const rounds = LEAGUE_RULES.rosterSize - (isStartup ? 0 : KEEPERS);
  let dt = weekStart(year, 1) - 14 * 86_400;
  for (let round = 1; round <= rounds; round++) {
    order.forEach((fid, i) => {
      const roster = rosters.get(fid);
      // Best available that the roster still has room for at his position.
      const at = pool.findIndex((pid) => needsPosition(roster, f.players.get(pid).position, f));
      if (at < 0) return;
      const [pid] = pool.splice(at, 1);
      roster.set(pid, { salary: 0, contractYear: 1, status: 'ROSTER', acquired: 'draft' });
      dt += srng.int(60, 600);
      draftPicks.push({ round: String(round).padStart(2, '0'), pick: String(i + 1).padStart(2, '0'), franchise: fid, player: pid, timestamp: String(dt), comments: '' });
    });
  }
}

/** A keeper league carries no salaries — the roster feed says 0, as MFL's does. */
function withoutSalaries(snapshot) {
  return new Map([...snapshot].map(([fid, r]) => [fid, new Map([...r].map(([pid, c]) => [pid, { ...c, salary: 0, contractYear: 0 }]))]));
}

/**
 * Preseason value of every player worth rostering: this season's points per
 * game (hindsight — it makes the fiction play out plausibly) blended with last
 * season's, plus noise so no franchise drafts perfectly.
 */
function valuation(f, prior, throughWeek, rng) {
  const now = seasonTotals(f, throughWeek);
  const before = prior ? seasonTotals(prior) : new Map();
  const value = new Map();
  for (const [pid, p] of f.players) {
    const a = now.get(pid);
    const b = before.get(pid);
    if (!a && !b) continue;
    const ppgNow = a ? a.points / Math.max(a.games, 1) : null;
    const ppgBefore = b ? b.points / Math.max(b.games, 1) : null;
    const ppg = ppgNow != null && ppgBefore != null ? ppgNow * 0.65 + ppgBefore * 0.35 : (ppgNow ?? ppgBefore);
    // K and D/ST score steadily and matter less at the draft table.
    const scarcity = p.position === 'PK' || p.position === 'Def' ? 0.45 : p.position === 'QB' ? 0.9 : 1;
    const v = Math.max(0.1, ppg * scarcity * (1 + rng.noise(0.18)));
    value.set(pid, v);
  }
  return value;
}

/** Roster composition caps, so the auction doesn't hand one team six kickers. */
const POSITION_CAP = { QB: 3, RB: 7, WR: 8, TE: 3, PK: 1, Def: 1 };

function needsPosition(roster, position, f) {
  let n = 0;
  for (const pid of roster.keys()) if (f.players.get(pid)?.position === position) n++;
  return n < POSITION_CAP[position];
}

function fillRosters(rosters, value, f, rng, onAdd, onDrop) {
  const taken = new Set([...rosters.values()].flatMap((r) => [...r.keys()]));
  const pool = [...value.entries()].filter(([pid]) => !taken.has(pid)).sort((a, b) => b[1] - a[1]);
  for (const [fid, roster] of rosters) {
    // Guarantee a starter at every required position first.
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'PK', 'Def']) {
      if ([...roster.keys()].some((pid) => f.players.get(pid)?.position === pos)) continue;
      const idx = pool.findIndex(([pid]) => f.players.get(pid).position === pos);
      if (idx < 0) continue;
      const [pid] = pool.splice(idx, 1)[0];
      // A full roster makes room first: cut the least valuable player at a
      // position the team is deep at, never one it has only one of.
      const active = () => [...roster.entries()].filter(([, c]) => c.status !== 'TAXI_SQUAD');
      if (active().length >= LEAGUE_RULES.rosterSize) {
        const count = (p) => active().filter(([id]) => f.players.get(id)?.position === p).length;
        const cut = active()
          .filter(([id]) => count(f.players.get(id)?.position) > 1)
          .sort((a, b) => (value.get(a[0]) ?? 0) - (value.get(b[0]) ?? 0))[0];
        if (cut) {
          roster.delete(cut[0]);
          onDrop(fid, cut[0]);
        }
      }
      roster.set(pid, { salary: LEAGUE_RULES.minSalary, contractYear: 1, status: 'ROSTER', acquired: 'fa' });
      onAdd(fid, pid);
    }
    const activeCount = () => [...roster.values()].filter((c) => c.status !== 'TAXI_SQUAD').length;
    while (activeCount() < LEAGUE_RULES.rosterSize && pool.length) {
      const idx = pool.findIndex(([pid]) => needsPosition(roster, f.players.get(pid).position, f));
      if (idx < 0) break;
      const [pid] = pool.splice(idx, 1)[0];
      roster.set(pid, { salary: LEAGUE_RULES.minSalary, contractYear: rng.int(1, 2), status: 'ROSTER', acquired: 'fa' });
      onAdd(fid, pid);
    }
  }
}

/** Circle-method round robin, shuffled per season; one game per team per week. */
function buildSchedule(ids, rng) {
  const teams = rng.shuffle(ids);
  const n = teams.length;
  const rounds = [];
  const rot = teams.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const circle = [teams[0], ...rot];
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i];
      const b = circle[n - 1 - i];
      games.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(games);
    rot.unshift(rot.pop());
  }
  // A league of fewer than regularSeasonWeeks + 1 teams (the 12-team keeper
  // demo) plays the round robin again for the remaining weeks.
  const shuffled = rng.shuffle(rounds);
  const season = [];
  while (season.length < LEAGUE_RULES.regularSeasonWeeks) season.push(...shuffled);
  return season.slice(0, LEAGUE_RULES.regularSeasonWeeks);
}

/**
 * The lineup a sensible owner sets: best expected player at each required
 * slot, then the best three remaining RB/WR/TE. Expected = season-to-date
 * points per game, falling back to preseason value — never this week's actual.
 */
function setLineup(roster, f, weekScores, soFar, value, rng) {
  const active = [...roster.entries()].filter(([, c]) => c.status === 'ROSTER').map(([pid]) => pid);
  const expected = (pid) => {
    const s = soFar.get(pid);
    const base = s && s.games ? s.points / s.games : value.get(pid) ?? 0;
    return base * (1 + rng.noise(0.12));
  };
  const actual = (pid) => weekScores.get(pid) ?? 0;
  const pick = (score) => {
    const chosen = [];
    const byPos = (pos) => active.filter((pid) => f.players.get(pid)?.position === pos && !chosen.includes(pid)).sort((a, b) => score(b) - score(a));
    for (const pos of ['QB', 'PK', 'Def', 'RB', 'WR', 'TE']) {
      const top = byPos(pos)[0];
      if (top) chosen.push(top);
    }
    const flex = active
      .filter((pid) => SKILL.includes(f.players.get(pid)?.position) && !chosen.includes(pid))
      .sort((a, b) => score(b) - score(a))
      .slice(0, LEAGUE_RULES.starters.flexExtra);
    return [...chosen, ...flex];
  };
  const starters = pick(expected);
  const optimal = pick(actual);
  const round2 = (n) => Math.round(n * 100) / 100;
  const score = round2(starters.reduce((s, pid) => s + actual(pid), 0));
  const optPts = round2(optimal.reduce((s, pid) => s + actual(pid), 0));
  return {
    starters,
    optimal,
    nonstarters: [...roster.keys()].filter((pid) => !starters.includes(pid)),
    players: [...roster.keys()].map((pid) => ({
      id: pid,
      score: actual(pid).toFixed(2),
      status: starters.includes(pid) ? 'starter' : 'nonstarter',
      shouldStart: optimal.includes(pid) ? '1' : '0',
    })),
    score,
    optPts,
  };
}

/**
 * A little in-season churn so the transaction log reads like a real league: a
 * waiver claim or free-agent swap most weeks, a trade every few weeks, an IR
 * move when a starter stops scoring.
 */
function inSeasonMoves({ week, rosters, value, f, srng, tx, ts, scoresSoFar }) {
  const ids = [...rosters.keys()];
  const taken = () => new Set([...rosters.values()].flatMap((r) => [...r.keys()]));
  const recent = (pid) => {
    const s = scoresSoFar.get(pid);
    return s && s.games ? s.points / s.games : (value.get(pid) ?? 0) * 0.7;
  };

  if (week > 1) {
    const moves = srng.int(1, 4);
    for (let i = 0; i < moves; i++) {
      const fid = srng.pick(ids);
      const roster = rosters.get(fid);
      const bench = [...roster.entries()].filter(([, c]) => c.status === 'ROSTER' && c.salary <= 1_000_000).map(([pid]) => pid);
      if (!bench.length) continue;
      const drop = bench.sort((a, b) => recent(a) - recent(b))[0];
      const pos = f.players.get(drop)?.position;
      const have = taken();
      const add = [...value.keys()].filter((pid) => !have.has(pid) && f.players.get(pid)?.position === pos).sort((a, b) => recent(b) - recent(a))[0];
      if (!add || recent(add) <= recent(drop)) continue;
      roster.delete(drop);
      const room = LEAGUE_RULES.salaryCap - [...roster.values()].reduce((sum, c) => sum + c.salary, 0);
      const wanted = Math.round((recent(add) * 40_000) / 25_000) * 25_000;
      const waiver = srng.chance(0.5) && room > 425_000;
      const bid = waiver ? String(Math.max(425_000, Math.min(wanted, Math.floor(room / 2 / 25_000) * 25_000))) : null;
      roster.set(add, { salary: bid ? Number(bid) : 425_000, contractYear: 1, status: 'ROSTER', acquired: 'fa' });
      tx.push(
        waiver
          ? { type: 'BBID_WAIVER', franchise: fid, transaction: `${add},|${bid}|${drop},`, timestamp: String(ts(week, 1, 1)) }
          : { type: 'FREE_AGENT', franchise: fid, transaction: `${add},|${drop},`, timestamp: String(ts(week, 2)) },
      );
    }
  }

  if (week > 2 && week % 3 === 0 && srng.chance(0.8)) {
    const [a, b] = srng.shuffle(ids);
    const ra = rosters.get(a);
    const rb = rosters.get(b);
    const pa = srng.pick([...ra.keys()].filter((pid) => ra.get(pid).status === 'ROSTER'));
    const candidates = [...rb.keys()].filter((pid) => rb.get(pid).status === 'ROSTER' && Math.abs((value.get(pid) ?? 0) - (value.get(pa) ?? 0)) < 3);
    if (pa && candidates.length) {
      const pb = srng.pick(candidates);
      const ca = ra.get(pa);
      const cb = rb.get(pb);
      ra.delete(pa);
      rb.delete(pb);
      ra.set(pb, cb);
      rb.set(pa, ca);
      const when = ts(week, 3, 18);
      tx.push({
        type: 'TRADE',
        franchise: a,
        franchise2: b,
        franchise1_gave_up: `${pa},`,
        franchise2_gave_up: `${pb},`,
        comments: '',
        expires: String(when + 7 * 86_400),
        timestamp: String(when),
      });
    }
  }
}

/** W/L/T, points for/against, division records — in MFL's standings vocabulary. */
function computeStandings(ids, weekly, franchises) {
  const div = new Map(franchises.map((f) => [f.id, f.divisionIndex]));
  const rows = new Map(ids.map((id) => [id, { id, w: 0, l: 0, t: 0, pf: 0, pa: 0, pp: 0, divw: 0, divl: 0, divt: 0, divpf: 0, allW: 0, allL: 0, scores: [] }]));
  for (const { games } of weekly) {
    const weekScores = [];
    for (const [home, away, hid, aid] of games) {
      const h = rows.get(hid);
      const a = rows.get(aid);
      weekScores.push([hid, home.score], [aid, away.score]);
      h.pf += home.score; a.pf += away.score;
      h.pa += away.score; a.pa += home.score;
      h.pp += home.optPts; a.pp += away.optPts;
      h.scores.push(home.score); a.scores.push(away.score);
      const sameDiv = div.get(hid) === div.get(aid);
      const result = home.score === away.score ? 't' : home.score > away.score ? 'h' : 'a';
      if (result === 't') { h.t++; a.t++; if (sameDiv) { h.divt++; a.divt++; } }
      else {
        const [win, lose] = result === 'h' ? [h, a] : [a, h];
        win.w++; lose.l++;
        if (sameDiv) { win.divw++; lose.divl++; }
      }
      if (sameDiv) { h.divpf += home.score; a.divpf += away.score; }
    }
    for (const [id, s] of weekScores) {
      const r = rows.get(id);
      for (const [other, o] of weekScores) {
        if (other === id) continue;
        if (s > o) r.allW++; else if (s < o) r.allL++;
      }
    }
  }
  const pct = (w, l, t) => (w + l + t ? ((w + t / 2) / (w + l + t)).toFixed(3).replace(/^0/, '') : '.000');
  const sorted = [...rows.values()].sort((x, y) => (y.w + y.t / 2) - (x.w + x.t / 2) || y.pf - x.pf);
  return sorted.map((r) => ({
    ...r,
    pct: pct(r.w, r.l, r.t),
    divpct: pct(r.divw, r.divl, r.divt),
    allPlayPct: pct(r.allW, r.allL, 0),
  }));
}

/**
 * The championship bracket (7 teams, the top seed on a week-15 bye), the
 * 3rd-place game, and a toilet bowl for the bottom seven — the three brackets
 * the site's playoff pages read.
 */
function playPlayoffs({ standings, lastWeek, rosters, f, scoresSoFar, value, srng, weekly, franchises }) {
  // The constitution's seeding: division champions are seeds 1-4 (in standings
  // order), three wild cards 5-7 by record, then All Play, then points.
  const divisionOf = new Map(franchises.map((fr) => [fr.id, fr.divisionIndex]));
  const winners = [];
  const seen = new Set();
  for (const row of standings) {
    const d = divisionOf.get(row.id);
    if (!seen.has(d)) {
      seen.add(d);
      winners.push(row);
    }
  }
  const pct = (r) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);
  const allPlay = (r) => r.allW / Math.max(1, r.allW + r.allL);
  const wildCards = standings
    .filter((r) => !winners.includes(r))
    .sort((a, b) => pct(b) - pct(a) || allPlay(b) - allPlay(a) || b.pf - a.pf)
    // Wild cards fill the seven-team field: three behind four division
    // champions, five behind a two-division league's two.
    .slice(0, 7 - winners.length);
  const field = [...winners, ...wildCards];
  const seeds = field.map((s, i) => ({ id: s.id, seed: i + 1 }));
  const inField = new Set(field.map((r) => r.id));
  const bottom = standings.filter((r) => !inField.has(r.id)).slice(-7).map((s, i) => ({ id: s.id, seed: i + 1 }));
  const game = (week, homeId, awayId) => {
    const weekScores = f.scores.get(week) ?? new Map();
    const h = setLineup(rosters.get(homeId), f, weekScores, scoresSoFar, value, srng);
    const a = setLineup(rosters.get(awayId), f, weekScores, scoresSoFar, value, srng);
    return { home: { id: homeId, lineup: h }, away: { id: awayId, lineup: a }, winner: h.score >= a.score ? homeId : awayId, loser: h.score >= a.score ? awayId : homeId };
  };
  const rounds = { 15: [], 16: [], 17: [] };
  const play = (week, list) => { if (week <= lastWeek) rounds[week].push(...list); return week <= lastWeek; };

  const bracket = (entrants, key) => {
    const s = (n) => entrants[n - 1].id;
    const out = { key, rounds: [] };
    // A seven-team bracket; a smaller league leaves too few for a toilet bowl.
    if (entrants.length < 7) return out;
    if (!play(15, [])) return out;
    const r1 = [game(15, s(2), s(7)), game(15, s(3), s(6)), game(15, s(4), s(5))];
    out.rounds.push({ week: 15, games: r1.map((g, i) => ({ ...g, gameId: i + 1, seeds: [[2, 7], [3, 6], [4, 5]][i] })) });
    if (16 > lastWeek) return out;
    // Top seed meets the lowest surviving seed.
    const survivors = r1.map((g, i) => ({ id: g.winner, seed: g.winner === g.home.id ? [2, 3, 4][i] : [7, 6, 5][i], from: i + 1 }));
    survivors.sort((x, y) => y.seed - x.seed);
    const low = survivors[0];
    const others = survivors.slice(1);
    const r2 = [
      { ...game(16, s(1), low.id), gameId: 4, from: [null, low.from] },
      { ...game(16, others[1].id, others[0].id), gameId: 5, from: [others[1].from, others[0].from] },
    ];
    out.rounds.push({ week: 16, games: r2 });
    if (17 > lastWeek) return out;
    const final = { ...game(17, r2[0].winner, r2[1].winner), gameId: 6, from: [4, 5] };
    out.rounds.push({ week: 17, games: [final] });
    out.champion = final.winner;
    out.runnerUp = final.loser;
    out.third = [r2[0].loser, r2[1].loser];
    return out;
  };

  const championship = bracket(seeds, 'championship');
  const toiletBowl = bracket(bottom, 'toilet');
  let thirdPlace = null;
  if (championship.third) {
    thirdPlace = { ...game(17, championship.third[0], championship.third[1]), gameId: 1 };
  }
  // Record playoff weeks in the weekly log (games only; eliminated teams idle).
  for (const week of [15, 16, 17]) {
    if (week > lastWeek) continue;
    const games = [
      ...(championship.rounds.find((r) => r.week === week)?.games ?? []),
      ...(toiletBowl.rounds.find((r) => r.week === week)?.games ?? []),
      ...(week === 17 && thirdPlace ? [thirdPlace] : []),
    ];
    weekly.push({ week, regularSeason: false, games: games.map((g) => [g.home.lineup, g.away.lineup, g.home.id, g.away.id]) });
  }
  return { seeds, bottom, championship, toiletBowl, thirdPlace };
}

function recomputeAllPlay(standings, weekly) {
  const byWeek = new Map();
  for (const w of weekly) {
    const scores = byWeek.get(w.week) ?? new Map();
    for (const [home, away, hid, aid] of w.games) {
      scores.set(hid, home.score);
      scores.set(aid, away.score);
    }
    byWeek.set(w.week, scores);
  }
  const acc = new Map(standings.map((r) => [r.id, { w: 0, l: 0, t: 0 }]));
  for (const scores of byWeek.values()) {
    for (const [id, s] of scores) {
      const a = acc.get(id);
      for (const [other, o] of scores) {
        if (other === id) continue;
        if (s > o) a.w++;
        else if (s < o) a.l++;
        else a.t++;
      }
    }
  }
  for (const r of standings) {
    const a = acc.get(r.id);
    const n = a.w + a.l + a.t;
    r.allW = a.w;
    r.allL = a.l;
    r.allT = a.t;
    r.allPlayPct = n ? ((a.w + a.t / 2) / n).toFixed(3).replace(/^0/, '') : '.000';
  }
}

function snapshotRosters(rosters) {
  return new Map([...rosters].map(([fid, r]) => [fid, new Map([...r].map(([pid, c]) => [pid, { ...c }]))]));
}

/**
 * Next three years of picks, each owned by its original franchise except a
 * handful traded — traded picks get their own TRADE transaction.
 */
function futurePicks(ids, year, rng, tx) {
  const picks = new Map(ids.map((id) => [id, []]));
  for (let y = year + 1; y <= year + 3; y++) {
    for (let round = 1; round <= LEAGUE_RULES.rookieRounds; round++) {
      for (const orig of ids) picks.get(orig).push({ year: y, round, originalPickFor: orig });
    }
  }
  for (let i = 0; i < 4; i++) {
    const [a, b] = rng.shuffle(ids);
    const list = picks.get(a);
    const idx = list.findIndex((p) => p.originalPickFor === a && p.year === year + 1);
    if (idx < 0) continue;
    const [pick] = list.splice(idx, 1);
    picks.get(b).push(pick);
    // Traded after the season's rookie draft, before the next.
    const when = tx.length ? Math.max(...tx.map((x) => Number(x.timestamp))) + rng.int(3_600, 86_400) : 0;
    tx.push({
      type: 'TRADE',
      franchise: a,
      franchise2: b,
      franchise1_gave_up: `FP_${a}_${pick.year}_${pick.round},`,
      franchise2_gave_up: '',
      comments: '',
      expires: String(when + 7 * 86_400),
      timestamp: String(when),
    });
  }
  return picks;
}
