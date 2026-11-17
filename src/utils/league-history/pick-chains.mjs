/**
 * Pick lineage — every draft pick that changed hands: the franchise it
 * started with, each trade it moved in, who used it and on whom. Pure.
 *
 * Two sources, one shape:
 * - a league with a traced pick-trades file (the AFL's
 *   data/<league>/derived/pick-trades.json, pick-trades.mjs) is read as is:
 *   its two conferences draft separately, so a `DP_` slot token alone cannot
 *   say which draft it belongs to, and that file pinned each one once;
 * - any other league (TheLeague) is derived here from its trades' pick tokens
 *   (mfl-pick-tokens.mjs) and its draft results.
 *
 * Deriving one: a future pick `FP_<orig>_<year>_<round>` names its original
 * franchise; a current-draft slot `DP_<round-1>_<pick-1>` names a slot. They
 * meet at the draft:
 * - a slot traded as `DP_` is that slot's pick (`exact`); its original
 *   franchise is the first team to trade it, unless that team had received
 *   that round's pick from someone else as an `FP_` (then the two are one
 *   pick), and unknown when it had received more than one;
 * - MFL's own draft comment ("[Pick traded from X.]", 2018 on, carried in the
 *   moves file's draft rows) names the LAST team to trade a pick away: an
 *   `FP_` whose final trade went from that team to the drafting team is that
 *   row's pick: `exact`;
 * - an `FP_` with no slot is matched to the one pick its last holder made in
 *   that round, only when that holder made exactly one and held exactly one:
 *   `traced`. Anything else stays `unknown`, never a guess.
 */
import { parsePickToken } from '../mfl-pick-tokens.mjs';
import { ptParts } from '../nfl-week-starts.mjs';
import { tradeIds } from './stints.mjs';

/**
 * @typedef {{ tradeId: string | null, year: number, date: string | null, from: string, to: string }} PickHop
 * @typedef {{
 *   id: string, year: number, round: number, unit: string, original: string | null,
 *   hops: PickHop[],
 *   used: { by: string, round: number, pick: number, overall: number | null, pid: string, unit: string } | null,
 *   status: 'used' | 'not used yet' | 'unknown',
 *   confidence: 'exact' | 'traced' | 'guess' | 'unknown',
 *   candidates?: string[],
 * }} PickChain
 * `candidates`: an unmatched pick's last holder made exactly as many picks in
 * that round as it held, so the pick became one of these players.
 */

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {any} moves league-history-moves.json
 * @param {any} [pickTrades] pick-trades.json, when the league has one
 * @returns {PickChain[]}
 */
export function buildPickChains(moves, pickTrades = null) {
  return pickTrades?.picks ? fromPickTrades(moves, pickTrades) : derive(moves);
}

function draftIndex(moves) {
  const bySlot = new Map();
  const byRound = new Map();
  const years = new Set();
  const units = new Map();
  for (const [y, unit, round, pick, overall, by, pid, , , from] of moves?.drafts ?? []) {
    const row = { year: y, unit, round, pick, overall, by, pid, from: from ?? null };
    bySlot.set(`${y}|${unit}|${round}|${pick}`, row);
    const rk = `${y}|${round}`;
    if (!byRound.has(rk)) byRound.set(rk, []);
    byRound.get(rk).push(row);
    years.add(y);
    if (!units.has(y)) units.set(y, new Set());
    units.get(y).add(unit);
  }
  return { bySlot, byRound, years, units, lastYear: Math.max(...years, -Infinity) };
}

const usedOf = (row) => ({ by: row.by, round: row.round, pick: row.pick, overall: row.overall, pid: row.pid, unit: row.unit });

