/**
 * Draft-pick trades — every traded pick's path between franchises and the
 * player it became, read from a league's pick-trades file
 * (data/<league>/derived/pick-trades.json):
 * `{ picks: [{ id, year, round, original, status, grade, hops: [{ trade, from, to }], used }],
 *    trades: { "<timestamp>:<franchise>-<franchise>": { season, sides: [{ franchise, gave: [{ player } | { pick, token }] }] } },
 *    players: { id: [name, position] } }`.
 * Pure, like keepers.mjs; a league with no file shows none.
 *
 * A franchise page reads it trade by trade (what went out, what came back,
 * and what each pick turned into); the Record Book ranks the picks that moved
 * the most and counts picks traded per season.
 */

/**
 * @typedef {{ kind: 'player', name: string, position: string }
 *   | { kind: 'pick', label: string, fate: string, hops: number, guess: boolean }} TradeItem
 * @typedef {{ ts: number, season: number, partner: { id: string, name: string }, gave: TradeItem[], got: TradeItem[] }} PickTrade
 * @typedef {{ trades: PickTrade[], sent: number, received: number }} FranchisePickTrades
 */

const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
};

/** A team's name in season `y`, or its nearest season when `y` is outside the record (a future pick). */
function teamName(ix, y, franchiseId) {
  const seasons = ix.ds.seasons;
  const exact = ix.team(y, franchiseId);
  if (exact) return exact.n;
  const near = y > seasons.at(-1).y ? seasons.findLast((s) => s.teams[franchiseId]) : seasons.find((s) => s.teams[franchiseId]);
  return near?.teams[franchiseId]?.n ?? franchiseId;
}

function player(pt, id) {
  const [name, position] = pt?.players?.[id] ?? [id, ''];
  return { name, position };
}

/** "2012 1st round", from a traced pick or a raw MFL token (FP_<orig>_<year>_<round>, DP_<round-1>_<slot-1>). */
function pickLabel(pick, token, season) {
  if (pick) return `${pick.year} ${ordinal(pick.round)} round`;
  const fp = /^FP_\d{4}_(\d{4})_(\d+)$/.exec(token ?? '');
  if (fp) return `${fp[1]} ${ordinal(Number(fp[2]))} round`;
  const dp = /^DP_(\d+)_\d+$/.exec(token ?? '');
  if (dp) return `${season} ${ordinal(Number(dp[1]) + 1)} round`;
  return 'Draft pick';
}

/** What a pick became after trade `key`: traded on, used on a player, or still to come. */
function pickFate(pt, ix, pick, key) {
  const at = pick.hops.findIndex((h) => h.trade === key);
  const later = pick.hops.slice(at + 1);
  const used = pick.used;
  const usedBy = used ? teamName(ix, pick.year, used.by) : null;
  const usedOn = used ? player(pt, used.player) : null;
  const parts = [];
  if (later.length) parts.push(`then traded ${later.length === 1 ? 'once more' : `${later.length} more times`}`);
  if (used) parts.push(`${usedBy} took ${usedOn.name}${usedOn.position ? ` (${usedOn.position})` : ''} with it`);
  else if (pick.status === 'unexercised') parts.push('not used yet');
  return parts.join('; ') || 'outcome not in the record';
}

const byId = (pt) => {
  const map = new Map();
  for (const p of pt?.picks ?? []) map.set(p.id, p);
  return map;
};

function items(pt, ix, picks, gave, key, season) {
  return gave.map((g) => {
    if (g.player) return { kind: 'player', ...player(pt, g.player) };
    const pick = g.pick ? picks.get(g.pick) : null;
    return {
      kind: 'pick',
      label: pickLabel(pick, g.token, season),
      fate: pick ? pickFate(pt, ix, pick, key) : 'path not in the record',
      hops: pick?.hops.length ?? 1,
      guess: !pick || pick.grade === 'GUESS',
    };
  });
}

