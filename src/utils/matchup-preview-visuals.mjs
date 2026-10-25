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

/** Results a form strip shows, newest last. */
export const FORM_GAMES = 10;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

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
  const weeks = (Array.isArray(weeklyResultsRaw) ? weeklyResultsRaw : [])
    .map((w) => w?.weeklyResults)
    .filter((w) => w && Number(w.week) < week)
    .sort((a, b) => Number(a.week) - Number(b.week));

  for (const w of weeks) {
    const wk = Number(w.week);
    const matchups = [].concat(w.matchup ?? []);
    const weekScores = new Map();
    for (const m of matchups) {
      const sides = [].concat(m?.franchise ?? []);
      if (sides.length !== 2) continue;
      for (const [me, them] of [[sides[0], sides[1]], [sides[1], sides[0]]]) {
        const result = me?.result;
        const score = num(me?.score);
        const opp = num(them?.score);
        if (!me?.id || !them?.id || !['W', 'L', 'T'].includes(result) || score == null || opp == null) continue;
        // An unplayed week can carry a placeholder T with 0-0; a real game has points.
        if (score === 0 && opp === 0) continue;
        get(me.id).games.push({ week: wk, result, score, opp, oppId: them.id });
        weekScores.set(me.id, score);
      }
    }
    for (const [id, score] of weekScores) {
      const f = get(id);
      f.weekly.push({ week: wk, score });
      for (const [otherId, other] of weekScores) {
        if (otherId === id) continue;
        if (score > other) f.allPlay.wins++;
        else if (score < other) f.allPlay.losses++;
        else f.allPlay.ties++;
      }
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
