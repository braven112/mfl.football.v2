/**
 * League History rivalry page — one pairing's whole series, computed from an
 * indexed League History dataset (records.mjs indexDataset). Pure, and built
 * only from the dataset, so any league with a dataset gets the page, like the
 * franchise page (franchise.mjs).
 *
 * A rivalry page is a pair of franchise SLOTS. By default it counts only the
 * meetings both CURRENT owners played (`ownerOnly`), the way the franchise
 * page highlights its current owner (Brandon, 2026-10-25); `ownerOnly: false`
 * is every game the two slots ever played, each credited to the owners of the
 * day. The series counts regular season and playoff games; consolation games
 * are listed but never counted, the Record Book's "all games" scope.
 *
 * Heat is the shared rivalry formula (rivalry-intensity.mjs), so this page,
 * the franchise pages and the schedule release rank a pairing the same way.
 */

import { MIN_RIVALRY_MEETINGS, rivalryIntensity } from '../rivalry-intensity.mjs';

const record = (w, l, t) => `${w}-${l}${t ? `-${t}` : ''}`;

/** The holding (owner, or co-owners) that ran a slot in its latest season. */
function currentHolding(ix, franchiseId) {
  for (let i = ix.ds.seasons.length - 1; i >= 0; i--) {
    const s = ix.ds.seasons[i];
    if (s.teams[franchiseId]) return { key: ix.entityOf(s.y, franchiseId), year: s.y };
  }
  return null;
}

/** The last playoff week of each season: a game there between its champion and runner-up is the final. */
function finalWeeks(ix) {
  if (!ix._finalWeeks) {
    const weeks = new Map();
    for (const g of ix.games) if (g.kind === 'playoffs') weeks.set(g.y, Math.max(weeks.get(g.y) ?? 0, g.wk));
    ix._finalWeeks = weeks;
  }
  return ix._finalWeeks;
}

const isFinal = (ix, g) => {
  if (g.kind !== 'playoffs' || finalWeeks(ix).get(g.y) !== g.wk) return false;
  const r = new Set([ix.team(g.y, g.wf)?.r, ix.team(g.y, g.lf)?.r]);
  return r.has('C') && r.has('R');
};

/** Every game between two slots, from A's side, oldest first. */
function meetingsOf(ix, a, b) {
  return ix.games
    .filter((g) => (g.wf === a && g.lf === b) || (g.wf === b && g.lf === a))
    .map((g) => {
      const aWon = g.wf === a;
      return {
        y: g.y,
        wk: g.wk,
        kind: g.kind,
        final: isFinal(ix, g),
        sA: aWon ? g.ws : g.ls,
        sB: aWon ? g.ls : g.ws,
        winner: g.tie ? null : aWon ? 'A' : 'B',
        nameA: ix.team(g.y, a)?.n ?? a,
        nameB: ix.team(g.y, b)?.n ?? b,
        holdingA: ix.entityOf(g.y, a),
        holdingB: ix.entityOf(g.y, b),
      };
    })
    .sort((x, y) => x.y - y.y || x.wk - y.wk);
}

/** W-L-T and the longest and current runs of a counted list of meetings, from A's side. */
export function seriesTally(meetings) {
  let a = 0;
  let b = 0;
  let t = 0;
  let longestA = null;
  let longestB = null;
  let run = null;
  for (const m of meetings) {
    if (m.winner === 'A') a += 1;
    else if (m.winner === 'B') b += 1;
    else t += 1;
    run = run && run.side === m.winner ? { ...run, len: run.len + 1, to: m } : { side: m.winner, len: 1, from: m, to: m };
    if (run.side === 'A' && run.len > (longestA?.len ?? 0)) longestA = run;
    if (run.side === 'B' && run.len > (longestB?.len ?? 0)) longestB = run;
  }
  const span = (r) => r && { len: r.len, from: r.from.y, to: r.to.y };
  return {
    a,
    b,
    t,
    games: meetings.length,
    longestA: span(longestA),
    longestB: span(longestB),
    current: run && run.side ? { side: run.side, len: run.len } : null,
  };
}

