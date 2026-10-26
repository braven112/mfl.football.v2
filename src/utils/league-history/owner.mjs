/**
 * League History owner page — one owner's whole career, computed from an
 * indexed League History dataset (records.mjs indexDataset, grouped by owner).
 * Pure, and built only from the dataset, like franchise.mjs.
 *
 * An owner page is a PERSON, not a slot: the seasons are every season a holding
 * that includes this owner ran a team, across every franchise id they held, so
 * a co-owned season counts for each co-owner. Head to head groups opponents by
 * their holding too (owner vs owner, the product default), and each row
 * carries the franchise pair of the last meeting, which is what the rivalry
 * page is keyed by. Records count regular season and playoff games, never
 * consolation games, the Record Book's "all games" scope.
 */

import { headToHeadByOpponent } from './rivalry.mjs';

const record = (w, l, t) => `${w}-${l}${t ? `-${t}` : ''}`;
const winPct = (w, l, t) => {
  const g = w + l + t;
  return g ? (w + t / 2) / g : 0;
};
const ownersIn = (key) => (key && !key.startsWith('slot:') && !key.startsWith('fr:') ? key.split('+') : []);

/** The owner ids in the dataset, `[{ ownerId, name, slug }]`. */
export function ownerList(ds) {
  return Object.entries(ds.owners ?? {}).map(([ownerId, o]) => ({ ownerId, name: o.name, slug: o.slug }));
}

/** The dataset's owner id for a page slug, or null. */
export function ownerIdForSlug(ds, slug) {
  return Object.entries(ds.owners ?? {}).find(([, o]) => o.slug === slug)?.[0] ?? null;
}

/**
 * The owner's history, or null when no season in the dataset is credited to
 * them. `ix` must be indexed by owner (the default).
 */
