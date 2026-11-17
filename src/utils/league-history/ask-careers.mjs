/**
 * Ask the History — a player's whole path through the league, and what a
 * waiver or free-agent pickup was worth over everything he did for the team
 * that added him. Both read the stints (stints.mjs via ask-stints.mjs), so a
 * career, a pickup and a stint can never disagree about who had him when.
 *
 * Two units:
 * - `careers`: one row per player ever rostered: every team (owner) that had
 *   him, how he arrived and left each time, his starter points, playoff points
 *   and the titles he started for, and (TheLeague) his salary where the
 *   season salary files or his auction and waiver bids record it.
 * - `pickupImpact`: one row per waiver claim or free-agent pickup, valued over
 *   the WHOLE stint it opened (every season he stayed, not just that season's
 *   end), with the playoff points, titles and WINS SWUNG it carried.
 *
 * Wins swung: a regular-season or playoff game his team won by less than he
 * scored as a starter that week. The assumption, stated wherever the number
 * is: with a zero in his lineup slot (no replacement scoring for him), that
 * win would have been a loss. A margin exactly equal to his score would have
 * been a tie, and is not counted.
 *
 * A one-player answer from `careers`, `stints` or `pickupImpact` carries a
 * career timeline chart (careerTimeline below, drawn by record-charts.mjs
 * careerChart): every stint as a team-colored segment across the seasons, and
 * his starter points season by season.
 *
 * Pure: the caller passes every dataset.
 */
import { ENDED, HOW, stintTotals } from './stints.mjs';
import { prepareStints } from './ask-stints.mjs';
import { NFL_DRAFT_FIELDS, NFL_PATH_DESC, nflTeamPath } from './ask-players.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const POINTS = 'starter points, regular season and playoffs';
const SWUNG =
  'regular-season and playoff games his team won by LESS than his starter points that week: with a zero in his lineup slot (no replacement scoring for him) each would have been a loss. A margin equal to his score (a tie) is not counted';

export const CAREER_FIELDS = {
  careers: {
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    year: { type: 'number', label: 'From', desc: 'first season he was rostered here (a years filter keeps every career that overlaps it)' },
    lastYear: { type: 'number', label: 'To', desc: 'last season he was rostered here' },
    seasons: { type: 'number', label: 'Seasons', desc: 'seasons he was on a roster here' },
    teams: { type: 'number', label: 'Teams', desc: 'different teams that rostered him (a team is one owner\'s franchise: credit follows the owner)' },
    teamsStartedFor: { type: 'number', label: 'Started for', desc: 'different teams he started at least one game for' },
    stints: { type: 'number', label: 'Stints', desc: 'separate spells with a team (back with the same team later is a second stint)' },
    path: { type: 'string', label: 'Path', desc: '"Team A 2015-2017 (draft → traded) · Team B 2017-2019 (trade → dropped)", oldest first; contains finds a team' },
    owners: { type: 'string', label: 'Owners', desc: 'every owner who had him, in order (contains finds an owner)' },
    arrivals: { type: 'string', label: 'Arrived by', desc: 'how each team got him, counted: "draft 1, trade 2, waiver 1"' },
    timesTraded: { type: 'number', label: 'Traded', desc: 'times he was traded away' },
    timesDropped: { type: 'number', label: 'Dropped', desc: 'times he was released' },
    timesClaimed: { type: 'number', label: 'Claimed', desc: 'times he was added off waivers or free agency' },
    starts: { type: 'number', label: 'Starts', desc: 'weeks started, regular season and playoffs' },
    points: { type: 'number', label: 'Pts', desc: `career total here (${POINTS})` },
    playoffStarts: { type: 'number', label: 'PO starts' },
    playoffPoints: { type: 'number', label: 'PO pts', desc: 'postseason points as a starter' },
    bestSeason: { type: 'string', label: 'Best season', desc: '"2019 Team A: 310.5 pts"' },
    titles: { type: 'number', label: 'Titles', desc: 'championship seasons he started at least one game for the champion ("started for the most champions" sorts this)' },
    titleYears: { type: 'string', label: 'Title years', desc: '"2019 (Team A), 2022 (Team B)"' },
    nflTeams: { type: 'string', label: 'NFL teams', desc: `${NFL_PATH_DESC}, over every season he was rostered here` },
    titleTeams: { type: 'number', label: 'Title teams', desc: 'different teams he won a title with' },
    salaryHigh: { type: 'number', label: 'Top salary', desc: 'highest salary on record; null where the league keeps no salaries' },
    salaries: { type: 'string', label: 'Salaries', desc: 'salary by season and team where on record: "2019 Team A $1,000,000; …". The season he was won at auction or claimed on waivers shows that bid; other seasons show the season salary file (rosters at its freeze week), which lists some players at the league minimum their bid says otherwise' },
    currentTeam: { type: 'string', label: 'Now with', desc: 'the team rostering him in the latest week (null when nobody is)' },
    ...NFL_DRAFT_FIELDS,
  },
  pickupImpact: {
    year: { type: 'number', label: 'Season', desc: 'season of the pickup' },
    date: { type: 'string', label: 'Date' },
    week: { type: 'number', label: 'Week', desc: 'NFL week current at the pickup; 0 = before the season' },
    team: { type: 'string', label: 'Team', desc: 'the team that added him' },
    owner: { type: 'string', label: 'Owner' },
    player: { type: 'string', label: 'Player' },
    position: { type: 'string', label: 'Pos' },
    how: { type: 'string', label: 'How', desc: 'waiver | free agent' },
    bid: { type: 'number', label: 'Bid', desc: 'blind-bid dollars (null when none)' },
    lastYear: { type: 'number', label: 'Kept to', desc: 'last season of the stint the pickup opened' },
    seasons: { type: 'number', label: 'Seasons', desc: 'seasons he stayed with the team that added him' },
    ended: { type: 'string', label: 'Ended', desc: `${Object.values(ENDED).join(' | ')}` },
    starts: { type: 'number', label: 'Starts', desc: 'for the team that added him, over the whole stint' },
    points: { type: 'number', label: 'Pts (stint)', desc: `THE DEFAULT MEASURE of a pickup: what he scored for the team that added him over the whole stint, every season he stayed (${POINTS})` },
    pointsSeason: { type: 'number', label: 'Pts that season', desc: 'the same, the pickup season only (pickups.pointsAfter)' },
    playoffPoints: { type: 'number', label: 'PO pts', desc: 'postseason starter points for that team over the stint' },
    winsSwung: { type: 'number', label: 'Wins swung', desc: SWUNG },
    playoffWinsSwung: { type: 'number', label: 'PO wins swung', desc: 'the playoff games among winsSwung' },
    swungGames: { type: 'string', label: 'Swung games', desc: '"2019 Wk 5: won by 3.20, he scored 18.50; …"' },
    titles: { type: 'number', label: 'Titles', desc: 'seasons in the stint the team won the title with him starting at least one game' },
    titleYears: { type: 'string', label: 'Title years' },
  },
};

