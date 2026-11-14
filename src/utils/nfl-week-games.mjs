/**
 * One NFL week's games, and which of them matters most to a fantasy game.
 *
 * Plain JS so the Schefter article scripts (node, no TypeScript) and the
 * Sunday Ticket board (`sunday-ticket-slate.ts`, which re-exports
 * `selectWeekMatchups`) read the committed `nflSchedule.json` through ONE
 * reader. The board ranks a week's NFL games by the projected points of the
 * players a viewer has in them; `keyNflGame` asks the same question for the
 * two teams of one fantasy matchup (owner's call, Nov 2026: the Saturday
 * preview names the NFL game that will swing each fantasy game).
 */

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Pick one week's matchups out of the committed `nflSchedule.json`, which
 * has TWO shapes: a live in-season feed carries only the current week under
 * `nflSchedule.matchup`, a synced/completed season only the full archive
 * under `fullNflSchedule.nflSchedule[week - 1].matchup`. The live shape may
 * carry `nflSchedule.week`; when it does and it is not the week asked for,
 * the answer is "no games", not another week's games wearing this week's
 * header. Same dual-source spine as MatchupPreviewHero.
 * @param {any} scheduleFeed
 * @param {number} week
 * @returns {any[]}
 */
export function selectWeekMatchups(scheduleFeed, week) {
  const feed = scheduleFeed?.default ?? scheduleFeed;
  const archive = feed?.fullNflSchedule?.nflSchedule;
  if (archive) {
    const weeks = asArray(archive);
    const entry = weeks[week - 1];
    return asArray(entry?.matchup);
  }
  const live = feed?.nflSchedule;
  if (!live) return [];
  const liveWeek = parseInt(live.week ?? '', 10);
  if (Number.isFinite(liveWeek) && liveWeek !== week) return [];
  return asArray(live.matchup);
}

/**
 * MFL matchups → `{ id, kickoff, away, home }`, in MFL's own team codes (the
 * same codes its players feed uses, so no alias table is needed to join the
 * two). A game without both teams is dropped.
 * @param {any} matchups
 * @returns {Array<{ id: string, kickoff: number, away: string, home: string }>}
 */
export function nflWeekGames(matchups) {
  const games = [];
  for (const m of asArray(matchups)) {
    const teams = asArray(m?.team);
    const homeRaw = teams.find((t) => t?.isHome === '1') ?? teams[1];
    const awayRaw = teams.find((t) => t?.isHome === '0') ?? teams[0];
    const home = String(homeRaw?.id ?? '').toUpperCase();
    const away = String(awayRaw?.id ?? '').toUpperCase();
    if (!home || !away) continue;
    const kickoff = parseInt(m?.kickoff ?? '', 10);
    games.push({ id: `${away}@${home}`, kickoff: Number.isFinite(kickoff) ? kickoff : 0, away, home });
  }
  return games;
}

/**
 * The NFL game carrying the most projected points across BOTH fantasy teams'
 * starters — the game that will swing the fantasy game. Ties go to the game
 * with more of those starters in it, then the earlier kickoff. Null when no
 * starter plays this week (or there is no schedule).
 *
 * @param {Array<{ id: string, kickoff: number, away: string, home: string }>} games
 * @param {Array<{ franchiseId: string, players: Array<{ name: string, position?: string, nflTeam?: string, proj: number }> }>} sides
 * @returns {null | { away: string, home: string, kickoff: number, projTotal: number,
 *   players: Array<{ franchiseId: string, name: string, position: string, nflTeam: string, proj: number }> }}
 */
export function keyNflGame(games, sides) {
  let best = null;
  for (const game of games ?? []) {
    const players = [];
    for (const side of sides ?? []) {
      for (const p of side?.players ?? []) {
        const team = String(p?.nflTeam ?? '').toUpperCase();
        if (team !== game.away && team !== game.home) continue;
        const proj = Number.isFinite(p.proj) ? Math.round(p.proj * 100) / 100 : 0;
        players.push({ franchiseId: side.franchiseId, name: p.name, position: p.position ?? '', nflTeam: team, proj });
      }
    }
    if (players.length === 0) continue;
    const projTotal = Math.round(players.reduce((s, p) => s + p.proj, 0) * 10) / 10;
    const better = !best
      || projTotal > best.projTotal
      || (projTotal === best.projTotal && players.length > best.players.length)
      || (projTotal === best.projTotal && players.length === best.players.length && game.kickoff < best.kickoff);
    if (better) {
      players.sort((a, b) => b.proj - a.proj || a.name.localeCompare(b.name));
      best = { away: game.away, home: game.home, kickoff: game.kickoff, projTotal, players };
    }
  }
  return best;
}
