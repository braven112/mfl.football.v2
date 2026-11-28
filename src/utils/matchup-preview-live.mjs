/**
 * The week so far, for the Saturday Matchup Preview (owner's call, Nov 2026).
 *
 * The preview runs on Saturday, but most NFL weeks have already played a
 * Thursday game by then, and some (Thanksgiving, late-season Saturdays, a
 * Wednesday opener) several. Written as if nothing had kicked off, the column
 * named a Thursday game that was already final as "the key NFL game" and
 * picked a score that ignored the 48 points a team had already banked.
 *
 * This reads MFL's liveScoring export (DETAILS=1) at write time and splits
 * every fantasy team's STARTERS into three groups by their NFL game:
 *   done — the game has kicked off and MFL shows no seconds left
 *   live — kicked off, seconds still on the clock
 *   left — not kicked off yet
 * A starter whose NFL team has no game this week (a bye) is in none of them.
 *
 * Pure: the caller fetches the payload and passes the clock.
 */

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round1 = (x) => Math.round(x * 10) / 10;
const GAME_SECONDS = 3600;

/**
 * @param {any} liveScoring MFL `TYPE=liveScoring&DETAILS=1` JSON
 * @param {{
 *   nflGames: Array<{ away: string, home: string, kickoff: number }>,
 *   players: Map<string, { name: string, position: string, team: string }>,
 *   projections: Map<string, number>,
 *   now: number,           // epoch ms
 *   zone?: string,         // the league's own clock, for the "through Friday" label
 * }} ctx
 * @returns {null | {
 *   started: Array<{ away: string, home: string, kickoff: number }>,
 *   finals: Array<{ away: string, home: string, kickoff: number }>,
 *   through: string | null,
 *   teams: Map<string, {
 *     score: number,
 *     hasLineup: boolean,
 *     done: Array<{ id: string, name: string, position: string, nflTeam: string, score: number }>,
 *     live: Array<{ id: string, name: string, position: string, nflTeam: string, score: number }>,
 *     left: Array<{ id: string, name: string, position: string, nflTeam: string, proj: number }>,
 *     projFinal: number | null,
 *   }>,
 * }}
 *   Null when no NFL game of the week has kicked off yet, or the payload is
 *   unusable: the preview is then the plain pre-week preview it always was.
 */
export function weekSoFar(liveScoring, { nflGames, players, projections, now, zone = 'America/Los_Angeles' }) {
  const nowSec = Math.floor(now / 1000);
  const games = asArray(nflGames).filter((g) => g && g.kickoff > 0);
  const started = games.filter((g) => g.kickoff <= nowSec);
  if (started.length === 0) return null;

  const matchups = asArray(liveScoring?.liveScoring?.matchup);
  if (matchups.length === 0) return null;

  const gameOf = new Map();
  for (const g of games) {
    gameOf.set(String(g.away).toUpperCase(), g);
    gameOf.set(String(g.home).toUpperCase(), g);
  }

  const teams = new Map();
  for (const m of matchups) {
    for (const f of asArray(m?.franchise)) {
      if (!f?.id) continue;
      const entry = { score: round1(num(f.score) ?? 0), hasLineup: false, done: [], live: [], left: [], projFinal: null };
      let remaining = 0;
      for (const p of asArray(f.players?.player)) {
        if (p?.status !== 'starter' || !p.id) continue;
        entry.hasLineup = true;
        const info = players.get(String(p.id));
        const nflTeam = String(info?.team ?? '').toUpperCase();
        const game = gameOf.get(nflTeam);
        if (!game) continue; // bye week, or a player the feed does not know
        const base = { id: String(p.id), name: info?.name ?? String(p.id), position: info?.position ?? '', nflTeam };
        const proj = projections.get(String(p.id)) ?? 0;
        const secs = num(p.gameSecondsRemaining);
        if (game.kickoff > nowSec) {
          entry.left.push({ ...base, proj: round1(proj) });
          remaining += proj;
        } else if (secs === 0) {
          entry.done.push({ ...base, score: round1(num(p.score) ?? 0) });
        } else {
          entry.live.push({ ...base, score: round1(num(p.score) ?? 0) });
          // A game in progress: the share of the projection its clock has left.
          remaining += proj * Math.min(1, Math.max(0, (secs ?? GAME_SECONDS) / GAME_SECONDS));
        }
      }
      entry.done.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
      entry.left.sort((x, y) => y.proj - x.proj || x.name.localeCompare(y.name));
      // No submitted lineup: MFL has no starters to project from, so the
      // caller falls back to its own best-nine estimate.
      entry.projFinal = entry.hasLineup ? round1(entry.score + remaining) : null;
      teams.set(String(f.id), entry);
    }
  }
  if (teams.size === 0) return null;

  // Only games MFL has finished count as "final" for the copy; a game still
  // on the clock at write time is in progress, not done.
  const finals = started.filter((g) => {
    for (const t of teams.values()) {
      if (t.live.some((p) => p.nflTeam === g.away || p.nflTeam === g.home)) return false;
    }
    return true;
  }).sort((x, y) => x.kickoff - y.kickoff);

  const last = finals[finals.length - 1];
  const through = last
    ? new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: zone }).format(new Date(last.kickoff * 1000))
    : null;
  return { started, finals, through, teams };
}

/** Games that have not kicked off yet: the only ones a preview can still call "key". */
export function unplayedGames(nflGames, now) {
  const nowSec = Math.floor(now / 1000);
  return asArray(nflGames).filter((g) => !(g?.kickoff > 0 && g.kickoff <= nowSec));
}

/**
 * The snapshot a game card draws ("So far"), or null when neither side has a
 * starter in a game that has kicked off — a 0-0 strip says nothing.
 */
export function liveCardSnapshot(soFar, aId, bId) {
  if (!soFar) return null;
  const a = soFar.teams.get(String(aId));
  const b = soFar.teams.get(String(bId));
  if (!a || !b) return null;
  const played = (t) => t.done.length + t.live.length;
  if (played(a) + played(b) === 0) return null;
  const side = (t) => ({ score: t.score, left: t.left.length + t.live.length, projFinal: t.projFinal });
  const done = [
    ...a.done.map((p) => ({ ...p, franchiseId: String(aId) })),
    ...b.done.map((p) => ({ ...p, franchiseId: String(bId) })),
  ].sort((x, y) => y.score - x.score).slice(0, 4);
  return { through: soFar.through, a: side(a), b: side(b), done };
}
