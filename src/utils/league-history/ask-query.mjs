/**
 * Ask the History — the query engine.
 *
 * An owner types a stats question ("has a team ever started 9-1 with fewer
 * points?"); Claude translates it into a QUERY over this engine and our code
 * computes the answer from `league-history.json`. The model never does the
 * math and never sees a row this engine did not produce, which is the whole
 * point: Roger-style guessing is what this feature exists to replace.
 *
 * Pure, and reads only `indexDataset` (records.mjs), so a game counts exactly
 * the way it counts in the Record Book and on the rivalry pages: consolation
 * games (toilet bowl, the AFL's NIT) are neither regular season nor
 * postseason, and seasons are credited to the OWNER who held the team.
 *
 * Three units, each a flat table the query filters, sorts and limits:
 *
 * - `seasons`: one row per team-season. `w/l/t/pf/pa/games` are counted from
 *   the regular-season games, optionally cut to the first N (`throughGames`)
 *   so "started 9-1" is `throughGames: 10, w: 9, l: 1`. The `final*` fields
 *   and `finish` are the official full-season row and never cut.
 * - `games`: one row per team per game (each game appears twice, once from
 *   each side), with the score, opponent and margin.
 * - `owners`: one row per owner (holding) across their whole career, or the
 *   seasons inside `years`.
 */

import { indexDataset } from './records.mjs';
import { PLAYER_DEFAULT_COLUMNS, PLAYER_FIELDS, PLAYER_UNITS, preparePlayers } from './ask-players.mjs';
import { MOVE_DEFAULT_COLUMNS, MOVE_FIELDS, MOVE_UNITS, prepareMoves } from './ask-moves.mjs';

export const TEAM_UNITS = ['seasons', 'games', 'owners'];
export const UNITS = [...TEAM_UNITS, ...PLAYER_UNITS, ...MOVE_UNITS];

const FINISH = { C: 'Champion', R: 'Runner-up', 3: 'Third place', P: 'Playoffs', M: 'Missed playoffs' };
const MADE = new Set(['C', 'R', '3', 'P']);

/**
 * Every field the query can read, by unit: `type` drives validation and the
 * operators allowed, `label` is the column header the answer table shows.
 * The tool schema the model sees is generated from this, so a field exists
 * for the model exactly when it exists here.
 */
