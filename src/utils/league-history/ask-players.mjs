/**
 * Ask the History — the player units, over league-history-players.json
 * (scripts/compute-league-history-players.mjs): every rostered player's score
 * in every final week, starter or bench.
 *
 * Joined to the team record (ask-query.mjs's prepared index) so a player-week
 * carries the same week kind the team questions use: a playoff week for a
 * team still in the bracket, consolation for a team in the toilet bowl, and
 * `none` for a team with no game that week (eliminated, or a bye). Player
 * credit follows the team: a player's points count for the owner who started
 * him that week.
 *
 * Three units:
 * - `playerWeeks`: one row per player per week.
 * - `playerSeasons`: one row per player per team per season.
 * - `playerCareers`: one row per player across every team he played for here.
 */

const r2 = (n) => Math.round(n * 100) / 100;

export const PLAYER_FIELDS = {
  playerWeeks: {
    year: { type: 'number', label: 'Season' },
    week: { type: 'number', label: 'Week' },
    kind: { type: 'string', label: 'Type', desc: "the team's week: regular | playoffs | consolation | none. Only regular and playoffs unless you filter on kind" },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos', desc: 'QB | RB | WR | TE | PK | Def (MFL codes)' },
    team: { type: 'string', label: 'Team', desc: 'the fantasy team that rostered him that week' },
    owner: { type: 'string', label: 'Owner' },
    score: { type: 'number', label: 'Pts' },
    started: { type: 'boolean', label: 'Started', desc: 'in the lineup. Only starters unless you filter on started' },
    optimal: { type: 'boolean', label: 'Optimal', desc: "MFL's best possible lineup would have started him" },
    result: { type: 'string', label: 'Result', desc: "the team's result that week: W | L | T (two letters in a doubleheader week, e.g. WL)" },
    opponent: { type: 'string', label: 'Opponent' },
  },
  playerSeasons: {
    year: { type: 'number', label: 'Season' },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    starts: { type: 'number', label: 'Starts', desc: 'regular-season weeks started' },
    points: { type: 'number', label: 'Pts', desc: 'regular-season points as a starter' },
    avgStart: { type: 'number', label: 'Pts/start' },
    bestWeek: { type: 'number', label: 'Best', desc: 'best regular-season week as a starter' },
    benchPoints: { type: 'number', label: 'Bench pts', desc: 'regular-season points scored while on the bench' },
    playoffStarts: { type: 'number', label: 'PO starts' },
    playoffPoints: { type: 'number', label: 'PO pts', desc: 'postseason points as a starter (consolation excluded)' },
    champion: { type: 'boolean', label: 'Won title', desc: "his team won the championship that season" },
  },
  playerCareers: {
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    starts: { type: 'number', label: 'Starts', desc: 'regular-season and playoff weeks started' },
    points: { type: 'number', label: 'Pts', desc: 'regular-season and playoff points as a starter' },
    avgStart: { type: 'number', label: 'Pts/start' },
    bestWeek: { type: 'number', label: 'Best' },
    seasons: { type: 'number', label: 'Seasons', desc: 'seasons he started at least once' },
    teams: { type: 'number', label: 'Teams', desc: 'different owners he started for' },
    lastTeam: { type: 'string', label: 'Last team' },
    playoffPoints: { type: 'number', label: 'PO pts' },
    titles: { type: 'number', label: 'Titles', desc: 'championships won by a team he started for in that postseason' },
  },
};

export const PLAYER_UNITS = Object.keys(PLAYER_FIELDS);

export const PLAYER_DEFAULT_COLUMNS = {
  playerWeeks: ['year', 'week', 'player', 'position', 'team', 'score', 'kind'],
  playerSeasons: ['year', 'player', 'position', 'team', 'points', 'starts'],
  playerCareers: ['player', 'position', 'points', 'starts', 'seasons', 'teams'],
};

const cache = new WeakMap();

/**
 * Index the player dataset against the prepared team index `p` (ask-query's
 * prepare()). Cached per player dataset.
 */
