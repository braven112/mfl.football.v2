/**
 * Keeper history — which players each franchise kept, every season, read
 * from a league's keeper-history file (data/<league>/derived/keeper-history.json):
 * `{ seasons: { "<year>": { "<franchiseId>": [playerId, ...] } }, players: { id: [name, position] } }`.
 * Pure, like franchise.mjs and owner.mjs; a league with no file shows none.
 *
 * A season's set is the roster each franchise held when its cut to the keeper
 * limit closed. A streak counts the consecutive seasons ONE franchise id kept
 * a player, so a player traded and then kept by his new team starts again.
 *
 * Seasons listed in `estimated.seasons` were inferred from earlier rosters
 * rather than recorded; `estimated.uncertain[year][franchiseId]` names the
 * players picked to fill a set to the limit. Pages label both.
 */

/**
 * @typedef {{ id: string, name: string, position: string, streak: number, uncertain: boolean }} KeptPlayer
 * @typedef {{ y: number, franchiseId: string, team: string, icon: string | null, estimated: boolean, keepers: KeptPlayer[] }} KeeperSeason
 * @typedef {{ seasons: KeeperSeason[], longest: (KeptPlayer & { from: number, to: number, team: string }) | null }} KeeperHistory
 */

const ownersIn = (key) => (key && !key.startsWith('slot:') && !key.startsWith('fr:') ? key.split('+') : []);

/** `[{ y, franchiseId, ids }]`, oldest first, optionally from season `from` on. */
function keeperSeasons(kh, from = null) {
  const out = [];
  for (const [year, byFranchise] of Object.entries(kh?.seasons ?? {})) {
    const y = Number(year);
    if (from != null && y < from) continue;
    for (const [franchiseId, ids] of Object.entries(byFranchise)) out.push({ y, franchiseId, ids });
  }
  return out.sort((a, b) => a.y - b.y || a.franchiseId.localeCompare(b.franchiseId));
}

/** Whether season `y`'s keepers were inferred rather than recorded. */
export function isEstimated(kh, y) {
  return (kh?.estimated?.seasons ?? []).includes(Number(y));
}

/** A player's display fields. */
export function keeperPlayer(kh, id) {
  const [name, position] = kh?.players?.[id] ?? [id, ''];
  return { id, name, position };
}

/**
 * How many consecutive seasons, ending at each season, the franchise had kept
 * each player: `Map("<y>|<franchiseId>|<playerId>", n)`.
 */
