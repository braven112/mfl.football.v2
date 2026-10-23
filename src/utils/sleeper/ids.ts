/**
 * Sleeper row ids the BROWSER needs to recognize. Pure and dependency-free so
 * the board island can import it without dragging `players.ts` (node:fs, Redis)
 * into the client bundle.
 */

/** Prefix for a row id Sleeper could not resolve. Never collides with an MFL id, which is all digits. */
export const UNRESOLVED_PREFIX = 'sleeper:';

export function isUnresolvedPlayerId(id: string): boolean {
  return id.startsWith(UNRESOLVED_PREFIX);
}

/** Where an owner fixes an unmatched player: the list on Live settings. */
export const PLAYER_FIX_HREF = '/live/settings#sleeper-fixes';
