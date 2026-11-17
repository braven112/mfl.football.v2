/**
 * Ask the History — the roster-path units: who had which player, how they got
 * him, and what he did for them (stints.mjs), and where every traded draft
 * pick went (pick-chains.mjs).
 *
 * Three units:
 * - `stints`: one row per player per stint with a team (one player on one
 *   franchise, under one owner, continuously). A player's whole path through
 *   the league is his stints in order.
 * - `titleRosters`: one row per player who started at least one week for a
 *   champion in its title season, with how that team got him.
 * - `pickChains`: one row per draft pick that changed hands, with every trade
 *   it moved in, who used it, on whom, and what that player then did for the
 *   team that drafted him and each team he was traded to.
 *
 * Points are what every other move answer counts (ask-moves.mjs): starter
 * points, regular season and playoffs, consolation excluded. Owner identity
 * follows the OWNER, never the franchise id: a stint splits when its franchise
 * changes hands, and a team filter matches an owner's team under every name.
 */
import { ENDED, HOW, buildStints, stintTotals } from './stints.mjs';
import { buildPickChains } from './pick-chains.mjs';
import { NFL_PATH_DESC, NFL_TEAM_DESC, nflTeamPath } from './ask-players.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
};

const POINTS = 'starter points, regular season and playoffs';
const ACQUIRED_DESC = `how this team got him: ${Object.values(HOW).join(' | ')} ("unknown" = before the transaction record, or no move on record; "came with the franchise" = on the roster when this owner took the team over)`;

