/**
 * Has a player's NFL game this week already kicked off?
 *
 * Doc Rivers' injury posts used to tell managers to "adjust accordingly" even
 * when the status change landed DURING the player's game — Colston Loveland
 * was ruled out mid-game on Thanksgiving 2026 and the post told owners to fix
 * a lineup MFL had already locked for him. Once his game has started, a
 * lineup change is no longer possible, so the copy must say what happened
 * (ruled out in-game, points banked so far are what counts) and never ask the
 * reader to act this week (Brandon, 2026-11-26).
 *
 * Input is ESPN's NFL scoreboard (`site.api.espn.com/.../nfl/scoreboard`),
 * which Doc already fetches as his season guard. Team codes on it are ESPN's
 * own abbreviations, the same ones the injuries feed uses.
 */

/** @typedef {'pre' | 'in' | 'post'} GameState */

/**
 * ESPN team abbreviation → that club's game state on the scoreboard.
 * A club with no game on the board (a bye) is absent.
 *
 * @param {any} scoreboard
 * @returns {Map<string, GameState>}
 */
export function gameStatesByTeam(scoreboard) {
  /** @type {Map<string, GameState>} */
  const states = new Map();
  for (const event of Array.isArray(scoreboard?.events) ? scoreboard.events : []) {
    const competition = event?.competitions?.[0];
    const state = competition?.status?.type?.state ?? event?.status?.type?.state;
    if (state !== 'pre' && state !== 'in' && state !== 'post') continue;
    for (const competitor of competition?.competitors ?? []) {
      const abbr = competitor?.team?.abbreviation;
      if (abbr) states.set(String(abbr).toUpperCase(), state);
    }
  }
  return states;
}

/**
 * True when the club's game has started (in progress or final), so its
 * players are locked in every lineup for this week.
 *
 * @param {Map<string, GameState>} states
 * @param {string} nflTeam
 */
export function hasKickedOff(states, nflTeam) {
  const state = states.get(String(nflTeam ?? '').toUpperCase());
  return state === 'in' || state === 'post';
}

/** "ruled out" for Out; "moved to <status>" for anything else. */
function ruled(p) {
  return String(p.status).toLowerCase() === 'out' ? 'ruled out' : `moved to ${p.status}`;
}

/** Where in his game the change landed. */
function when(p) {
  return p.gameState === 'in' ? 'during his game' : 'after his game';
}

function detailSentence(p) {
  return p.detail ? ` Dealing with ${p.detail.toLowerCase()}.` : '';
}

/**
 * Doc's copy once the player's game has kicked off. None of these may tell a
 * manager to change a lineup this week (tests/injury-game-state.test.ts).
 * Each template takes the injury plus `gameState` ('in' | 'post').
 */
export const INJURY_TEMPLATES_LOCKED_BREAKING = [
  (p) => `${p.name} (${p.nflTeam}) has been ${ruled(p)} ${when(p)}.${detailSentence(p)} Lineups locked at kickoff, so whatever he put up is what counts this week.`,
  (p) => `Update from the sideline: ${p.name} (${p.position}, ${p.nflTeam}) has been ${ruled(p)} ${when(p)}.${detailSentence(p)} It's too late to change lineups for him this week. His status for next week is the one to watch.`,
  (p) => `${p.name} (${p.nflTeam}) → ${p.status} ${when(p)}.${detailSentence(p)} No lineup moves left to make, since his game had already kicked off. Next week is the question now.`,
];

export const INJURY_TEMPLATES_LOCKED_STANDARD = [
  (p) => `${p.name} (${p.position}, ${p.nflTeam}) is now ${p.status} ${when(p)}.${detailSentence(p)} Lineups are already locked for him, so all managers can do is watch.`,
  (p) => `Status change for ${p.name} (${p.nflTeam}) ${when(p)}: now ${p.status}.${detailSentence(p)} Too late for lineup moves this week. Keep an eye on next week's practice reports.`,
];
