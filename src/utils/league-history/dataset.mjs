/**
 * League History dataset — every game and every franchise-season of one
 * league, with each season credited to the OWNER who ran the team that year.
 *
 * Pure. `scripts/compute-league-history.mjs` walks the committed feeds and
 * hands the pieces in; the pages read the file it writes through
 * `record-book.mjs`. Kept as .mjs so the node script imports it directly.
 *
 * Three inputs, each the existing source of truth for its part:
 *
 * - games: `gamesFromSchedule` (record-book.mjs) over every season's
 *   schedule.json. Every game ever played, under every owner, deduplicated.
 * - seasons: `season-ledger.json`. One row per franchise-season, ALL owners
 *   (the ledger is not owner-scoped the way franchise-history.json is), with
 *   that season's name, icon, division and finish.
 * - owners: `owner-tenures.json`. Each owner's tenures list the exact
 *   (franchise, year) seasons they held. This file only READS that answer: the
 *   ownership boundary has one implementation (`buildAttributor`,
 *   owner-tenures.mjs) and `tests/owner-boundary-parity.test.ts` fails on a
 *   second one.
 *
 * Group-by-owner is the product default (Brandon, 2026-10-24); a season held by
 * co-owners lands on one HOLDING, the sorted set of their ids, so it is counted
 * once and never split.
 */

/** A holding with no owner on record: the franchise slot stands in for it. */
export const slotHolding = (franchiseId) => `slot:${franchiseId}`;

/** The holding key for a set of owner ids: sorted, so co-owners agree. */
export const holdingKey = (ownerIds) => [...ownerIds].sort().join('+');

/**
 * (franchiseId, year) → holding key, from the owner tenures' own season lists.
 * @returns {Map<string, string>}
 */
export function holdingsBySeason(ownerTenures) {
  const owners = new Map();
  for (const owner of ownerTenures?.owners ?? []) {
    for (const tenure of owner.tenures ?? []) {
      for (const s of tenure.seasons ?? []) {
        const key = `${s.franchiseId ?? tenure.franchiseId}|${s.year}`;
        if (!owners.has(key)) owners.set(key, new Set());
        owners.get(key).add(owner.ownerId);
      }
    }
  }
  const out = new Map();
  for (const [key, ids] of owners) out.set(key, holdingKey(ids));
  return out;
}

const RESULT_CODES = {
  champion: 'C',
  'runner-up': 'R',
  'third-place': '3',
  playoffs: 'P',
  missed: 'M',
};

/**
 * @param {object} args
 * @param {string} args.league registry slug
 * @param {Array<{year:number, week:number, isPlayoff:boolean, winnerId:string, loserId:string, winnerScore:number, loserScore:number}>} args.games
 * @param {Array<object>} args.ledgerRows season-ledger.json `rows`
 * @param {object} args.ownerTenures owner-tenures.json
 * @param {Record<number, number>} [args.firstPlayoffWeeks] year → first playoff week
 */
export function buildHistoryDataset({ league, games, ledgerRows, ownerTenures, firstPlayoffWeeks = {} }) {
  const holdings = holdingsBySeason(ownerTenures);

  const owners = {};
  for (const o of ownerTenures?.owners ?? []) {
    owners[o.ownerId] = { name: o.displayName || o.title || o.dominantName, slug: o.slug };
  }

  const years = [...new Set(ledgerRows.map((r) => r.year))].sort((a, b) => a - b);
  const seasons = years.map((year) => {
    const rows = ledgerRows.filter((r) => r.year === year && !r.seasonNotStarted);
    const teams = {};
    for (const r of rows) {
      teams[r.franchiseId] = {
        n: r.name,
        i: r.icon ?? null,
        h: holdings.get(`${r.franchiseId}|${year}`) ?? slotHolding(r.franchiseId),
        w: r.wins ?? 0,
        l: r.losses ?? 0,
        t: r.ties ?? 0,
        // MFL's official points-for; 0 where the feed never carried it (AFL 2003).
        pf: Math.round((r.pointsFor ?? 0) * 100) / 100,
        rk: r.regSeasonRank ?? null,
        d: r.divisionName ?? null,
        wd: r.wonDivision ? 1 : 0,
        r: RESULT_CODES[r.playoffResult] ?? 'M',
      };
    }
    const fpw = firstPlayoffWeeks[year];
    return {
      y: year,
      // A season is complete once it has crowned a champion.
      done: rows.some((r) => r.playoffResult === 'champion') ? 1 : 0,
      pw: Number.isFinite(fpw) ? fpw : null,
      teams,
    };
  });

  const known = new Set(years);
  const compact = games
    .filter((g) => known.has(g.year))
    .map((g) => [
      g.year,
      g.week,
      g.winnerId,
      round2(g.winnerScore),
      g.loserId,
      round2(g.loserScore),
      g.isPlayoff ? 1 : 0,
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || cmp(a[2], b[2]) || cmp(a[4], b[4]));

  return {
    league,
    firstSeason: years[0] ?? null,
    lastSeason: years[years.length - 1] ?? null,
    owners: sortKeys(owners),
    seasons,
    games: compact,
  };
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => cmp(a, b)));
