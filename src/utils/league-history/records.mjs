/**
 * Record Book boards, computed from a League History dataset
 * (`league-history.json`, built by dataset.mjs). Pure; the Record Book page
 * calls it per request, which costs tens of milliseconds for ~5,000 games.
 *
 * Covers every board MFLHistory.com shows (single game, single season, career,
 * postseason, milestones), per the inventory in the League History plan doc.
 *
 * Definitions that are easy to get wrong:
 *
 * - **Postseason game**: played in a playoff week (the bracket feed's first
 *   start week, AFL Cup excluded) by two teams that both made the playoffs that
 *   season. Consolation games in those weeks (toilet bowl, the AFL's NIT) are
 *   neither regular season nor postseason, so they count only in the
 *   single-game boards under "All games".
 * - **Season boards are regular season.** Wins, losses and ties come from the
 *   official standings row (season-ledger), never re-counted from games, which
 *   would miss MFL's own tiebreak-free W-L-T (record-book.mjs officialRecord).
 * - **Grouping**: `groupBy: 'owner'` (the product default) credits each
 *   season to its holding, so an owner who moved franchise slots keeps one
 *   career and a slot's previous owner keeps theirs. `'franchise'` groups by
 *   slot instead (a commissioner override, not yet wired to a setting).
 */

export const SCOPES = ['all', 'regular', 'playoffs'];

const RESULT_LABEL = { C: 'Champion', R: 'Runner-up', 3: 'Third place', P: 'Playoffs', M: 'Missed' };
export const resultLabel = (code) => RESULT_LABEL[code] ?? '';
const MADE_PLAYOFFS = new Set(['C', 'R', '3', 'P']);

const fmt2 = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt1 = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (n) => Number(n).toLocaleString('en-US');
const pct = (n) => n.toFixed(3).replace(/^0(?=\.)/, '');

/** Index a dataset once: teams by season, holdings, and every team-game. */
export function indexDataset(ds, { groupBy = 'owner' } = {}) {
  const seasonByYear = new Map(ds.seasons.map((s) => [s.y, s]));
  const team = (y, f) => seasonByYear.get(y)?.teams?.[f] ?? null;
  const entityOf = (y, f) => (groupBy === 'franchise' ? `fr:${f}` : (team(y, f)?.h ?? `slot:${f}`));

  // Entity labels: owner names for a holding, the latest name for a slot.
  const latest = new Map();
  for (const s of ds.seasons) {
    for (const [f, t] of Object.entries(s.teams)) {
      latest.set(entityOf(s.y, f), { name: t.n, icon: t.i, year: s.y, franchiseId: f });
    }
  }
  const ownerNames = (key) =>
    key
      .split('+')
      .map((id) => ds.owners?.[id]?.name)
      .filter(Boolean);
  const entityCache = new Map();
  const entity = (key) => {
    if (!entityCache.has(key)) entityCache.set(key, buildEntity(key));
    return entityCache.get(key);
  };
  const buildEntity = (key) => {
    const last = latest.get(key) ?? { name: key, icon: null, franchiseId: null };
    if (groupBy === 'franchise' || key.startsWith('slot:')) {
      return { key, name: last.name, team: last.name, icon: last.icon, franchiseId: last.franchiseId, ownerSlug: null };
    }
    const names = ownerNames(key);
    const firstOwner = key.split('+')[0];
    return {
      key,
      name: names.length ? names.join(' & ') : last.name,
      team: last.name,
      icon: last.icon,
      franchiseId: last.franchiseId,
      ownerSlug: ds.owners?.[firstOwner]?.slug ?? null,
    };
  };

  const games = ds.games.map(([y, wk, wf, ws, lf, ls, pw]) => {
    const both = MADE_PLAYOFFS.has(team(y, wf)?.r) && MADE_PLAYOFFS.has(team(y, lf)?.r);
    const kind = !pw ? 'regular' : both ? 'playoffs' : 'consolation';
    return { y, wk, wf, ws, lf, ls, kind, tie: ws === ls };
  });

  const teamGames = [];
  for (const g of games) {
    teamGames.push({ ...g, f: g.wf, s: g.ws, of: g.lf, os: g.ls, won: !g.tie, lost: false });
    teamGames.push({ ...g, f: g.lf, s: g.ls, of: g.wf, os: g.ws, won: false, lost: !g.tie });
  }
  teamGames.sort((a, b) => a.y - b.y || a.wk - b.wk);

  return { ds, groupBy, team, entityOf, entity, games, teamGames, seasonByYear };
}