export const FIELDS = {
  seasons: {
    year: { type: 'number', label: 'Season' },
    team: { type: 'string', label: 'Team', desc: "the team's name that season" },
    owner: { type: 'string', label: 'Owner' },
    division: { type: 'string', label: 'Division' },
    games: { type: 'number', label: 'GP', desc: 'regular-season games counted (all of them, or the first throughGames)' },
    w: { type: 'number', label: 'W', desc: 'wins in the counted games' },
    l: { type: 'number', label: 'L', desc: 'losses in the counted games' },
    t: { type: 'number', label: 'T', desc: 'ties in the counted games' },
    winPct: { type: 'number', label: 'Win %', desc: '(w + t/2) / games' },
    pf: { type: 'number', label: 'PF', desc: 'points scored in the counted games' },
    pa: { type: 'number', label: 'PA', desc: 'points allowed in the counted games' },
    pointDiff: { type: 'number', label: 'Diff', desc: 'pf - pa' },
    avgPf: { type: 'number', label: 'PF/G', desc: 'pf per counted game' },
    highGame: { type: 'number', label: 'High', desc: 'best single score in the counted games' },
    lowGame: { type: 'number', label: 'Low', desc: 'worst single score in the counted games' },
    finalW: { type: 'number', label: 'Final W', desc: 'official full regular-season wins' },
    finalL: { type: 'number', label: 'Final L', desc: 'official full regular-season losses' },
    finalT: { type: 'number', label: 'Final T' },
    finalPf: { type: 'number', label: 'Season PF', desc: "official full regular-season points-for (MFL's own number)" },
    rank: { type: 'number', label: 'Seed', desc: 'final regular-season standings rank, 1 = best' },
    finish: { type: 'string', label: 'Finish', desc: 'Champion | Runner-up | Third place | Playoffs | Missed playoffs ("" while the season is in progress)' },
    madePlayoffs: { type: 'boolean', label: 'Playoffs' },
    champion: { type: 'boolean', label: 'Champion' },
    wonDivision: { type: 'boolean', label: 'Won division' },
    playoffW: { type: 'number', label: 'PO W', desc: 'postseason wins (consolation games excluded)' },
    playoffL: { type: 'number', label: 'PO L' },
    complete: { type: 'boolean', label: 'Complete', desc: 'false only for the season still being played' },
  },
  games: {
    year: { type: 'number', label: 'Season' },
    week: { type: 'number', label: 'Week' },
    kind: { type: 'string', label: 'Type', desc: 'regular | playoffs | consolation. Consolation games are left out unless you filter on kind' },
    team: { type: 'string', label: 'Team' },
    owner: { type: 'string', label: 'Owner' },
    opponent: { type: 'string', label: 'Opponent' },
    opponentOwner: { type: 'string', label: 'Opp. owner' },
    score: { type: 'number', label: 'Score' },
    oppScore: { type: 'number', label: 'Opp.' },
    margin: { type: 'number', label: 'Margin', desc: 'score - oppScore (negative = a loss)' },
    combined: { type: 'number', label: 'Combined', desc: 'score + oppScore' },
    result: { type: 'string', label: 'Result', desc: 'W | L | T' },
    gameNumber: { type: 'number', label: 'Game #', desc: "this team's nth regular-season game that year (null for postseason)" },
  },
  owners: {
    owner: { type: 'string', label: 'Owner' },
    team: { type: 'string', label: 'Latest team' },
    seasons: { type: 'number', label: 'Seasons' },
    w: { type: 'number', label: 'W', desc: 'official regular-season wins' },
    l: { type: 'number', label: 'L' },
    t: { type: 'number', label: 'T' },
    winPct: { type: 'number', label: 'Win %' },
    pf: { type: 'number', label: 'PF', desc: 'official regular-season points-for' },
    titles: { type: 'number', label: 'Titles' },
    finals: { type: 'number', label: 'Title games' },
    playoffApps: { type: 'number', label: 'Playoff trips' },
    playoffW: { type: 'number', label: 'PO W' },
    playoffL: { type: 'number', label: 'PO L' },
    divisionTitles: { type: 'number', label: 'Div. titles' },
    firstYear: { type: 'number', label: 'First' },
    lastYear: { type: 'number', label: 'Last' },
    active: { type: 'boolean', label: 'Active', desc: 'owns a team in the latest season' },
  },
  ...PLAYER_FIELDS,
  ...MOVE_FIELDS,
};

const OPS = {
  eq: (a, b) => norm(a) === norm(b),
  ne: (a, b) => norm(a) !== norm(b),
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  in: (a, b) => Array.isArray(b) && b.some((v) => norm(v) === norm(a)),
  contains: (a, b) => String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
};
const OP_WORDS = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'in', contains: 'contains' };
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

export const MAX_LIMIT = 25;

const r2 = (n) => Math.round(n * 100) / 100;

