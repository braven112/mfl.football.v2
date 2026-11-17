/**
 * Ask the History — what-ifs. Re-plays one season of the record with one
 * thing changed and says what would have followed, side by side with what
 * really happened (Brandon, 2026-11-17: "what ifs are a must").
 *
 * Two kinds:
 *
 * - `best_lineup`: a team (or every team) starts its best LEGAL lineup from
 *   the players it really had rostered each week, under that season's own
 *   starter rules (league.json `starters`).
 * - `undo_trade`: one trade never happens. From the trade's week to the end of
 *   that season each side keeps the players it gave up (for every week the
 *   other side really had them) and never gets the ones it received. Both
 *   sides then start their best legal lineup from the roster that leaves.
 *
 * Pure. Reads league-history.json (the games and the official season rows),
 * league-history-players.json (every rostered player's score each week, with
 * flags 1 = started, 2 = MFL's optimal lineup) and league-history-moves.json,
 * plus that season's league.json, playoff-brackets.json and players.json (a
 * player's position THAT season), which the caller loads (ask.ts).
 *
 * How a replay is scored. A team's replay score in a week is its REAL score
 * plus (its replay lineup's points − the points its real starters scored).
 * Real starters always add up to the real score (checked: every team-week in
 * TheLeague, all but three in the AFL), so for a team the what-if does not
 * touch nothing moves, and a replay with no change reproduces the season to
 * the point.
 *
 * Standings are a REPLAY, never the real standings: rule 1 in
 * docs/claude/rules/standings-brackets-draft-order.md says MFL's order applies
 * tiebreakers we cannot re-run (head-to-head, Power Rank, Victory Points) and
 * must never be re-sorted. So the replay starts from MFL's real order and
 * moves a team only when its replay win % moves it: teams level on replay win
 * % keep the order the league really had them in (stable sort). That is the
 * documented tiebreaker, and it is why an untouched team never moves.
 *
 * Playoffs re-run that season's own championship bracket (playoff-brackets
 * .json: who plays whom, by seed, week by week) when the season has one we can
 * walk: one bracket fed by the whole league (TheLeague), or one bracket per
 * conference feeding a final (the AFL from 2018); an archive season whose
 * export carries only the bracket's size gets a standard seeded bracket of
 * that size. The AFL's 2003-2017 single bracket seeded both conferences in an
 * order the record does not carry, so those playoffs are not replayed. The
 * field is the same size as the real one and every division winner is in it;
 * division winners are seeded first or everyone by record, whichever that
 * season really did. Ties on replay win % go to the seed the league really
 * gave (MFL's, or inferred from the real playoff games), then the real order.
 * A playoff game level on points goes to the higher seed. Seeding is the one
 * thing the record cannot settle (rule 4 of the same doc: standings order is
 * not seed order), so every replay also runs a CONTROL with nothing changed
 * and reports whether it reproduces the real bracket (TheLeague: every season
 * but 2009 and 2018, and 2019, whose bracket on file does not match its games;
 * the AFL: 2018 on, every season).
 */
import { parsePickToken } from '../mfl-pick-tokens.mjs';
import { resultOf } from '../game-results.mjs';
import { bracketKindFromName } from '../afl-bracket-kind.mjs';
import { bracketMetas, getEntryBracketIds } from '../playoff-entry-brackets.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Every replay result says this, so no reader can take it for the real standings. */
export const REPLAY_LABEL = 'What-if replay — not the real standings';

export const WHAT_IF_KINDS = ['best_lineup', 'undo_trade'];

export class WhatIfError extends Error {}

const FINISH = { C: 'Champion', R: 'Runner-up', 3: 'Third place', P: 'Playoffs', M: 'Missed playoffs' };

/** NFL regular-season weeks: 17 through 2020, 18 since (ask-moves.mjs). */
const nflRegularWeeks = (year) => (year >= 2021 ? 18 : 17);

// ── Lineup rules and the optimizer ────────────────────────────────────────

/**
 * A season's starter rules from its league.json: `count` starters, each
 * position's [min, max] ("1-3" = at least one, at most three) and any combined
 * flex slot ("RB+WR+TE": n more from those positions). Null when the feed
 * carries no rules, so a caller can say so rather than guess.
 */
export function parseStarterRules(leagueFeed) {
  const league = leagueFeed?.league ?? leagueFeed;
  const starters = league?.starters;
  const count = Number(starters?.count);
  if (!starters || !Number.isFinite(count) || count <= 0) return null;
  const slots = [];
  const flex = [];
  for (const p of toArray(starters.position)) {
    const name = String(p?.name ?? '');
    const [a, b] = String(p?.limit ?? '').split('-').map(Number);
    if (!name || !Number.isFinite(a)) continue;
    const max = Number.isFinite(b) ? b : a;
    if (name.includes('+')) flex.push({ positions: name.split('+'), n: max });
    else slots.push({ pos: name, min: a, max });
  }
  return slots.length ? { count, slots, flex } : null;
}

/** "QB 1, RB 1-3, WR 1-4, TE 1-3, PK 1, Def 1 (9 starters)". */
export function describeStarterRules(rules) {
  if (!rules) return '';
  const parts = rules.slots.map((s) => `${s.pos} ${s.min === s.max ? s.min : `${s.min}-${s.max}`}`);
  for (const f of rules.flex) parts.push(`${f.n} flex (${f.positions.join('/')})`);
  return `${parts.join(', ')} (${rules.count} starters)`;
}

/** Can the extra players over each position's own max be seated in the flex slots? */
function flexFits(over, flex) {
  const need = Object.entries(over).filter(([, n]) => n > 0);
  if (!need.length) return true;
  const cap = flex.map((f) => f.n);
  const place = (i) => {
    if (i === need.length) return true;
    const [pos, n] = need[i];
    const opts = flex.map((f, j) => (f.positions.includes(pos) ? j : -1)).filter((j) => j >= 0);
    const fill = (k, left) => {
      if (left === 0) return place(i + 1);
      if (k === opts.length) return false;
      const j = opts[k];
      for (let take = Math.min(left, cap[j]); take >= 0; take--) {
        cap[j] -= take;
        if (fill(k + 1, left - take)) return true;
        cap[j] += take;
      }
      return false;
    };
    return fill(0, n);
  };
  return place(0);
}

