/**
 * THE definition of a game result and a W-L-T record, for the whole site.
 *
 * Every surface that turns MFL's matchups into wins and losses reads this:
 * League History's game list (record-book.mjs `gamesFromSchedule`), the
 * standings' derived division records, the AFL draft order's head-to-head
 * ledger, the matchup previews, division strength, schedule strength, the
 * Pecking Order, playoff performance and all-play. Until Oct 2026 each of
 * those tallied its own, and they disagreed at the edges: one dropped every
 * forfeit, one counted MFL's placeholder "T" on an unplayed week, one read
 * the score where MFL had broken a tie (Brandon, 2026-10-26: "a game counts
 * when MFL recorded a result"). `tests/game-results-guard.test.ts` fails on a
 * file that grows its own tally again.
 *
 * The rules:
 * - A game has a result once MFL has posted both scores and they are not a
 *   0-0 placeholder. An unplayed week carries no score at all, and MFL stamps
 *   both sides "T" anyway, so the score, never the result field, says whether
 *   a game was played.
 * - A forfeit (a team that set no lineup posts 0.00) IS a game. It counts in
 *   every record; only scoring boards leave the 0.00 off (`isForfeit`).
 * - The result is MFL's own W/L/T when it recorded one, so a tie MFL broke on
 *   its tiebreaker stays a win and a loss; the scores decide only where MFL
 *   recorded nothing.
 * - Win percentage counts a tie as half a win, MFL's own convention.
 * - All-play compares a team's score against every other team's that week; a
 *   week where nobody scored is unplayed, not a week of ties.
 *
 * Plain ESM with JSDoc so the Vite-bundled pages and the plain-node scripts
 * import the same file (the arrangement all-play.mjs and leagues-data.mjs use).
 */

const RESULTS = new Set(['W', 'L', 'T']);

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** A posted score as a number, or null when MFL has not posted one. */
export function scoreOf(side) {
  if (side?.score == null || side.score === '') return null;
  const n = Number(side.score);
  return Number.isFinite(n) ? n : null;
}

/** Whether MFL has recorded a result for a pairing of two sides: both scores posted, not 0-0. */
export function hasResult(a, b) {
  const sa = scoreOf(a);
  const sb = scoreOf(b);
  return sa != null && sb != null && (sa > 0 || sb > 0);
}

/** A forfeit: one side posted 0.00 (no lineup set). A game, but not a performance. */
export const isForfeit = (scoreA, scoreB) => !(scoreA > 0 && scoreB > 0);

/** 'W' | 'L' | 'T' from one side's score against the other's. */
export const resultOf = (mine, theirs) => (mine > theirs ? 'W' : mine < theirs ? 'L' : 'T');

/**
 * The result of two bare scores (a hypothetical pairing, all-play, a schedule
 * swap): null when either is missing or both are 0, an unplayed week.
 */