/** The model-facing JSON schema for one query, generated from FIELDS. */
export function querySchema() {
  const allFields = [...new Set(Object.values(FIELDS).flatMap((f) => Object.keys(f)))];
  const fieldDoc = UNITS.map(
    (u) =>
      `${u}: ` +
      Object.entries(FIELDS[u])
        .map(([k, f]) => `${k} (${f.type}${f.desc ? `, ${f.desc}` : ''})`)
        .join('; '),
  ).join('\n');
  return {
    type: 'object',
    description: `Fields by unit:\n${fieldDoc}`,
    properties: {
      unit: { type: 'string', enum: UNITS },
      throughGames: {
        type: 'integer',
        minimum: 1,
        description: 'seasons only: count just the first N regular-season games (e.g. 10 for "started 9-1"). Omit for the whole regular season.',
      },
      years: {
        type: 'object',
        properties: { from: { type: 'integer' }, to: { type: 'integer' } },
        description: 'Limit to seasons in this range (inclusive). For owners, their totals cover only these seasons.',
      },
      where: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: allFields },
            op: { type: 'string', enum: Object.keys(OPS) },
            value: {},
          },
          required: ['field', 'op', 'value'],
        },
        description: 'All conditions must hold. Name matches are case-insensitive; use contains for partial names.',
      },
      sort: {
        type: 'array',
        items: {
          type: 'object',
          properties: { field: { type: 'string', enum: allFields }, dir: { type: 'string', enum: ['asc', 'desc'] } },
          required: ['field', 'dir'],
        },
      },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Rows to return (default 10, max ${MAX_LIMIT}). total always counts every match.` },
      columns: {
        type: 'array',
        items: { type: 'string', enum: allFields },
        description: 'Columns to show, in order. Defaults to a sensible set for the unit.',
      },
      summarize: {
        type: 'array',
        items: { type: 'string', enum: allFields },
        description: 'Numeric fields to summarize (min, max, avg, sum) over every matching row.',
      },
      chart: {
        type: 'string',
        enum: allFields,
        description:
          'A numeric field to chart for the answer: the top ten on one scale, and every matching row season by season with how the record grew. Set it on the query you will show when the answer is a ranking or a record.',
      },
    },
    required: ['unit'],
  };
}

const DEFAULT_COLUMNS = {
  seasons: ['year', 'team', 'owner', 'w', 'l', 'pf', 'finish'],
  games: ['year', 'week', 'team', 'score', 'opponent', 'oppScore', 'result'],
  owners: ['owner', 'seasons', 'w', 'l', 'titles', 'playoffApps'],
  ...PLAYER_DEFAULT_COLUMNS,
  ...MOVE_DEFAULT_COLUMNS,
};

/**
 * Index once per dataset: the rows of every unit that do not depend on a
 * query's window. `seasons` rows depend on throughGames, so they are built per
 * call from the cached per-team game lists.
 */
const cache = new WeakMap();
function prepare(ds) {
  if (cache.has(ds)) return cache.get(ds);
  const ix = indexDataset(ds, { groupBy: 'owner' });
  const latestYear = ds.seasons.at(-1)?.y ?? null;
  const latestHoldings = new Set(Object.values(ds.seasons.at(-1)?.teams ?? {}).map((t) => t.h));

  const ownerOf = (y, f) => ix.entity(ix.entityOf(y, f));
  const teamName = (y, f) => ix.team(y, f)?.n ?? f;

  // Team-games, numbered within each team-season's regular season.
  const byTeamSeason = new Map();
  const gameRows = [];
  for (const g of ix.teamGames) {
    const key = `${g.y}|${g.f}`;
    if (!byTeamSeason.has(key)) byTeamSeason.set(key, []);
    const list = byTeamSeason.get(key);
    const gameNumber = g.kind === 'regular' ? list.filter((x) => x.kind === 'regular').length + 1 : null;
    list.push(g);
    const owner = ownerOf(g.y, g.f);
    const opp = ownerOf(g.y, g.of);
    gameRows.push({
      year: g.y,
      week: g.wk,
      kind: g.kind,
      team: teamName(g.y, g.f),
      owner: owner.name,
      opponent: teamName(g.y, g.of),
      opponentOwner: opp.name,
      score: g.s,
      oppScore: g.os,
      margin: r2(g.s - g.os),
      combined: r2(g.s + g.os),
      result: g.tie ? 'T' : g.won ? 'W' : 'L',
      gameNumber,
      _franchiseId: g.f,
      _ownerSlug: owner.ownerSlug,
    });
  }

  const teamSeasons = [];
  for (const s of ds.seasons) {
    for (const [f, t] of Object.entries(s.teams)) {
      const owner = ownerOf(s.y, f);
      teamSeasons.push({
        y: s.y,
        f,
        t,
        owner,
        done: !!s.done,
        games: byTeamSeason.get(`${s.y}|${f}`) ?? [],
      });
    }
  }

  const prepared = { ix, latestYear, latestHoldings, gameRows, teamSeasons };
  cache.set(ds, prepared);
  return prepared;
}

function seasonRows(p, throughGames) {
  return p.teamSeasons.map(({ y, f, t, owner, done, games }) => {
    const regular = games.filter((g) => g.kind === 'regular');
    const counted = throughGames ? regular.slice(0, throughGames) : regular;
    let w = 0, l = 0, ties = 0, pf = 0, pa = 0;
    let high = null, low = null;
    for (const g of counted) {
      if (g.tie) ties++;
      else if (g.won) w++;
      else l++;
      pf += g.s;
      pa += g.os;
      high = high === null ? g.s : Math.max(high, g.s);
      low = low === null ? g.s : Math.min(low, g.s);
    }
    const post = games.filter((g) => g.kind === 'playoffs');
    const n = counted.length;
    // An in-progress season has no finish yet: the ledger's 'M' is a
    // placeholder, not "missed the playoffs".
    const code = done ? t.r : null;
    return {
      year: y,
      team: t.n,
      owner: owner.name,
      division: t.d ?? '',
      games: n,
      w,
      l,
      t: ties,
      winPct: n ? r2((w + ties / 2) / n) : 0,
      pf: r2(pf),
      pa: r2(pa),
      pointDiff: r2(pf - pa),
      avgPf: n ? r2(pf / n) : 0,
      highGame: high,
      lowGame: low,
      finalW: t.w,
      finalL: t.l,
      finalT: t.t,
      finalPf: t.pf,
      rank: t.rk,
      finish: code ? FINISH[code] ?? '' : '',
      madePlayoffs: code ? MADE.has(code) : false,
      champion: code === 'C',
      wonDivision: !!t.wd,
      playoffW: post.filter((g) => g.won).length,
      playoffL: post.filter((g) => g.lost).length,
      complete: done,
      _franchiseId: f,
      _ownerSlug: owner.ownerSlug,
    };
  });
}

function ownerRows(p, years) {
  const by = new Map();
  for (const ts of p.teamSeasons) {
    if (!inYears(ts.y, years)) continue;
    const key = ts.owner.key;
    if (!by.has(key)) {
      by.set(key, {
        owner: ts.owner.name,
        team: ts.t.n,
        seasons: 0, w: 0, l: 0, t: 0, pf: 0,
        titles: 0, finals: 0, playoffApps: 0, playoffW: 0, playoffL: 0, divisionTitles: 0,
        firstYear: ts.y, lastYear: ts.y,
        active: p.latestHoldings.has(key),
        _franchiseId: ts.f,
        _ownerSlug: ts.owner.ownerSlug,
      });
    }
    const o = by.get(key);
    const code = ts.done ? ts.t.r : null;
    o.seasons++;
    o.w += ts.t.w;
    o.l += ts.t.l;
    o.t += ts.t.t;
    o.pf = r2(o.pf + ts.t.pf);
    if (code === 'C') o.titles++;
    if (code === 'C' || code === 'R') o.finals++;
    if (code && MADE.has(code)) o.playoffApps++;
    if (ts.t.wd && ts.done) o.divisionTitles++;
    for (const g of ts.games) {
      if (g.kind !== 'playoffs') continue;
      if (g.won) o.playoffW++;
      else if (g.lost) o.playoffL++;
    }
    if (ts.y >= o.lastYear) {
      o.lastYear = ts.y;
      o.team = ts.t.n;
      o._franchiseId = ts.f;
    }
    o.firstYear = Math.min(o.firstYear, ts.y);
  }
  return [...by.values()].map((o) => {
    const n = o.w + o.l + o.t;
    return { ...o, winPct: n ? r2((o.w + o.t / 2) / n) : 0 };
  });
}

const inYears = (y, years) => !years || ((years.from == null || y >= years.from) && (years.to == null || y <= years.to));

/** Throws a QueryError the model can read and correct. */
export class QueryError extends Error {}

/** Validate and normalize a model-written query. */
export function normalizeQuery(q) {
  if (!q || typeof q !== 'object') throw new QueryError('query must be an object');
  const unit = q.unit;
  if (!UNITS.includes(unit)) throw new QueryError(`unit must be one of ${UNITS.join(', ')}`);
  const fields = FIELDS[unit];
  const check = (field, where) => {
    if (!fields[field]) throw new QueryError(`${where}: "${field}" is not a field of ${unit}. Fields: ${Object.keys(fields).join(', ')}`);
  };
  const where = (Array.isArray(q.where) ? q.where : []).map((c) => {
    check(c?.field, 'where');
    if (!OPS[c.op]) throw new QueryError(`where: op must be one of ${Object.keys(OPS).join(', ')}`);
    const type = fields[c.field].type;
    let value = c.value;
    if (type === 'number' && c.op !== 'in') {
      value = Number(value);
      if (!Number.isFinite(value)) throw new QueryError(`where: ${c.field} needs a number`);
    }
    if (type === 'boolean') value = value === true || value === 'true';
    return { field: c.field, op: c.op, value };
  });
  const sort = (Array.isArray(q.sort) ? q.sort : []).map((s) => {
    check(s?.field, 'sort');
    return { field: s.field, dir: s.dir === 'asc' ? 'asc' : 'desc' };
  });
  const columns = (Array.isArray(q.columns) && q.columns.length ? q.columns : DEFAULT_COLUMNS[unit]).filter((c) => fields[c]);
  for (const c of q.columns ?? []) check(c, 'columns');
  const summarize = (Array.isArray(q.summarize) ? q.summarize : []).filter((f) => {
    check(f, 'summarize');
    return fields[f].type === 'number';
  });
  const throughGames = unit === 'seasons' && Number.isInteger(q.throughGames) && q.throughGames > 0 ? q.throughGames : null;
  const years = q.years && typeof q.years === 'object'
    ? { from: Number.isFinite(q.years.from) ? q.years.from : null, to: Number.isFinite(q.years.to) ? q.years.to : null }
    : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isInteger(q.limit) ? q.limit : 10));
  let chart = null;
  if (q.chart != null && q.chart !== '') {
    check(q.chart, 'chart');
    if (fields[q.chart].type !== 'number') throw new QueryError(`chart: ${q.chart} is not a number`);
    chart = q.chart;
  }
  return { unit, throughGames, years, where, sort, limit, columns, summarize, chart };
}

/**
 * Run one query. Returns the table the answer shows: column headers, the
 * first `limit` rows, how many rows matched in all, and a plain-words
 * description of exactly what was counted (the receipt under every answer).
 */
/**
 * @typedef {{ cells: Array<string | number | boolean | null>, franchiseId: string | null, ownerSlug: string | null, year: number | null }} AnswerRow
 * @typedef {{ min: number, max: number, avg: number, sum: number }} FieldSummary
 * @typedef {{ field: string, label: string, asc: boolean, rows: Array<any>, population: Array<Array<number|string|null>> }} ChartBoard
 * @typedef {{ query: any, description: string, total: number, columns: Array<{ key: string, label: string }>, rows: AnswerRow[], summary: Record<string, FieldSummary | null>, chart: ChartBoard | null }} QueryResult
 * @param {any} ds league-history.json
 * @param {any} rawQuery
 * @param {{ players?: any, moves?: any }} [extra] league-history-players.json (player units) and league-history-moves.json (trades, pickups, drafts, auctions)
 * @returns {QueryResult}
 */
export function runQuery(ds, rawQuery, extra = {}) {
  const q = normalizeQuery(rawQuery);
  const p = prepare(ds);
  const isPlayer = PLAYER_UNITS.includes(q.unit);
  const isMove = MOVE_UNITS.includes(q.unit);
  if (isPlayer && !extra.players) throw new QueryError('Player stats are not available for this league.');
  if (isMove && !extra.moves) throw new QueryError('Trades, drafts and pickups are not available for this league.');
  const pp = (isPlayer || isMove) && extra.players ? preparePlayers(p, extra.players) : null;
  const pm = isMove ? prepareMoves(p, pp, extra.moves) : null;
  let rows =
    q.unit === 'seasons'
      ? seasonRows(p, q.throughGames)
      : q.unit === 'owners'
        ? ownerRows(p, q.years)
        : q.unit === 'games'
          ? p.gameRows
          : isMove
            ? pm[q.unit]
            : pp[q.unit];
  if (q.unit !== 'owners' && q.unit !== 'playerCareers') rows = rows.filter((r) => inYears(r.year, q.years));
  const filtersOn = (f) => q.where.some((c) => c.field === f);
  // Consolation games count nowhere unless asked for by name (records.mjs).
  if (q.unit === 'games' && !filtersOn('kind')) rows = rows.filter((r) => r.kind !== 'consolation');
  // A player-week counts like the team's week: no consolation, no dead weeks,
  // and only what he scored in the lineup, unless the question says otherwise.
  if (q.unit === 'playerWeeks' && !filtersOn('kind')) rows = rows.filter((r) => r.kind === 'regular' || r.kind === 'playoffs');
  if (q.unit === 'playerWeeks' && !filtersOn('started')) rows = rows.filter((r) => r.started);
  // A cut window ("first 10 games") only makes sense for a team that played
  // that many; a team 6 games into this season has not "started 9-1" or not.
  if (q.unit === 'seasons' && q.throughGames) rows = rows.filter((r) => r.games >= q.throughGames);
  for (const c of q.where) rows = rows.filter((r) => OPS[c.op](r[c.field], c.value));
  if (q.sort.length) {
    rows = rows.slice().sort((a, b) => {
      for (const s of q.sort) {
        const d = cmp(a[s.field], b[s.field]);
        if (d) return s.dir === 'asc' ? d : -d;
      }
      return 0;
    });
  }
  /** @type {Record<string, FieldSummary | null>} */
  const summary = {};
  for (const f of q.summarize) {
    const vals = rows.map((r) => r[f]).filter((v) => Number.isFinite(v));
    summary[f] = vals.length
      ? { min: Math.min(...vals), max: Math.max(...vals), avg: r2(vals.reduce((a, b) => a + b, 0) / vals.length), sum: r2(vals.reduce((a, b) => a + b, 0)) }
      : null;
  }
  const shown = rows.slice(0, q.limit);
  return {
    query: q,
    description: describeQuery(q),
    total: rows.length,
    columns: q.columns.map((c) => ({ key: c, label: FIELDS[q.unit][c].label })),
    rows: shown.map((r) => ({
      cells: q.columns.map((c) => r[c] ?? null),
      franchiseId: r._franchiseId ?? null,
      ownerSlug: r._ownerSlug ?? null,
      year: r.year ?? null,
    })),
    summary,
    chart: q.chart ? chartBoard(q, rows) : null,
  };
}

const CHART_TOP = 10;
const CHART_POPULATION = 1500;

/**
 * The matching rows as a Record Book board (records.mjs), so record-charts.mjs
 * draws an answer exactly the way it draws a record: `rows` is the top ten by
 * the charted field (ranked, ties sharing a rank), `population` every matching
 * row as `[value, year, week, name, null]`. A big population (every player
 * week) is thinned to CHART_POPULATION, always keeping the top ten and every
 * row that set a new best on its way to the record, so the progression line
 * stays exact.
 * @returns {{ field: string, label: string, asc: boolean, rows: Array<any>, population: Array<Array<number|string|null>> } | null}
 */
function chartBoard(q, rows) {
  const field = q.chart;
  const asc = q.sort[0]?.field === field ? q.sort[0].dir === 'asc' : false;
  const valued = rows.filter((r) => Number.isFinite(r[field]));
  if (valued.length < 2) return null;
  const ranked = valued.slice().sort((a, b) => (asc ? a[field] - b[field] : b[field] - a[field]));
  const integers = valued.every((r) => Number.isInteger(r[field]));
  const display = (v) =>
    field === 'winPct'
      ? v.toFixed(3).replace(/^0(?=\.)/, '')
      : v.toLocaleString('en-US', { minimumFractionDigits: integers ? 0 : 2, maximumFractionDigits: integers ? 0 : 2 });
  const nameOf = (r) => r.player ?? r.team ?? r.owner ?? '';
  const ownerOf = (r) => (r.player ? r.team ?? r.lastTeam ?? null : r.team && r.owner ? r.owner : null);
  const contextOf = (r) => [r.year, r.week != null ? `Week ${r.week}` : null].filter((x) => x != null).join(' ');

  const top = [];
  ranked.slice(0, CHART_TOP).forEach((r, i) => {
    const prev = top[i - 1];
    top.push({
      value: r[field],
      display: display(r[field]),
      name: nameOf(r),
      owner: ownerOf(r),
      context: contextOf(r),
      year: r.year ?? null,
      rank: prev && prev.value === r[field] ? prev.rank : i + 1,
      franchiseId: r._franchiseId ?? null,
      entity: { key: null },
    });
  });

  let keep = valued;
  if (valued.length > CHART_POPULATION) {
    const must = new Set(ranked.slice(0, CHART_TOP));
    const better = (a, b) => (asc ? a < b : a > b);
    let best = null;
    const chrono = valued.slice().sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0));
    for (const r of chrono) {
      if (best === null || better(r[field], best)) {
        best = r[field];
        must.add(r);
      }
    }
    const stride = valued.length / Math.max(1, CHART_POPULATION - must.size);
    keep = [...must];
    for (let i = 0; i < valued.length; i += stride) {
      const r = valued[Math.floor(i)];
      if (!must.has(r)) keep.push(r);
    }
  }
  return {
    field,
    label: FIELDS[q.unit][field].label,
    asc,
    rows: top,
    population: keep.map((r) => [r[field], r.year ?? null, r.week ?? null, nameOf(r), null]),
  };
}

const cmp = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
};

const UNIT_WORDS = {
  seasons: 'team-seasons',
  games: 'team-games',
  owners: 'owners',
  playerWeeks: 'player-weeks',
  playerSeasons: 'player-seasons (regular season, by team)',
  playerCareers: 'player careers (regular season and playoffs, as a starter)',
  trades: 'trades (one row per side)',
  pickups: 'waiver and free-agent pickups',
  draftPicks: 'draft picks',
  auctions: 'auction wins',
};

/** "Team-seasons, first 10 regular-season games, where W = 9 and L = 1, sorted by PF (lowest first)". */
export function describeQuery(q) {
  const parts = [UNIT_WORDS[q.unit][0].toUpperCase() + UNIT_WORDS[q.unit].slice(1)];
  if (q.throughGames) parts.push(`first ${q.throughGames} regular-season games`);
  else if (q.unit === 'seasons') parts.push('regular season');
  if (q.years) {
    const { from, to } = q.years;
    parts.push(from && to ? (from === to ? `${from}` : `${from} to ${to}`) : from ? `${from} on` : to ? `through ${to}` : '');
  }
  const fields = FIELDS[q.unit];
  if (q.where.length) {
    parts.push(
      'where ' +
        q.where
          .map((c) => `${fields[c.field].label} ${OP_WORDS[c.op]} ${Array.isArray(c.value) ? c.value.join(' or ') : c.value}`)
          .join(' and '),
    );
  }
  const filtersOn = (f) => q.where.some((c) => c.field === f);
  if ((q.unit === 'games' || q.unit === 'playerWeeks') && !filtersOn('kind')) parts.push('regular season and playoffs (consolation games excluded)');
  if (q.unit === 'playerWeeks' && !filtersOn('started')) parts.push('starters only');
  if (q.sort.length) {
    parts.push(
      'sorted by ' + q.sort.map((s) => `${fields[s.field].label} (${s.dir === 'asc' ? 'lowest' : 'highest'} first)`).join(', then '),
    );
  }
  return parts.filter(Boolean).join(', ');
}

/**
 * How far the record goes: the last week with a final score in the latest
 * season, and whether that season is still being played. Every answer carries
 * it, because "has anyone started 9-1?" asked mid-season depends on whether
 * this week's games are in yet (Brandon, 2026-10-26). Games enter the record
 * once MFL has them final; a week still being played is not counted.
 * @returns {{ year: number | null, week: number | null, inProgress: boolean }}
 */
export function dataAsOf(ds) {
  const latest = ds.seasons.at(-1);
  if (!latest) return { year: null, week: null, inProgress: false };
  let week = null;
  for (const g of ds.games) if (g[0] === latest.y && (week === null || g[1] > week)) week = g[1];
  return { year: latest.y, week, inProgress: !latest.done };
}

/** "Counted through 2026 Week 6 (the season is still being played)". */
export function describeAsOf(asOf) {
  if (!asOf?.year || !asOf.inProgress) return '';
  return asOf.week
    ? `Counted through ${asOf.year} Week ${asOf.week}; games still being played are not in yet`
    : `The ${asOf.year} season has no final games yet`;
}