/**
 * The best legal lineup from `roster` ([{ id, pos, score }]) under `rules`.
 *
 * Exact: for each position the best lineup takes that position's top k
 * players, so the only choice is how many of each (k), and the space of k is
 * tiny (TheLeague's 1 QB, 1-4 RB/WR/TE, 1 PK, 1 Def is 64 shapes). Every slot
 * is filled when the roster can fill it, even with a negative score, because
 * MFL makes you start a full lineup; a position the roster cannot fill stays
 * empty (0), as it would have.
 *
 * @returns {{ points: number, ids: string[] }}
 */
export function bestLineup(roster, rules) {
  const byPos = new Map(rules.slots.map((s) => [s.pos, []]));
  for (const p of roster) byPos.get(p.pos)?.push(p);
  for (const list of byPos.values()) list.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const flexRoom = (pos) => rules.flex.filter((f) => f.positions.includes(pos)).reduce((a, f) => a + f.n, 0);

  const ranges = rules.slots.map((s) => {
    const have = byPos.get(s.pos).length;
    return { pos: s.pos, max: s.max, lo: Math.min(s.min, have), hi: Math.min(s.max + flexRoom(s.pos), have) };
  });
  // A slot the roster cannot fill (no TE at all) stays empty; it never becomes a seat for another position.
  const cap = rules.count - rules.slots.reduce((a, s) => a + Math.max(0, s.min - byPos.get(s.pos).length), 0);
  let best = null;
  const k = new Array(ranges.length).fill(0);
  const visit = (i, used) => {
    if (used > cap) return;
    if (i === ranges.length) {
      const over = {};
      ranges.forEach((r, j) => (over[r.pos] = k[j] - r.max));
      if (!flexFits(over, rules.flex)) return;
      let points = 0;
      ranges.forEach((r, j) => {
        for (const p of byPos.get(r.pos).slice(0, k[j])) points += p.score;
      });
      points = r2(points);
      // More starters first (a full lineup is the legal one), then more points.
      if (!best || used > best.used || (used === best.used && points > best.points)) best = { used, points, k: [...k] };
      return;
    }
    for (let n = ranges[i].lo; n <= ranges[i].hi; n++) {
      k[i] = n;
      visit(i + 1, used + n);
    }
  };
  visit(0, 0);
  if (!best) return { points: 0, ids: [] };
  const ids = ranges.flatMap((r, j) => byPos.get(r.pos).slice(0, best.k[j]).map((p) => p.id));
  return { points: best.points, ids };
}

// ── The season index ──────────────────────────────────────────────────────

/**
 * id → position from one season's players.json. A player's position is the
 * one he had THAT season: the player-week file carries only his latest, and a
 * fullback listed as a TE in 2007 and an RB today would otherwise make an
 * illegal lineup look legal (and the other way round).
 */
export function seasonPositions(playersFeed) {
  const out = new Map();
  for (const p of toArray(playersFeed?.players?.player)) if (p?.id && p.position) out.set(String(p.id), String(p.position));
  return out;
}

/** One season's games, rosters and real scores, ready to replay. */
function indexSeason(ds, pds, year, positions = new Map()) {
  const season = ds.seasons.find((s) => s.y === year);
  if (!season) throw new WhatIfError(`There is no ${year} season on record (${ds.firstSeason}-${ds.lastSeason}).`);
  const games = ds.games
    .filter((g) => g[0] === year)
    .map(([y, wk, wf, ws, lf, ls, po, broken]) => ({ wk, a: wf, as: ws, b: lf, bs: ls, playoff: !!po, tie: ws === ls && !broken }));
  const realScore = new Map();
  for (const g of games) {
    realScore.set(`${g.wk}|${g.a}`, g.as);
    realScore.set(`${g.wk}|${g.b}`, g.bs);
  }
  const names = pds.players ?? {};
  const rows = new Map();
  for (const [y, wk, f, pid, score, flags] of pds.weeks ?? []) {
    if (y !== year) continue;
    const k = `${wk}|${f}`;
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push({ id: pid, pos: positions.get(pid) ?? names[pid]?.[1] ?? '', name: names[pid]?.[0] ?? pid, score, started: (flags & 1) === 1 });
  }
  const weeks = [...new Set(games.map((g) => g.wk))].sort((a, b) => a - b);
  const playerWeeks = new Set([...rows.keys()].map((k) => Number(k.split('|')[0])));
  return { season, games, realScore, rows, weeks, playerWeeks };
}

const startedPoints = (list) => r2((list ?? []).filter((p) => p.started).reduce((a, p) => a + p.score, 0));

// ── Replay ────────────────────────────────────────────────────────────────

/**
 * Replay one season. `deltaOf(f, wk)` is how many points the what-if adds to
 * franchise f's real score in week wk (0 for an untouched team-week).
 */
