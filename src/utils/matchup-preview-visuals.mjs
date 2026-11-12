/**
 * The Matchup Preview's visuals: a Game of the Week rivalry panel and a
 * tale-of-the-tape card for every game on the week's slate.
 *
 * Plain .mjs because the article runner (node, scripts/article-types/
 * matchup-preview.mjs) computes this snapshot when it writes the column, and
 * the article page only RENDERS what the post carries. The snapshot lives on
 * the post, not in a derived file, because a preview is a picture of one
 * week: re-deriving it on every page view would show week 9's form under a
 * week 7 headline.
 *
 * Every number comes from data the repo already has:
 *   - this season's form, streaks, weekly scores and all-play come from
 *     `weekly-results-raw.json` (only weeks BEFORE the previewed one);
 *   - the head-to-head series is the site's one definition
 *     (`headToHeadMeetings`, league-history/rivalry.mjs) over the League
 *     History dataset: the games the two current owners played each other,
 *     consolation games left out — the record each rivalry page shows.
 */
import { rivalryIntensity, MIN_RIVALRY_MEETINGS } from './rivalry-intensity.mjs';
import { headToHeadMeetings } from './league-history/rivalry.mjs';
import { allPlayWeek, weekEntries, weekGames } from './game-results.mjs';

/** Results a form strip shows, newest last. */
export const FORM_GAMES = 10;

/**
 * Every completed game before `week`, per franchise, oldest first.
 *
 * A doubleheader week puts a franchise in two matchups with ONE score; both
 * games count toward form and record, but the week contributes one point to
 * the weekly-score line and one all-play slate.
 *
 * @param {any[]} weeklyResultsRaw  the runner's `weekly-results-raw` array
 * @param {number} week             the week being previewed
 */
export function seasonGames(weeklyResultsRaw, week) {
  /** @type {Map<string, {games: {week:number,result:string,score:number,opp:number,oppId:string}[], weekly: {week:number,score:number}[], allPlay: {wins:number,losses:number,ties:number}}>} */
  const byFranchise = new Map();
  const get = (id) => {
    if (!byFranchise.has(id)) byFranchise.set(id, { games: [], weekly: [], allPlay: { wins: 0, losses: 0, ties: 0 } });
    return byFranchise.get(id);
  };
  // Which matchups are games, and their results, is game-results.mjs's call.
  const weeks = (Array.isArray(weeklyResultsRaw) ? weekEntries(weeklyResultsRaw) : []).filter((w) => Number(w.week) < week);

  for (const w of weeks) {
    const wk = Number(w.week);
    const weekScores = new Map();
    for (const g of weekGames(w)) {
      for (const [me, them, score, opp, result] of [
        [g.a, g.b, g.sa, g.sb, g.ra],
        [g.b, g.a, g.sb, g.sa, g.rb],
      ]) {
        get(me).games.push({ week: wk, result, score, opp, oppId: them });
        weekScores.set(me, score);
      }
    }
    for (const [id, rec] of allPlayWeek(weekScores)) {
      const f = get(id);
      f.weekly.push({ week: wk, score: weekScores.get(id) });
      f.allPlay.wins += rec.wins;
      f.allPlay.losses += rec.losses;
      f.allPlay.ties += rec.ties;
    }
  }
  return byFranchise;
}

/** "W4" / "L2" from a chronological result list, or null before any game. */
export function currentStreak(results) {
  if (!results.length) return null;
  const last = results[results.length - 1];
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
  return `${last}${n}`;
}

const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

/** One team's tale of the tape from its season games. */
export function sideSnapshot(franchiseId, season) {
  const s = season.get(franchiseId) ?? { games: [], weekly: [], allPlay: { wins: 0, losses: 0, ties: 0 } };
  const results = s.games.map((g) => g.result);
  const wins = results.filter((r) => r === 'W').length;
  const losses = results.filter((r) => r === 'L').length;
  const ties = results.filter((r) => r === 'T').length;
  const ap = s.allPlay;
  const apGames = ap.wins + ap.losses + ap.ties;
  // Luck: actual wins minus the wins an average schedule would have produced,
  // i.e. all-play win rate × games played. Ties count half, as MFL does.
  const expectedWins = apGames > 0 ? ((ap.wins + ap.ties / 2) / apGames) * results.length : null;
  const ppg = s.weekly.length ? s.weekly.reduce((t, w) => t + w.score, 0) / s.weekly.length : null;
  return {
    franchiseId,
    wins,
    losses,
    ties,
    streak: currentStreak(results),
    form: results.slice(-FORM_GAMES),
    weekly: s.weekly.map((w) => round1(w.score)),
    ppg: ppg == null ? null : round1(ppg),
    allPlay: apGames > 0 ? { wins: ap.wins, losses: ap.losses, ties: ap.ties } : null,
    luck: expectedWins == null ? null : round1(wins + ties / 2 - expectedWins),
  };
}