export function scoreResult(mine, theirs) {
  const a = Number(mine);
  const b = Number(theirs);
  if (mine == null || theirs == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (!(a > 0 || b > 0)) return null;
  return resultOf(a, b);
}

/**
 * One side's result in a game with a result: MFL's recorded W/L/T when it has
 * one, else the scores' (`mine`/`theirs` override them, e.g. a live spread).
 */
export function sideResult(me, them, mine = scoreOf(me) ?? 0, theirs = scoreOf(them) ?? 0) {
  const recorded = String(me?.result ?? '').toUpperCase();
  if (RESULTS.has(recorded)) return recorded;
  return resultOf(mine, theirs);
}

/**
 * The games with a result in one week entry of a schedule or weeklyResults
 * feed (`{ week, matchup }`), each from its first side: `{ week, a, b, sa, sb,
 * ra, rb, regularSeason }`, where `ra`/`rb` are each side's result. A team
 * paired with itself (MFL's old bye rows) is not a game.
 *
 * @returns {Array<{week:number, a:string, b:string, sa:number, sb:number, ra:'W'|'L'|'T', rb:'W'|'L'|'T', regularSeason:boolean|null}>}
 */
export function weekGames(weekEntry) {
  const week = Number(weekEntry?.week);
  const out = [];
  for (const m of toArray(weekEntry?.matchup)) {
    const sides = toArray(m?.franchise);
    if (sides.length !== 2) continue;
    const [x, y] = sides;
    if (!x?.id || !y?.id || x.id === y.id || !hasResult(x, y)) continue;
    out.push({
      week,
      a: x.id,
      b: y.id,
      sa: scoreOf(x),
      sb: scoreOf(y),
      ra: sideResult(x, y),
      rb: sideResult(y, x),
      regularSeason: m?.regularSeason == null ? null : String(m.regularSeason) === '1',
    });
  }
  return out;
}

/**
 * The week entries of a weekly-results-raw feed (an array of
 * `{ weeklyResults }`, or of the entries themselves), or of a schedule feed
 * (`{ schedule: { weeklySchedule } }`), oldest first.
 */
export function weekEntries(feed) {
  const raw = feed?.schedule?.weeklySchedule ?? feed?.weeklyResults ?? feed;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return list
    .map((w) => w?.weeklyResults ?? (Array.isArray(w) ? w[0]?.weeklyResults : null) ?? w)
    .filter((w) => w && Number(w.week) > 0)
    .sort((a, b) => Number(a.week) - Number(b.week));
}

/** A W-L-T record plus the points on both sides of it. */
export const emptyRecord = () => ({ wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 });

/** Games in a record. */
export const recordGames = (rec) => (rec ? rec.wins + rec.losses + rec.ties : 0);

/** Fold one result ('W' | 'L' | 'T') into a record. */
export function addResult(rec, result) {
  if (result === 'W') rec.wins += 1;
  else if (result === 'L') rec.losses += 1;
  else if (result === 'T') rec.ties += 1;
  return rec;
}

/**
 * Fold one game into a record from the record-holder's side. `result`
 * defaults to the scores'; pass MFL's recorded one when there is one.
 */
export function addGame(rec, scoreFor, scoreAgainst, result = resultOf(scoreFor, scoreAgainst)) {
  addResult(rec, result);
  rec.pointsFor += scoreFor;
  rec.pointsAgainst += scoreAgainst;
  return rec;
}

/** Fold `b` into `a` in place. */
export function mergeRecord(a, b) {
  if (!b) return a;
  a.wins += b.wins;
  a.losses += b.losses;
  a.ties += b.ties;
  a.pointsFor += b.pointsFor ?? 0;
  a.pointsAgainst += b.pointsAgainst ?? 0;
  return a;
}

/**
 * Win percentage with ties as half a win. Null (not 0) when no games were
 * played, so "hasn't played" never sorts as "lost everything".
 */
export function winPct(rec) {
  const g = recordGames(rec);
  return g ? (rec.wins + rec.ties * 0.5) / g : null;
}

/** "9-4" or "9-4-1". */
export const formatRecord = (rec) => `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''}`;

/**
 * One week of all-play: every team's score against every other team's.
 * `scores` is `[[franchiseId, score], ...]` (or a Map / plain object). A week
 * where nobody scored is unplayed and yields nothing.
 *
 * @returns {Map<string, {wins:number, losses:number, ties:number}>}
 */
export function allPlayWeek(scores) {
  const entries = (scores instanceof Map ? [...scores] : Array.isArray(scores) ? scores : Object.entries(scores ?? {}))
    .map(([id, s]) => [id, Number(s)])
    .filter(([, s]) => Number.isFinite(s));
  const out = new Map();
  if (!entries.some(([, s]) => s > 0)) return out;
  for (const [id, mine] of entries) {
    const rec = { wins: 0, losses: 0, ties: 0 };
    for (const [other, theirs] of entries) if (other !== id) addResult(rec, resultOf(mine, theirs));
    out.set(id, rec);
  }
  return out;
}