function replay(ix, deltaOf, playoffSetup) {
  const { season, games, realScore, rows } = ix;
  const teams = Object.keys(season.teams);
  const scoreOf = (f, wk) => {
    const base = realScore.get(`${wk}|${f}`) ?? (rows.has(`${wk}|${f}`) ? startedPoints(rows.get(`${wk}|${f}`)) : null);
    return base === null ? null : r2(base + deltaOf(f, wk));
  };

  // Regular season: the replay's record is the official row plus whatever the
  // replayed games change, so a replay with no change IS the official row.
  const tally = new Map(teams.map((f) => [f, { w: 0, l: 0, t: 0, pf: 0, rw: 0, rl: 0, rt: 0, rpf: 0, apW: 0, apG: 0 }]));
  const flipped = [];
  const regWeeks = new Map();
  for (const g of games) {
    if (g.playoff) continue;
    const as = scoreOf(g.a, g.wk);
    const bs = scoreOf(g.b, g.wk);
    const same = as === g.as && bs === g.bs;
    // The real result stands while neither score moved (it carries MFL's broken ties).
    const SIDES = { W: [1, 0], L: [0, 1], T: [0.5, 0.5] };
    const [aw, bw] = same ? (g.tie ? SIDES.T : SIDES.W) : SIDES[resultOf(as, bs)];
    for (const [f, real, rep, s, rs] of [
      [g.a, g.tie ? 0.5 : 1, aw, g.as, as],
      [g.b, g.tie ? 0.5 : 0, bw, g.bs, bs],
    ]) {
      const t = tally.get(f);
      if (!t) continue;
      if (real === 1) t.w++; else if (real === 0) t.l++; else t.t++;
      if (rep === 1) t.rw++; else if (rep === 0) t.rl++; else t.rt++;
      t.pf += s;
      t.rpf += rs;
    }
    if (aw !== (g.tie ? 0.5 : 1)) flipped.push({ wk: g.wk, a: g.a, as: g.as, b: g.b, bs: g.bs, ras: as, rbs: bs, aw });
    if (!regWeeks.has(g.wk)) regWeeks.set(g.wk, new Set());
    regWeeks.get(g.wk).add(g.a).add(g.b);
  }
  // All-play over the regular season, real and replay, for the record.
  for (const [wk, set] of regWeeks) {
    const list = [...set].map((f) => [f, scoreOf(f, wk)]).filter(([, s]) => s !== null);
    for (const [f, s] of list) {
      const t = tally.get(f);
      if (!t) continue;
      for (const [o, os] of list) if (o !== f) { t.apG++; t.apW += { W: 1, L: 0, T: 0.5 }[resultOf(s, os)]; }
    }
  }

  const rowsOut = teams.map((f) => {
    const team = season.teams[f];
    const t = tally.get(f);
    const w = team.w + (t.rw - t.w);
    const l = team.l + (t.rl - t.l);
    const tt = team.t + (t.rt - t.t);
    const games = w + l + tt;
    return {
      f,
      team,
      real: { w: team.w, l: team.l, t: team.t, pf: team.pf, rank: team.rk, finish: team.r },
      replay: { w, l, t: tt, pf: r2(team.pf + (t.rpf - t.pf)), winPct: games ? (w + tt / 2) / games : 0, allPlay: t.apG ? t.apW / t.apG : 0 },
    };
  });
  const realWinPct = (r) => {
    const g = r.real.w + r.real.l + r.real.t;
    return g ? (r.real.w + r.real.t / 2) / g : 0;
  };
  // MFL's real order first, then a stable sort on replay win %: level teams keep the league's own order.
  const byRealRank = (a, b) => (a.real.rank ?? 99) - (b.real.rank ?? 99) || realWinPct(b) - realWinPct(a) || a.f.localeCompare(b.f);
  const ordered = rowsOut.slice().sort(byRealRank).sort((a, b) => b.replay.winPct - a.replay.winPct);
  ordered.forEach((r, i) => (r.replay.rank = i + 1));

  const playoffs = playoffSetup ? replayPlayoffs(playoffSetup, ordered, scoreOf, ix) : null;
  if (playoffs?.ok) {
    for (const r of ordered) {
      r.replay.seed = playoffs.seedOf.get(r.f) ?? null;
      r.replay.finish = playoffs.finishOf.get(r.f) ?? 'M';
    }
  }
  return { rows: ordered, flipped, playoffs, scoreOf };
}

// ── Playoffs ──────────────────────────────────────────────────────────────

/**
 * A standard seeded single-elimination bracket of `size` teams opening in
 * `startWeek`, in MFL's playoff-brackets shape: 1 meets the lowest seed left,
 * and byes go to the top seeds (7 teams: 2v7, 3v6, 4v5, then 1 meets the
 * 4v5 winner — exactly TheLeague's own 2019 bracket).
 */
export function standardBracket(size, startWeek) {
  if (!(size >= 2)) return [];
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((o) => [o, n + 1 - o]);
  }
  let slots = order.map((s) => (s <= size ? { seed: String(s) } : null));
  const rounds = [];
  let id = 0;
  let week = startWeek;
  while (slots.length > 1) {
    const games = [];
    const next = [];
    for (let i = 0; i < slots.length; i += 2) {
      const [a, b] = [slots[i], slots[i + 1]];
      if (a && b) {
        const gameId = String(++id);
        games.push({ game_id: gameId, home: a, away: b });
        next.push({ winner_of_game: gameId });
      } else next.push(a ?? b);
    }
    if (games.length) rounds.push({ week: week++, games });
    slots = next;
  }
  return rounds;
}

/**
 * What the season's championship looks like, from its playoff-brackets.json
 * and league.json: the entry brackets, each with the pool it seeds from, and
 * every bracket on the way to the title. `{ reason }` when it cannot be
 * replayed.
 */
