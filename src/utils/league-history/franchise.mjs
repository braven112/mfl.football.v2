/**
 * League History franchise page — one franchise slot's whole story, computed
 * from an indexed League History dataset (records.mjs indexDataset). Pure, and
 * built only from the dataset, so any league with a dataset gets the page
 * (Brandon, 2026-10-25: the franchise pages are part of the history product).
 *
 * A franchise page is a SLOT, not an owner: the seasons are every season this
 * franchise id played, whoever held it, and `owners` lists the holdings that
 * ran it. Records count regular season and playoff games, never consolation
 * games, the Record Book's "all games" scope.
 */

const record = (w, l, t) => `${w}-${l}${t ? `-${t}` : ''}`;
const winPct = (w, l, t) => {
  const g = w + l + t;
  return g ? (w + t / 2) / g : 0;
};

/** The name and logo each franchise id carried in its latest season. */
function latestLooks(ds) {
  const out = new Map();
  for (const s of ds.seasons) {
    for (const [f, t] of Object.entries(s.teams)) out.set(f, { name: t.n ?? f, icon: t.i ?? null, year: s.y });
  }
  return out;
}

/** Every franchise id in the dataset, newest name first: `[{ franchiseId, name, icon, active }]`. */
export function franchiseList(ds) {
  const looks = latestLooks(ds);
  const latest = ds.seasons.at(-1)?.y;
  return [...looks.entries()]
    .map(([franchiseId, l]) => ({ franchiseId, name: l.name, icon: l.icon, active: l.year === latest }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/**
 * The franchise's history, or null when the dataset never saw this id.
 * `ownerOnly` keeps only the seasons and games of the holding that ran the
 * slot most recently (Brandon, 2026-10-25: both views, whole franchise by
 * default, the current owner's run one pill away).
 */
export function franchiseHistory(ix, franchiseId, { ownerOnly = false } = {}) {
  const { ds } = ix;
  const looks = latestLooks(ds);
  if (!looks.has(franchiseId)) return null;
  const latestYear = ds.seasons.at(-1)?.y;

  let seasons = [];
  for (const s of ds.seasons) {
    const t = s.teams[franchiseId];
    if (!t) continue;
    seasons.push({
      y: s.y,
      name: t.n ?? franchiseId,
      icon: t.i ?? null,
      w: t.w ?? 0,
      l: t.l ?? 0,
      t: t.t ?? 0,
      pf: t.pf ?? null,
      rank: t.rk ?? null,
      division: t.d ?? null,
      // In a season still being played the finish is not known yet.
      r: s.done ? (t.r ?? null) : null,
      wonDivision: s.done && t.wd === 1,
      live: !s.done,
      entityKey: ix.entityOf(s.y, franchiseId),
      teams: Object.keys(s.teams).length,
    });
  }

  const holding = seasons.at(-1)?.entityKey ?? null;
  const fullSpan = { firstYear: seasons[0]?.y ?? null, seasons: seasons.length };
  if (ownerOnly) seasons = seasons.filter((s) => s.entityKey === holding);
  const done = seasons.filter((s) => !s.live);
  const titles = done.filter((s) => s.r === 'C').map((s) => s.y);
  const finals = done.filter((s) => s.r === 'C' || s.r === 'R').map((s) => s.y);
  const trips = done.filter((s) => s.r && s.r !== 'M').length;
  const divisionTitles = done.filter((s) => s.wonDivision).map((s) => s.y);

  // Games: the Record Book's all-games scope (no consolation games).
  const games = ix.teamGames.filter(
    (g) => g.f === franchiseId && g.kind !== 'consolation' && (!ownerOnly || ix.entityOf(g.y, franchiseId) === holding),
  );
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

  // Owners who ran the slot, in order of their first season here.
  const byOwner = new Map();
  for (const s of seasons) {
    if (!byOwner.has(s.entityKey)) byOwner.set(s.entityKey, { key: s.entityKey, years: [], w: 0, l: 0, t: 0, titles: 0 });
    const o = byOwner.get(s.entityKey);
    o.years.push(s.y);
    o.w += s.w;
    o.l += s.l;
    o.t += s.t;
    if (s.r === 'C') o.titles += 1;
  }
  const owners = [...byOwner.values()].map((o) => ({
    entity: ix.entity(o.key),
    from: o.years[0],
    to: o.years.at(-1),
    seasons: o.years.length,
    record: record(o.w, o.l, o.t),
    titles: o.titles,
    current: o.years.at(-1) === latestYear,
  }));

  // Head to head with every franchise id it has played.
  const vs = new Map();
  for (const g of games) {
    if (!vs.has(g.of)) vs.set(g.of, []);
    vs.get(g.of).push(g);
  }
  const headToHead = [...vs.entries()]
    .map(([opponentId, list]) => {
      const t = tally(list);
      const look = looks.get(opponentId);
      const last = list.at(-1);
      return {
        opponentId,
        name: look?.name ?? opponentId,
        icon: look?.icon ?? null,
        active: look?.year === latestYear,
        ...t,
        games: list.length,
        playoffGames: list.filter((g) => g.kind === 'playoffs').length,
        last: { y: last.y, wk: last.wk, won: last.won, tie: last.tie, s: last.s, os: last.os },
      };
    })
    .sort((a, b) => b.games - a.games || b.pct - a.pct);

  const best = (list, value) => list.reduce((top, g) => (top && value(top) >= value(g) ? top : g), null);
  const highGame = best(games, (g) => g.s);
  const bigWin = best(
    games.filter((g) => g.won),
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
      s: g.s,
      os: g.os,
      opponentId: g.of,
      opponent: looks.get(g.of)?.name ?? g.of,
      playoffs: g.kind === 'playoffs',
    };

  const now = looks.get(franchiseId);
  const latestSeason = seasons.at(-1);
  return {
    franchiseId,
    ownerOnly,
    /** Whether the slot ever had another owner, i.e. whether the views differ. */
    hadOtherOwners: fullSpan.seasons !== seasons.length || owners.length > 1,
    franchiseFirstYear: fullSpan.firstYear,
    name: now.name,
    icon: now.icon,
    active: now.year === latestYear,
    division: latestSeason?.division ?? null,
    firstYear: seasons[0]?.y ?? null,
    lastYear: latestSeason?.y ?? null,
    owner: owners.find((o) => o.current)?.entity ?? null,
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
    owners,
    headToHead,
    highs: {
      game: gameLine(highGame),
      win: gameLine(bigWin),
      season: bestSeason && { y: bestSeason.y, record: record(bestSeason.w, bestSeason.l, bestSeason.t), pf: bestSeason.pf, r: bestSeason.r },
    },
  };
}
