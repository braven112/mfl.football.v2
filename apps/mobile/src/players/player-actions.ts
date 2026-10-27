/**
 * The hook the add/drop flow plugs into (package L).
 *
 * The Players tab and the player card show an Add button on a free agent only
 * when `usePlayerAdd()` returns a function, and call it with the player and
 * the league. Until the add/drop sheet lands it returns null, so no button
 * shows. Package L replaces the body of this one file; the screens that call
 * it do not change.
 */

import type { MflLiveAppPlayerSummary } from '@mfl/shared-types/mfl-live-app-k';

export type AddPlayer = (player: MflLiveAppPlayerSummary, leagueId: string) => void;

export function usePlayerAdd(): AddPlayer | null {
  return null;
}