export function playoffSetupOf(leagueSlug, bracketsFeed, leagueFeed, season) {
  if (!bracketsFeed) return { reason: 'this season has no playoff bracket on file' };
  const metas = bracketMetas(bracketsFeed);
  const bodies = bracketsFeed?.brackets ?? {};
  const entries = getEntryBracketIds(leagueSlug, bracketsFeed);
  const fed = (id) => toArray(bodies?.[id]?.playoffBracket?.playoffRound).map((r) => ({ week: Number(r.week), games: toArray(r.playoffGame) }));
  // Archive seasons carry only the metadata; their championship is a standard
  // seeded bracket of that size (checked against every season whose body IS on
  // file: TheLeague 2019-2025, the AFL 2024-2025).
  const template = (id) => {
    const rounds = fed(id);
    if (rounds.length) return rounds;
    const meta = metas.find((m) => String(m.id) === id);
    const size = Number(meta?.teamsInvolved);
    const start = Number(meta?.startWeek);
    if (!Number.isFinite(size) || !Number.isFinite(start)) return [];
    if (entries.includes(id)) return standardBracket(size, start);
    // A final between the entry brackets' winners.
    if (size === entries.length && size === 2) {
      const last = (e) => {
        const rounds = template(e);
        return rounds.at(-1)?.games?.[0]?.game_id ?? null;
      };
      const [a, b] = entries.map(last);
      if (!a || !b) return [];
      return [{ week: start, games: [{ game_id: '1', home: { winner_of_game: a, bracket: entries[0] }, away: { winner_of_game: b, bracket: entries[1] } }] }];
    }
    return [];
  };
  const league = leagueFeed?.league ?? leagueFeed;
  const conferences = toArray(league?.conferences?.conference);
  const divisionConf = new Map(toArray(league?.divisions?.division).map((d) => [String(d.id), d.conference != null ? String(d.conference) : null]));
  const franchiseDiv = new Map(toArray(league?.franchises?.franchise).map((f) => [String(f.id), f.division != null ? String(f.division) : null]));
  const teams = Object.keys(season.teams);

  const pools = [];
  if (entries.length === 1) {
    if (conferences.length > 1) return { reason: 'that season seeded both conferences into one bracket, in an order the record does not carry' };
    pools.push({ bracket: entries[0], teams });
  } else {
    for (const id of entries) {
      const meta = metas.find((m) => String(m.id) === id);
      const kind = bracketKindFromName(meta?.name, id);
      const conf = conferences.find((c) => (kind === 'al' ? /^american/i : /^national/i).test(String(c.name ?? '')));
      if (!conf || (kind !== 'al' && kind !== 'nl')) return { reason: 'its conference brackets could not be matched to conferences' };
      pools.push({ bracket: id, teams: teams.filter((f) => divisionConf.get(franchiseDiv.get(f)) === String(conf.id)) });
    }
  }
  for (const p of pools) {
    const meta = metas.find((m) => String(m.id) === p.bracket);
    p.size = Number(meta?.teamsInvolved) || 0;
    p.rounds = template(p.bracket);
    if (!p.size || !p.rounds.length || !p.teams.length) return { reason: 'its championship bracket is not on file in full' };
  }
  // Every bracket the title runs through: the entries, and any that read their winners.
  const ids = new Set(entries);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of metas) {
      const id = String(m.id);
      if (ids.has(id)) continue;
      const reads = template(id).some((r) => r.games.some((g) => [g.home, g.away].some((s) => s?.winner_of_game && s.bracket && ids.has(String(s.bracket)))));
      if (reads && /champion/i.test(`${m.name} ${m.bracketWinnerTitle}`) && !/consolation|loser|toilet|place|nit/i.test(String(m.name))) {
        ids.add(id);
        grew = true;
      }
    }
  }
  const brackets = [...ids].map((id) => ({ id, rounds: template(id) }));
  // The title bracket is the one nobody else reads.
  const readBy = new Set(brackets.flatMap((b) => b.rounds.flatMap((r) => r.games.flatMap((g) => [g.home, g.away].map((s) => (s?.winner_of_game && s.bracket ? String(s.bracket) : null))))).filter(Boolean));
  const title = brackets.filter((b) => !readBy.has(b.id));
  if (title.length !== 1) return { reason: 'its title game could not be found in the bracket' };

  // The seeds the league really gave, where MFL's export names them.
  const realSeeds = new Map();
  for (const p of pools) {
    for (const r of p.rounds) for (const g of r.games) for (const s of [g.home, g.away]) {
      if (s?.seed && s.franchise_id) realSeeds.set(String(s.franchise_id), Number(s.seed));
    }
  }
  return { pools, brackets, titleId: title[0].id, realSeeds, franchiseDiv };
}

const MADE = new Set(['C', 'R', '3', 'P']);

/** How a season seeds its field: division winners first, or everyone by record. */
export const SEEDING_STYLES = ['division', 'record'];

/**
 * The seeds the league really gave, where MFL's export does not name them:
 * the seeding of the real field whose bracket walk reproduces every real
 * playoff game (who met whom, and who won). Several seedings can (the two
 * teams of an opening game can swap seeds without changing a game), so the
 * one closest to the real standings order wins. Used only to break replay
 * ties, so a replay with nothing changed gives back the real bracket.
 */
export function inferRealSeeds(setup, ix) {
  const seeds = new Map(setup.realSeeds);
  const unmatched = [];
  const winnerOf = new Map();
  for (const g of ix.games) if (g.playoff) winnerOf.set(`${g.wk}|${[g.a, g.b].sort().join('-')}`, g.a);
  const teams = ix.season.teams;
  const winPct = (t) => (t.w + t.t / 2) / (t.w + t.l + t.t || 1);
  for (const pool of setup.pools) {
    const field = pool.teams.filter((f) => MADE.has(teams[f]?.r));
    if (field.some((f) => seeds.has(f))) continue;
    if (field.length !== pool.size || field.length > 8) {
      unmatched.push(pool.bracket);
      continue;
    }
    const base = field.slice().sort((a, b) => winPct(teams[b]) - winPct(teams[a]) || teams[b].wd - teams[a].wd || (teams[a].rk ?? 99) - (teams[b].rk ?? 99));
    const consistent = (perm) => {
      const won = new Map();
      for (const round of pool.rounds) {
        for (const g of round.games) {
          const side = (s) => (s?.seed ? perm[Number(s.seed) - 1] : won.get(String(s?.winner_of_game)));
          const [h, a] = [side(g.home), side(g.away)];
          const w = h && a ? winnerOf.get(`${round.week}|${[h, a].sort().join('-')}`) : null;
          if (!w) return false;
          won.set(String(g.game_id), w);
        }
      }
      return true;
    };
    let best = null;
    let bestCost = Infinity;
    const perm = [];
    const used = new Set();
    const walk = (cost) => {
      if (cost >= bestCost) return;
      if (perm.length === base.length) {
        if (consistent(perm)) {
          best = [...perm];
          bestCost = cost;
        }
        return;
      }
      for (let i = 0; i < base.length; i++) {
        if (used.has(i)) continue;
        used.add(i);
        perm.push(base[i]);
        walk(cost + Math.abs(i - (perm.length - 1)));
        perm.pop();
        used.delete(i);
      }
    };
    walk(0);
    if (best) best.forEach((f, i) => seeds.set(f, i + 1));
    else unmatched.push(pool.bracket);
  }
  return { seeds, unmatched };
}