/**
 * Every trade a franchise made that moved a draft pick, newest first, with
 * both sides and what each pick became. `ownerOnly` keeps the trades made
 * under the holding that ran the slot most recently (the franchise page's
 * default, matching franchiseKeepers).
 * @returns {FranchisePickTrades | null}
 */
export function franchisePickTrades(pt, ix, franchiseId, { ownerOnly = false } = {}) {
  const picks = byId(pt);
  const latestYear = ix.ds.seasons.findLast((s) => s.teams[franchiseId])?.y;
  const holding = ownerOnly && latestYear != null ? ix.entityOf(latestYear, franchiseId) : null;
  const trades = [];
  let sent = 0;
  let received = 0;
  for (const [key, t] of Object.entries(pt?.trades ?? {})) {
    const mine = t.sides.find((s) => s.franchise === franchiseId);
    if (!mine) continue;
    if (ownerOnly) {
      const season = ix.team(t.season, franchiseId) ? t.season : latestYear;
      if (ix.entityOf(season, franchiseId) !== holding) continue;
    }
    const theirs = t.sides.find((s) => s !== mine);
    const gave = items(pt, ix, picks, mine.gave, key, t.season);
    const got = items(pt, ix, picks, theirs?.gave ?? [], key, t.season);
    sent += gave.filter((i) => i.kind === 'pick').length;
    received += got.filter((i) => i.kind === 'pick').length;
    trades.push({
      ts: Number(key.split(':')[0]),
      season: t.season,
      partner: { id: theirs?.franchise ?? '', name: theirs ? teamName(ix, t.season, theirs.franchise) : '' },
      gave,
      got,
    });
  }
  if (!trades.length) return null;
  trades.sort((a, b) => b.ts - a.ts);
  return { trades, sent, received };
}

/** Picks traded each season, by the season of the trade: `[{ season, count }]`, oldest first. */
export function picksTradedBySeason(pt, { from = null } = {}) {
  const counts = new Map();
  for (const t of Object.values(pt?.trades ?? {})) {
    if (from != null && t.season < from) continue;
    const n = t.sides.reduce((sum, s) => sum + s.gave.filter((g) => !g.player).length, 0);
    counts.set(t.season, (counts.get(t.season) ?? 0) + n);
  }
  return [...counts].sort((a, b) => a[0] - b[0]).map(([season, count]) => ({ season, count }));
}

/**
 * The Record Book's pick board, in the row shape records.mjs builds: the
 * picks that changed hands the most, each row belonging to the team the pick
 * started with, in its draft season (or the nearest season in the record).
 * The board carries `series` (picksTradedBySeason) for its per-season chart.
 */
export function pickBoards(pt, ix, { from = null, rankRows }) {
  const last = ix.ds.seasons.at(-1)?.y;
  const rows = (pt?.picks ?? [])
    .filter((p) => from == null || p.year >= from)
    .map((p) => {
      const y = ix.team(p.year, p.original) ? p.year : Math.min(p.year, last);
      if (!ix.team(y, p.original)) return null;
      const t = ix.team(y, p.original);
      const e = ix.entity(ix.entityOf(y, p.original));
      const path = [p.original, ...p.hops.map((h) => h.to)].map((f) => teamName(ix, p.year, f)).join(' → ');
      const used = p.used ? player(pt, p.used.player) : null;
      return {
        value: p.hops.length,
        display: String(p.hops.length),
        unit: p.hops.length === 1 ? 'trade' : 'trades',
        name: `${pickLabel(p)} pick (${teamName(ix, p.year, p.original)})`,
        icon: t?.i ?? null,
        owner: ix.groupBy === 'owner' && !e.key.startsWith('slot:') ? e.name : null,
        context: used ? `${path} · ${used.name}` : path,
        entity: e,
        year: y,
        franchiseId: p.original,
        tiebreak: -p.year,
      };
    })
    .filter(Boolean);
  return [
    {
      id: 'pick-trades',
      label: 'Most traded',
      title: 'Most-traded draft picks',
      note: 'Times one pick changed hands before it was used',
      rows: rankRows(rows),
      series: picksTradedBySeason(pt, { from }),
    },
  ];
}