export const CAREER_UNITS = Object.keys(CAREER_FIELDS);

export const CAREER_DEFAULT_COLUMNS = {
  careers: ['player', 'position', 'year', 'lastYear', 'teams', 'path', 'points', 'titles', 'titleTeams', 'titleYears'],
  pickupImpact: ['year', 'player', 'position', 'team', 'seasons', 'points', 'winsSwung', 'titles'],
};

export const CAREER_UNIT_WORDS = {
  careers: "player careers here (every team that rostered him, how he arrived and left, his starter points and titles)",
  pickupImpact: 'waiver and free-agent pickups, valued over the whole stint each one opened',
};

export const CAREER_COUNT_LABEL = { careers: 'Players', pickupImpact: 'Pickups' };

const cache = new WeakMap();
/** A long path keeps its first and last ten stints (a defense can have 90): the stints unit lists every one. */
const PATH_ENDS = 10;
const capped = (list) => (list.length <= PATH_ENDS * 2 + 1 ? list : [...list.slice(0, PATH_ENDS), `… ${list.length - PATH_ENDS * 2} more stints …`, ...list.slice(-PATH_ENDS)]);
const NO_SALARIES = {};

/**
 * Index both units. `p` is ask-query's prepare(), `pp` preparePlayers(), `mds`
 * the moves file; `extra.keepers` / `extra.pickTrades` as prepareStints takes
 * them, and `extra.salaries` the league's season salaries (datasets.ts
 * loadLeagueSalaries: `{ [year]: { [pid]: [salary, franchiseId] } }`), or null.
 */