const inScope = (kind, scope) =>
  scope === 'all' ? kind !== 'consolation' : kind === scope;

/**
 * rankRows for large inputs: ranks raw items by `value` and builds display rows
 * only for the ones that make the board. A single-game board ranks ~10,000
 * team-games to show ten; building all of them cost seconds per request.
 */
function rankBy(items, value, build, { asc = false, limit = 10 } = {}) {
  const scored = items.map((item) => ({ item, v: value(item) }));
  scored.sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
  const out = [];
  for (let i = 0; i < scored.length && out.length < limit; i++) {
    const prev = out[out.length - 1];
    const rank = prev && prev.value === scored[i].v ? prev.rank : i + 1;
    out.push({ ...build(scored[i].item, scored[i].v), value: scored[i].v, rank });
  }
  return out;
}

/** Ranked rows with shared ranks for equal values. */
function rankRows(rows, { asc = false, limit = 10 } = {}) {
  const sorted = rows
    .slice()
    .sort((a, b) => (asc ? a.value - b.value : b.value - a.value) || (a.tiebreak ?? 0) - (b.tiebreak ?? 0));
  const out = [];
  for (let i = 0; i < sorted.length && out.length < limit; i++) {
    const prev = out[out.length - 1];
    const rank = prev && prev.value === sorted[i].value ? prev.rank : i + 1;
    out.push({ ...sorted[i], rank });
  }
  return out;
}

function gameContext(ix, g, f) {
  const opp = f === g.wf ? g.lf : g.wf;
  const oppName = ix.team(g.y, opp)?.n ?? opp;
  const when = g.kind === 'playoffs' ? `Playoffs, Week ${g.wk}` : `Week ${g.wk}`;
  return `${g.y} · ${when} vs ${oppName}`;
}

/** A row about one team in one season (single game or single season). */
function seasonRow(ix, y, f, value, display, context) {
  const t = ix.team(y, f);
  const e = ix.entity(ix.entityOf(y, f));
  return {
    value,
    display,
    name: t?.n ?? f,
    icon: t?.i ?? null,
    owner: ix.groupBy === 'owner' && !e.key.startsWith('slot:') ? e.name : null,
    context,
    entity: e,
    year: y,
  };
}

/** A row about one entity across seasons (career, postseason, milestones). */
function entityRow(e, value, display, context) {
  return {
    value,
    display,
    name: e.name,
    icon: e.icon,
    owner: null,
    context: e.team && e.team !== e.name ? `${e.team} · ${context}` : context,
    entity: e,
  };
}

/**
 * TheLeague plays doubleheader weeks: one weekly score counts in two games. A
 * score board ranks performances, so each team-week appears once (per result,
 * for the win/loss boards).
 */
