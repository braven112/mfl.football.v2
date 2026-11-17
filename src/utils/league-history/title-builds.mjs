/**
 * Title builds — how a team's starters got there, and what a trade was worth
 * over every season that followed. Pure: it reads the stints (stints.mjs) and
 * pick chains (pick-chains.mjs) the Ask engine already builds, plus the moves
 * file's trades, and returns plain objects keyed by franchise id and player id.
 * ask-title-builds.mjs names them and turns them into query rows.
 *
 * Three answers:
 * - `starterIndex` / `buildMix`: every player who started for a team in a
 *   season, with how that team got him, summed by acquisition method (the
 *   "how was each title team built" mix, and the same for this season's
 *   contenders).
 * - `titleTrades`: every trade that put a starter on a champion's roster, in
 *   the title season or any earlier one: a player who came in the trade and
 *   stayed, or a draft pick that came in the trade and was used on him.
 * - `tradeOutcomes`: every trade, both sides, each player and pick followed
 *   forward for as long as the team that got it kept it (all seasons, not just
 *   the rest of that one): starter points, playoff points, titles.
 *
 * Nothing is guessed. A starter whose arrival predates the transaction record
 * stays `unknown`; a pick the record cannot pin to a player stays unresolved;
 * a piece traded on is counted as traded on, not credited with what it later
 * became.
 */
import { ENDED, HOW, stintTotals, tradeIds } from './stints.mjs';

const r2 = (n) => Math.round(n * 100) / 100;

/** Acquisition methods in the order the mix lists (and colors) them; unknown last. */
export const MIX = [HOW.draft, HOW.trade, HOW.waiver, HOW.freeAgent, HOW.auction, HOW.commissioner, HOW.inherited, HOW.unknown];

