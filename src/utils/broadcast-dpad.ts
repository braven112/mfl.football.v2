/**
 * The TV remote's D-pad on the Broadcast board.
 *
 * Hands-free is the board's default and stays its resting state: the strip
 * rotates and the header shows every game. The remote borrows it (owner's
 * plan, Oct 2026):
 *
 *  - **Down** takes the bottom strip and stops its rotation; **Left/Right**
 *    then step through every page that would have rotated there.
 *  - **Up** highlights a game in the header; **Left/Right** move between games
 *    and **OK** features that game, so the strip below shows only its two
 *    rosters (still rotating, hands-free). OK on the featured game drops it.
 *  - **Back** returns to the full hands-free board. A featured game stays
 *    featured until then; nothing times it out.
 *
 * Pure, so the whole key map is pinned without a DOM. The island owns the
 * keydown wiring and the history entry that lets the TV's own Back key reach
 * the page instead of leaving it.
 */
import type { BroadcastLeaguePanel } from '../types/live-broadcast';

export type DpadKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

export interface DpadState {
  /** Where the remote is: nowhere (hands-free), the strip, or the header's games. */
  zone: 'auto' | 'strip' | 'games';
  /** The highlighted game, an index into the header's game list. */
  game: number;
  /** The featured game's key (`gameKey`), or null for every game. */
  featured: string | null;
}

export const DPAD_IDLE: DpadState = { zone: 'auto', game: 0, featured: null };

export interface DpadStep {
  state: DpadState;
  /** A strip page to turn to, when the key asked for one. */
  page?: 'next' | 'prev';
  /** False when the key means nothing here, so the browser keeps it (Back leaves the page). */
  handled: boolean;
}

/** One game in the header: a league's matchup, by its index in that league. */
export const gameKey = (leagueId: string, index: number) => `${leagueId}:${index}`;

/** Anything off the hands-free board, which is what Back undoes. */
export const isSteering = (s: DpadState) => s.zone !== 'auto' || s.featured !== null;

/**
 * The games a remote can highlight, in the order the header draws them: the
 * full-size panels, then the overflow row. A league with no opponent this week
 * has nothing to feature and is skipped.
 */
export function listGames(panels: readonly BroadcastLeaguePanel[]): string[] {
  const out: string[] = [];
  for (const panel of panels) {
    for (const m of panel.matchups) {
      if (m.opponent) out.push(gameKey(panel.leagueId, m.index));
    }
  }
  return out;
}

/** A TV remote, a keyboard or a game pad, as the browser reports each. */
export function dpadKeyFrom(key: string): DpadKey | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
      return 'ok';
    case 'Escape':
    case 'Backspace':
    case 'GoBack':
    case 'BrowserBack':
      return 'back';
    default:
      return null;
  }
}

/** The panels the strip should draw: every league, or just the featured game. */
export function stripPanelsFor(
  panels: readonly BroadcastLeaguePanel[],
  featured: string | null,
): readonly BroadcastLeaguePanel[] {
  if (!featured) return panels;
  for (const panel of panels) {
    const matchup = panel.matchups.find((m) => gameKey(panel.leagueId, m.index) === featured);
    if (matchup) return [{ ...panel, matchups: [matchup] }];
  }
  // The featured game left the board (a league switched off): show everything.
  return panels;
}

export function stepDpad(state: DpadState, key: DpadKey, games: readonly string[]): DpadStep {
  const n = games.length;
  const at = (featured: string | null) => {
    const i = featured ? games.indexOf(featured) : -1;
    return i >= 0 ? i : Math.min(state.game, Math.max(0, n - 1));
  };

  if (key === 'back') {
    return isSteering(state) ? { state: DPAD_IDLE, handled: true } : { state, handled: false };
  }

  switch (state.zone) {
    case 'auto':
      if (key === 'down') return { state: { ...state, zone: 'strip' }, handled: true };
      if (key === 'left' || key === 'right') {
        return { state: { ...state, zone: 'strip' }, page: key === 'right' ? 'next' : 'prev', handled: true };
      }
      if (key === 'up' && n > 0) {
        return { state: { ...state, zone: 'games', game: at(state.featured) }, handled: true };
      }
      return { state, handled: false };

    case 'strip':
      if (key === 'left' || key === 'right') {
        return { state, page: key === 'right' ? 'next' : 'prev', handled: true };
      }
      if (key === 'up' && n > 0) {
        return { state: { ...state, zone: 'games', game: at(state.featured) }, handled: true };
      }
      if (key === 'down') return { state, handled: true };
      return { state, handled: false };

    case 'games': {
      if (n === 0) return { state: { ...state, zone: 'auto' }, handled: false };
      const game = Math.min(state.game, n - 1);
      if (key === 'left' || key === 'right') {
        const next = (game + (key === 'right' ? 1 : -1) + n) % n;
        return { state: { ...state, game: next }, handled: true };
      }
      if (key === 'down') return { state: { ...state, zone: 'strip', game }, handled: true };
      if (key === 'ok') {
        const picked = games[game];
        // OK on the featured game again is the other way back to hands-free.
        if (state.featured === picked) return { state: DPAD_IDLE, handled: true };
        return { state: { ...state, game, featured: picked }, handled: true };
      }
      // Up passes through, so the remote can still reach the controls above.
      return { state, handled: false };
    }
  }
}