function onePerWeek(teamGames, withResult = false) {
  const seen = new Set();
  return teamGames.filter((g) => {
    const key = `${g.y}|${g.wk}|${g.f}${withResult ? `|${g.won}` : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Single game ──────────────────────────────────────────────────────────────

function singleGameBoards(ix, scope) {
  const scoped = scope === 'all' ? ix.teamGames : ix.teamGames.filter((g) => g.kind === scope);
  const tg = onePerWeek(scoped);
  const tgr = onePerWeek(scoped, true);
  const gs = ix.games.filter((g) => scope === 'all' ? true : g.kind === scope);
  const row = (g, f, v, d) => seasonRow(ix, g.y, f, v, d, gameContext(ix, g, f));
  const pairRow = (g, v, d) => {
    const w = ix.team(g.y, g.wf);
    const l = ix.team(g.y, g.lf);
    return {
      ...seasonRow(ix, g.y, g.wf, v, d, `${g.y} · ${g.kind === 'playoffs' ? 'Playoffs, ' : ''}Week ${g.wk}`),
      name: `${w?.n ?? g.wf} vs ${l?.n ?? g.lf}`,
      owner: null,
      context: `${fmt2(g.ws)} to ${fmt2(g.ls)} · ${g.y} · ${g.kind === 'playoffs' ? 'Playoffs, ' : ''}Week ${g.wk}`,
    };
  };
  const score = (g) => g.s;
  const margin = (g) => g.ws - g.ls;
  const combined = (g) => g.ws + g.ls;
  const scoreRow = (g) => row(g, g.f, g.s, fmt2(g.s));
  const marginRow = (g) => ({
    ...row(g, g.wf, margin(g), `+${fmt2(margin(g))}`),
    context: `${fmt2(g.ws)} to ${fmt2(g.ls)} · ${gameContext(ix, g, g.wf)}`,
  });
  const combinedRow = (g) => pairRow(g, combined(g), fmt2(combined(g)));
  const decided = gs.filter((g) => !g.tie);
  return [
    { id: 'most-points', label: 'Most points', title: 'Most points in a game',
      rows: rankBy(tg, score, scoreRow) },
    { id: 'fewest-points', label: 'Fewest points', title: 'Fewest points in a game',
      rows: rankBy(tg, score, scoreRow, { asc: true }) },
    { id: 'fewest-in-win', label: 'Fewest in a win', title: 'Fewest points in a win',
      rows: rankBy(tgr.filter((g) => g.won), score, scoreRow, { asc: true }) },
    { id: 'most-in-loss', label: 'Most in a loss', title: 'Most points in a loss',
      rows: rankBy(tgr.filter((g) => g.lost), score, scoreRow) },
    { id: 'biggest-win', label: 'Biggest win', title: 'Biggest margin of victory',
      rows: rankBy(decided, margin, marginRow) },
    { id: 'closest-win', label: 'Closest win', title: 'Closest finish',
      rows: rankBy(decided, margin, marginRow, { asc: true }) },
    { id: 'most-combined', label: 'Most combined', title: 'Most combined points',
      rows: rankBy(gs, combined, combinedRow) },
    { id: 'fewest-combined', label: 'Fewest combined', title: 'Fewest combined points',
      rows: rankBy(gs, combined, combinedRow, { asc: true }) },
  ];
}

// ── Single season (regular season) ──────────────────────────────────────────

function seasonStats(ix) {
  const stats = new Map();
  const get = (y, f) => {
    const k = `${y}|${f}`;
    if (!stats.has(k)) stats.set(k, { y, f, pf: 0, weeks: new Set(), highs: 0, games: [], divW: 0, divL: 0, divT: 0 });
    return stats.get(k);
  };
  const highs = new Map();
  for (const g of ix.teamGames) {
    if (g.kind !== 'regular') continue;
    const st = get(g.y, g.f);
    if (!st.weeks.has(g.wk)) {
      st.weeks.add(g.wk);
      st.pf += g.s;
    }
    st.games.push(g);
    const td = ix.team(g.y, g.f)?.d;
    if (td && td === ix.team(g.y, g.of)?.d) {
      if (g.tie) st.divT += 1;
      else if (g.won) st.divW += 1;
      else st.divL += 1;
    }
    const wk = `${g.y}|${g.wk}`;
    const best = highs.get(wk);
    if (!best || g.s > best.s) highs.set(wk, { s: g.s, f: new Set([g.f]) });
    else if (g.s === best.s) best.f.add(g.f);
  }
  for (const [wk, h] of highs) {
    const y = Number(wk.split('|')[0]);
    for (const f of h.f) get(y, f).highs += 1;
  }
  return stats;
}

/** Longest run of `test` games in an ordered list; returns {length, from, to}. */
function longestRun(list, test, { fromStart = false } = {}) {
  let run = 0;
  let start = null;
  let best = null;
  for (const g of list) {
    if (test(g)) {
      if (run === 0) start = g;
      run += 1;
      if (!best || run > best.length) best = { length: run, from: start, to: g };
    } else {
      if (fromStart) break;
      run = 0;
    }
  }
  return best;
}

function singleSeasonBoards(ix) {
  const stats = seasonStats(ix);
  const rows = [];
  for (const s of ix.ds.seasons) {
    for (const [f, t] of Object.entries(s.teams)) {
      rows.push({ y: s.y, f, t, done: !!s.done, st: stats.get(`${s.y}|${f}`) ?? null });
    }
  }
  const played = rows.filter((r) => r.t.w + r.t.l + r.t.t > 0);
  const rec = (t) => `${t.w}-${t.l}${t.t ? `-${t.t}` : ''}`;
  const sr = (r, v, d, ctx) => seasonRow(ix, r.y, r.f, v, d, `${r.y} · ${ctx}`);
  const wpct = (t) => (t.w + t.t * 0.5) / (t.w + t.l + t.t);
  // MFL's official points-for, else each scored week once.
  const pts = (r) => (r.t.pf > 0 ? r.t.pf : (r.st?.pf ?? 0));
  const streakBoard = (test, opts) =>
    rankRows(
      played
        .filter((r) => r.st)
        .map((r) => ({ r, run: longestRun(r.st.games, test, opts) }))
        .filter((x) => x.run && x.run.length > 1)
        .map(({ r, run }) => sr(r, run.length, fmt0(run.length), `Weeks ${run.from.wk} to ${run.to.wk}`))
    );
  return [
    { id: 'most-wins', label: 'Most wins', title: 'Most wins in a season',
      rows: rankRows(played.map((r) => ({ ...sr(r, r.t.w, fmt0(r.t.w), rec(r.t)), tiebreak: r.t.l }))) },
    { id: 'most-losses', label: 'Most losses', title: 'Most losses in a season',
      rows: rankRows(played.map((r) => ({ ...sr(r, r.t.l, fmt0(r.t.l), rec(r.t)), tiebreak: r.t.w }))) },
    { id: 'best-record', label: 'Best record', title: 'Best winning percentage',
      rows: rankRows(played.filter((r) => r.done).map((r) => sr(r, wpct(r.t), pct(wpct(r.t)), rec(r.t)))) },
    { id: 'most-points-season', label: 'Most points', title: 'Most points in a season',
      rows: rankRows(played.filter((r) => pts(r) > 0).map((r) => sr(r, pts(r), fmt2(pts(r)), rec(r.t)))) },
    { id: 'fewest-points-season', label: 'Fewest points', title: 'Fewest points in a full season',
      rows: rankRows(played.filter((r) => r.done && pts(r) > 0).map((r) => sr(r, pts(r), fmt2(pts(r)), rec(r.t))), { asc: true }) },
    { id: 'division-record', label: 'Division record', title: 'Best record in division games',
      rows: rankRows(played.filter((r) => r.st && r.done && r.st.divW + r.st.divL + r.st.divT >= 4).map((r) => {
        const n = r.st.divW + r.st.divL + r.st.divT;
        const v = (r.st.divW + r.st.divT * 0.5) / n;
        return sr(r, v, pct(v), `${r.st.divW}-${r.st.divL}${r.st.divT ? `-${r.st.divT}` : ''} in ${r.t.d ?? 'division'}`);
      })) },
    { id: 'high-point-weeks', label: 'Top-score weeks', title: 'Most weeks as the top scorer',
      rows: rankRows(played.filter((r) => r.st?.highs).map((r) => sr(r, r.st.highs, fmt0(r.st.highs), `of ${r.st.weeks.size} weeks`))) },
    { id: 'season-win-streak', label: 'Win streak', title: 'Longest winning streak in a season',
      rows: streakBoard((g) => g.won) },
    { id: 'season-loss-streak', label: 'Losing streak', title: 'Longest losing streak in a season',
      rows: streakBoard((g) => g.lost) },
    { id: 'hot-start', label: 'Hot start', title: 'Longest winning streak to open a season',
      rows: streakBoard((g) => g.won, { fromStart: true }) },
  ];
}

// ── Career ───────────────────────────────────────────────────────────────────

function careerTotals(ix, scope) {
  const totals = new Map();
  for (const g of ix.teamGames) {
    if (!inScope(g.kind, scope)) continue;
    const key = ix.entityOf(g.y, g.f);
    if (!totals.has(key)) totals.set(key, { key, w: 0, l: 0, t: 0, pf: 0, gp: 0, years: new Set(), games: [] });
    const c = totals.get(key);
    c.gp += 1;
    c.pf += g.s;
    c.years.add(g.y);
    c.games.push(g);
    if (g.tie) c.t += 1;
    else if (g.won) c.w += 1;
    else c.l += 1;
  }
  return [...totals.values()];
}

const span = (years) => {
  const ys = [...years].sort((a, b) => a - b);
  return ys.length ? (ys[0] === ys[ys.length - 1] ? `${ys[0]}` : `${ys[0]} to ${ys[ys.length - 1]}`) : '';
};

function careerBoards(ix, scope) {
  const totals = careerTotals(ix, scope);
  // Enough games for a rate to mean something: about two regular seasons, or
  // three playoff games. One season let a one-year owner top the career list.
  const minGames = scope === 'playoffs' ? 3 : 28;
  const rec = (c) => `${c.w}-${c.l}${c.t ? `-${c.t}` : ''}`;
  const er = (c, v, d, ctx) => entityRow(ix.entity(c.key), v, d, ctx);
  const wp = (c) => (c.w + c.t * 0.5) / c.gp;
  const streak = (test) =>
    rankRows(
      totals
        .map((c) => ({ c, run: longestRun(c.games, test) }))
        .filter((x) => x.run && x.run.length > 1)
        .map(({ c, run }) => er(c, run.length, fmt0(run.length),
          `${run.from.y} Week ${run.from.wk} to ${run.to.y} Week ${run.to.wk}`))
    );
  return [
    { id: 'career-wins', label: 'Wins', title: 'Most wins',
      rows: rankRows(totals.map((c) => er(c, c.w, fmt0(c.w), `${rec(c)} · ${span(c.years)}`))) },
    { id: 'career-losses', label: 'Losses', title: 'Most losses',
      rows: rankRows(totals.map((c) => er(c, c.l, fmt0(c.l), `${rec(c)} · ${span(c.years)}`))) },
    { id: 'career-pct', label: 'Win %', title: 'Best winning percentage',
      note: `Minimum ${minGames} games`,
      rows: rankRows(totals.filter((c) => c.gp >= minGames).map((c) => er(c, wp(c), pct(wp(c)), `${rec(c)} · ${span(c.years)}`))) },
    { id: 'career-points', label: 'Points', title: 'Most points scored',
      rows: rankRows(totals.map((c) => er(c, c.pf, fmt1(c.pf), `${fmt0(c.gp)} games · ${span(c.years)}`))) },
    { id: 'career-ppg', label: 'Points per game', title: 'Most points per game',
      note: `Minimum ${minGames} games`,
      rows: rankRows(totals.filter((c) => c.gp >= minGames).map((c) => er(c, c.pf / c.gp, fmt1(c.pf / c.gp), `${fmt0(c.gp)} games · ${span(c.years)}`))) },
    { id: 'career-win-streak', label: 'Win streak', title: 'Longest winning streak',
      rows: streak((g) => g.won) },
    { id: 'career-loss-streak', label: 'Losing streak', title: 'Longest losing streak',
      rows: streak((g) => g.lost) },
  ];
}

// ── Postseason ───────────────────────────────────────────────────────────────

function postseasonBoards(ix) {
  const bySeason = new Map();
  const doneSeasons = ix.ds.seasons.filter((s) => s.done);
  for (const s of doneSeasons) {
    for (const [f, t] of Object.entries(s.teams)) {
      const key = ix.entityOf(s.y, f);
      if (!bySeason.has(key)) bySeason.set(key, { key, seasons: 0, apps: [], titles: [], finals: [], divs: [] });
      const e = bySeason.get(key);
      e.seasons += 1;
      if (MADE_PLAYOFFS.has(t.r)) e.apps.push(s.y);
      if (t.r === 'C') e.titles.push(s.y);
      if (t.r === 'C' || t.r === 'R') e.finals.push(s.y);
      if (t.wd) e.divs.push(s.y);
    }
  }
  const all = [...bySeason.values()];
  const er = (e, v, d, ctx) => entityRow(ix.entity(e.key), v, d, ctx);
  const years = (ys) => ys.join(', ');
  const play = careerTotals(ix, 'playoffs');
  const rec = (c) => `${c.w}-${c.l}${c.t ? `-${c.t}` : ''}`;
  const wp = (c) => (c.w + c.t * 0.5) / c.gp;
  return [
    { id: 'titles', label: 'Championships', title: 'Most championships',
      rows: rankRows(all.filter((e) => e.titles.length).map((e) => er(e, e.titles.length, fmt0(e.titles.length), years(e.titles)))) },
    { id: 'title-games', label: 'Title games', title: 'Most championship game appearances',
      rows: rankRows(all.filter((e) => e.finals.length).map((e) =>
        er(e, e.finals.length, fmt0(e.finals.length), `${e.titles.length}-${e.finals.length - e.titles.length} · ${years(e.finals)}`))) },
    { id: 'appearances', label: 'Appearances', title: 'Most playoff appearances',
      rows: rankRows(all.filter((e) => e.apps.length).map((e) => er(e, e.apps.length, fmt0(e.apps.length), `of ${e.seasons} seasons`))) },
    { id: 'appearance-rate', label: 'Appearance rate', title: 'Most often in the playoffs',
      note: 'Minimum 3 seasons',
      rows: rankRows(all.filter((e) => e.seasons >= 3 && e.apps.length).map((e) =>
        er(e, e.apps.length / e.seasons, pct(e.apps.length / e.seasons), `${e.apps.length} of ${e.seasons} seasons`))) },
    { id: 'playoff-wins', label: 'Playoff wins', title: 'Most playoff wins',
      rows: rankRows(play.map((c) => er(c, c.w, fmt0(c.w), rec(c)))) },
    { id: 'playoff-pct', label: 'Playoff win %', title: 'Best playoff winning percentage',
      note: 'Minimum 3 playoff games',
      rows: rankRows(play.filter((c) => c.gp >= 3).map((c) => er(c, wp(c), pct(wp(c)), rec(c)))) },
    { id: 'playoff-ppg', label: 'Playoff points per game', title: 'Most points per playoff game',
      note: 'Minimum 3 playoff games',
      rows: rankRows(play.filter((c) => c.gp >= 3).map((c) => er(c, c.pf / c.gp, fmt1(c.pf / c.gp), `${c.gp} games`))) },
    { id: 'division-titles', label: 'Division titles', title: 'Most division titles',
      rows: rankRows(all.filter((e) => e.divs.length).map((e) => er(e, e.divs.length, fmt0(e.divs.length), years(e.divs)))) },
  ];
}

// ── Milestones ───────────────────────────────────────────────────────────────

const POINT_MILESTONES = [5000, 10000, 15000, 20000, 25000, 30000];
const WIN_MILESTONES = [50, 100, 150, 200, 250];

function milestoneBoards(ix) {
  const careers = careerTotals(ix, 'regular');
  const boards = [];
  const reach = (c, metric, target) => {
    let sum = 0;
    for (let i = 0; i < c.games.length; i++) {
      const g = c.games[i];
      sum += metric === 'points' ? g.s : g.won ? 1 : 0;
      if (sum >= target) return { games: i + 1, at: g };
    }
    return null;
  };
  for (const [metric, targets, unit] of [['points', POINT_MILESTONES, 'points'], ['wins', WIN_MILESTONES, 'wins']]) {
    for (const target of targets) {
      const rows = careers
        .map((c) => ({ c, hit: reach(c, metric, target) }))
        .filter((x) => x.hit)
        .map(({ c, hit }) => ({
          ...entityRow(ix.entity(c.key), hit.games, `${fmt0(hit.games)}`,
            `Reached it ${hit.at.y}, Week ${hit.at.wk} vs ${ix.team(hit.at.y, hit.at.of)?.n ?? hit.at.of}`),
          unit: 'games',
        }));
      if (!rows.length) continue;
      boards.push({
        id: `${metric}-${target}`,
        label: `${fmt0(target)} ${unit}`,
        title: `Fastest to ${fmt0(target)} ${unit}`,
        note: 'Regular-season games needed',
        rows: rankRows(rows, { asc: true }),
      });
    }
  }
  return boards;
}

// ── The book ─────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  { id: 'single-game', label: 'Single game', scoped: true },
  { id: 'season', label: 'Season', scoped: false },
  { id: 'career', label: 'Career', scoped: true },
  { id: 'postseason', label: 'Postseason', scoped: false },
  { id: 'milestones', label: 'Milestones', scoped: false },
];

/**
 * One category's boards. `scope` applies to Single game and Career only.
 * @returns {Array<{id:string,label:string,title:string,note?:string,rows:Array<object>}>}
 */
export function buildCategory(ix, category, scope = 'all') {
  const sc = SCOPES.includes(scope) ? scope : 'all';
  switch (category) {
    case 'single-game':
      return singleGameBoards(ix, sc);
    case 'season':
      return singleSeasonBoards(ix);
    case 'career':
      return careerBoards(ix, sc);
    case 'postseason':
      return postseasonBoards(ix);
    case 'milestones':
      return milestoneBoards(ix);
    default:
      return [];
  }
}

/** League-wide facts for the page header. */
export function bookFacts(ix) {
  const champions = new Set();
  for (const s of ix.ds.seasons) {
    for (const [f, t] of Object.entries(s.teams)) if (t.r === 'C') champions.add(ix.entityOf(s.y, f));
  }
  return {
    seasons: ix.ds.seasons.filter((s) => Object.keys(s.teams).length).length,
    games: ix.games.filter((g) => g.kind !== 'consolation').length,
    champions: champions.size,
    firstSeason: ix.ds.firstSeason,
    lastSeason: ix.ds.lastSeason,
  };
}

/**
 * Cached boards for a page request. The dataset is a static import, so the
 * same object arrives on every request to a route and the boards are built
 * once per server instance, not per view (the Season boards cost ~50 ms).
 */
const bookCache = new WeakMap();
export function recordBook(ds, { groupBy = 'owner' } = {}) {
  if (!bookCache.has(ds)) bookCache.set(ds, new Map());
  const byGroup = bookCache.get(ds);
  if (!byGroup.has(groupBy)) {
    const ix = indexDataset(ds, { groupBy });
    const boards = new Map();
    let facts = null;
    byGroup.set(groupBy, {
      facts: () => (facts ??= bookFacts(ix)),
      category: (category, scope = 'all') => {
        const key = `${category}|${scope}`;
        if (!boards.has(key)) boards.set(key, buildCategory(ix, category, scope));
        return boards.get(key);
      },
    });
  }
  return byGroup.get(groupBy);
}