export function ownerHistory(ix, ownerId) {
  const { ds } = ix;
  if (ix.groupBy !== 'owner' || !ds.owners?.[ownerId]) return null;
  const latestYear = ds.seasons.at(-1)?.y;
  const mine = (key) => ownersIn(key).includes(ownerId);

  const seasons = [];
  for (const s of ds.seasons) {
    for (const [f, t] of Object.entries(s.teams)) {
      const key = ix.entityOf(s.y, f);
      if (!mine(key)) continue;
      seasons.push({
        y: s.y,
        franchiseId: f,
        name: t.n ?? f,
        icon: t.i ?? null,
        w: t.w ?? 0,
        l: t.l ?? 0,
        t: t.t ?? 0,
        pf: t.pf ?? null,
        rank: t.rk ?? null,
        division: t.d ?? null,
        r: s.done ? (t.r ?? null) : null,
        wonDivision: s.done && t.wd === 1,
        live: !s.done,
        holding: key,
        teams: Object.keys(s.teams).length,
      });
    }
  }
  if (seasons.length === 0) return null;
  seasons.sort((a, b) => a.y - b.y || a.franchiseId.localeCompare(b.franchiseId));

  const done = seasons.filter((s) => !s.live);
  const titles = done.filter((s) => s.r === 'C');
  const finals = done.filter((s) => s.r === 'C' || s.r === 'R');
  const trips = done.filter((s) => s.r && s.r !== 'M').length;
  const divisionTitles = done.filter((s) => s.wonDivision);

  const games = ix.teamGames.filter((g) => g.kind !== 'consolation' && mine(ix.entityOf(g.y, g.f)));
  const tally = (list) => {
    let w = 0;
    let l = 0;
    let t = 0;
    for (const g of list) {
      if (g.tie) t += 1;
      else if (g.won) w += 1;
      else l += 1;
    }
    return { w, l, t, record: record(w, l, t), pct: winPct(w, l, t) };
  };
  const regular = tally(games.filter((g) => g.kind === 'regular'));
  const playoffs = tally(games.filter((g) => g.kind === 'playoffs'));
  const pointsFor = games.reduce((n, g) => n + g.s, 0);

  // The teams they ran: one row per franchise id, its names in order.
  const byTeam = new Map();
  for (const s of seasons) {
    if (!byTeam.has(s.franchiseId)) byTeam.set(s.franchiseId, []);
    byTeam.get(s.franchiseId).push(s);
  }
  const teams = [...byTeam.entries()]
    .map(([franchiseId, list]) => {
      const last = list.at(-1);
      const w = list.reduce((n, s) => n + s.w, 0);
      const l = list.reduce((n, s) => n + s.l, 0);
      const t = list.reduce((n, s) => n + s.t, 0);
      const coOwners = [...new Set(list.flatMap((s) => ownersIn(s.holding)).filter((id) => id !== ownerId))];
      return {
        franchiseId,
        name: last.name,
        icon: last.icon,
        names: [...new Set(list.map((s) => s.name))],
        from: list[0].y,
        to: last.y,
        current: last.y === latestYear,
        seasons: list.length,
        record: record(w, l, t),
        titles: list.filter((s) => s.r === 'C').length,
        coOwners: coOwners.map((id) => ({ ownerId: id, name: ds.owners[id]?.name ?? id, slug: ds.owners[id]?.slug ?? null })),
      };
    })
    .sort((a, b) => b.to - a.to || b.from - a.from);

  // Head to head with every other owner, grouped by the opponent's holding,
  // from rivalry.mjs's one game index: against an opponent's current holding,
  // from the owner's current one, a row is the rivalry page's record.
  const vs = headToHeadByOpponent(ix, [...new Set(seasons.map((s) => s.holding))]);
  const headToHead = [...vs.entries()]
    .map(([key, list]) => {
      const t = tally(list);
      const e = ix.entity(key);
      const last = list.at(-1);
      // Still in the league: the holding ran a team in the latest season.
      const active = Object.keys(ds.seasons.at(-1)?.teams ?? {}).some((f) => ix.entityOf(latestYear, f) === key);
      return {
        key,
        name: e.name,
        team: e.team,
        icon: e.icon,
        ownerSlug: e.ownerSlug,
        franchiseId: e.franchiseId,
        active,
        ...t,
        games: list.length,
        playoffGames: list.filter((g) => g.kind === 'playoffs').length,
        // The rivalry page is keyed by the franchise pair of the last meeting.
        last: { y: last.y, wk: last.wk, f: last.f, of: last.of, won: last.won, tie: last.tie, s: last.s, os: last.os },
        // Whether both still hold the teams of that meeting. When they do, the
        // rivalry page's default (current owners) view is exactly this pair;
        // when not, the link asks for every game between the two slots.
        lastPairCurrent: mine(ix.entityOf(latestYear, last.f)) && ix.entityOf(latestYear, last.of) === key,
      };
    })
    .sort((a, b) => b.games - a.games || b.pct - a.pct);

  const best = (list, value) => list.reduce((top, g) => (top && value(top) >= value(g) ? top : g), null);
  // A forfeit (0.00, no lineup set) counts as a game but is no performance.
  const scoring = games.filter((g) => g.s > 0 && g.os > 0);
  const highGame = best(scoring, (g) => g.s);
  const bigWin = best(
    scoring.filter((g) => g.won),
    (g) => g.s - g.os,
  );
  const bestSeason = best(
    done.filter((s) => s.w + s.l + s.t > 0),
    (s) => winPct(s.w, s.l, s.t) + (s.pf ?? 0) / 1e7,
  );
  const gameLine = (g) =>
    g && {
      y: g.y,
      wk: g.wk,
      f: g.f,
      s: g.s,
      os: g.os,
      opponentId: g.of,
      opponent: ix.team(g.y, g.of)?.n ?? g.of,
      playoffs: g.kind === 'playoffs',
    };

  const latest = seasons.at(-1);
  return {
    ownerId,
    name: ds.owners[ownerId].name,
    slug: ds.owners[ownerId].slug,
    active: latest.y === latestYear,
    /** The team they run now, or the last one they ran. */
    team: { franchiseId: latest.franchiseId, name: latest.name, icon: latest.icon, division: latest.division },
    firstYear: seasons[0].y,
    lastYear: latest.y,
    seasons,
    titles,
    finals,
    trips,
    divisionTitles,
    regular,
    playoffs,
    games: games.length,
    pointsFor,
    pointsPerGame: games.length ? pointsFor / games.length : 0,
    teams,
    headToHead,
    highs: {
      game: gameLine(highGame),
      win: gameLine(bigWin),
      season: bestSeason && {
        y: bestSeason.y,
        name: bestSeason.name,
        record: record(bestSeason.w, bestSeason.l, bestSeason.t),
        pf: bestSeason.pf,
        r: bestSeason.r,
      },
    },
  };
}