export function prepareCareers(p, pp, mds, extra = {}) {
  let bySalaries = cache.get(mds);
  if (!bySalaries) cache.set(mds, (bySalaries = new WeakMap()));
  const salaryKey = extra.salaries && typeof extra.salaries === 'object' ? extra.salaries : NO_SALARIES;
  if (bySalaries.has(salaryKey)) return bySalaries.get(salaryKey);

  const ps = prepareStints(p, pp, mds, extra);
  const { ix } = p;
  const finish = (y, f) => {
    const s = ix.ds.seasons.find((x) => x.y === y);
    return s?.done ? s.teams?.[f]?.r ?? null : null;
  };

  // Each team's games by (season, week), for the wins a starter swung.
  const gamesAt = new Map();
  for (const g of ix.teamGames) {
    if (g.kind !== 'regular' && g.kind !== 'playoffs') continue;
    const k = `${g.y}|${g.wk}|${g.f}`;
    if (!gamesAt.has(k)) gamesAt.set(k, []);
    gamesAt.get(k).push(g);
  }
  const swungBy = (stint) => {
    const out = [];
    for (const w of stint.weekRows ?? []) {
      if (!w.started || !w.counted || !(w.score > 0)) continue;
      for (const g of gamesAt.get(`${w.year}|${w.week}|${stint.franchiseId}`) ?? []) {
        if (!g.won) continue;
        const margin = r2(g.s - g.os);
        if (w.score > margin) out.push({ year: w.year, week: w.week, margin, score: w.score, playoff: g.kind === 'playoffs' });
      }
    }
    return out;
  };
  /** Title seasons in a stint in which he started at least one game for the champion. */
  const titleSeasons = (stint) => [...stint.seasons].filter(([y, ss]) => ss.starts > 0 && finish(y, stint.franchiseId) === 'C').map(([y]) => y);

  // The stints unit's rows, keyed by stint, already carry team names and owners.
  const rowOf = new Map(ps.stints.map((r) => [r._stint, r]));
  const salaryOf = (y, pid, f) => {
    const hit = extra.salaries?.[y]?.[pid];
    return hit && hit[1] === f ? hit[0] : null;
  };

  // ---- pickupImpact
  const pickupImpact = [];
  for (const r of ps.stints) {
    const s = r._stint;
    if (s.how !== HOW.waiver && s.how !== HOW.freeAgent) continue;
    const tot = stintTotals(s);
    const swung = swungBy(s);
    const titles = titleSeasons(s);
    const y = s.start?.year ?? r.year;
    pickupImpact.push({
      year: y,
      date: s.start?.date ?? null,
      week: s.start?.week ?? null,
      team: r.team,
      owner: r.owner,
      player: r.player,
      position: r.position,
      how: s.how,
      bid: s.ref?.bid ?? null,
      lastYear: r.lastYear,
      seasons: r.seasons,
      ended: s.ended,
      starts: tot.starts,
      points: tot.points,
      pointsSeason: s.seasons.get(y)?.points ?? 0,
      playoffPoints: tot.playoffPoints,
      winsSwung: swung.length,
      playoffWinsSwung: swung.filter((g) => g.playoff).length,
      swungGames: swung.map((g) => `${g.year} Wk ${g.week}${g.playoff ? ' (playoffs)' : ''}: won by ${g.margin.toFixed(2)}, he scored ${g.score.toFixed(2)}`).join('; '),
      titles: titles.length,
      titleYears: titles.join(', '),
      _franchiseId: r._franchiseId,
      _ownerSlug: r._ownerSlug,
      _pid: s.pid,
    });
  }

  // ---- careers
  const byPid = new Map();
  for (const r of ps.stints) {
    if (!byPid.has(r._pid)) byPid.set(r._pid, []);
    byPid.get(r._pid).push(r);
  }
  const titleByPid = new Map();
  for (const t of ps.titleRosters) {
    const pid = t._pid;
    if (pid == null) continue;
    if (!titleByPid.has(pid)) titleByPid.set(pid, []);
    titleByPid.get(pid).push(t);
  }

  const careers = [];
  for (const [pid, rows] of byPid) {
    rows.sort((a, b) => a.year - b.year || (a.fromDate ?? '').localeCompare(b.fromDate ?? '') || a.lastYear - b.lastYear);
    const teamKey = (r) => `${r._stint.holder ?? r.owner}|${r._franchiseId}`;
    const teams = new Set(rows.map(teamKey));
    const startedFor = new Set(rows.filter((r) => r.starts > 0).map(teamKey));
    const count = (pred) => rows.filter(pred).length;
    const arrivals = new Map();
    for (const r of rows) arrivals.set(r.acquired, (arrivals.get(r.acquired) ?? 0) + 1);
    let best = null;
    const salaryNotes = [];
    let salaryHigh = null;
    const note = (y, team, amount, label = '') => {
      salaryNotes.push(`${y} ${team} ${money(amount)}${label}`);
      if (salaryHigh == null || amount > salaryHigh) salaryHigh = amount;
    };
    for (const r of rows) {
      const s = r._stint;
      // The auction or waiver bid he signed for is his salary the season it
      // was made; the season file (its freeze week) covers the other seasons.
      // The two disagree for some players, almost always with the file at the
      // league minimum, so the bid is the one believed where both exist.
      const bid = (s.how === HOW.auction || s.how === HOW.waiver) && s.ref?.bid != null ? s.ref.bid : null;
      const bidYear = bid != null ? s.start?.year ?? r.year : null;
      const bidLabel = ` (${s.how === HOW.auction ? 'auction' : 'waiver'} bid)`;
      if (bid != null && !s.seasons.has(bidYear)) note(bidYear, r.team, bid, bidLabel);
      for (const [y, ss] of [...s.seasons].sort((a, b) => a[0] - b[0])) {
        if (!best || ss.points > best.points) best = { year: y, team: r.team, points: ss.points };
        if (y === bidYear) note(y, r.team, bid, bidLabel);
        else {
          const sal = salaryOf(y, pid, s.franchiseId);
          if (sal != null) note(y, r.team, sal);
        }
      }
    }
    const titles = (titleByPid.get(pid) ?? []).slice().sort((a, b) => a.year - b.year);
    const tot = rows.reduce(
      (a, r) => ({ starts: a.starts + r.starts, points: a.points + r.points, playoffPoints: a.playoffPoints + r.playoffPoints, playoffStarts: a.playoffStarts + stintTotals(r._stint).playoffStarts }),
      { starts: 0, points: 0, playoffPoints: 0, playoffStarts: 0 },
    );
    const span = (r) => (r.year === r.lastYear ? `${r.year}` : `${r.year}-${r.lastYear}`);
    const current = rows.find((r) => r.ended === ENDED.current);
    const last = rows.at(-1);
    careers.push({
      player: rows[0].player,
      position: rows[0].position,
      year: Math.min(...rows.map((r) => r.year)),
      lastYear: Math.max(...rows.map((r) => r.lastYear)),
      seasons: new Set(rows.flatMap((r) => [...r._stint.seasons.keys()])).size,
      teams: teams.size,
      teamsStartedFor: startedFor.size,
      stints: rows.length,
      nflTeams: nflTeamPath(pp?.nflTeamOf ?? (() => null), pid, rows.flatMap((r) => [...r._stint.seasons.keys()])),
      ...(pp?.nflDraftOf ?? (() => ({})))(pid),
      path: capped(rows.map((r) => `${r.team} ${span(r)} (${r.acquired} → ${r.ended === ENDED.traded ? r.endDetail : r.ended})`)).join(' · '),
      owners: [...new Set(rows.map((r) => r.owner))].join(' → '),
      arrivals: [...arrivals].map(([k, n]) => `${k} ${n}`).join(', '),
      timesTraded: count((r) => r.ended === ENDED.traded),
      timesDropped: count((r) => r.ended === ENDED.dropped),
      timesClaimed: count((r) => r.acquired === HOW.waiver || r.acquired === HOW.freeAgent),
      starts: tot.starts,
      points: r2(tot.points),
      playoffStarts: tot.playoffStarts,
      playoffPoints: r2(tot.playoffPoints),
      bestSeason: best && best.points > 0 ? `${best.year} ${best.team}: ${best.points} pts` : null,
      titles: titles.length,
      titleYears: titles.map((t) => `${t.year} (${t.team})`).join(', '),
      titleTeams: new Set(titles.map((t) => t._franchiseId + '|' + t.owner)).size,
      salaryHigh,
      salaries: salaryNotes.length ? salaryNotes.join('; ') : null,
      currentTeam: current?.team ?? null,
      _franchiseId: (current ?? last)._franchiseId,
      _ownerSlug: (current ?? last)._ownerSlug,
      _pid: pid,
    });
  }

  const prepared = { careers, pickupImpact, _stintRows: ps.stints };
  bySalaries.set(salaryKey, prepared);
  return prepared;
}