/**
 * The head-to-head series between `a` and `b`, from A's perspective, from an
 * indexed League History dataset (`recordBook(ds).ix`). Null when they have
 * never met under the current owners, or there is no dataset.
 *
 * `disputed` is always false now: there is one game list, so one answer. The
 * field stays because posts already in the feed carry it and the renderers
 * still read it.
 */
export function seriesSnapshot(ix, a, b, { withMeetings = false } = {}) {
  const games = ix ? headToHeadMeetings(ix, a, b) : null;
  if (!games?.length) return null;

  const meetings = games.map((m) => ({
    year: m.y,
    week: m.wk,
    score: round2(m.sA),
    opp: round2(m.sB),
    playoff: m.kind === 'playoffs',
  }));
  const winnerOf = (m) => (m.score > m.opp ? a : m.score < m.opp ? b : null);
  const aWins = meetings.filter((m) => m.score > m.opp).length;
  const bWins = meetings.filter((m) => m.score < m.opp).length;

  let streak = null;
  const last = meetings[meetings.length - 1];
  const lastWinner = winnerOf(last);
  if (lastWinner) {
    let count = 0;
    for (let i = meetings.length - 1; i >= 0 && winnerOf(meetings[i]) === lastWinner; i--) count++;
    streak = { franchiseId: lastWinner, count };
  }
  const decided = meetings.filter((m) => m.score !== m.opp);
  const byMargin = [...decided].sort((x, y) => Math.abs(y.score - y.opp) - Math.abs(x.score - x.opp));
  const asGame = (m) => m && { year: m.year, week: m.week, winnerId: winnerOf(m), score: Math.max(m.score, m.opp), opp: Math.min(m.score, m.opp) };
  const playoffWins = meetings.filter((m) => m.playoff && m.score > m.opp).length;
  const playoffLosses = meetings.filter((m) => m.playoff && m.score < m.opp).length;

  return {
    disputed: false,
    games: meetings.length,
    aWins,
    bWins,
    ties: meetings.length - aWins - bWins,
    since: meetings[0].year,
    streak,
    playoffGames: meetings.filter((m) => m.playoff).length,
    playoffWins,
    playoffLosses,
    lastPlayoff: asGame([...meetings].reverse().find((m) => m.playoff)),
    biggest: asGame(byMargin[0]),
    closest: asGame(byMargin[byMargin.length - 1]),
    meetings: withMeetings ? meetings : undefined,
  };
}

const winPct = (s) => {
  const g = s.wins + s.losses + s.ties;
  return g > 0 ? (s.wins + s.ties / 2) / g : null;
};

/**
 * How much a game is worth featuring: rivalry intensity (the Rivalries
 * pages' formula) times the WORSE of the two teams' win rates, so a great
 * series between two contenders beats an even series involving a winless
 * team. Before anyone has played, intensity alone decides.
 */
export function gameOfWeekScore(series, sideA, sideB) {
  if (!series || series.disputed || series.games < MIN_RIVALRY_MEETINGS) return null;
  const intensity = rivalryIntensity(series.games, series.aWins, series.bWins, series.ties, series.playoffGames);
  const pa = winPct(sideA);
  const pb = winPct(sideB);
  const stakes = pa == null || pb == null ? 1 : Math.min(pa, pb);
  return intensity * stakes;
}

/**
 * The full snapshot a Matchup Preview post carries.
 *
 * @param {{
 *   pairings: {franchise1Id: string, franchise2Id: string}[],
 *   weeklyResultsRaw: any[],
 *   history: object | undefined,   // recordBook(league-history.json).ix
 *   year: number,
 *   week: number,
 * }} input
 */
export function buildMatchupVisuals({ pairings, weeklyResultsRaw, history, year, week }) {
  const season = seasonGames(weeklyResultsRaw, week);
  const matchups = pairings.map(({ franchise1Id: a, franchise2Id: b }) => {
    const sideA = sideSnapshot(a, season);
    const sideB = sideSnapshot(b, season);
    const series = seriesSnapshot(history, a, b);
    return { a: sideA, b: sideB, series };
  });

  let gameOfWeek = null;
  let best = -Infinity;
  matchups.forEach((m, i) => {
    const score = gameOfWeekScore(m.series, m.a, m.b);
    if (score != null && score > best) {
      best = score;
      gameOfWeek = i;
    }
  });
  if (gameOfWeek != null) {
    const m = matchups[gameOfWeek];
    m.series = seriesSnapshot(history, m.a.franchiseId, m.b.franchiseId, { withMeetings: true });
  }
  return { year, week, gameOfWeek, matchups };
}