export function preparePlayers(p, pds) {
  if (cache.has(pds)) return cache.get(pds);
  const { ix } = p;

  // (year, week, franchise) → the team's games that week.
  const teamWeek = new Map();
  for (const g of ix.teamGames) {
    const k = `${g.y}|${g.wk}|${g.f}`;
    if (!teamWeek.has(k)) teamWeek.set(k, []);
    teamWeek.get(k).push(g);
  }
  const kindOf = (games) =>
    !games?.length ? 'none' : games.some((g) => g.kind === 'playoffs') ? 'playoffs' : games.some((g) => g.kind === 'regular') ? 'regular' : 'consolation';

  const champs = new Set();
  for (const s of ix.ds.seasons) for (const [f, t] of Object.entries(s.teams)) if (s.done && t.r === 'C') champs.add(`${s.y}|${f}`);

  const weeks = [];
  for (const [y, wk, f, pid, score, flags] of pds.weeks ?? []) {
    const games = teamWeek.get(`${y}|${wk}|${f}`);
    const [name, pos] = pds.players?.[pid] ?? [pid, ''];
    const owner = ix.entity(ix.entityOf(y, f));
    weeks.push({
      year: y,
      week: wk,
      kind: kindOf(games),
      player: name,
      position: pos,
      team: ix.team(y, f)?.n ?? f,
      owner: owner.name,
      score,
      started: (flags & 1) === 1,
      optimal: (flags & 2) === 2,
      result: (games ?? []).map((g) => (g.tie ? 'T' : g.won ? 'W' : 'L')).join(''),
      opponent: [...new Set((games ?? []).map((g) => ix.team(g.y, g.of)?.n ?? g.of))].join(' & '),
      _franchiseId: f,
      _ownerSlug: owner.ownerSlug,
      _pid: pid,
      _ownerKey: owner.key,
    });
  }

  const seasons = new Map();
  const careers = new Map();
  for (const w of weeks) {
    if (w.kind === 'consolation' || w.kind === 'none') {
      if (w.kind === 'none' || !w.started) continue;
    }
    const sk = `${w.year}|${w._franchiseId}|${w._pid}`;
    if (!seasons.has(sk)) {
      seasons.set(sk, {
        year: w.year, player: w.player, position: w.position, team: w.team, owner: w.owner,
        starts: 0, points: 0, bestWeek: null, benchPoints: 0, playoffStarts: 0, playoffPoints: 0,
        champion: champs.has(`${w.year}|${w._franchiseId}`),
        _franchiseId: w._franchiseId, _ownerSlug: w._ownerSlug,
      });
    }
    const s = seasons.get(sk);
    if (w.kind === 'regular') {
      if (w.started) {
        s.starts++;
        s.points = r2(s.points + w.score);
        s.bestWeek = s.bestWeek === null ? w.score : Math.max(s.bestWeek, w.score);
      } else s.benchPoints = r2(s.benchPoints + w.score);
    } else if (w.kind === 'playoffs' && w.started) {
      s.playoffStarts++;
      s.playoffPoints = r2(s.playoffPoints + w.score);
    }

    if (!w.started || (w.kind !== 'regular' && w.kind !== 'playoffs')) continue;
    if (!careers.has(w._pid)) {
      careers.set(w._pid, {
        player: w.player, position: w.position, starts: 0, points: 0, bestWeek: null,
        _years: new Set(), _owners: new Set(), _titles: new Set(), lastTeam: w.team, _last: 0, playoffPoints: 0,
        _franchiseId: w._franchiseId, _ownerSlug: null,
      });
    }
    const c = careers.get(w._pid);
    c.starts++;
    c.points = r2(c.points + w.score);
    c.bestWeek = c.bestWeek === null ? w.score : Math.max(c.bestWeek, w.score);
    c._years.add(w.year);
    c._owners.add(w._ownerKey);
    if (w.kind === 'playoffs') {
      c.playoffPoints = r2(c.playoffPoints + w.score);
      if (champs.has(`${w.year}|${w._franchiseId}`)) c._titles.add(w.year);
    }
    const order = w.year * 100 + w.week;
    if (order >= c._last) {
      c._last = order;
      c.lastTeam = w.team;
      c._franchiseId = w._franchiseId;
    }
  }

  const seasonRows = [...seasons.values()].map((s) => ({ ...s, avgStart: s.starts ? r2(s.points / s.starts) : 0 }));
  const careerRows = [...careers.values()].map((c) => ({
    player: c.player,
    position: c.position,
    starts: c.starts,
    points: c.points,
    avgStart: c.starts ? r2(c.points / c.starts) : 0,
    bestWeek: c.bestWeek,
    seasons: c._years.size,
    teams: c._owners.size,
    lastTeam: c.lastTeam,
    playoffPoints: c.playoffPoints,
    titles: c._titles.size,
    _franchiseId: c._franchiseId,
    _ownerSlug: null,
  }));

  const prepared = { playerWeeks: weeks, playerSeasons: seasonRows, playerCareers: careerRows, missingWeeks: pds.missingWeeks ?? {} };
  cache.set(pds, prepared);
  return prepared;
}

/** "AFL player scores are missing for 2007-2011 Weeks 1-13, …" — what a player answer could not see. */
export function describeMissingWeeks(missing) {
  const years = Object.keys(missing ?? {}).map(Number).sort((a, b) => a - b);
  if (!years.length) return '';
  const groups = [];
  for (const y of years) {
    const weeks = missing[y];
    const label = weekRange(weeks);
    const last = groups.at(-1);
    if (last && last.label === label && last.to === y - 1) last.to = y;
    else groups.push({ from: y, to: y, label });
  }
  return `Player scores are missing for ${groups.map((g) => `${g.from === g.to ? g.from : `${g.from}-${g.to}`} ${g.label}`).join('; ')}`;
}

function weekRange(weeks) {
  const parts = [];
  let start = weeks[0];
  let prev = weeks[0];
  for (const w of [...weeks.slice(1), null]) {
    if (w === prev + 1) {
      prev = w;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = w;
    prev = w;
  }
  return `Week${weeks.length > 1 ? 's' : ''} ${parts.join(', ')}`;
}
