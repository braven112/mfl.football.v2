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

/** " (shoulder)" when ESPN names the injury, else nothing. */
function injuryTag(p) {
  return p.detail ? ` (${p.detail.toLowerCase()})` : '';
}

/**
 * Doc's copy once the player's game has kicked off. It reports the INJURY:
 * no lineup advice (nobody can make a move) and no "his points so far are
 * what counts" filler, which states the obvious (Brandon, 2026-11-26).
 * tests/injury-game-state.test.ts pins both. Each template takes the injury
 * plus `gameState` ('in' | 'post').
 */
export const INJURY_TEMPLATES_LOCKED_BREAKING = [
  (p) => `${p.name} (${p.nflTeam}) has been ${ruled(p)} ${when(p)}${injuryTag(p)}. Next up is word on how serious it is.`,
  (p) => `Injury update: ${p.name} (${p.position}, ${p.nflTeam}) has been ${ruled(p)} ${when(p)}${injuryTag(p)}. His status for next week is now the question.`,
  (p) => `Bad news from the sideline: ${p.name} (${p.nflTeam}) ${p.gameState === 'in' && String(p.status).toLowerCase() === 'out' ? "won't return" : `has been ${ruled(p)} ${when(p)}`}${injuryTag(p)}. Watch for an update on how much time he could miss.`,
];

export const INJURY_TEMPLATES_LOCKED_STANDARD = [
  (p) => p.gameState === 'in'
    ? `${p.name} (${p.position}, ${p.nflTeam}) is ${String(p.status).toLowerCase()} to return${injuryTag(p)}.`
    : `${p.name} (${p.position}, ${p.nflTeam}) is listed as ${p.status} after his game${injuryTag(p)}. Keep an eye on next week's practice reports.`,
  (p) => `Injury update: ${p.name} (${p.nflTeam}) is now ${p.status} ${when(p)}${injuryTag(p)}. More to come on how serious it is.`,
];
