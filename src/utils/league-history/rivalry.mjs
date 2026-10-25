/**
 * League History rivalry page — one pairing's whole series, computed from an
 * indexed League History dataset (records.mjs indexDataset). Pure, and built
 * only from the dataset, so any league with a dataset gets the page, like the
 * franchise page (franchise.mjs).
 *
 * A rivalry page is a pair of franchise SLOTS. By default it counts only the
 * meetings both CURRENT owners played (`ownerOnly`), the way the franchise
 * page highlights its current owner (Brandon, 2026-10-25), and that follows
 * the OWNERS: a game they played from other slots before one moved franchises
 * counts too, as the old rivalry pages and franchise history counted it.
 * `ownerOnly: false` adds every game the two slots ever played, each credited
 * to the owners of the day. The series counts regular season and playoff games; consolation games
 * are listed but never counted, the Record Book's "all games" scope.
 *
 * Heat is the shared rivalry formula (rivalry-intensity.mjs), so this page,
 * the franchise pages and the schedule release rank a pairing the same way.
 *
 * THIS FILE IS THE HEAD-TO-HEAD DEFINITION for the whole site. A pairing's
 * record is the games its two CURRENT owners played each other, from whichever
 * slots they held, regular season and playoffs, consolation games left out.
 * `rivalryPairs` tallies it for every pairing, `headToHeadMeetings` lists one
 * pairing's games, and `rivalEntries` / `rivalrySeries` are the shapes the
 * franchise pages, owner map, matchup previews and schedule release read. The
 * old per-franchise `matchupHistory` in franchise-history.json counted
 * consolation games and stored every game twice, and disagreed with the
 * rivalry pages on most pairings; `tests/head-to-head-source-guard.test.ts`
 * fails on a record tallied from it again.
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

/**
 * Every game between two slots, plus every game the two slots' current owners
 * played each other from other slots (an owner who moved franchises), from A's
 * side, oldest first. A is whichever team was slot `a` or `a`'s current owner.
 */
function meetingsOf(ix, a, b, ka, kb) {
  return ix.games
    .map((g) => {
      const ew = ix.entityOf(g.y, g.wf);
      const el = ix.entityOf(g.y, g.lf);
      const slots = (g.wf === a && g.lf === b) || (g.wf === b && g.lf === a);
      const owners = (ew === ka && el === kb) || (ew === kb && el === ka);
      if (!slots && !owners) return null;
      const aWon = slots ? g.wf === a : ew === ka;
      const [fa, fb] = aWon ? [g.wf, g.lf] : [g.lf, g.wf];
      return {
        y: g.y,
        wk: g.wk,
        kind: g.kind,
        final: isFinal(ix, g),
        sA: aWon ? g.ws : g.ls,
        sB: aWon ? g.ls : g.ws,
        winner: g.tie ? null : aWon ? 'A' : 'B',
        franchiseA: fa,
        franchiseB: fb,
        nameA: ix.team(g.y, fa)?.n ?? fa,
        nameB: ix.team(g.y, fb)?.n ?? fb,
        iconA: ix.team(g.y, fa)?.i ?? null,
        iconB: ix.team(g.y, fb)?.i ?? null,
        holdingA: ix.entityOf(g.y, fa),
        holdingB: ix.entityOf(g.y, fb),
      };
    })
    .filter(Boolean)
    .sort((x, y) => x.y - y.y || x.wk - y.wk);
}

/** Whether a meeting counts toward a record: regular season and playoffs, never a consolation game. */
const counts = (m) => m.kind !== 'consolation';

/**
 * The games that make up a pairing's head-to-head record: every counted game
 * the two slots' CURRENT owners played each other, from A's side, oldest
 * first. Empty when they never met; null when the dataset never saw a slot.
 * Each item is a rivalry-page meeting (`y`, `wk`, `kind`, `sA`, `sB`,
 * `winner` 'A' | 'B' | null, …).
 */