function derive(moves) {
  const drafts = draftIndex(moves);
  const ids = tradeIds(moves?.trades);
  /** @type {Map<string, PickChain>} */
  const fp = new Map();
  const dp = new Map();
  (moves?.trades ?? []).forEach(([y, date, , fa, fb, aGave, bGave], i) => {
    for (const [from, to, csv] of [
      [fa, fb, aGave],
      [fb, fa, bGave],
    ]) {
      for (const token of String(csv ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        const pick = parsePickToken(token);
        if (!pick) continue;
        const hop = { tradeId: ids[i], year: y, date, from, to };
        if (pick.scope === 'future') {
          const id = `${pick.year}:R${pick.round}:${pick.franchiseId}`;
          if (!fp.has(id)) fp.set(id, chain(id, pick.year, pick.round, '', pick.franchiseId));
          const hops = fp.get(id).hops;
          if (!hops.some((h) => h.tradeId === hop.tradeId && h.from === hop.from && h.to === hop.to)) hops.push(hop);
        } else {
          const k = `${y}|${pick.round}|${pick.pick}`;
          if (!dp.has(k)) dp.set(k, { year: y, round: pick.round, pick: pick.pick, hops: [] });
          const hops = dp.get(k).hops;
          if (!hops.some((h) => h.tradeId === hop.tradeId && h.from === hop.from && h.to === hop.to)) hops.push(hop);
        }
      }
    }
  });

  const claimed = new Set();
  const slotKey = (row) => `${row.year}|${row.unit}|${row.round}|${row.pick}`;
  const holder = (c) => c.hops.at(-1)?.to ?? c.original;
  /** @type {PickChain[]} */
  const out = [];

  // Current-draft slots: the slot is known, the original franchise is not.
  for (const d of dp.values()) {
    const last = d.hops.at(-1).to;
    // A DP_ names "the draft being conducted now": its own league year's, or
    // the next one's for a trade made after the season (week 22).
    let row = null;
    for (const y of [d.year, d.year + 1]) {
      const units = drafts.units.get(y);
      if (!units || units.size !== 1) continue;
      const r = drafts.bySlot.get(`${y}|${[...units][0]}|${d.round}|${d.pick}`);
      if (r && r.by === last) {
        row = r;
        break;
      }
    }
    if (!row) {
      const c = chain(`${d.year}:R${d.round}:slot${d.pick}`, d.year, d.round, '', null);
      c.hops = d.hops;
      out.push(c);
      continue;
    }
    claimed.add(slotKey(row));
    const first = d.hops[0];
    // The first team to trade the slot, unless it came to them as an FP_.
    const incoming = [...fp.values()].filter(
      (c) => !c._linked && c.year === row.year && c.round === row.round && holder(c) === first.from && (c.hops.at(-1).date ?? '') <= (first.date ?? ''),
    );
    const original = incoming.length === 1 ? incoming[0].original : incoming.length === 0 ? first.from : null;
    const merged = original ? fp.get(`${row.year}:R${row.round}:${original}`) : null;
    const c = merged ?? chain(`${row.year}:R${row.round}:${original ?? `slot${row.pick}`}`, row.year, row.round, row.unit, original);
    if (merged) merged._linked = true;
    c.unit = row.unit;
    c.hops = dedupeHops([...c.hops, ...d.hops]);
    c.used = usedOf(row);
    c.status = 'used';
    c.confidence = 'exact';
    if (!merged) out.push(c);
  }

  // Future picks whose last trade the draft comments name.
  for (const c of fp.values()) {
    if (c._linked) continue;
    const last = c.hops.at(-1);
    const rows = (drafts.byRound.get(`${c.year}|${c.round}`) ?? []).filter((r) => r.by === last.to && r.from === last.from && !claimed.has(slotKey(r)));
    if (rows.length !== 1) continue;
    const row = rows[0];
    claimed.add(slotKey(row));
    Object.assign(c, { unit: row.unit, used: usedOf(row), status: 'used', confidence: 'exact', _linked: true });
  }

  // The rest: the last holder's one pick in that round, when it is the only one.
  const pending = [...fp.values()].filter((c) => !c._linked);
  for (const c of pending) {
    if (c.year > drafts.lastYear) {
      c.status = 'not used yet';
      continue;
    }
    const h = holder(c);
    const rows = (drafts.byRound.get(`${c.year}|${c.round}`) ?? []).filter((r) => r.by === h && !claimed.has(slotKey(r)));
    const tradedAway = fp.has(`${c.year}:R${c.round}:${h}`) && holder(fp.get(`${c.year}:R${c.round}:${h}`)) !== h;
    const held = pending.filter((o) => o.year === c.year && o.round === c.round && holder(o) === h).length + (h === c.original || tradedAway ? 0 : 1);
    if (rows.length === 1 && held === 1) {
      claimed.add(slotKey(rows[0]));
      Object.assign(c, { unit: rows[0].unit, used: usedOf(rows[0]), status: 'used', confidence: 'traced' });
    } else if (rows.length > 1 && rows.length === held) {
      // It was one of these picks, and the record cannot say which.
      c.candidates = rows.map((r) => r.pid);
    }
  }

  for (const c of fp.values()) {
    delete c._linked;
    out.push(c);
  }
  return out.sort((a, b) => a.year - b.year || a.round - b.round || (a.used?.overall ?? 999) - (b.used?.overall ?? 999) || a.id.localeCompare(b.id));
}

/** One hop per (trade, from, to): a trade can list the same pick as both an FP_ and a DP_. */
function dedupeHops(hops) {
  const seen = new Set();
  return hops
    .slice()
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .filter((h) => {
      const k = `${h.tradeId}|${h.from}|${h.to}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function chain(id, year, round, unit, original) {
  return { id, year, round, unit, original, hops: [], used: null, status: 'unknown', confidence: 'unknown' };
}

/** The AFL's traced file, in the same shape: hop trade keys become the moves file's trade ids. */
function fromPickTrades(moves, pt) {
  const drafts = draftIndex(moves);
  const ids = tradeIds(moves?.trades);
  const byPair = new Map();
  (moves?.trades ?? []).forEach(([, date, , fa, fb], i) => {
    const k = `${date}|${[fa, fb].sort().join('-')}`;
    if (!byPair.has(k)) byPair.set(k, ids[i]);
  });
  const dateOf = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    const p = ptParts(new Date(n * 1000));
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  };
  return (pt.picks ?? []).map((p) => {
    const conf = /^\d{4}:(\d+):/.exec(p.id)?.[1];
    const unit = conf != null ? `CONFERENCE${conf}` : '';
    const hops = (p.hops ?? []).map((h) => {
      const [ts, pair] = String(h.trade ?? '').split(':');
      const date = dateOf(ts);
      const sorted = String(pair ?? '').split('-').sort().join('-');
      return { tradeId: date ? byPair.get(`${date}|${sorted}`) ?? null : null, year: pt.trades?.[h.trade]?.season ?? p.year, date, from: h.from, to: h.to };
    });
    let used = null;
    if (p.used?.player) {
      const row = drafts.bySlot.get(`${p.year}|${unit}|${p.round}|${p.used.slot}`);
      used = { by: p.used.by, round: p.round, pick: p.used.slot ?? null, overall: row?.overall ?? null, pid: String(p.used.player), unit };
    }
    const status = used ? 'used' : p.status === 'unexercised' ? 'not used yet' : 'unknown';
    const confidence = !used ? 'unknown' : p.grade === 'GUESS' || p.status === 'ambiguous' ? 'guess' : 'traced';
    return { id: p.id, year: p.year, round: p.round, unit, original: p.original ?? null, hops, used, status, confidence };
  });
}