export const STINT_FIELDS = {
  stints: {
    year: { type: 'number', label: 'From', desc: 'first season of the stint (a years filter keeps every stint that overlaps it)' },
    lastYear: { type: 'number', label: 'To', desc: 'last season of the stint' },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    nflTeams: { type: 'string', label: 'NFL teams', desc: `${NFL_PATH_DESC}, over the stint's seasons` },
    team: { type: 'string', label: 'Team', desc: "the team's name in the stint's last season" },
    owner: { type: 'string', label: 'Owner' },
    fromDate: { type: 'string', label: 'Acquired', desc: 'YYYY-MM-DD of the move that brought him (null when unknown)' },
    acquired: { type: 'string', label: 'How', desc: ACQUIRED_DESC },
    acquiredDetail: { type: 'string', label: 'Detail', desc: 'the draft slot, the trade partner, the bid' },
    tradeId: { type: 'string', label: 'Trade id', desc: 'the trade that brought him (matches trades.tradeId), else null' },
    tradePartner: { type: 'string', label: 'From team', desc: 'the team that traded him here, else null' },
    ended: { type: 'string', label: 'Ended', desc: `${Object.values(ENDED).join(' | ')} ("left roster" = gone with no release on record)` },
    endDate: { type: 'string', label: 'Left', desc: 'YYYY-MM-DD of the trade or drop that ended it (null otherwise)' },
    endDetail: { type: 'string', label: 'Left how', desc: 'who he was traded to, etc.' },
    seasons: { type: 'number', label: 'Seasons', desc: 'seasons he was on this roster during the stint' },
    starts: { type: 'number', label: 'Starts', desc: 'weeks started, regular season and playoffs' },
    points: { type: 'number', label: 'Pts', desc: `for this team during the stint (${POINTS})` },
    playoffPoints: { type: 'number', label: 'PO pts' },
    bySeason: { type: 'string', label: 'By season', desc: '"2019: 210.5 pts in 12 starts; 2020: …"' },
    titles: { type: 'number', label: 'Titles', desc: 'seasons in the stint this team won the championship' },
    titleYears: { type: 'string', label: 'Title years' },
    playoffYears: { type: 'string', label: 'Playoff years', desc: 'seasons in the stint this team made the playoffs' },
  },
  titleRosters: {
    year: { type: 'number', label: 'Season' },
    team: { type: 'string', label: 'Champion' },
    owner: { type: 'string', label: 'Owner' },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    nflTeam: { type: 'string', label: 'NFL', desc: `${NFL_TEAM_DESC}. "Seahawks who won a title" = nflTeam SEA, every position, not only the Seattle defense` },
    acquired: { type: 'string', label: 'How', desc: ACQUIRED_DESC },
    acquiredYear: { type: 'number', label: 'Since', desc: 'season he was acquired (null when unknown)' },
    acquiredDetail: { type: 'string', label: 'Detail' },
    tradeId: { type: 'string', label: 'Trade id', desc: 'the trade that brought him (matches trades.tradeId), else null' },
    tradeDate: { type: 'string', label: 'Trade date' },
    tradePartner: { type: 'string', label: 'From team' },
    carriedOver: { type: 'boolean', label: 'Carried over', desc: 'on this roster in an earlier season (a keeper, a contract) rather than added for this one' },
    keeper: { type: 'boolean', label: 'Keeper', desc: "in the team's keeper set that season (null where the league records none)" },
    seasonsBefore: { type: 'number', label: 'Prior seasons', desc: 'earlier seasons of this stint with the team' },
    starts: { type: 'number', label: 'Starts', desc: 'that season, regular season and playoffs' },
    points: { type: 'number', label: 'Pts', desc: `that season (${POINTS})` },
    playoffStarts: { type: 'number', label: 'PO starts' },
    playoffPoints: { type: 'number', label: 'PO pts', desc: 'that postseason, as a starter' },
  },
  pickChains: {
    year: { type: 'number', label: 'Draft', desc: 'the draft the pick belongs to' },
    round: { type: 'number', label: 'Rd' },
    pick: { type: 'number', label: 'Pick', desc: 'pick within the round (null when not known)' },
    overall: { type: 'number', label: 'Overall' },
    draft: { type: 'string', label: 'Draft unit', desc: "'' for a league-wide draft, else the conference" },
    originalTeam: { type: 'string', label: 'Original team', desc: 'the team the pick started with (null when the record cannot say)' },
    originalOwner: { type: 'string', label: 'Original owner' },
    trades: { type: 'number', label: 'Trades', desc: 'times the pick changed hands' },
    path: { type: 'string', label: 'Path', desc: '"Team A → Team B → Team C", oldest first (contains finds a team)' },
    pathOwners: { type: 'string', label: 'Owners', desc: 'every owner who held it, in order (contains finds an owner)' },
    tradeIds: { type: 'string', label: 'Trade ids', desc: 'the trades it moved in, matching trades.tradeId' },
    firstTradeDate: { type: 'string', label: 'First traded' },
    lastTradeDate: { type: 'string', label: 'Last traded' },
    team: { type: 'string', label: 'Used by', desc: 'the team that made the pick' },
    owner: { type: 'string', label: 'Used by owner' },
    player: { type: 'string', label: 'Player', desc: 'who it was used on (null when not used or not known)' },
    position: { type: 'string', label: 'Pos' },
    status: { type: 'string', label: 'Status', desc: 'used | not used yet | unknown (the record cannot pin which pick it became)' },
    confidence: { type: 'string', label: 'Source', desc: "exact (MFL's draft comment names it) | traced (followed through the trade log) | guess | unknown. Say so when not exact" },
    candidates: { type: 'string', label: 'One of', desc: 'for an unknown pick: the players it must have been one of' },
    pointsForTeam: { type: 'number', label: 'Pts for drafter', desc: `what the player scored for the team that drafted him (${POINTS})` },
    seasonsForTeam: { type: 'number', label: 'Seasons w/ drafter' },
    pointsAfter: { type: 'number', label: 'Pts after', desc: 'for the drafting team and every team he was then traded to, in a row' },
    afterDraft: { type: 'string', label: 'What he did', desc: 'each stint from the draft on, following trades: team, seasons, points, how it ended' },
  },
};

export const STINT_UNITS = Object.keys(STINT_FIELDS);