function streakIndex(rows) {
  const index = new Map();
  for (const { y, franchiseId, ids } of rows) {
    for (const id of ids) index.set(`${y}|${franchiseId}|${id}`, (index.get(`${y - 1}|${franchiseId}|${id}`) ?? 0) + 1);
  }
  return index;
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'];
const byPosition = (a, b) =>
  (POSITION_ORDER.indexOf(a.position) + 1 || 99) - (POSITION_ORDER.indexOf(b.position) + 1 || 99) ||
  a.name.localeCompare(b.name);

/**
 * Streaks count only the seasons in `rows`, so the current owner's view of a
 * franchise never credits them with the seasons a previous owner kept a player.
 */
function seasonCards(kh, ix, rows) {
  const streaks = streakIndex(rows);
  return rows
    .map(({ y, franchiseId, ids }) => {
      const t = ix.team(y, franchiseId);
      const uncertain = kh?.estimated?.uncertain?.[y]?.[franchiseId] ?? [];
      return {
        y,
        franchiseId,
        team: t?.n ?? franchiseId,
        icon: t?.i ?? null,
        estimated: isEstimated(kh, y),
        keepers: ids
          .map((id) => ({
            ...keeperPlayer(kh, id),
            streak: streaks.get(`${y}|${franchiseId}|${id}`) ?? 1,
            uncertain: uncertain.includes(id),
          }))
          .sort(byPosition),
      };
    })
    .sort((a, b) => b.y - a.y || a.team.localeCompare(b.team));
}

/** The franchise's longest-kept player, from its season cards. */
function longestKept(cards) {
  let top = null;
  for (const c of cards) {
    for (const k of c.keepers) {
      if (!top || k.streak > top.streak || (k.streak === top.streak && c.y > top.to)) {
        top = { ...k, to: c.y, from: c.y - k.streak + 1, team: c.team };
      }
    }
  }
  return top;
}

/**
 * A franchise's keepers, newest season first. `ownerOnly` keeps the seasons of
 * the holding that ran the slot most recently, the franchise page's default.
 * @returns {KeeperHistory | null}
 */
export function franchiseKeepers(kh, ix, franchiseId, { ownerOnly = false } = {}) {
  let rows = keeperSeasons(kh).filter((r) => r.franchiseId === franchiseId && ix.team(r.y, franchiseId));
  if (!rows.length) return null;
  if (ownerOnly) {
    const latestYear = ix.ds.seasons.findLast((s) => s.teams[franchiseId])?.y;
    const holding = latestYear != null ? ix.entityOf(latestYear, franchiseId) : null;
    rows = rows.filter((r) => ix.entityOf(r.y, franchiseId) === holding);
    if (!rows.length) return null;
  }
  const seasons = seasonCards(kh, ix, rows);
  return { seasons, longest: longestKept(seasons) };
}

/**
 * An owner's keepers across every franchise they ran, newest season first.
 * @returns {KeeperHistory | null}
 */
export function ownerKeepers(kh, ix, ownerId) {
  const rows = keeperSeasons(kh).filter((r) => ix.team(r.y, r.franchiseId) && ownersIn(ix.entityOf(r.y, r.franchiseId)).includes(ownerId));
  if (!rows.length) return null;
  const seasons = seasonCards(kh, ix, rows);
  return { seasons, longest: longestKept(seasons) };
}

/**
 * The Record Book's keeper boards, in the row shape records.mjs builds (one
 * team in one season carries `year` and `franchiseId`, so a row opens that
 * franchise's page). `from` is the era's first season.
 */
export function keeperBoards(kh, ix, { from = null, rankRows }) {
  const rows = keeperSeasons(kh, from).filter((r) => ix.team(r.y, r.franchiseId));
  const fmt = (n) => String(n);
  const firstRecorded = Object.keys(kh?.seasons ?? {}).map(Number).filter((y) => !isEstimated(kh, y)).sort((a, b) => a - b)[0];
  const estimatedNote = rows.some((r) => isEstimated(kh, r.y)) && firstRecorded ? `; seasons before ${firstRecorded} are estimated` : '';
  const span = (a, b) => (a === b ? `${a}` : `${a}-${b}`);

  // Every finished streak (a franchise keeping one player in back-to-back seasons).
  const runs = new Map();
  for (const { y, franchiseId, ids } of rows) {
    for (const id of ids) {
      const prev = runs.get(`${franchiseId}|${id}|${y - 1}`);
      if (prev) runs.delete(`${franchiseId}|${id}|${y - 1}`);
      runs.set(`${franchiseId}|${id}|${y}`, { franchiseId, id, from: prev?.from ?? y, to: y });
    }
  }
  const row = (y, f, value, player, context) => {
    const t = ix.team(y, f);
    const e = ix.entity(ix.entityOf(y, f));
    return {
      value,
      display: fmt(value),
      unit: value === 1 ? 'season' : 'seasons',
      name: `${player.name}${player.position ? ` (${player.position})` : ''}`,
      icon: t?.i ?? null,
      owner: ix.groupBy === 'owner' && !e.key.startsWith('slot:') ? e.name : null,
      context,
      entity: e,
      year: y,
      franchiseId: f,
    };
  };
  const streakRows = [...runs.values()].map((r) => {
    const n = r.to - r.from + 1;
    return { ...row(r.to, r.franchiseId, n, keeperPlayer(kh, r.id), `${ix.team(r.to, r.franchiseId)?.n ?? r.franchiseId} · ${span(r.from, r.to)}`), tiebreak: -r.to };
  });

  // Seasons kept by any team, per player.
  const byPlayer = new Map();
  for (const { y, franchiseId, ids } of rows) {
    for (const id of ids) {
      if (!byPlayer.has(id)) byPlayer.set(id, []);
      byPlayer.get(id).push({ y, franchiseId });
    }
  }
  const totalRows = [...byPlayer.entries()].map(([id, kept]) => {
    const perTeam = new Map();
    for (const k of kept) perTeam.set(k.franchiseId, [...(perTeam.get(k.franchiseId) ?? []), k.y]);
    // The row belongs to the team that kept him most (latest on a tie).
    const [topTeam, topYears] = [...perTeam.entries()].sort((a, b) => b[1].length - a[1].length || Math.max(...b[1]) - Math.max(...a[1]))[0];
    const years = kept.map((k) => k.y);
    const teams = perTeam.size;
    return {
      ...row(Math.max(...topYears), topTeam, kept.length, keeperPlayer(kh, id),
        `${teams === 1 ? `${ix.team(Math.max(...topYears), topTeam)?.n ?? topTeam}` : `${teams} teams`} · ${span(Math.min(...years), Math.max(...years))}`),
      tiebreak: -Math.max(...years),
    };
  });

  return [
    { id: 'keeper-streak', label: 'Keeper streak', title: 'Longest keeper streak',
      note: `Seasons in a row one team kept the same player${estimatedNote}`, rows: rankRows(streakRows) },
    { id: 'keeper-seasons', label: 'Seasons kept', title: 'Most seasons kept',
      note: `Every season a player was kept, by any team${estimatedNote}`, rows: rankRows(totalRows) },
  ];
}

/**
 * The keeper set a season's July roster snapshots settle on: the first
 * snapshot, oldest first, where every expected franchise holds exactly
 * `limit` players off injured reserve. Null when none does (an archive gap, or cuts that never
 * settled). `snapshots` are `[{ date, rosters }]`, rosters as MFL exports them.
 */
export function settledKeepers(snapshots, expectedFranchiseIds, limit) {
  const expected = [...expectedFranchiseIds];
  if (!expected.length) return null;
  const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  for (const snapshot of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    const byFranchise = new Map();
    for (const fr of asArray(snapshot.rosters?.rosters?.franchise)) {
      // A player parked on injured reserve during the cut holds an IR slot,
      // not a keeper slot (the AFL's one such case: 2023, franchise 0004).
      byFranchise.set(fr.id, asArray(fr.player).filter((p) => p.status !== 'INJURED_RESERVE').map((p) => p.id).sort());
    }
    if (expected.every((f) => byFranchise.get(f)?.length === limit)) return { date: snapshot.date, byFranchise };
  }
  return null;
}
