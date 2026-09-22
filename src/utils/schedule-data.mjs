/**
 * Reading MFL's `schedule` export — one parser for every league.
 *
 * Source of truth is the committed feed, `data/<league>/mfl-feeds/<year>/
 * schedule.json`, NOT the schedule-plan or schedule-release lock files: those
 * record the draw that was generated, and the commissioner pastes the real one
 * into MFL by hand, so the two can legitimately disagree. What is being played
 * is whatever MFL says is being played.
 *
 * Two shapes in that feed have already produced bugs elsewhere and are the
 * reason this module exists instead of an inline walk per page:
 *
 * 1. **An unplayed matchup still carries `result: "T"`.** MFL fills the field
 *    in before kickoff, so `result` alone reports every remaining week of the
 *    season as a tie. A game is PLAYED only when it carries a `score`, which
 *    is what `played` keys off; `result` is read only once that holds.
 * 2. **A franchise appears TWICE in a doubleheader week.** TheLeague runs
 *    doubleheaders in 2026 weeks 1, 2, 3 and 12; the AFL in 1, 2 and 12 — and
 *    which weeks those are moves every season, so nothing here may hardcode
 *    them. Every per-franchise accessor returns an ARRAY of games per week;
 *    collapsing it to one silently drops half a week's scoring.
 */

/**
 * One game from ONE franchise's point of view — the shape every per-franchise
 * accessor below returns, and the shape the roster header's props declare.
 *
 * Named rather than repeated inline because four functions return it: a bare
 * `object[]` in a @returns silently makes every field an error at the .astro
 * call site, which is how the header's props went red the moment the
 * week-level accessors were added.
 *
 * @typedef {{
 *   week: number,
 *   opponentId: string,
 *   isHome: boolean,
 *   played: boolean,
 *   score: number|null,
 *   opponentScore: number|null,
 *   outcome: 'W'|'L'|'T'|null
 * }} FranchiseGame
 */

/** MFL returns a single-element list as a bare object. */
function toArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize the raw feed into weeks of matchups, ascending by week.
 *
 * @param {unknown} feed Parsed `schedule.json`.
 * @returns {{week: number, matchups: {franchises: {id: string, isHome: boolean, score: number|null, result: string|null}[]}[]}[]}
 */
export function parseWeeklySchedule(feed) {
  const weekly = toArray(feed?.schedule?.weeklySchedule);
  return weekly
    .map((entry) => ({
      week: Number(entry?.week),
      matchups: toArray(entry?.matchup)
        .map((matchup) => ({
          franchises: toArray(matchup?.franchise).map((franchise) => ({
            id: String(franchise?.id ?? ''),
            isHome: String(franchise?.isHome ?? '') === '1',
            score: toNumber(franchise?.score),
            result: franchise?.result ? String(franchise.result) : null,
          })),
        }))
        .filter((matchup) => matchup.franchises.length === 2),
    }))
    // A week MFL has created but not drawn yet carries a `week` and no
    // `matchup` — the live 2026 feeds do exactly that for the playoff weeks
    // (TheLeague 15-17, the AFL 15-18). Keeping those weeks renders a grid
    // column in which every club shows the bye dash, which is indistinguishable
    // from a real bye. An undrawn week is not a scheduled week.
    .filter((entry) => Number.isFinite(entry.week) && entry.matchups.length > 0)
    .sort((a, b) => a.week - b.week);
}

/**
 * Every game one franchise plays, grouped by week.
 *
 * `games` is plural by design — see the doubleheader note at the top. A week
 * the franchise does not appear in is omitted rather than returned empty, so
 * callers iterate real games only.
 *
 * @returns {{week: number, games: FranchiseGame[]}[]}
 */
export function franchiseSchedule(weeks, franchiseId) {
  const id = String(franchiseId);
  const out = [];
  for (const { week, matchups } of weeks) {
    const games = [];
    for (const { franchises } of matchups) {
      const mine = franchises.find((f) => f.id === id);
      if (!mine) continue;
      const opponent = franchises.find((f) => f.id !== id);
      if (!opponent) continue;
      // Both sides must carry a score: MFL has published a half-filled
      // matchup mid-scoring, and a game with one score is not a result yet.
      const played = mine.score != null && opponent.score != null;
      games.push({
        week,
        opponentId: opponent.id,
        isHome: mine.isHome,
        played,
        score: mine.score,
        opponentScore: opponent.score,
        outcome: played ? resolveOutcome(mine, opponent) : null,
      });
    }
    if (games.length > 0) out.push({ week, games });
  }
  return out;
}

/**
 * MFL's own `result` wins once the game is played — it applies the league's
 * tie rules, which a score comparison does not. The score comparison is only
 * the fallback for a played game MFL left unlabelled.
 */
function resolveOutcome(side, opponent) {
  const result = (side.result ?? '').toUpperCase();
  if (result === 'W' || result === 'L' || result === 'T') return result;
  if (side.score == null || opponent?.score == null) return null;
  if (side.score > opponent.score) return 'W';
  if (side.score < opponent.score) return 'L';
  return 'T';
}