const isPick = (token) => /^(FP|DP)_/.test(token);
const tokensOf = (csv) =>
  String(csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The moves file's trades by id (stints.mjs tradeIds): who gave what.
 * @returns {Map<string, { index: number, id: string, year: number, date: string, week: number, a: string, b: string, gave: Record<string, string[]> }>}
 */
export function tradeIndex(trades) {
  const ids = tradeIds(trades);
  const out = new Map();
  (trades ?? []).forEach(([year, date, week, a, b, aGave, bGave], index) => {
    out.set(ids[index], { index, id: ids[index], year, date, week, a, b, gave: { [a]: tokensOf(aGave), [b]: tokensOf(bGave) } });
  });
  return out;
}

/** The other franchise in a trade. */
export const otherSide = (t, f) => (t.a === f ? t.b : t.a);

/**
 * Every starter of every team-season: `${year}|${franchiseId}` → one entry per
 * player who started at least one counted week, credited to the stint he
 * started most for that season (a player dropped and re-added keeps one row).
 * @returns {Map<string, Array<{ pid: string, stint: any, starts: number, points: number, playoffStarts: number, playoffPoints: number, carriedOver: boolean, keeper: boolean | null }>>}
 */
export function starterIndex(stints) {
  const parts = new Map();
  for (const s of stints) {
    for (const [y, ss] of s.seasons) {
      if (!ss.starts) continue;
      const k = `${y}|${s.franchiseId}`;
      if (!parts.has(k)) parts.set(k, new Map());
      const byPid = parts.get(k);
      if (!byPid.has(s.pid)) byPid.set(s.pid, []);
      byPid.get(s.pid).push({ s, ss });
    }
  }
  const out = new Map();
  for (const [k, byPid] of parts) {
    const list = [];
    for (const [pid, ps] of byPid) {
      const main = ps.slice().sort((a, b) => b.ss.starts - a.ss.starts)[0];
      const sum = (f) => r2(ps.reduce((a, x) => a + x.ss[f], 0));
      list.push({
        pid,
        stint: main.s,
        starts: sum('starts'),
        points: sum('points'),
        playoffStarts: sum('playoffStarts'),
        playoffPoints: sum('playoffPoints'),
        carriedOver: main.ss.carriedOver,
        keeper: main.ss.keeper,
      });
    }
    list.sort((a, b) => b.points - a.points);
    out.set(k, list);
  }
  return out;
}

/**
 * One team-season's starters summed by how the team got them: count and
 * starter points per method, and how many were carried over from an earlier
 * season (a keeper, a contract) rather than added for this one.
 */
export function buildMix(starters) {
  const byHow = Object.fromEntries(MIX.map((h) => [h, { count: 0, points: 0 }]));
  const carried = { count: 0, points: 0 };
  let keeper = null;
  let points = 0;
  for (const st of starters ?? []) {
    const how = byHow[st.stint.how] ? st.stint.how : HOW.unknown;
    byHow[how].count++;
    byHow[how].points = r2(byHow[how].points + st.points);
    points = r2(points + st.points);
    if (st.carriedOver) {
      carried.count++;
      carried.points = r2(carried.points + st.points);
    }
    if (st.keeper != null) {
      keeper ??= { count: 0, points: 0 };
      if (st.keeper) {
        keeper.count++;
        keeper.points = r2(keeper.points + st.points);
      }
    }
  }
  return { starters: (starters ?? []).length, points, byHow, carried, keeper };
}

/** Pick chains by the player they were used on: `${draftYear}|${usedBy}|${pid}`. */
export function chainsByUse(chains) {
  const out = new Map();
  for (const c of chains ?? []) if (c.used) out.set(`${c.year}|${c.used.by}|${c.used.pid}`, c);
  return out;
}

/**
 * How a trade put this starter on the team, if one did: the trade that
 * brought HIM, or the trade that brought the PICK he was drafted with. Null
 * when no trade did. A drafted player whose pick the draft record says was
 * traded, with no chain on record, still links (`tradeId` null): the record
 * names the team the pick came from, not the trade.
 * @returns {{ tradeId: string | null, via: 'player' | 'pick', from: string | null, date: string | null, year: number | null, chain: any } | null}
 */
export function tradeLink(stint, byUse) {
  if (stint.how === HOW.trade) {
    return { tradeId: stint.ref.tradeId, via: 'player', from: stint.ref.from, date: stint.start?.date ?? null, year: stint.start?.year ?? null, chain: null };
  }
  if (stint.how !== HOW.draft) return null;
  const chain = byUse.get(`${stint.ref?.year}|${stint.franchiseId}|${stint.pid}`);
  const hop = chain?.hops.filter((h) => h.to === stint.franchiseId).at(-1);
  if (hop) return { tradeId: hop.tradeId ?? null, via: 'pick', from: hop.from, date: hop.date ?? null, year: hop.year ?? null, chain };
  if (stint.ref?.from) return { tradeId: null, via: 'pick', from: stint.ref.from, date: null, year: null, chain: chain ?? null };
  return null;
}

/**
 * Every trade that put a starter on a champion: one entry per (title season,
 * trade), with the starters it led to and what they scored that season.
 * `champions` is `[{ year, franchiseId }]`.
 */
export function titleTrades(champions, starters, byUse, trades) {
  const out = [];
  for (const { year, franchiseId } of champions) {
    const groups = new Map();
    for (const st of starters.get(`${year}|${franchiseId}`) ?? []) {
      const link = tradeLink(st.stint, byUse);
      if (!link) continue;
      const key = link.tradeId ?? `pick:${link.chain?.id ?? `${st.stint.ref?.year}:${link.from}:${st.pid}`}`;
      if (!groups.has(key)) groups.set(key, { link, players: [] });
      groups.get(key).players.push({ ...st, via: link.via, chain: link.chain });
    }
    const rows = [...groups.values()].map(({ link, players }) => {
      const t = link.tradeId ? trades.get(link.tradeId) ?? null : null;
      const sum = (f) => r2(players.reduce((a, p) => a + p[f], 0));
      return {
        year,
        franchiseId,
        tradeId: link.tradeId,
        trade: t,
        partner: t ? otherSide(t, franchiseId) : link.from,
        tradeYear: t?.year ?? link.year,
        tradeDate: t?.date ?? link.date,
        players,
        starts: sum('starts'),
        points: sum('points'),
        playoffStarts: sum('playoffStarts'),
        playoffPoints: sum('playoffPoints'),
        gave: t ? t.gave[franchiseId] ?? [] : null,
        got: t ? t.gave[otherSide(t, franchiseId)] ?? [] : null,
      };
    });
    rows.sort((a, b) => b.points - a.points || b.playoffPoints - a.playoffPoints);
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.ofTrades = rows.length;
    });
    out.push(...rows);
  }
  return out;
}