/**
 * The season salary files (`mfl-player-salaries-<year>.json`) as the careers
 * unit reads them: `{ [year]: { [pid]: [salary, franchiseId] } }`, rostered
 * players with a salary only.
 * @param {Array<[string | number, any]>} entries [year, file] pairs
 */
export function compactSalaries(entries) {
  const out = {};
  for (const [year, file] of entries) {
    const list = file?.players;
    if (!/^\d{4}$/.test(String(year)) || !Array.isArray(list)) continue;
    const byPid = {};
    for (const pl of list) {
      const salary = Number(pl?.salary);
      if (pl?.id && pl?.franchiseId && Number.isFinite(salary) && salary > 0) byPid[String(pl.id)] = [salary, String(pl.franchiseId)];
    }
    out[String(year)] = byPid;
  }
  return out;
}

/** Fantasy weeks a season is drawn as on the timeline. */
const SEASON_WEEKS = 18;
const MAX_LANES = 12;

/**
 * The career timeline for an answer whose rows are all ONE player (from
 * careers, stints or pickupImpact): the chart object record-charts.mjs
 * careerChart draws. Null for any other answer. Plain JSON, because it is
 * saved with the answer.
 *
 * @param {Array<any>} rows the query's matching rows
 * @param {{ _stintRows: Array<any>, careers: Array<any> }} prepared prepareCareers()
 */
