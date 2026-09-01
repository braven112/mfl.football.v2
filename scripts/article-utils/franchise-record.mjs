/**
 * Franchise records and doubleheader-week shape, for article fact sheets.
 *
 * TWO BUGS LIVE HERE, both of which shipped into real articles.
 *
 * 1. RECORDS WERE DOUBLED. Five article types computed wins as
 *    `h2hw + divw + nondivw`. In MFL's standings export `h2hw` is the TOTAL
 *    head-to-head win count and `divw`/`nondivw` are its two SUBSETS — the
 *    league's own `h2hwlt` string proves it (a franchise with h2hwlt "15-3-0"
 *    has divw 5 and nondivw 10). Summing all three reported that team as 30-6
 *    to the model, and Schefter repeated it. Always use `franchiseRecord()`.
 *
 * 2. A DOUBLEHEADER WEEK LOOKS LIKE TWICE THE LEAGUE. TheLeague plays
 *    doubleheaders in Weeks 1, 2, 3 and 12 — every franchise appears in TWO
 *    matchups, so a 16-team league produces 16 matchup rows, not 8. Code that
 *    keys anything by franchise id silently keeps only the second game, and a
 *    fact sheet that lists the rows without saying so hands the model a team
 *    that both won and lost with no explanation. Use `summarizeWeekFormat()`
 *    and let the fact sheet say what the week is.
 */

/**
 * A franchise's true record from an MFL standings row.
 *
 * @param {Record<string, any>} f Standings franchise row.
 * @returns {{ wins: number, losses: number, ties: number, display: string }}
 */
export function franchiseRecord(f = {}) {
  const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  const wins = num(f.h2hw);
  const losses = num(f.h2hl);
  const ties = num(f.h2ht);
  return { wins, losses, ties, display: ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}` };
}

/**
 * Describe the shape of a week's schedule.
 *
 * @param {Array<{franchise1Id: string, franchise2Id: string}>} pairings
 * @returns {{
 *   isDoubleheader: boolean,
 *   gameCount: number,
 *   franchiseCount: number,
 *   gamesPerFranchise: number,
 *   opponentsByFranchise: Map<string, string[]>,
 *   label: string,
 * }}
 */
export function summarizeWeekFormat(pairings = []) {
  const opponentsByFranchise = new Map();
  for (const { franchise1Id, franchise2Id } of pairings) {
    if (!franchise1Id || !franchise2Id) continue;
    for (const [a, b] of [[franchise1Id, franchise2Id], [franchise2Id, franchise1Id]]) {
      if (!opponentsByFranchise.has(a)) opponentsByFranchise.set(a, []);
      opponentsByFranchise.get(a).push(b);
    }
  }
  const gameCount = pairings.filter((p) => p.franchise1Id && p.franchise2Id).length;
  const franchiseCount = opponentsByFranchise.size;
  // Ceil so an uneven week (a bye, a scheduling oddity) still reads as a
  // doubleheader rather than rounding down into "normal".
  const gamesPerFranchise = franchiseCount === 0 ? 0 : Math.ceil((gameCount * 2) / franchiseCount);
  const isDoubleheader = gamesPerFranchise > 1;
  return {
    isDoubleheader,
    gameCount,
    franchiseCount,
    gamesPerFranchise,
    opponentsByFranchise,
    label: isDoubleheader
      ? `DOUBLEHEADER WEEK — ${gameCount} games, every franchise plays ${gamesPerFranchise}`
      : `${gameCount} matchups`,
  };
}

/**
 * The paragraph a fact sheet should carry on a doubleheader week, so the model
 * frames a team appearing twice as the format rather than as a contradiction.
 * Empty string on a normal week.
 *
 * @param {ReturnType<typeof summarizeWeekFormat>} format
 */
export function doubleheaderBriefing(format) {
  if (!format?.isDoubleheader) return '';
  return [
    `!! ${format.label}. !!`,
    `Every franchise plays ${format.gamesPerFranchise} separate games this week and each counts`,
    `in the standings independently. A team can go 2-0, 1-1 or 0-2. When a team appears`,
    `twice below that is the schedule, NOT an error and NOT the same game — refer to its`,
    `games separately, and describe its week by the combined result (e.g. "split their`,
    `doubleheader", "swept", "dropped both"). Never write that a team simply "won" or`,
    `"lost" this week without saying which game or giving the combined record.`,
  ].join('\n');
}

/**
 * Per-franchise results for a doubleheader week: every score a franchise put
 * up, with the opponent and outcome. Accumulates rather than overwriting —
 * franchise-keyed assignment is what silently dropped game one.
 *
 * @param {Array<any>} matchups Raw `weeklyResults.matchup` rows.
 * @returns {Map<string, Array<{ opponentId: string, score: number, opponentScore: number, result: 'W'|'L'|'T' }>>}
 */
export function resultsByFranchise(matchups = []) {
  const out = new Map();
  for (const matchup of matchups) {
    const [f1, f2] = matchup?.franchise || [];
    if (!f1?.id || !f2?.id) continue;
    const s1 = parseFloat(f1.score ?? f1.spread ?? 0) || 0;
    const s2 = parseFloat(f2.score ?? f2.spread ?? 0) || 0;
    for (const [self, opp, selfScore, oppScore] of [
      [f1, f2, s1, s2],
      [f2, f1, s2, s1],
    ]) {
      if (!out.has(self.id)) out.set(self.id, []);
      out.get(self.id).push({
        opponentId: opp.id,
        score: selfScore,
        opponentScore: oppScore,
        result: selfScore > oppScore ? 'W' : selfScore < oppScore ? 'L' : 'T',
      });
    }
  }
  return out;
}

/**
 * A franchise's combined line for the week — "2-0 (241.10 total)".
 * @param {Array<{score: number, result: string}>} games
 */
export function weekSummaryLine(games = []) {
  const w = games.filter((g) => g.result === 'W').length;
  const l = games.filter((g) => g.result === 'L').length;
  const t = games.filter((g) => g.result === 'T').length;
  const total = games.reduce((sum, g) => sum + g.score, 0);
  const record = t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
  return `${record} (${total.toFixed(2)} total)`;
}