function replayPlayoffs(setup, ordered, scoreOf, ix) {
  if (setup.reason) return { ok: false, reason: setup.reason };
  const pos = new Map(ordered.map((r, i) => [r.f, i]));
  const division = (r) => setup.franchiseDiv.get(r.f) ?? r.team.d ?? null;
  const seedOf = new Map();
  const finishOf = new Map();
  const seeds = new Map(); // bracket → seed → franchise
  for (const pool of setup.pools) {
    const inPool = new Set(pool.teams);
    // Pool order: a seed the league really gave first, then the replay standings.
    const list = ordered
      .filter((r) => inPool.has(r.f))
      .sort((a, b) => b.replay.winPct - a.replay.winPct || (setup.realSeeds.get(a.f) ?? 99) - (setup.realSeeds.get(b.f) ?? 99) || pos.get(a.f) - pos.get(b.f));
    const winners = [];
    const seen = new Set();
    // A division's winner: its best replay record; the real winner keeps a tie.
    const divOrder = list.slice().sort((a, b) => b.replay.winPct - a.replay.winPct || b.team.wd - a.team.wd || pos.get(a.f) - pos.get(b.f));
    for (const r of divOrder) {
      const d = division(r);
      if (d == null || seen.has(d)) continue;
      seen.add(d);
      winners.push(r);
    }
    const winnerSet = new Set(winners.map((r) => r.f));
    // Division winners are always in; `setup.style` says whether they are also seeded first.
    const divFirst = setup.style !== 'record' && winners.length && winners.length < pool.size;
    const wild = list.filter((r) => !winnerSet.has(r.f)).slice(0, Math.max(0, pool.size - winners.length));
    const inField = new Set([...winners.slice(0, pool.size), ...wild].map((r) => r.f));
    const field = divFirst
      ? [...list.filter((r) => winnerSet.has(r.f)), ...wild]
      : list.filter((r) => inField.has(r.f));
    const map = new Map();
    field.forEach((r, i) => {
      map.set(i + 1, r.f);
      seedOf.set(r.f, i + 1);
      finishOf.set(r.f, 'P');
    });
    seeds.set(pool.bracket, map);
  }

  // Walk every bracket in week order.
  const results = new Map(); // `${bracket}|${game}` → { winner, loser }
  const realGame = new Map();
  for (const g of ix.games) if (g.playoff) realGame.set(`${g.wk}|${[g.a, g.b].sort().join('-')}`, g);
  const rounds = setup.brackets.flatMap((b) => b.rounds.map((r) => ({ ...r, bracket: b.id }))).sort((a, b) => a.week - b.week);
  const sideTeam = (side, bracket) => {
    if (side?.seed) return seeds.get(bracket)?.get(Number(side.seed)) ?? null;
    const ref = results.get(`${side?.bracket ? String(side.bracket) : bracket}|${side?.winner_of_game ?? side?.loser_of_game}`);
    if (!ref) return null;
    return side.winner_of_game ? ref.winner : ref.loser;
  };
  let title = null;
  for (const round of rounds) {
    for (const g of round.games) {
      const home = sideTeam(g.home, round.bracket);
      const away = sideTeam(g.away, round.bracket);
      if (!home || !away) return { ok: false, reason: 'the replayed bracket left a game without two teams' };
      const hs = scoreOf(home, round.week);
      const as = scoreOf(away, round.week);
      if (hs === null || as === null) {
        const who = ix.season.teams[hs === null ? home : away]?.n ?? (hs === null ? home : away);
        return { ok: false, reason: `the replayed bracket sends ${who} to a Week ${round.week} game, and that week has no score for them (they did not play)` };
      }
      const real = realGame.get(`${round.week}|${[home, away].sort().join('-')}`);
      let winner;
      if (real && ((real.a === home && real.as === hs && real.bs === as) || (real.a === away && real.as === as && real.bs === hs))) winner = real.a;
      else if (hs !== as) winner = hs > as ? home : away;
      else winner = (seedOf.get(home) ?? 99) <= (seedOf.get(away) ?? 99) ? home : away;
      const loser = winner === home ? away : home;
      results.set(`${round.bracket}|${g.game_id}`, { winner, loser, week: round.week, hs, as, home, away });
      if (round.bracket === setup.titleId) title = { winner, loser, week: round.week, hs, as, home, away };
    }
  }
  if (!title) return { ok: false, reason: 'the replayed bracket never reached a title game' };
  finishOf.set(title.winner, 'C');
  finishOf.set(title.loser, 'R');
  return { ok: true, seedOf, finishOf, title, fieldSize: setup.pools.reduce((a, p) => a + p.size, 0) };
}

// ── Scenarios ─────────────────────────────────────────────────────────────

function teamMatcher(ds, year, query, label) {
  const season = ds.seasons.find((s) => s.y === year);
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) throw new WhatIfError(`Say which ${label}.`);
  const ownerName = (t) => String(t.h ?? '').split('+').map((id) => ds.owners?.[id]?.name ?? '').join(' & ');
  const entries = Object.entries(season.teams);
  let hits = entries.filter(([, t]) => t.n.toLowerCase().includes(q) || ownerName(t).toLowerCase().includes(q));
  if (!hits.length) {
    // A renamed team: the franchise slot under any of its other names.
    const slots = new Set(ds.seasons.flatMap((s) => Object.entries(s.teams).filter(([, t]) => t.n.toLowerCase().includes(q)).map(([f]) => f)));
    hits = entries.filter(([f]) => slots.has(f));
  }
  const exact = hits.filter(([, t]) => t.n.toLowerCase() === q);
  if (exact.length === 1) hits = exact;
  if (!hits.length) throw new WhatIfError(`No ${year} team matches "${query}". ${year} teams: ${entries.map(([, t]) => t.n).join(', ')}.`);
  if (hits.length > 1) throw new WhatIfError(`"${query}" matches more than one ${year} team: ${hits.map(([, t]) => t.n).join(', ')}. Use the full name.`);
  return hits[0][0];
}

const record = (o) => `${o.w}-${o.l}${o.t ? `-${o.t}` : ''}`;