/** Heat of every pairing of active slots over the current owners' meetings, hottest first. Cached per index. */
export function rivalryHeat(ix) {
  if (ix._rivalryHeat) return ix._rivalryHeat;
  const latest = ix.ds.seasons.at(-1);
  const active = latest ? Object.keys(latest.teams) : [];
  const holding = new Map(active.map((f) => [f, currentHolding(ix, f)?.key]));
  const pairs = new Map();
  for (const g of ix.games) {
    if (g.kind === 'consolation' || !holding.has(g.wf) || !holding.has(g.lf) || g.wf === g.lf) continue;
    if (ix.entityOf(g.y, g.wf) !== holding.get(g.wf) || ix.entityOf(g.y, g.lf) !== holding.get(g.lf)) continue;
    const [a, b] = [g.wf, g.lf].sort();
    if (!pairs.has(`${a}-${b}`)) pairs.set(`${a}-${b}`, { a, b, wa: 0, wb: 0, t: 0, games: 0, playoffs: 0 });
    const p = pairs.get(`${a}-${b}`);
    p.games += 1;
    if (g.kind === 'playoffs') p.playoffs += 1;
    if (g.tie) p.t += 1;
    else if (g.wf === a) p.wa += 1;
    else p.wb += 1;
  }
  const ranked = [...pairs.values()]
    .filter((p) => p.games >= MIN_RIVALRY_MEETINGS)
    .map((p) => ({ ...p, heat: rivalryIntensity(p.games, p.wa, p.wb, p.t, p.playoffs) }))
    .sort((x, y) => y.heat - x.heat);
  ix._rivalryHeat = { ranked, pairings: (active.length * (active.length - 1)) / 2 };
  return ix._rivalryHeat;
}

/**
 * The pairing's series, or null when the dataset never saw one of the ids.
 * `a` and `b` are taken in the order given; the canonical page passes the
 * smaller id first.
 */
export function rivalryHistory(ix, a, b, { ownerOnly = true } = {}) {
  const ha = currentHolding(ix, a);
  const hb = currentHolding(ix, b);
  if (!ha || !hb || a === b) return null;
  const latestYear = ix.ds.seasons.at(-1)?.y;

  const all = meetingsOf(ix, a, b);
  const bothCurrent = (m) => m.holdingA === ha.key && m.holdingB === hb.key;
  const listed = ownerOnly ? all.filter(bothCurrent) : all;
  const counted = listed.filter((m) => m.kind !== 'consolation');
  const playoffs = counted.filter((m) => m.kind === 'playoffs');
  const series = seriesTally(counted);
  const playoffSeries = seriesTally(playoffs);

  const best = (list, value) => list.reduce((top, m) => (top && value(top) >= value(m) ? top : m), null);
  const decided = counted.filter((m) => m.winner);
  const highs = {
    blowout: best(decided, (m) => Math.abs(m.sA - m.sB)),
    closest: best(decided, (m) => -Math.abs(m.sA - m.sB)),
    shootout: best(counted, (m) => m.sA + m.sB),
    topA: best(counted, (m) => m.sA),
    topB: best(counted, (m) => m.sB),
  };

  // Season ledger: who took each season's meetings.
  const bySeason = new Map();
  for (const m of counted) {
    if (!bySeason.has(m.y)) bySeason.set(m.y, []);
    bySeason.get(m.y).push(m);
  }
  const seasons = [...bySeason.entries()].map(([y, list]) => ({ y, ...seriesTally(list) }));

  const heat = rivalryHeat(ix);
  const rank = heat.ranked.findIndex((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  const pointsA = counted.reduce((n, m) => n + m.sA, 0);
  const pointsB = counted.reduce((n, m) => n + m.sB, 0);
  const side = (id, h) => ({
    franchiseId: id,
    name: ix.team(h.year, id)?.n ?? id,
    icon: ix.team(h.year, id)?.i ?? null,
    active: h.year === latestYear,
    owner: ix.entity(h.key),
  });

  return {
    a: side(a, ha),
    b: side(b, hb),
    ownerOnly,
    /** Whether either slot met the other under an earlier owner, i.e. whether the views differ. */
    hadOtherOwners: all.some((m) => !bothCurrent(m)),
    firstMeeting: all[0]?.y ?? null,
    meetings: listed,
    series: { ...series, record: record(series.a, series.b, series.t) },
    playoffs: { ...playoffSeries, record: record(playoffSeries.a, playoffSeries.b, playoffSeries.t) },
    finals: playoffs.filter((m) => m.final),
    highs,
    seasons,
    pointsA,
    pointsB,
    /** The heat rank among the league's current pairings (1 = hottest), or null below the meetings floor. */
    heat: rank >= 0 ? { rank: rank + 1, of: heat.ranked.length, value: heat.ranked[rank].heat } : null,
    minMeetings: MIN_RIVALRY_MEETINGS,
  };
}