export function headToHeadMeetings(ix, a, b) {
  const ha = currentHolding(ix, a);
  const hb = currentHolding(ix, b);
  if (!ha || !hb || a === b) return null;
  return meetingsOf(ix, a, b, ha.key, hb.key).filter(
    (m) => m.holdingA === ha.key && m.holdingB === hb.key && counts(m),
  );
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

/**
 * Every pairing of active slots, over the games their CURRENT owners played
 * each other (from whichever slots they held then), consolation games left
 * out: { a, b, wa, wb, t, games, playoffs, heat }, keyed `${a}-${b}` with the
 * smaller id first. The rivalry index and each rivalry page's heat read this,
 * so a pairing's record is the same everywhere. Cached per index.
 */
export function rivalryPairs(ix) {
  if (ix._rivalryPairs) return ix._rivalryPairs;
  const latest = ix.ds.seasons.at(-1);
  const active = latest ? Object.keys(latest.teams) : [];
  const slotOf = new Map();
  for (const f of active) {
    const key = currentHolding(ix, f)?.key;
    if (key) slotOf.set(key, f);
  }
  const pairs = new Map();
  for (const g of ix.games) {
    if (g.kind === 'consolation') continue;
    const sw = slotOf.get(ix.entityOf(g.y, g.wf));
    const sl = slotOf.get(ix.entityOf(g.y, g.lf));
    if (!sw || !sl || sw === sl) continue;
    const [a, b] = [sw, sl].sort();
    if (!pairs.has(`${a}-${b}`)) pairs.set(`${a}-${b}`, { a, b, wa: 0, wb: 0, t: 0, games: 0, playoffs: 0 });
    const p = pairs.get(`${a}-${b}`);
    p.games += 1;
    if (g.kind === 'playoffs') p.playoffs += 1;
    if (g.tie) p.t += 1;
    else if (sw === a) p.wa += 1;
    else p.wb += 1;
  }
  for (const p of pairs.values()) p.heat = rivalryIntensity(p.games, p.wa, p.wb, p.t, p.playoffs);
  ix._rivalryPairs = pairs;
  return pairs;
}

/**
 * One slot's rivals among the active slots, hottest first, from its side:
 * `[{ opponentId, wins, losses, ties, games, playoffGames, intensity }]`.
 * Pairings under `minMeetings` are left out.
 */
export function rivalEntries(ix, franchiseId, { minMeetings = MIN_RIVALRY_MEETINGS } = {}) {
  const out = [];
  for (const p of rivalryPairs(ix).values()) {
    if (p.games < minMeetings || (p.a !== franchiseId && p.b !== franchiseId)) continue;
    const isA = p.a === franchiseId;
    out.push({
      opponentId: isA ? p.b : p.a,
      wins: isA ? p.wa : p.wb,
      losses: isA ? p.wb : p.wa,
      ties: p.t,
      games: p.games,
      playoffGames: p.playoffs,
      intensity: p.heat,
    });
  }
  return out.sort((x, y) => y.intensity - x.intensity);
}

/**
 * Every pairing's series keyed by `rivalryPairKey` (smaller id first), in the
 * shape `describeSeries` (rivalry-intensity.mjs) reads: the record belongs to
 * `perspective`, the smaller id. One game list means one answer per pairing,
 * so a series is never `disputed` the way the two stored copies of the old
 * `matchupHistory` could be.
 */
export function rivalrySeries(ix, { minMeetings = MIN_RIVALRY_MEETINGS } = {}) {
  const out = {};
  for (const [key, p] of rivalryPairs(ix)) {
    if (p.games < minMeetings) continue;
    out[key] = {
      games: p.games,
      playoffGames: p.playoffs,
      intensity: p.heat,
      perspective: p.a,
      wins: p.wa,
      losses: p.wb,
      ties: p.t,
      disputed: false,
    };
  }
  return out;
}

/** Pairings at or above the meetings floor, hottest first. Cached per index. */
export function rivalryHeat(ix) {
  if (ix._rivalryHeat) return ix._rivalryHeat;
  const latest = ix.ds.seasons.at(-1);
  const active = latest ? Object.keys(latest.teams) : [];
  const ranked = [...rivalryPairs(ix).values()]
    .filter((p) => p.games >= MIN_RIVALRY_MEETINGS)
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

  const all = meetingsOf(ix, a, b, ha.key, hb.key);
  const bothCurrent = (m) => m.holdingA === ha.key && m.holdingB === hb.key;
  const listed = ownerOnly ? all.filter(bothCurrent) : all;
  const counted = listed.filter(counts);
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