/** The players a franchise received and gave in one trade row. */
function tradeSides(trade) {
  const [, , , fa, fb, aGave, bGave] = trade;
  const players = (list) => String(list ?? '').split(',').filter((t) => t && !parsePickToken(t));
  const picks = (list) => String(list ?? '').split(',').filter((t) => t && parsePickToken(t));
  return { fa, fb, aGave: players(aGave), bGave: players(bGave), picks: picks(aGave).length + picks(bGave).length };
}

/**
 * The trade the question means: in league year `year`, between `team` and
 * (optionally) `partner`, narrowed by `player` and `date` when there are
 * several. Throws with the candidates when it is still ambiguous.
 */
function findTrade(ds, moves, input) {
  const year = input.year;
  const nameOf = (pid) => moves.players?.[pid]?.[0] ?? pid;
  const fTeam = teamMatcher(ds, year, input.team, 'team made the trade');
  const fPartner = input.partner ? teamMatcher(ds, year, input.partner, 'partner') : null;
  let list = (moves.trades ?? []).filter((t) => t[0] === year && (t[3] === fTeam || t[4] === fTeam) && (!fPartner || t[3] === fPartner || t[4] === fPartner));
  const sides = (t) => tradeSides(t);
  list = list.filter((t) => sides(t).aGave.length + sides(t).bGave.length > 0);
  if (input.date && list.some((t) => t[1] === input.date)) list = list.filter((t) => t[1] === input.date);
  if (input.player) {
    const p = String(input.player).toLowerCase();
    const hit = list.filter((t) => [...sides(t).aGave, ...sides(t).bGave].some((pid) => nameOf(pid).toLowerCase().includes(p)));
    if (hit.length) list = hit;
  }
  const team = (f) => ds.seasons.find((s) => s.y === year)?.teams?.[f]?.n ?? f;
  const describe = (t) => `${t[1]}: ${team(t[3])} gave ${sides(t).aGave.map(nameOf).join(', ') || 'picks only'}; ${team(t[4])} gave ${sides(t).bGave.map(nameOf).join(', ') || 'picks only'}`;
  if (!list.length) throw new WhatIfError(`No ${year} trade with players found for ${team(fTeam)}${fPartner ? ` and ${team(fPartner)}` : ''}.`);
  if (list.length > 1) throw new WhatIfError(`${list.length} trades match; pass date (or player) to pick one: ${list.slice(0, 8).map(describe).join(' | ')}`);
  return { trade: list[0], describe: describe(list[0]) };
}

/** Which season a trade made in league year y, NFL week wk, changes, and from which week. */
export function tradeEffect(year, week) {
  if (week > nflRegularWeeks(year)) return { season: year + 1, fromWeek: 1, after: true };
  return { season: year, fromWeek: Math.max(1, week), after: false };
}

/**
 * Everything a replay of `season` needs, checked once: its games and rosters,
 * its starter rules, its bracket, and the CONTROL — the replay with nothing
 * changed — which settles the season's seeding style and says whether the
 * engine gives back the real bracket. `run(deltaOf)` replays the season with
 * `deltaOf(f, wk)` points added to franchise f's real score in week wk.
 */
function prepareReplay(ds, pds, season, { leagueSlug, feeds }) {
  const fd = feeds?.(season) ?? {};
  const positions = seasonPositions(fd.players);
  const ix = indexSeason(ds, pds, season, positions);
  if (!ix.playerWeeks.size) throw new WhatIfError(`There are no player scores for ${season}, so its lineups cannot be replayed.`);
  const rules = parseStarterRules(fd.league);
  if (!rules) throw new WhatIfError(`The ${season} starter rules are not on file, so a legal lineup cannot be built for that season.`);

  const setup = playoffSetupOf(leagueSlug, fd.brackets, fd.league, ix.season);
  let unmatched = false;
  if (!setup.reason && ix.season.done) {
    const inferred = inferRealSeeds(setup, ix);
    setup.realSeeds = inferred.seeds;
    unmatched = inferred.unmatched.length > 0;
  }
  const playable = ix.season.done ? setup : { reason: `the ${season} season is still being played` };

  // Does the replay engine, given the real season, give back the real bracket?
  // Division winners are always in the field; whether they are also SEEDED
  // first changed over the years (TheLeague seeded by record in the 2010s and
  // seeds division winners first now), so the control picks the style that
  // reproduces this season, division-first when neither does.
  const realChamp = Object.entries(ix.season.teams).find(([, t]) => t.r === 'C')?.[0] ?? null;
  const realRunnerUp = Object.entries(ix.season.teams).find(([, t]) => t.r === 'R')?.[0] ?? null;
  const realField = new Set(Object.entries(ix.season.teams).filter(([, t]) => MADE.has(t.r)).map(([f]) => f));
  const reproduces = (run) => {
    if (!run.playoffs?.ok) return false;
    const field = new Set(run.rows.filter((r) => r.replay.seed).map((r) => r.f));
    return field.size === realField.size && [...field].every((f) => realField.has(f)) && run.playoffs.title.winner === realChamp && run.playoffs.title.loser === realRunnerUp;
  };
  let control = null;
  let controlCheck = null;
  for (const style of SEEDING_STYLES) {
    setup.style = style;
    control = replay(ix, () => 0, playable);
    if (reproduces(control)) {
      controlCheck = 'reproduces';
      break;
    }
  }
  if (!controlCheck) {
    setup.style = SEEDING_STYLES[0];
    control = replay(ix, () => 0, playable);
    if (control.playoffs?.ok) controlCheck = 'differs';
    // A bracket on file that the real games do not fit (2019's) is not that season's bracket.
    else if (unmatched && !playable.reason) setup.reason = 'the bracket on file does not match the playoff games that were played';
  }
  return { ix, rules, positions, setup, playable, control, controlCheck, realChamp, run: (deltaOf) => replay(ix, deltaOf, playable) };
}

/**
 * Replay `season` with every team starting the lineup `lineup(f, wk, roster,
 * rules)` picks (an array of player ids, or null to keep what it really
 * started). Passing each team's real starters gives back the real season, game
 * for game — the property the what-ifs rest on.
 */
