/**
 * Ask the History — the roster-move units, over league-history-moves.json
 * (scripts/compute-league-history-moves.mjs): trades, waiver and free-agent
 * pickups, draft picks and auction wins.
 *
 * What a move was WORTH comes from the player-week record (ask-players.mjs):
 * points a player scored AS A STARTER for the team that got him, regular
 * season and playoffs (consolation excluded, the same rule as every other
 * answer), from the week of the move to the end of that season. A league with
 * missing player weeks (the AFL's 2007-2019) undercounts there, and the
 * engine's prompt says so.
 *
 * Four units:
 * - `trades`: one row per side of a trade (each trade appears twice).
 * - `pickups`: one row per player added off waivers or free agency.
 * - `draftPicks`: one row per pick made.
 * - `auctions`: one row per auction win (TheLeague's salary auction).
 */
import { formatPickLabel, parsePickToken } from '../mfl-pick-tokens.mjs';

const r2 = (n) => Math.round(n * 100) / 100;

const VALUE = 'starter points, regular season and playoffs';

export const MOVE_FIELDS = {
  trades: {
    year: { type: 'number', label: 'Season' },
    date: { type: 'string', label: 'Date', desc: 'YYYY-MM-DD (compare with gte/lte)' },
    week: { type: 'number', label: 'Week', desc: 'NFL week current at the time; 0 = before the season' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    partner: { type: 'string', label: 'Partner', desc: 'the other team in the trade' },
    partnerOwner: { type: 'string', label: 'Partner owner' },
    got: { type: 'string', label: 'Got', desc: 'players and picks this team received (contains to find a player)' },
    gave: { type: 'string', label: 'Gave', desc: 'players and picks this team gave up' },
    playersGot: { type: 'number', label: 'Players in' },
    picksGot: { type: 'number', label: 'Picks in' },
    pointsGot: { type: 'number', label: 'Pts in', desc: `what the received players scored for this team the rest of that season (${VALUE})` },
    pointsGave: { type: 'number', label: 'Pts out', desc: 'what the players given up scored for the partner the rest of that season' },
    pointsNet: { type: 'number', label: 'Net', desc: 'pointsGot - pointsGave: who won the trade that season' },
  },
  pickups: {
    year: { type: 'number', label: 'Season' },
    date: { type: 'string', label: 'Date' },
    week: { type: 'number', label: 'Week', desc: 'NFL week current at the time; 0 = before the season' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    how: { type: 'string', label: 'How', desc: 'waiver | free agent' },
    bid: { type: 'number', label: 'Bid', desc: 'blind-bid amount in dollars (null when there was no bid)' },
    pointsAfter: { type: 'number', label: 'Pts after', desc: `what he scored for this team the rest of that season (${VALUE})` },
    startsAfter: { type: 'number', label: 'Starts after' },
  },
  draftPicks: {
    year: { type: 'number', label: 'Season' },
    draft: { type: 'string', label: 'Draft', desc: "which draft: '' for a league-wide draft, else the conference" },
    round: { type: 'number', label: 'Rd' },
    pick: { type: 'number', label: 'Pick', desc: 'pick within the round' },
    overall: { type: 'number', label: 'Overall', desc: 'pick number in the whole draft' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    seasonPoints: { type: 'number', label: 'Pts that year', desc: `what he scored for the drafting team that season (${VALUE})` },
    pointsWithTeam: { type: 'number', label: 'Pts with team', desc: 'what he scored for the drafting franchise in every season on record' },
    seasonsWithTeam: { type: 'number', label: 'Seasons with team', desc: 'seasons he started for the drafting franchise' },
  },
  auctions: {
    year: { type: 'number', label: 'Season' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    salary: { type: 'number', label: 'Salary', desc: 'winning bid in dollars' },
    seasonPoints: { type: 'number', label: 'Pts that year', desc: `what he scored for the winning team that season (${VALUE})` },
    dollarsPerPoint: { type: 'number', label: '$/pt', desc: 'salary / seasonPoints (null when he scored nothing)' },
  },
};

export const MOVE_UNITS = Object.keys(MOVE_FIELDS);

export const MOVE_DEFAULT_COLUMNS = {
  trades: ['year', 'date', 'team', 'got', 'gave', 'pointsNet'],
  pickups: ['year', 'week', 'player', 'position', 'team', 'pointsAfter'],
  draftPicks: ['year', 'round', 'pick', 'player', 'position', 'team', 'seasonPoints'],
  auctions: ['year', 'player', 'position', 'team', 'salary', 'seasonPoints'],
};

const cache = new WeakMap();

/**
 * Index the move dataset against the prepared team index `p` (ask-query's
 * prepare()) and the prepared player weeks `pp` (preparePlayers, or null when
 * the league has none, which leaves every points field null).
 */
export function prepareMoves(p, pp, mds) {
  if (cache.has(mds)) return cache.get(mds);
  const { ix } = p;
  const owner = (y, f) => ix.entity(ix.entityOf(y, f));
  const teamName = (y, f) => ix.team(y, f)?.n ?? f;

  const names = new Map(Object.entries(mds.players ?? {}));
  const nameOf = (pid) => names.get(pid)?.[0] ?? pid;
  const posOf = (pid) => names.get(pid)?.[1] ?? '';

  // (year, franchise, player) → that player's counted weeks for that team.
  const scored = new Map();
  for (const w of pp?.playerWeeks ?? []) {
    if (!w.started || (w.kind !== 'regular' && w.kind !== 'playoffs')) continue;
    const k = `${w.year}|${w._franchiseId}|${w._pid}`;
    if (!scored.has(k)) scored.set(k, []);
    scored.get(k).push(w);
    if (!names.has(w._pid)) names.set(w._pid, [w.player, w.position]);
  }
  const has = !!pp;
  const pointsFrom = (y, f, pid, week = 0) => {
    if (!has) return { points: null, starts: null };
    const ws = (scored.get(`${y}|${f}|${pid}`) ?? []).filter((w) => w.week >= week);
    return { points: r2(ws.reduce((a, w) => a + w.score, 0)), starts: ws.length };
  };

  const assets = (y, list) => {
    const players = [];
    const picks = [];
    for (const token of String(list ?? '').split(',').filter(Boolean)) {
      const pick = parsePickToken(token);
      if (pick) picks.push(formatPickLabel(pick, (id) => teamName(y, id)));
      else players.push(token);
    }
    return { players, picks };
  };

  const trades = [];
  for (const [y, date, week, fa, fb, aGave, bGave] of mds.trades ?? []) {
    const a = assets(y, aGave);
    const b = assets(y, bGave);
    for (const [f, of, got, gave] of [
      [fa, fb, b, a],
      [fb, fa, a, b],
    ]) {
      const o = owner(y, f);
      const po = owner(y, of);
      const sum = (list, team) => (has ? r2(list.reduce((s, pid) => s + pointsFrom(y, team, pid, week).points, 0)) : null);
      const pointsGot = sum(got.players, f);
      const pointsGave = sum(gave.players, of);
      trades.push({
        year: y,
        date,
        week,
        team: teamName(y, f),
        owner: o.name,
        partner: teamName(y, of),
        partnerOwner: po.name,
        got: [...got.players.map(nameOf), ...got.picks].join(', '),
        gave: [...gave.players.map(nameOf), ...gave.picks].join(', '),
        playersGot: got.players.length,
        picksGot: got.picks.length,
        pointsGot,
        pointsGave,
        pointsNet: has ? r2(pointsGot - pointsGave) : null,
        _franchiseId: f,
        _ownerSlug: o.ownerSlug,
      });
    }
  }

  const pickups = (mds.pickups ?? []).map(([y, date, week, f, pid, how, bid]) => {
    const o = owner(y, f);
    const after = pointsFrom(y, f, pid, week);
    return {
      year: y,
      date,
      week,
      team: teamName(y, f),
      owner: o.name,
      player: nameOf(pid),
      position: posOf(pid),
      how,
      bid,
      pointsAfter: after.points,
      startsAfter: after.starts,
      _franchiseId: f,
      _ownerSlug: o.ownerSlug,
    };
  });

  // Every season a player started for a franchise, for "points with team".
  const byFranchise = new Map();
  for (const [k, ws] of scored) {
    const [y, f, pid] = k.split('|');
    const key = `${f}|${pid}`;
    if (!byFranchise.has(key)) byFranchise.set(key, { points: 0, years: new Set() });
    const e = byFranchise.get(key);
    e.points = r2(e.points + ws.reduce((a, w) => a + w.score, 0));
    e.years.add(Number(y));
  }

  const draftPicks = (mds.drafts ?? []).map(([y, unit, round, pick, overall, f, pid]) => {
    const o = owner(y, f);
    const career = byFranchise.get(`${f}|${pid}`);
    // Seasons from the draft on: a franchise that drafted him again later
    // should not be credited with a stint before this pick.
    const later = career ? [...career.years].filter((yr) => yr >= y) : [];
    return {
      year: y,
      draft: unit === 'LEAGUE' ? '' : unit.replace(/^CONFERENCE0*/, 'Conference '),
      round,
      pick,
      overall,
      team: teamName(y, f),
      owner: o.name,
      player: nameOf(pid),
      position: posOf(pid),
      seasonPoints: pointsFrom(y, f, pid).points,
      pointsWithTeam: has ? r2(later.reduce((a, yr) => a + pointsFrom(yr, f, pid).points, 0)) : null,
      seasonsWithTeam: has ? later.length : null,
      _franchiseId: f,
      _ownerSlug: o.ownerSlug,
    };
  });

  const auctions = (mds.auctions ?? []).map(([y, f, pid, salary]) => {
    const o = owner(y, f);
    const pts = pointsFrom(y, f, pid).points;
    return {
      year: y,
      team: teamName(y, f),
      owner: o.name,
      player: nameOf(pid),
      position: posOf(pid),
      salary,
      seasonPoints: pts,
      dollarsPerPoint: pts ? Math.round(salary / pts) : null,
      _franchiseId: f,
      _ownerSlug: o.ownerSlug,
    };
  });

  const prepared = { trades, pickups, draftPicks, auctions };
  cache.set(mds, prepared);
  return prepared;
}
