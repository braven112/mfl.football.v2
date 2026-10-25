/**
 * League History home — the champions' banners ("the Rafters"), the dynasties
 * and the every-season grid, computed from an indexed League History dataset
 * (records.mjs indexDataset). Pure; the History home page calls it per
 * request through the same cached index the Record Book uses.
 *
 * Grouped by OWNER like the Record Book: a grid row is one holding (an owner,
 * or a set of co-owners), and follows them across franchise slots.
 */

/** One banner per finished season with a champion, newest first. */
export function champions(ix) {
  const out = [];
  for (const s of ix.ds.seasons) {
    const entries = Object.entries(s.teams);
    const champ = entries.find(([, t]) => t.r === 'C');
    if (!champ) continue;
    const [f, t] = champ;
    const runner = entries.find(([, x]) => x.r === 'R');
    const e = ix.entity(ix.entityOf(s.y, f));
    out.push({
      year: s.y,
      franchiseId: f,
      name: t.n ?? f,
      icon: t.i ?? null,
      record: `${t.w}-${t.l}${t.t ? `-${t.t}` : ''}`,
      owner: e.key.startsWith('slot:') ? null : e.name,
      entityKey: e.key,
      ownerSlug: e.ownerSlug,
      runnerUp: runner ? (runner[1].n ?? runner[0]) : null,
    });
  }
  return out.reverse();
}

/**
 * Owners by championships, then title-game trips: `[{ entity, titles: [years],
 * finals, seasons }]`, only owners with a title.
 */
export function dynasties(ix) {
  const by = new Map();
  for (const s of ix.ds.seasons) {
    if (!s.done) continue;
    for (const [f, t] of Object.entries(s.teams)) {
      const key = ix.entityOf(s.y, f);
      if (!by.has(key)) by.set(key, { key, titles: [], finals: 0, seasons: 0 });
      const d = by.get(key);
      d.seasons += 1;
      if (t.r === 'C') d.titles.push(s.y);
      if (t.r === 'C' || t.r === 'R') d.finals += 1;
    }
  }
  return [...by.values()]
    .filter((d) => d.titles.length)
    .sort((a, b) => b.titles.length - a.titles.length || b.finals - a.finals || a.titles[0] - b.titles[0])
    .map((d) => ({ entity: ix.entity(d.key), titles: d.titles, finals: d.finals, seasons: d.seasons }));
}

/**
 * The every-season grid: one row per holding, one cell per season.
 * `rows` are the holdings in the latest season (the league as it stands),
 * `former` everyone else. A row is sorted by titles, then finals, then
 * playoff trips. Each cell: `{ r, name, franchiseId, record, rank, pf }`, or
 * absent for a season the holding did not play.
 */
export function seasonGrid(ix) {
  const years = ix.ds.seasons.filter((s) => Object.keys(s.teams).length).map((s) => s.y);
  const latest = ix.ds.seasons[ix.ds.seasons.length - 1];
  const rows = new Map();
  for (const s of ix.ds.seasons) {
    for (const [f, t] of Object.entries(s.teams)) {
      const key = ix.entityOf(s.y, f);
      if (!rows.has(key)) rows.set(key, { key, cells: {}, titles: 0, finals: 0, trips: 0, seasons: 0 });
      const row = rows.get(key);
      // In a season still being played the finish is not known yet.
      const r = s.done ? t.r : null;
      row.cells[s.y] = {
        r,
        name: t.n ?? f,
        franchiseId: f,
        record: `${t.w}-${t.l}${t.t ? `-${t.t}` : ''}`,
        rank: t.rk ?? null,
        pf: t.pf ?? null,
      };
      row.seasons += 1;
      if (r === 'C') row.titles += 1;
      if (r === 'C' || r === 'R') row.finals += 1;
      if (r && r !== 'M') row.trips += 1;
    }
  }
  const current = new Set(Object.keys(latest?.teams ?? {}).map((f) => ix.entityOf(latest.y, f)));
  const sorted = [...rows.values()]
    .sort((a, b) => b.titles - a.titles || b.finals - a.finals || b.trips - a.trips || b.seasons - a.seasons)
    .map((row) => ({ ...row, entity: ix.entity(row.key) }));
  return {
    years,
    live: latest && !latest.done ? latest.y : null,
    rows: sorted.filter((row) => current.has(row.key)),
    former: sorted.filter((row) => !current.has(row.key)),
  };
}