export function replayLineups(ds, pds, season, { leagueSlug, feeds, lineup }) {
  const prep = prepareReplay(ds, pds, season, { leagueSlug, feeds });
  const { ix, rules } = prep;
  const run = prep.run((f, wk) => {
    const real = ix.rows.get(`${wk}|${f}`);
    if (!real) return 0;
    const ids = lineup(f, wk, real, rules);
    if (!ids) return 0;
    const pick = new Set(ids);
    return r2(real.filter((p) => pick.has(p.id)).reduce((a, p) => a + p.score, 0) - startedPoints(real));
  });
  return { ...run, controlCheck: prep.controlCheck, label: REPLAY_LABEL };
}


/**
 * Run one what-if. `feeds(year)` returns that season's `{ league, brackets,
 * players }` (league.json, playoff-brackets.json, players.json; any may be
 * null, and the result says what that cost).
 *
 * @returns the answer table (AskTable shape, with a `compare` chart) and
 * `summary`, the facts the model words its answer from.
 */
export function runWhatIf(ds, pds, moves, input, { leagueSlug, feeds }) {
  const kind = String(input?.kind ?? '');
  if (!WHAT_IF_KINDS.includes(kind)) throw new WhatIfError(`kind must be one of ${WHAT_IF_KINDS.join(', ')}`);
  if (!pds?.weeks) throw new WhatIfError('This league has no player scores, so no lineup can be replayed.');
  const year = Number(input?.year);
  if (!Number.isInteger(year)) throw new WhatIfError('Say which season (year).');

  let season = year;
  let subjects = [];
  let fromWeek = 1;
  let swap = null; // undo_trade: f → { out: Set<pid>, back: Map<pid, fromFranchise> }
  let scenario;
  let tradeText = null;
  let picksNote = null;
  const assumptions = [];

  if (kind === 'best_lineup') {
    if (input.team) subjects = [teamMatcher(ds, year, input.team, 'team')];
    scenario = null;
  } else {
    if (!moves?.trades) throw new WhatIfError('This league has no trade record.');
    const { trade, describe } = findTrade(ds, moves, input);
    const { fa, fb, aGave, bGave, picks } = tradeSides(trade);
    const effect = tradeEffect(trade[0], trade[2]);
    season = effect.season;
    fromWeek = effect.fromWeek;
    subjects = [fa, fb];
    swap = new Map([
      [fa, { out: new Set(bGave), back: new Map(aGave.map((p) => [p, fb])) }],
      [fb, { out: new Set(aGave), back: new Map(bGave.map((p) => [p, fa])) }],
    ]);
    tradeText = describe;
    if (effect.after) assumptions.push(`The trade was made after the ${trade[0]} season, so the replay is the ${season} season.`);
    if (picks) picksNote = 'Draft picks in the trade are left out: only the players are undone.';
  }

  const prep = prepareReplay(ds, pds, season, { leagueSlug, feeds });
  const { ix, rules, positions, setup, playable, controlCheck, realChamp } = prep;

  const lineupCache = new Map();
  const rosterOf = (f, wk) => {
    const real = ix.rows.get(`${wk}|${f}`) ?? [];
    const s = swap?.get(f);
    if (!s || wk < fromWeek) return real;
    const kept = real.filter((p) => !s.out.has(p.id));
    // A player given up comes back for the weeks the other side really had him.
    for (const [pid, other] of s.back) {
      const there = (ix.rows.get(`${wk}|${other}`) ?? []).find((p) => p.id === pid);
      if (there && !kept.some((p) => p.id === pid)) kept.push({ ...there, started: false });
    }
    return kept;
  };
  const optimized = new Set(subjects.length ? subjects : Object.keys(ix.season.teams));
  const best = (f, wk, roster) => {
    const key = `${f}|${wk}|${roster === ix.rows.get(`${wk}|${f}`) ? 'real' : 'swap'}`;
    if (!lineupCache.has(key)) lineupCache.set(key, bestLineup(roster, rules));
    return lineupCache.get(key);
  };
  const deltaFor = (useSwap) => (f, wk) => {
    if (!optimized.has(f) || (swap && wk < fromWeek)) return 0;
    const real = ix.rows.get(`${wk}|${f}`);
    if (!real) return 0;
    const roster = useSwap ? rosterOf(f, wk) : real;
    return r2(best(f, wk, roster).points - startedPoints(real));
  };
  const result = prep.run(deltaFor(true));
  const lineupOnly = swap ? prep.run(deltaFor(false)) : null;

  // ── The table ──
  const ownerName = (t) => String(t.h ?? '').split('+').map((id) => ds.owners?.[id]?.name).filter(Boolean).join(' & ') || null;
  const ownerSlug = (t) => ds.owners?.[String(t.h ?? '').split('+')[0]]?.slug ?? null;
  const playoffsOk = !!result.playoffs?.ok;
  const finishText = (code, seed) => `${FINISH[code] ?? FINISH.M}${seed ? ` (${seed} seed)` : ''}`;
  const columns = [
    { key: 'team', label: 'Team' },
    { key: 'owner', label: 'Owner' },
    { key: 'realRecord', label: 'Real W-L' },
    { key: 'replayRecord', label: 'Replay W-L' },
    { key: 'realPf', label: 'Real PF' },
    { key: 'replayPf', label: 'Replay PF' },
    { key: 'realRank', label: 'Real rank' },
    { key: 'replayRank', label: 'Replay rank' },
    { key: 'realFinish', label: 'Real finish' },
    ...(playoffsOk ? [{ key: 'replayFinish', label: 'Replay finish' }] : []),
  ];
  const subjectSet = new Set(subjects);
  const tableRows = result.rows.map((r) => {
    const realSeed = setup.realSeeds?.get(r.f) ?? null;
    const cells = [
      r.team.n,
      ownerName(r.team),
      record(r.real),
      record(r.replay),
      r.real.pf,
      r.replay.pf,
      r.real.rank,
      r.replay.rank,
      finishText(r.real.finish, realSeed),
      ...(playoffsOk ? [finishText(r.replay.finish, r.replay.seed)] : []),
    ];
    return { cells, franchiseId: r.f, ownerSlug: ownerSlug(r.team), year: season };
  });

  // Chart: real vs replay wins, for the teams a reader is looking for.
  const confOf = (f) => setup.pools?.find((p) => p.teams.includes(f))?.bracket ?? null;
  let chartRows = result.rows;
  if (chartRows.length > 16 && subjects.length) {
    const pools = new Set(subjects.map(confOf));
    chartRows = chartRows.filter((r) => pools.has(confOf(r.f)));
  }
  if (chartRows.length > 16) chartRows = chartRows.filter((r) => subjectSet.has(r.f) || r.replay.w !== r.real.w || r.replay.rank <= 12).slice(0, 16);
  const chart = {
    kind: 'compare',
    field: 'wins',
    label: 'Wins',
    asc: false,
    rows: [],
    population: [],
    compare: {
      title: `Real vs. replay wins, ${season}`,
      realLabel: 'Real',
      replayLabel: 'Replay',
      rows: chartRows.map((r) => ({
        name: r.team.n,
        franchiseId: r.f,
        real: r.real.w,
        replay: r.replay.w,
        realDisplay: record(r.real),
        replayDisplay: record(r.replay),
        subject: subjectSet.has(r.f),
      })),
    },
  };

  const teamName = (f) => ix.season.teams[f]?.n ?? f;
  const scen = kind === 'best_lineup'
    ? `${subjects.length ? teamName(subjects[0]) : 'every team'} starting the best legal lineup every week`
    : `the trade never happening (${tradeText})`;
  const description = `${REPLAY_LABEL}: ${season} with ${scen}`;

  assumptions.push(
    kind === 'best_lineup'
      ? `Best lineup = the highest-scoring legal lineup from the players ${subjects.length ? 'the team' : 'each team'} really had rostered that week, under the ${season} starter rules: ${describeStarterRules(rules)}. Every other team's score is what it really scored.`
      : `From Week ${fromWeek} to the end of ${season}, each side keeps the players it gave up (for the weeks the other side really had them) and never gets the ones it received; nothing else about either roster changes. Both sides then start their best legal lineup from that roster (${describeStarterRules(rules)}), so part of any swing is lineup choices, not the trade (see lineupOnly). Every other team's score is what it really scored.`,
    positions.size ? `Positions are each player's ${season} MFL position.` : `The ${season} player list is not on file, so positions are each player's latest MFL position.`,
    'Replay standings: by replay win %, and teams level on replay win % keep the order MFL really had them in (the league\'s own tiebreakers, which a replay cannot re-run). These are not the real standings.',
  );
  if (picksNote) assumptions.push(picksNote);
  if (playoffsOk) {
    const seeding = setup.style === 'record' ? 'every division winner gets in and the field is seeded by replay record' : 'division winners seeded first, then wild cards, by replay record';
    assumptions.push(`Playoffs: the ${season} championship bracket replayed with the same field size (${result.playoffs.fieldSize}); ${seeding}${controlCheck === 'reproduces' ? ` (the way ${season} really seeded: replayed with nothing changed, it gives back the real bracket)` : ''}; a tie on points goes to the higher seed.`);
    if (controlCheck === 'differs') assumptions.push(`Caution: replayed with nothing changed, this seeding rule does not give back the real ${season} bracket (seeding ties the record cannot settle), so read the replay's playoff result as approximate.`);
  }
  const noPlayers = ix.weeks.filter((wk) => !ix.playerWeeks.has(wk));
  if (noPlayers.length) assumptions.push(`No player scores for Week${noPlayers.length > 1 ? 's' : ''} ${noPlayers.join(', ')}: those weeks are kept as played.`);

  const subjectSummary = (f, run) => {
    const r = run.rows.find((x) => x.f === f);
    const real = r.real;
    return {
      team: teamName(f),
      real: { record: record(real), pf: real.pf, rank: real.rank, finish: FINISH[real.finish] ?? FINISH.M },
      replay: { record: record(r.replay), pf: r.replay.pf, rank: r.replay.rank, finish: run.playoffs?.ok ? finishText(r.replay.finish, r.replay.seed) : null },
    };
  };
  const flips = (f) =>
    result.flipped
      .filter((g) => g.a === f || g.b === f)
      .map((g) => {
        const mine = g.a === f;
        const [s, os, rs, ros] = mine ? [g.as, g.bs, g.ras, g.rbs] : [g.bs, g.as, g.rbs, g.ras];
        return { week: g.wk, opponent: teamName(mine ? g.b : g.a), real: `${resultOf(s, os)} ${s}-${os}`, replay: `${resultOf(rs, ros)} ${rs}-${ros}` };
      });
  const changed = result.rows.filter((r) => r.replay.w !== r.real.w || r.replay.l !== r.real.l || r.replay.t !== r.real.t);
  const summary = {
    label: REPLAY_LABEL,
    season,
    scenario: scen,
    assumptions,
    subjects: (subjects.length ? subjects : []).map((f) => ({ ...subjectSummary(f, result), flippedGames: flips(f) })),
    ...(subjects.length ? {} : { teamsWithDifferentRecords: changed.length, biggestGains: changed.slice().sort((a, b) => b.replay.w - b.real.w - (a.replay.w - a.real.w)).slice(0, 5).map((r) => subjectSummary(r.f, result)) }),
    ...(lineupOnly ? { lineupOnly: subjects.map((f) => ({ ...subjectSummary(f, lineupOnly), note: 'best lineups with the trade KEPT: the lineup effect alone' })) } : {}),
    gamesThatFlipped: result.flipped.length,
    champion: {
      real: realChamp ? teamName(realChamp) : null,
      replay: playoffsOk ? teamName(result.playoffs.title.winner) : null,
      replayTitleGame: playoffsOk ? `Week ${result.playoffs.title.week}: ${teamName(result.playoffs.title.home)} ${result.playoffs.title.hs} - ${teamName(result.playoffs.title.away)} ${result.playoffs.title.as}` : null,
    },
    playoffs: playoffsOk ? { replayed: true, controlReproducesRealBracket: controlCheck === 'reproduces' } : { replayed: false, reason: result.playoffs?.reason ?? playable.reason ?? 'no bracket' },
  };

  return {
    description,
    total: tableRows.length,
    columns,
    rows: tableRows,
    summary: {},
    chart,
    whatIf: summary,
  };
}
