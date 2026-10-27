import type {
  MflLiveAppGameState,
  MflLiveAppLiveBoard,
  MflLiveAppLiveMatchup,
  MflLiveAppLivePanel,
  MflLiveAppLiveRow,
} from '@mfl/shared-types/mfl-live-app-a';

/**
 * What `/live` prints when a league's own setting is unknown, which on the
 * cross-league board is always. The server sends `scorePrecision`; this is
 * only for a server too old to.
 */
const FALLBACK_PRECISION = 2;

/** The web board's cadence, for a server that sends no `pollAfterMs`. */
const FALLBACK_POLL_LIVE_MS = 25_000;
const FALLBACK_POLL_IDLE_MS = 90_000;

/** MFL's "game not started" clock: a full 60 minutes. */
const FULL_GAME_SECONDS = 3600;

export function points(n: number, precision: number = FALLBACK_PRECISION): string {
  return (Number.isFinite(n) ? n : 0).toFixed(precision);
}

export function precisionOf(panel: MflLiveAppLivePanel): number {
  return panel.scorePrecision ?? FALLBACK_PRECISION;
}

/**
 * Both sides of a win-probability split, rounded ONCE so they always sum to
 * 100 (rounding each side alone prints 51% + 50% for any x.5 split).
 */
export function winSplit(p: number): [number, number] {
  const mine = Math.round(Math.min(1, Math.max(0, p)) * 100);
  return [mine, 100 - mine];
}

/**
 * The state of a player's game. The server decides it from MFL's clock; the
 * fallback reads the same clock for a server that does not send it yet.
 */
export function gameStateOf(row: MflLiveAppLiveRow): MflLiveAppGameState {
  if (row.gameState) return row.gameState;
  if (row.secondsRemaining <= 0) return 'final';
  if (row.secondsRemaining >= FULL_GAME_SECONDS) return 'not-started';
  return 'in-progress';
}

/**
 * The words beside a player. Never a game clock: MFL's seconds-left number
 * does not stop when the NFL clock does, so "7 min left" would drift all
 * afternoon. The web board prints the state and no numbers for the same reason.
 */
export function gameStateLabel(state: MflLiveAppGameState): string {
  if (state === 'final') return 'Final';
  if (state === 'not-started') return 'Yet to play';
  return 'In progress';
}

/** Every starter's game is over. */
export function isFinal(m: MflLiveAppLiveMatchup): boolean {
  if (m.isFinal !== undefined) return m.isFinal;
  const rows = [...m.mine.players, ...m.opponent.players];
  return rows.length > 0 && rows.every((r) => r.secondsRemaining <= 0);
}

function anyRowInProgress(board: MflLiveAppLiveBoard): boolean {
  return board.leagues.some((league) =>
    league.matchups.some((m) =>
      [m.mine, m.opponent].some((team) => team.players.some((p) => gameStateOf(p) === 'in-progress')),
    ),
  );
}

/** Is an NFL game on right now? */
export function isLive(board: MflLiveAppLiveBoard | null): boolean {
  if (!board) return false;
  return board.live ?? anyRowInProgress(board);
}

/** When to ask for the board again: the server's hint, read off the NFL schedule. */
export function nextPollMs(board: MflLiveAppLiveBoard | null): number {
  if (board?.pollAfterMs && board.pollAfterMs > 0) return board.pollAfterMs;
  return isLive(board) ? FALLBACK_POLL_LIVE_MS : FALLBACK_POLL_IDLE_MS;
}

/**
 * How old the scores on screen are, from when the PHONE received them. The
 * server's `fetchedAt` is another clock, and a phone a minute off would say
 * "1m ago" about scores that just arrived.
 */
export function ageLabel(receivedAt: number, now: number): string {
  if (!receivedAt) return '';
  const s = Math.max(0, Math.floor((now - receivedAt) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** The status line's word, as the web board's pill says it. */
export function feedLabel(opts: { failing: boolean; loaded: boolean; live: boolean }): string {
  if (opts.failing) return 'Reconnecting';
  if (!opts.loaded) return 'Connecting';
  return opts.live ? 'Live' : 'Tracking';
}

/**
 * How long a league's last confirmed scores may stay on screen after MFL
 * stops answering for it. The web board's own number (five minutes).
 */
export const STALE_HOLD_MS = 5 * 60 * 1000;

export interface HeldPanel {
  panel: MflLiveAppLivePanel;
  /** Phone clock when these scores were last confirmed; null when current. */
  heldSince: number | null;
}

/**
 * The panels to draw. A league MFL could not be read for (`unavailable`)
 * keeps its last confirmed panel for `STALE_HOLD_MS`, labelled with when it
 * was confirmed, as the web board does. Every other status is an answer MFL
 * GAVE (a bye, an unplayed week) and is never papered over.
 *
 * `memory` is keyed by week AND league: a held week 7 panel must not show
 * under week 8, and two leagues can share a franchise id.
 */
export function holdPanels(
  board: MflLiveAppLiveBoard,
  memory: Map<string, { panel: MflLiveAppLivePanel; at: number }>,
  receivedAt: number,
  now: number,
): HeldPanel[] {
  return board.leagues.map((panel) => {
    const key = `${board.week}:${panel.leagueId}`;
    if (panel.status === 'ok') {
      const seen = memory.get(key);
      if (!seen || seen.panel !== panel) memory.set(key, { panel, at: receivedAt });
      return { panel, heldSince: null };
    }
    if (panel.status !== 'unavailable') return { panel, heldSince: null };
    const remembered = memory.get(key);
    if (!remembered) return { panel, heldSince: null };
    if (now - remembered.at > STALE_HOLD_MS) {
      memory.delete(key);
      return { panel, heldSince: null };
    }
    return { panel: { ...remembered.panel, leagueName: panel.leagueName }, heldSince: remembered.at };
  });
}