// ── The chart-led preview (Nov 2026) ────────────────────────────────────────
//
// The owner's "recommended mix": a playoff-race board on top, then one card per
// game, biggest stakes first, each with the rivalry's last five meetings, both
// teams' last five weeks, what the game is worth in playoff (or bye) odds, and
// The Gauntlet's next four weeks. Everything below is added to the SAME
// snapshot, so an old post (no `race`) keeps rendering the way it always did.

/** Last N of something, newest last. */
const lastN = (arr, n) => arr.slice(Math.max(0, arr.length - n));

/** Cards a large league shows; the rest are named in one line under them. */
export const MAX_GAME_CARDS = 12;

/** A league bigger than this shows only the teams still in the race on the board. */
export const BOARD_FULL_MAX_TEAMS = 32;

/** Rows a large league's board shows on each side of the playoff line. */
export const BUBBLE_ROWS = 10;

/**
 * One team's last five WEEKS: the week's one score, and W/L when the week's
 * games all went one way ('S' for a split doubleheader).
 */
export function lastFiveWeeks(franchiseId, season) {
  const s = season.get(franchiseId);
  if (!s) return [];
  return lastN(s.weekly, 5).map((w) => {
    const results = s.games.filter((g) => g.week === w.week).map((g) => g.result);
    const all = (r) => results.length > 0 && results.every((x) => x === r);
    const result = all('W') ? 'W' : all('L') ? 'L' : all('T') ? 'T' : 'S';
    return { week: w.week, score: round1(w.score), result };
  });
}

/**
 * The extras for the chart-led preview. Pure: everything comes in.
 *
 * @param {object} visuals         buildMatchupVisuals' result (mutated copy returned)
 * @param {object} args
 * @param {any[]} args.weeklyResultsRaw
 * @param {object | undefined} args.history  recordBook(...).ix
 * @param {any | null} args.odds    a playoff-odds derived file (compute-playoff-odds.mjs)
 * @param {any | null} args.gauntlet a schedule-strength derived file
 */
/**
 * The board(s) for the article: one for a league that seeds as a whole
 * (`race`), one per conference for a league that seeds each conference on its
 * own (`raceGroups`) — a single playoff line across two conferences would sit
 * in the wrong place for both.
 */
export function raceBoards(odds, gamesByPair, runInRank = new Map()) {
  if (!odds) return { race: null };
  if (odds.format?.groupBy !== 'conference') return { race: raceBoard(odds, gamesByPair, runInRank) };
  const confs = [...new Set(odds.teams.map((t) => t.conference))].sort();
  return {
    race: null,
    raceGroups: confs.map((c) => ({
      label: odds.conferenceNames?.[c] ?? c,
      race: raceBoard(odds, gamesByPair, runInRank, {
        teams: new Set(odds.teams.filter((t) => t.conference === c).map((t) => t.franchiseId)),
      }),
    })),
  };
}

/** The odds file's games keyed by pair, for raceBoard. */
export function oddsGamesByPair(odds) {
  return new Map((odds?.games ?? []).map((g) => [[g.a.franchiseId, g.b.franchiseId].sort().join('-'), g]));
}