export const STINT_DEFAULT_COLUMNS = {
  stints: ['player', 'team', 'year', 'lastYear', 'acquired', 'ended', 'points', 'titles'],
  titleRosters: ['year', 'team', 'player', 'position', 'nflTeam', 'acquired', 'acquiredYear', 'tradePartner', 'points'],
  pickChains: ['year', 'round', 'originalTeam', 'path', 'player', 'pointsForTeam', 'afterDraft'],
};

/** Team names that a team filter matches by its owner (ask-query.mjs teamFilter). */
export const STINT_TEAM_OWNER_FIELDS = { originalTeam: 'originalOwner' };

const MADE = new Set(['C', 'R', '3', 'P']);
const cache = new WeakMap();

/**
 * Index the stint units against the prepared team index `p` (ask-query's
 * prepare()) and player weeks `pp` (preparePlayers). `extra.keepers` is the
 * league's keeper-history.json and `extra.pickTrades` its pick-trades.json,
 * each when it has one.
 */
export function prepareStints(p, pp, mds, extra = {}) {
  if (cache.has(mds)) return cache.get(mds);
  const { ix } = p;
  const teamName = (y, f) => ix.team(y, f)?.n ?? nearestName(ix, y, f);
  const ownerAt = (y, f) => ix.entity(ix.entityOf(y, f));

  const names = new Map(Object.entries(mds.players ?? {}));
  for (const w of pp?.playerWeeks ?? []) if (!names.has(w._pid)) names.set(w._pid, [w.player, w.position]);
  const nameOf = (pid) => names.get(pid)?.[0] ?? pid;
  const posOf = (pid) => names.get(pid)?.[1] ?? '';
  const nflOf = pp?.nflTeamOf ?? (() => null);

  let latest = null;
  const presence = (pp?.playerWeeks ?? []).map((w) => {
    if (!latest || w.year > latest.year || (w.year === latest.year && w.week > latest.week)) latest = { year: w.year, week: w.week };
    return {
      year: w.year,
      week: w.week,
      franchiseId: w._franchiseId,
      pid: w._pid,
      started: w.started,
      counted: w.kind === 'regular' || w.kind === 'playoffs',
      playoff: w.kind === 'playoffs',
      score: w.score,
    };
  });
  const stints = buildStints({ presence, moves: mds, keepers: extra.keepers ?? null, holderOf: (y, f) => ix.entityOf(y, f), latest });

  const finish = (y, f) => {
    const s = ix.ds.seasons.find((x) => x.y === y);
    return s?.done ? s.teams?.[f]?.r ?? null : null;
  };

  const detail = (s) => {
    const r = s.ref ?? {};
    const y = s.start?.year;
    if (s.how === HOW.draft) {
      const from = r.from ? ` (pick acquired from ${teamName(r.year, r.from)})` : '';
      return `${r.year} ${ordinal(r.round)} round, pick ${r.pick} (${ordinal(r.overall)} overall)${from}`;
    }
    if (s.how === HOW.trade) return `trade with ${teamName(y, r.from)}`;
    if (s.how === HOW.auction) return r.bid != null ? `auction, $${r.bid.toLocaleString('en-US')}` : 'auction';
    if (s.how === HOW.waiver) return r.bid != null ? `waiver claim, $${r.bid.toLocaleString('en-US')} bid` : 'waiver claim';
    if (s.how === HOW.freeAgent) return 'free-agent pickup';
    if (s.how === HOW.commissioner) return 'added by the commissioner';
    if (s.how === HOW.inherited) return 'on the roster when this owner took the team over';
    return 'not on record';
  };
  const endDetail = (s) => {
    if (s.ended === ENDED.traded) return `traded to ${teamName(s.end?.year, s.endRef?.to)}`;
    if (s.ended === ENDED.notKept) return `not kept for ${s.lastSeen ? s.lastSeen.year + 1 : 'the next season'}`;
    return s.ended;
  };

  const stintRows = [];
  const rowOf = new Map();
  for (const s of stints) {
    const years = [...s.seasons.keys()].sort((a, b) => a - b);
    const first = years[0] ?? s.start?.year ?? s.end?.year;
    const last = years.at(-1) ?? s.end?.year ?? first;
    if (first == null) continue;
    const owner = ownerAt(first, s.franchiseId);
    const tot = stintTotals(s);
    const titleYears = years.filter((y) => finish(y, s.franchiseId) === 'C');
    const playoffYears = years.filter((y) => MADE.has(finish(y, s.franchiseId)));
    const row = {
      year: first,
      lastYear: last,
      player: nameOf(s.pid),
      position: posOf(s.pid),
      nflTeams: nflTeamPath(nflOf, s.pid, years),
      team: teamName(last, s.franchiseId),
      owner: owner.name,
      fromDate: s.start?.date ?? null,
      acquired: s.how,
      acquiredDetail: detail(s),
      tradeId: s.how === HOW.trade ? s.ref.tradeId : null,
      tradePartner: s.how === HOW.trade ? teamName(s.start.year, s.ref.from) : null,
      ended: s.ended,
      endDate: s.end?.date ?? null,
      endDetail: endDetail(s),
      seasons: years.length,
      starts: tot.starts,
      points: tot.points,
      playoffPoints: tot.playoffPoints,
      bySeason: years.map((y) => `${y}: ${s.seasons.get(y).points} pts in ${s.seasons.get(y).starts} starts`).join('; '),
      titles: titleYears.length,
      titleYears: titleYears.join(', '),
      playoffYears: playoffYears.join(', '),
      _franchiseId: s.franchiseId,
      _ownerSlug: owner.ownerSlug,
      _pid: s.pid,
      _stint: s,
    };
    stintRows.push(row);
    rowOf.set(s, row);
  }

  // Champions' rosters: everyone who started for the champion that season.
  const byTeamSeason = new Map();
  for (const s of stints) {
    for (const [y, ss] of s.seasons) {
      if (finish(y, s.franchiseId) !== 'C' || !ss.starts) continue;
      const k = `${y}|${s.franchiseId}|${s.pid}`;
      if (!byTeamSeason.has(k)) byTeamSeason.set(k, []);
      byTeamSeason.get(k).push({ s, ss, y });
    }
  }
  const titleRows = [];
  for (const parts of byTeamSeason.values()) {
    // Dropped and re-added in a title season: the stint he started most in tells how.
    const main = parts.slice().sort((a, b) => b.ss.starts - a.ss.starts)[0];
    const { s, y } = main;
    const owner = ownerAt(y, s.franchiseId);
    const sum = (k) => r2(parts.reduce((a, x) => a + x.ss[k], 0));
    titleRows.push({
      year: y,
      team: teamName(y, s.franchiseId),
      owner: owner.name,
      player: nameOf(s.pid),
      position: posOf(s.pid),
      nflTeam: nflOf(s.pid, y),
      acquired: s.how,
      acquiredYear: s.start?.year ?? null,
      acquiredDetail: detail(s),
      tradeId: s.how === HOW.trade ? s.ref.tradeId : null,
      tradeDate: s.how === HOW.trade ? s.start.date : null,
      tradePartner: s.how === HOW.trade ? teamName(s.start.year, s.ref.from) : null,
      carriedOver: main.ss.carriedOver,
      keeper: main.ss.keeper,
      seasonsBefore: [...s.seasons.keys()].filter((x) => x < y).length,
      starts: sum('starts'),
      points: sum('points'),
      playoffStarts: sum('playoffStarts'),
      playoffPoints: sum('playoffPoints'),
      _franchiseId: s.franchiseId,
      _ownerSlug: owner.ownerSlug,
      _pid: s.pid,
    });
  }
  titleRows.sort((a, b) => a.year - b.year || b.points - a.points);

  // Every stint by (franchise, player), to follow a drafted player through trades.
  const byKey = new Map();
  for (const s of stints) {
    const k = `${s.franchiseId}|${s.pid}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  /** The drafted player's stints: the drafting one, then each one a trade led to. */
  const pathFrom = (f, pid, year) => {
    const out = [];
    let s = (byKey.get(`${f}|${pid}`) ?? []).find((x) => x.how === HOW.draft && x.ref?.year === year);
    const seen = new Set();
    while (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (s.ended !== ENDED.traded) break;
      const to = s.endRef?.to;
      const id = s.endRef?.tradeId;
      s = (byKey.get(`${to}|${pid}`) ?? []).find((x) => x.how === HOW.trade && x.ref?.tradeId === id);
    }
    return out;
  };

  const chains = buildPickChains(mds, extra.pickTrades ?? null);
  const chainRows = chains.map((c) => {
    // Every holder in order, with the record's gaps shown: a hop whose giver is
    // not the last holder names the giver too, rather than skipping him.
    const holders = [];
    const years = [];
    const add = (f, y) => {
      if (f && holders.at(-1) !== f) {
        holders.push(f);
        years.push(y);
      }
    };
    add(c.original, c.hops[0]?.year ?? c.year);
    for (const h of c.hops) {
      add(h.from, h.year);
      add(h.to, h.year);
    }
    const yOf = (i) => years[i];
    const used = c.used;
    const path = used ? pathFrom(used.by, used.pid, c.year) : [];
    const drafter = path[0] ? stintTotals(path[0]) : null;
    const owner = used ? ownerAt(c.year, used.by) : null;
    const orig = c.original ? ownerAt(c.year, c.original) : null;
    const nameAt = (y, f) => teamName(Math.min(y, ix.ds.seasons.at(-1)?.y ?? y), f);
    return {
      year: c.year,
      round: c.round,
      pick: used?.pick ?? null,
      overall: used?.overall ?? null,
      draft: c.unit && c.unit !== 'LEAGUE' ? c.unit.replace(/^CONFERENCE0*/, 'Conference ') : '',
      originalTeam: c.original ? nameAt(c.year, c.original) : null,
      originalOwner: orig?.name ?? null,
      trades: c.hops.length,
      path: holders.map((f, i) => nameAt(yOf(i), f)).join(' → '),
      pathOwners: [...new Set(holders.map((f, i) => ownerAt(Math.min(yOf(i), ix.ds.seasons.at(-1)?.y ?? yOf(i)), f).name))].join(' → '),
      tradeIds: c.hops.map((h) => h.tradeId).filter(Boolean).join(', '),
      firstTradeDate: c.hops[0]?.date ?? null,
      lastTradeDate: c.hops.at(-1)?.date ?? null,
      team: used ? nameAt(c.year, used.by) : null,
      owner: owner?.name ?? null,
      player: used ? nameOf(used.pid) : null,
      position: used ? posOf(used.pid) : null,
      status: c.status,
      confidence: c.confidence,
      candidates: c.candidates?.length ? c.candidates.map(nameOf).join(' or ') : null,
      pointsForTeam: drafter ? drafter.points : used ? 0 : null,
      seasonsForTeam: path[0] ? path[0].seasons.size : used ? 0 : null,
      pointsAfter: used ? r2(path.reduce((a, s) => a + stintTotals(s).points, 0)) : null,
      afterDraft: path
        .map((s) => {
          const r = rowOf.get(s);
          return r ? `${r.team} ${r.year === r.lastYear ? r.year : `${r.year}-${r.lastYear}`}: ${r.points} pts in ${r.starts} starts (${r.endDetail})` : '';
        })
        .filter(Boolean)
        .join('; '),
      _franchiseId: used?.by ?? c.original ?? null,
      _ownerSlug: owner?.ownerSlug ?? null,
    };
  });

  const prepared = { stints: stintRows, titleRosters: titleRows, pickChains: chainRows, _stints: stints, _chains: chains };
  cache.set(mds, prepared);
  return prepared;
}

/** A team's name in season `y`, or its nearest season (a future pick, a year before the record). */
function nearestName(ix, y, f) {
  const seasons = ix.ds.seasons;
  if (y == null) return f;
  const near = y > (seasons.at(-1)?.y ?? 0) ? seasons.findLast((s) => s.teams[f]) : seasons.find((s) => s.teams[f]);
  return near?.teams[f]?.n ?? f;
}