/**
 * The next game that has not been played, at or after `fromWeek`. Returns null
 * once the season is over — the caller decides what to show instead.
 *
 * @param {{week: number, games: FranchiseGame[]}[]} schedule
 * @param {number} [fromWeek]
 * @returns {FranchiseGame|null}
 */
export function findNextGame(schedule, fromWeek = 1) {
  for (const { week, games } of schedule) {
    if (week < fromWeek) continue;
    const pending = games.find((game) => !game.played);
    if (pending) return pending;
  }
  return null;
}

/**
 * The most recent game that HAS been played, at or before `beforeWeek`.
 *
 * The mirror of `findNextGame`, and the other half of what a roster header
 * shows: last result on one side, next opponent on the other. Returns null
 * before a club's first game of the season — the caller decides what to show
 * instead, exactly as with `findNextGame`.
 *
 * Walks weeks newest-first, and within a week takes the LAST played game
 * rather than the first: a doubleheader week holds two games, and the later
 * one is the more recent result. Iterating forward and keeping the final
 * match would work too, but this stops at the first hit on a full season.
 *
 * @param {{week: number, games: FranchiseGame[]}[]} schedule
 * @param {number} [beforeWeek]
 * @returns {FranchiseGame|null}
 */
export function findLastResult(schedule, beforeWeek = Infinity) {
  for (let i = schedule.length - 1; i >= 0; i -= 1) {
    const { week, games } = schedule[i];
    if (week > beforeWeek) continue;
    for (let j = games.length - 1; j >= 0; j -= 1) {
      if (games[j].played) return games[j];
    }
  }
  return null;
}

/**
 * The most recent week a club actually PLAYED, with every game it played that
 * week — the week-level form of `findLastResult`.
 *
 * A roster header needs this rather than one game. TheLeague opens 2026 with
 * three doubleheader weeks, so "the last result" is routinely two results,
 * and the club can have SPLIT them: the Pigskins lost week 1 by 21 and won it
 * by 7, and a header that printed the second game announced a win for a week
 * they finished 1-1. `findLastResult` is still the right answer where one
 * opponent is the question ("who did we just play"); this is the right answer
 * where the WEEK is ("how did week 1 go").
 *
 * Unplayed games in that week are dropped: a doubleheader can be half
 * scored, and a game with no score is not a result.
 *
 * @param {{week: number, games: FranchiseGame[]}[]} schedule
 * @param {number} [beforeWeek]
 * @returns {{week: number, games: FranchiseGame[]}|null}
 */
export function findLastPlayedWeek(schedule, beforeWeek = Infinity) {
  for (let i = schedule.length - 1; i >= 0; i -= 1) {
    const { week, games } = schedule[i];
    if (week > beforeWeek) continue;
    const played = games.filter((game) => game.played);
    if (played.length > 0) return { week, games: played };
  }
  return null;
}

/**
 * The next week holding an unplayed game, with every unplayed game in it —
 * the week-level form of `findNextGame`, and the mirror of the above.
 *
 * Games in that week that HAVE been played are dropped, so a half-scored
 * doubleheader reports only what is still to come.
 *
 * @param {{week: number, games: FranchiseGame[]}[]} schedule
 * @param {number} [fromWeek]
 * @returns {{week: number, games: FranchiseGame[]}|null}
 */
export function findNextWeek(schedule, fromWeek = 1) {
  for (const { week, games } of schedule) {
    if (week < fromWeek) continue;
    const pending = games.filter((game) => !game.played);
    if (pending.length > 0) return { week, games: pending };
  }
  return null;
}

/**
 * Grid source: franchise id → week number → the opponents it faces that week.
 *
 * The inner value is an array for the same doubleheader reason; a grid cell
 * renders every entry rather than the first.
 *
 * `score` / `opponentScore` are this club's own and its opponent's, in that
 * order — the grid prints the final score in the cell, so the pair must read
 * from the perspective of the ROW, not of whichever side the feed listed
 * first. They are null for a game that has not been played.
 */
export function opponentsByWeek(weeks) {
  /** @type {Map<string, Map<number, {opponentId: string, isHome: boolean, played: boolean, score: number|null, opponentScore: number|null, outcome: 'W'|'L'|'T'|null}[]>>} */
  const byFranchise = new Map();
  for (const { week, matchups } of weeks) {
    for (const { franchises } of matchups) {
      for (const side of franchises) {
        const opponent = franchises.find((f) => f.id !== side.id);
        if (!opponent) continue;
        const played = side.score != null && opponent.score != null;
        if (!byFranchise.has(side.id)) byFranchise.set(side.id, new Map());
        const weeksFor = byFranchise.get(side.id);
        if (!weeksFor.has(week)) weeksFor.set(week, []);
        weeksFor.get(week).push({
          opponentId: opponent.id,
          isHome: side.isHome,
          played,
          // Null unless the game is PLAYED, which is stricter than "copy what
          // the feed had": MFL publishes a half-filled matchup mid-scoring, so
          // one side can carry a score while `played` is false. Passing that
          // through lets a consumer print a partial result as a final one.
          score: played ? side.score : null,
          opponentScore: played ? opponent.score : null,
          outcome: played ? resolveOutcome(side, opponent) : null,
        });
      }
    }
  }
  return byFranchise;
}