export function addPreviewExtras(visuals, { weeklyResultsRaw, history, odds, gauntlet }) {
  const season = seasonGames(weeklyResultsRaw, visuals.week);
  const pairKey = (a, b) => [a, b].sort().join('-');
  const gamesByPair = new Map((odds?.games ?? []).map((g) => [pairKey(g.a.franchiseId, g.b.franchiseId), g]));
  const runInRank = new Map((gauntlet?.runIn ?? []).map((r) => [r.franchiseId, r.rank]));
  const heat = new Map((gauntlet?.heatMap?.franchises ?? []).map((f) => [f.franchiseId, f.cells]));
  const lastWeek = odds?.lastWeek ?? Infinity;

  const strip = (id) => {
    const cells = (heat.get(id) ?? [])
      .filter((c) => c.week >= visuals.week && c.week <= lastWeek)
      .slice(0, 4)
      .map((c) => ({
        week: c.week,
        bye: Boolean(c.bye),
        opps: (c.opps ?? []).map((o) => o.oppAbbrev ?? o.oppId),
        step: c.step ?? 0,
      }));
    return cells.length ? { rank: runInRank.get(id) ?? null, cells } : null;
  };

  const matchups = visuals.matchups.map((m) => {
    const a = m.a.franchiseId;
    const b = m.b.franchiseId;
    const full = seriesSnapshot(history, a, b, { withMeetings: true });
    const recent = full?.meetings ? lastN(full.meetings, 5).map(({ year, week, score, opp }) => ({ year, week, score, opp })) : [];
    const g = gamesByPair.get(pairKey(a, b));
    // The odds file names its sides in its own order; turn it to this card's.
    const sides = g ? (g.a.franchiseId === a ? [g.a, g.b] : [g.b, g.a]) : null;
    const pick = (s) => s && {
      franchiseId: s.franchiseId,
      now: { playoff: s.playoff, bye: s.bye },
      win: s.win,
      loss: s.loss,
      winChance: s.winChance ?? null,
    };
    return {
      ...m,
      recent,
      lastFive: { a: lastFiveWeeks(a, season), b: lastFiveWeeks(b, season) },
      stakes: g ? { kind: g.stakes.kind, swing: g.stakes.swing, a: pick(sides[0]), b: pick(sides[1]) } : null,
      gauntlet: { a: strip(a), b: strip(b) },
    };
  });

  // Order: the Game of the Week first, then every other game by what it is worth.
  const gotw = visuals.gameOfWeek != null ? matchups[visuals.gameOfWeek] : null;
  const rest = matchups.filter((m) => m !== gotw).sort((x, y) => (y.stakes?.swing ?? -1) - (x.stakes?.swing ?? -1));
  const ordered = gotw ? [gotw, ...rest] : rest;
  // A 99-team league plays ~100 games a week; the article carries the ones
  // that matter most and says how many more there are.
  const shown = ordered.slice(0, MAX_GAME_CARDS);

  return {
    ...visuals,
    gameOfWeek: gotw ? 0 : null,
    matchups: shown,
    moreGames: ordered.length - shown.length,
    ...raceBoards(odds, gamesByPair, runInRank),
  };
}

/**
 * The race board: every team's playoff odds today, and the range this week's
 * game can move them (low = with a loss, high = with a win).
 */
export function raceBoard(odds, gamesByPair, runInRank = new Map(), { full = false, teams: only = null } = {}) {
  const range = new Map();
  for (const g of gamesByPair.values()) {
    for (const s of [g.a, g.b]) {
      const lo = Math.min(range.get(s.franchiseId)?.low ?? 1, s.loss.playoff);
      const hi = Math.max(range.get(s.franchiseId)?.high ?? 0, s.win.playoff);
      range.set(s.franchiseId, { low: lo, high: hi });
    }
  }
  // `teams` narrows the board to one seeding group (a conference); the spots
  // are then that group's. Expected qualifiers = the sum of everyone's odds.
  const pool = only ? odds.teams.filter((t) => only.has(t.franchiseId)) : odds.teams;
  const spots = Math.round(pool.reduce((t, x) => t + x.playoff, 0));
  const all = [...pool]
    .sort((x, y) => y.playoff - x.playoff || y.wins - x.wins || y.pf - x.pf)
    .map((t) => ({
      franchiseId: t.franchiseId,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      playoff: t.playoff,
      bye: t.bye,
      low: range.get(t.franchiseId)?.low ?? null,
      high: range.get(t.franchiseId)?.high ?? null,
      sked: runInRank.get(t.franchiseId) ?? null,
    }));
  // "Out" is a fact on the board, not a row: a team the draw never put in.
  // The Playoff Odds page (`full`) lists everyone; the article trims.
  let out = full ? [] : all.filter((t) => t.playoff < 0.005 && (t.high ?? 0) < 0.005);
  let shown = all.filter((t) => !out.includes(t));
  let locked = [];
  if (!full && all.length > BOARD_FULL_MAX_TEAMS) {
    // A 99-team board is a wall: show the bubble, the rows either side of the
    // playoff line, and count everyone above and below it.
    const from = Math.max(0, spots - BUBBLE_ROWS);
    const to = Math.min(all.length, spots + BUBBLE_ROWS);
    locked = all.slice(0, from);
    shown = all.slice(from, to);
    out = all.slice(to);
  }
  return {
    week: odds.week,
    lastWeek: odds.lastWeek,
    spots,
    hasByes: (odds.format?.byes ?? 0) > 0,
    teams: shown,
    /** Rows above the first one shown (a large league's board starts at the bubble). */
    aboveCount: locked.length,
    /** Index in `teams` of the first team outside the playoff spots. */
    lineAt: Math.max(0, spots - locked.length),
    lockedIds: locked.map((t) => t.franchiseId),
    outIds: out.map((t) => t.franchiseId),
    teamCount: all.length,
  };
}