export function careerTimeline(rows, prepared) {
  const pids = new Set(rows.map((r) => r._pid).filter((x) => x != null));
  if (pids.size !== 1) return null;
  const [pid] = pids;
  const stintRows = prepared._stintRows.filter((r) => r._pid === pid);
  const career = prepared.careers.find((c) => c._pid === pid);
  if (!stintRows.length || !career) return null;

  const lanes = [];
  const laneOf = new Map();
  const seasonMap = new Map();
  const pos = (y, w) => r2(y + Math.min(Math.max(w - 1, 0), SEASON_WEEKS) / SEASON_WEEKS);
  const sorted = stintRows.slice().sort((a, b) => a.year - b.year || (a.fromDate ?? '').localeCompare(b.fromDate ?? ''));
  for (const r of sorted) {
    const s = r._stint;
    const weeks = (s.weekRows ?? []).slice().sort((a, b) => a.year - b.year || a.week - b.week);
    const firstSeen = weeks[0];
    const lastSeen = weeks.at(-1);
    const startAt = s.start && (!firstSeen || s.start.year === firstSeen.year) ? s.start : firstSeen ? { year: firstSeen.year, week: firstSeen.week } : s.start;
    const endAt = s.end && lastSeen && s.end.year === lastSeen.year && s.end.week >= lastSeen.week ? s.end : lastSeen ?? s.end;
    if (!startAt || !endAt) continue;
    const key = `${s.holder ?? r.owner}|${s.franchiseId}`;
    if (!laneOf.has(key)) {
      if (lanes.length >= MAX_LANES) continue;
      laneOf.set(key, lanes.length);
      lanes.push({ team: r.team, owner: r.owner, franchiseId: s.franchiseId, segments: [] });
    }
    const lane = lanes[laneOf.get(key)];
    lane.team = r.team; // its latest name
    const from = pos(startAt.year, startAt.week || 1);
    const to = Math.max(from + 1 / SEASON_WEEKS, pos(endAt.year, (endAt.week || 1) + 1));
    lane.segments.push({ from, to: r2(to), how: r.acquired, ended: r.ended, years: r.year === r.lastYear ? `${r.year}` : `${r.year}-${r.lastYear}`, points: r.points, starts: r.starts });
    for (const [y, ss] of s.seasons) {
      if (!seasonMap.has(y)) seasonMap.set(y, { year: y, points: 0, playoffPoints: 0, parts: [], title: null });
      const e = seasonMap.get(y);
      e.points = r2(e.points + ss.points);
      e.playoffPoints = r2(e.playoffPoints + ss.playoffPoints);
      const lane_ = laneOf.get(key);
      const part = e.parts.find((x) => x.lane === lane_);
      if (part) part.points = r2(part.points + ss.points);
      else e.parts.push({ lane: lane_, points: ss.points });
    }
  }
  if (!lanes.length) return null;
  for (const t of (career.titleYears ? career.titleYears.split(', ') : [])) {
    const m = /^(\d{4}) \((.*)\)$/.exec(t);
    if (m && seasonMap.has(Number(m[1]))) seasonMap.get(Number(m[1])).title = m[2];
  }
  const seasons = [...seasonMap.values()].sort((a, b) => a.year - b.year);
  const first = Math.floor(Math.min(...lanes.flatMap((l) => l.segments.map((s) => s.from)), ...seasons.map((s) => s.year)));
  const last = Math.floor(Math.max(...lanes.flatMap((l) => l.segments.map((s) => s.to - 1e-6)), ...seasons.map((s) => s.year)));
  return {
    kind: 'career',
    player: career.player,
    position: career.position,
    first,
    last,
    lanes,
    seasons,
    summary: {
      teams: career.teams,
      seasons: career.seasons,
      points: career.points,
      playoffPoints: career.playoffPoints,
      titles: career.titles,
      titleYears: career.titleYears,
    },
  };
}
