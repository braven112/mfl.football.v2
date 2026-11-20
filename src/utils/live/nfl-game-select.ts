/**
 * Which NFL game is open, shared between two islands.
 *
 * The NFL games rail (`NflGamesStrip`) and the board (`LiveBoard`) hydrate as
 * SEPARATE islands — the rail deliberately sits outside the board so it
 * survives a drill-in — and React state cannot cross island roots. A module
 * shared by both chunks can, which is the same trick `live-poll-store.ts`
 * uses so the two do not run two scoreboard pollers.
 *
 * The value is the ESPN EVENT id, an identity rather than the game object, for
 * the reason `LiveBoard` stores a matchup as one: every poll replaces the
 * slate, and a stored object would freeze the drill-in at the moment of the
 * tap while the rail beside it kept moving.
 *
 * `listeners` counts the boards that can actually open a game. The rail only
 * turns its cards into buttons when one is listening, so a page that renders
 * the rail with no board (the Brand Book's demo) never offers a tap that
 * does nothing.
 */
import { useSyncExternalStore } from 'react';

let selected: string | null = null;
let boards = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

export function selectNflGame(eventId: string | null): void {
  if (selected === eventId) return;
  selected = eventId;
  emit();
}

export function getSelectedNflGame(): string | null {
  return selected;
}

/** A board that renders the drill-in registers itself while mounted. */
export function registerNflGameBoard(): () => void {
  boards += 1;
  emit();
  return () => {
    boards = Math.max(0, boards - 1);
    if (boards === 0) selected = null;
    emit();
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSelectedNflGame(): string | null {
  return useSyncExternalStore(subscribe, () => selected, () => null);
}

/** True while some board on the page can open a game. */
export function useNflGameBoardListening(): boolean {
  return useSyncExternalStore(subscribe, () => boards > 0, () => false);
}