/**
 * Every trade, both sides, every piece followed forward: a player for as long
 * as the team that got him kept him (the stint this trade opened, every
 * season of it), and a pick through to the player it was used on and his
 * stint with the team that drafted him. A piece the team traded on is marked
 * `traded on`, and what it later became is not credited (that is the next
 * trade's outcome). `finish(year, franchiseId)` is the season's finish code
 * ('C' = champion) or null.
 */
export function tradeOutcomes(stints, chains, trades, finish) {
  const byKey = new Map();
  for (const s of stints) {
    const k = `${s.franchiseId}|${s.pid}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  // Each trade's picks, by the chains that moved in it.
  const picksIn = new Map();
  for (const c of chains ?? []) {
    for (const h of c.hops) {
      if (!h.tradeId) continue;
      if (!picksIn.has(h.tradeId)) picksIn.set(h.tradeId, []);
      picksIn.get(h.tradeId).push({ chain: c, hop: h });
    }
  }
  const titleYearsOf = (s) => [...s.seasons].filter(([y, ss]) => ss.starts > 0 && finish(y, s.franchiseId) === 'C').map(([y]) => y);
  const valueOf = (s) => {
    const t = stintTotals(s);
    const years = [...s.seasons.keys()].sort((a, b) => a - b);
    return { ...t, seasons: years.filter((y) => s.seasons.get(y).starts > 0).length, firstYear: years[0] ?? null, lastYear: years.at(-1) ?? null, titleYears: titleYearsOf(s), ended: s.ended, endRef: s.endRef, stint: s };
  };

  const out = [];
  for (const t of trades.values()) {
    const sides = [t.a, t.b].map((f) => {
      const from = otherSide(t, f);
      const pieces = [];
      for (const pid of t.gave[from].filter((x) => !isPick(x))) {
        const s = (byKey.get(`${f}|${pid}`) ?? []).find((x) => x.how === HOW.trade && x.ref?.tradeId === t.id);
        pieces.push({ kind: 'player', pid, status: s ? 'kept' : 'not on record', value: s ? valueOf(s) : null });
      }
      const picks = (picksIn.get(t.id) ?? []).filter((p) => p.hop.to === f && p.hop.from === from);
      for (const { chain, hop } of picks) {
        const i = chain.hops.indexOf(hop);
        const onward = chain.hops.slice(i + 1).find((h) => h.from === f);
        if (onward) {
          pieces.push({ kind: 'pick', chain, status: 'traded on', onward, value: null });
          continue;
        }
        if (chain.status === 'not used yet') {
          pieces.push({ kind: 'pick', chain, status: 'not used yet', value: null });
          continue;
        }
        if (!chain.used || chain.used.by !== f) {
          pieces.push({ kind: 'pick', chain, status: 'unknown', value: null });
          continue;
        }
        const s = (byKey.get(`${f}|${chain.used.pid}`) ?? []).find((x) => x.how === HOW.draft && x.ref?.year === chain.year);
        pieces.push({ kind: 'pick', chain, pid: chain.used.pid, status: 'used', value: s ? valueOf(s) : null });
      }
      const pickTokens = t.gave[from].filter(isPick).length;
      const valued = pieces.filter((p) => p.value);
      const sum = (k) => r2(valued.reduce((a, p) => a + p.value[k], 0));
      const titleYears = [...new Set(valued.flatMap((p) => p.value.titleYears))].sort((a, b) => a - b);
      const open = pieces.some((p) => p.status === 'not used yet' || p.value?.ended === ENDED.current);
      return {
        franchiseId: f,
        partnerId: from,
        pieces,
        picksUntraced: Math.max(0, pickTokens - picks.length),
        points: sum('points'),
        playoffPoints: sum('playoffPoints'),
        starts: sum('starts'),
        titleYears,
        open,
      };
    });
    const [a, b] = sides;
    for (const [me, them] of [
      [a, b],
      [b, a],
    ]) {
      const net = r2(me.points - them.points);
      out.push({ trade: t, ...me, partner: them, net, result: net > 0 ? 'won' : net < 0 ? 'lost' : 'even' });
    }
  }
  return out;
}
